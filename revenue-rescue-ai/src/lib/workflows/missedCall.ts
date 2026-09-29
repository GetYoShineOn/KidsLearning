import type { Db } from '../db';
import { auditLog } from '../security';
import { canSendSms, STOP_WORDS, withRequiredFooter } from '../compliance';
import { normalizePhone, type SmsProvider } from '../sms';

interface Biz { id: string; org_id: string; name: string; timezone: string; auto_book: boolean }
interface OrgCtx { db: Db; orgId: string; sms: SmsProvider; now?: Date }

async function business(db: Db, orgId: string): Promise<Biz> {
  const b = (await db.query<Biz>(`select id, org_id, name, timezone, auto_book from businesses where org_id = $1 order by created_at limit 1`, [orgId]))[0];
  if (!b) throw new Error('Organization has no business profile');
  return b;
}

async function upsertContact(db: Db, orgId: string, phone: string) {
  const ex = (await db.query<{ id: string; sms_consent: boolean; opted_out_at: string | null }>(
    `select id, sms_consent, opted_out_at from contacts where org_id=$1 and phone=$2 limit 1`, [orgId, phone]))[0];
  if (ex) return ex;
  return (await db.query<{ id: string; sms_consent: boolean; opted_out_at: string | null }>(
    `insert into contacts(org_id, phone) values ($1,$2) returning id, sms_consent, opted_out_at`, [orgId, phone]))[0];
}

async function record(db: Db, orgId: string, leadId: string, direction: 'inbound' | 'outbound', body: string, mode: 'REAL' | 'SIMULATED' | 'BLOCKED', blocked?: string) {
  await db.query(`insert into messages(org_id, lead_id, direction, channel, body, delivery_mode, blocked_reason) values ($1,$2,$3,'sms',$4,$5,$6)`,
    [orgId, leadId, direction, body, mode, blocked ?? null]);
}

async function sendOut(ctx: OrgCtx, biz: Biz, leadId: string, contact: { sms_consent: boolean; opted_out_at: string | null }, to: string, text: string, purpose: 'missed_call_reply' | 'inbound_conversation') {
  const now = ctx.now ?? new Date();
  const gate = canSendSms(contact, purpose, now, biz.timezone);
  const body = withRequiredFooter(text, biz.name);
  if (!gate.ok) { await record(ctx.db, ctx.orgId, leadId, 'outbound', body, 'BLOCKED', gate.reason); return false; }
  await ctx.sms.send(to, body);
  await record(ctx.db, ctx.orgId, leadId, 'outbound', body, ctx.sms.mode);
  return true;
}

/** A call to the business went unanswered. Create the lead and send one compliant text-back. */
export async function handleMissedCall(ctx: OrgCtx, callerPhoneRaw: string) {
  const phone = normalizePhone(callerPhoneRaw);
  if (!phone) throw new Error('Invalid caller phone');
  const biz = await business(ctx.db, ctx.orgId);
  const contact = await upsertContact(ctx.db, ctx.orgId, phone);
  // Dedupe: an open lead for this contact within 24h reuses the thread.
  const open = (await ctx.db.query<{ id: string }>(
    `select id from leads where org_id=$1 and contact_id=$2 and status in ('new','contacted','engaged') and created_at > now() - interval '24 hours' limit 1`, [ctx.orgId, contact.id]))[0];
  if (open) return { leadId: open.id, deduped: true, sent: false };
  const lead = (await ctx.db.query<{ id: string }>(
    `insert into leads(org_id, contact_id, source, workflow, is_simulated) values ($1,$2,'missed_call','missed_call_recovery',$3) returning id`,
    [ctx.orgId, contact.id, ctx.sms.mode === 'SIMULATED'], ))[0];
  const sent = await sendOut(ctx, biz, lead.id, contact, phone,
    `Sorry we missed your call! What do you need help with? A quick reply here lets us get you scheduled faster.`, 'missed_call_reply');
  if (sent) await ctx.db.query(`update leads set status='contacted', first_response_at=$2 where id=$1 and org_id=$3`, [lead.id, new Date().toISOString(), ctx.orgId]);
  await auditLog(ctx.db, ctx.orgId, 'workflow:missed_call', sent ? 'lead_created_text_sent' : 'lead_created_text_held', 'lead', lead.id);
  return { leadId: lead.id, deduped: false, sent };
}

/**
 * Deterministic intent capture. Inbound text is UNTRUSTED DATA: it is only ever matched against fixed patterns
 * and stored verbatim as a quoted note. It never selects tools, prompts or instructions.
 */
export function classifyReply(text: string): { kind: 'slot'; slot: 1 | 2 } | { kind: 'need' } {
  const t = text.trim();
  if (/^[12]$/.test(t)) return { kind: 'slot', slot: Number(t) as 1 | 2 };
  return { kind: 'need' };
}

export async function handleInboundSms(ctx: OrgCtx, fromRaw: string, body: string) {
  const from = normalizePhone(fromRaw);
  if (!from) throw new Error('Invalid sender phone');
  const text = body.slice(0, 1000);
  const biz = await business(ctx.db, ctx.orgId);
  const contact = (await ctx.db.query<{ id: string; sms_consent: boolean; opted_out_at: string | null }>(
    `select id, sms_consent, opted_out_at from contacts where org_id=$1 and phone=$2 limit 1`, [ctx.orgId, from]))[0];
  if (!contact) return { handled: false as const, reason: 'unknown sender' };
  const lead = (await ctx.db.query<{ id: string; status: string }>(
    `select id, status from leads where org_id=$1 and contact_id=$2 and status in ('contacted','engaged','new') order by created_at desc limit 1`, [ctx.orgId, contact.id]))[0];
  if (STOP_WORDS.test(text)) {
    await ctx.db.query(`update contacts set opted_out_at = now(), sms_consent=false where id=$1 and org_id=$2`, [contact.id, ctx.orgId]);
    if (lead) { await record(ctx.db, ctx.orgId, lead.id, 'inbound', text, ctx.sms.mode); await ctx.db.query(`update leads set status='opted_out' where id=$1 and org_id=$2`, [lead.id, ctx.orgId]); }
    await auditLog(ctx.db, ctx.orgId, 'contact', 'opt_out', 'contact', contact.id);
    return { handled: true as const, action: 'opted_out' as const };
  }
  if (!lead) return { handled: false as const, reason: 'no open lead' };
  await record(ctx.db, ctx.orgId, lead.id, 'inbound', text, ctx.sms.mode);
  const intent = classifyReply(text);
  if (intent.kind === 'need' && lead.status !== 'engaged') {
    await ctx.db.query(`update leads set status='engaged', service_need=$2 where id=$1 and org_id=$3`, [lead.id, text.slice(0, 300), ctx.orgId]);
    await sendOut(ctx, biz, lead.id, contact, from, `Thanks, got it. When works best? Reply 1 for a morning visit or 2 for an afternoon visit, and a team member will confirm.`, 'inbound_conversation');
    return { handled: true as const, action: 'engaged' as const, leadId: lead.id };
  }
  if (intent.kind === 'slot') {
    const now = ctx.now ?? new Date();
    const start = new Date(now); start.setUTCDate(start.getUTCDate() + 1); start.setUTCHours(intent.slot === 1 ? 15 : 19, 0, 0, 0);
    await ctx.db.query(`update leads set status = case when $3 then 'appointment_booked' else 'engaged' end where id=$1 and org_id=$2`, [lead.id, ctx.orgId, biz.auto_book]);
    if (biz.auto_book) {
      await ctx.db.query(`insert into appointments(org_id, lead_id, starts_at) values ($1,$2,$3)`, [ctx.orgId, lead.id, start.toISOString()]);
      await sendOut(ctx, biz, lead.id, contact, from, `You're on the schedule for tomorrow ${intent.slot === 1 ? 'morning' : 'afternoon'}. A team member will confirm the exact arrival window.`, 'inbound_conversation');
      await auditLog(ctx.db, ctx.orgId, 'workflow:missed_call', 'appointment_booked', 'lead', lead.id);
      return { handled: true as const, action: 'booked' as const, leadId: lead.id };
    }
    await sendOut(ctx, biz, lead.id, contact, from, `Thanks! A team member will call to confirm your ${intent.slot === 1 ? 'morning' : 'afternoon'} visit.`, 'inbound_conversation');
    await auditLog(ctx.db, ctx.orgId, 'workflow:missed_call', 'staff_confirmation_requested', 'lead', lead.id);
    return { handled: true as const, action: 'staff_confirm' as const, leadId: lead.id };
  }
  return { handled: true as const, action: 'noted' as const, leadId: lead.id };
}
