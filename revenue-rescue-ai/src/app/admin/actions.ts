'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { auditLog, hashPassword } from '@/lib/security';
import { runAudit } from '@/lib/audit/run';
import { INDUSTRY_KEYS } from '@/lib/audit/verticals';
import { approveOutreach, draftEmail, markSent } from '@/lib/outreach';
import { seedDemoOrg } from '@/lib/demo';

const id = z.string().uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function addProspect(fd: FormData) {
  const s = await requireAdmin();
  const d = z.object({ name: z.string().min(2).max(120), website: z.string().min(3).max(300), industry: z.string().refine(v => INDUSTRY_KEYS.includes(v)),
    location: z.string().max(120).optional(), phone: z.string().max(30).optional(), email: z.string().email().optional().or(z.literal('')) })
    .parse({ name: str(fd, 'name'), website: str(fd, 'website'), industry: str(fd, 'industry'), location: str(fd, 'location'), phone: str(fd, 'phone'), email: str(fd, 'email') });
  const db = await getDb();
  const r = await db.query<{ id: string }>(`insert into prospects(name, website, industry, location, phone, contact_email, source) values ($1,$2,$3,$4,$5,$6,'manual') returning id`,
    [d.name, d.website, d.industry, d.location || null, d.phone || null, d.email || null]);
  await auditLog(db, null, `user:${s.uid}`, 'prospect_added', 'prospect', r[0].id);
  revalidatePath('/admin');
}

export async function auditProspect(fd: FormData) {
  const s = await requireAdmin();
  const pid = id.parse(str(fd, 'id'));
  const db = await getDb();
  const p = (await db.query<{ name: string; website: string | null; industry: string; location: string | null; phone: string | null }>(`select name, website, industry, location, phone from prospects where id=$1`, [pid]))[0];
  if (!p || !p.website) return;
  const a = await runAudit(db, { businessName: p.name, website: p.website, industry: p.industry, location: p.location ?? undefined, phone: p.phone ?? undefined }, { source: 'admin', prospectId: pid });
  await db.query(`update prospects set score=$2, stage = case when stage='researched' then 'audited' else stage end where id=$1`, [pid, a.score]);
  await auditLog(db, null, `user:${s.uid}`, 'audit_run', 'prospect', pid);
  revalidatePath('/admin');
}

export async function draftOutreach(fd: FormData) {
  const s = await requireAdmin();
  const db = await getDb();
  await draftEmail(db, id.parse(str(fd, 'id')), { senderName: process.env.SENDER_NAME ?? '{{SENDER_NAME}}', baseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000' });
  await auditLog(db, null, `user:${s.uid}`, 'outreach_drafted', 'prospect', str(fd, 'id'));
  revalidatePath('/admin');
}
export async function approve(fd: FormData) {
  const s = await requireAdmin();
  const db = await getDb();
  const postal = process.env.COMPANY_POSTAL_ADDRESS;
  if (postal) await db.query(`update outreach set body = replace(replace(body,'{{COMPANY_POSTAL_ADDRESS}}',$2),'{{SENDER_NAME}}',$3) where id=$1`, [id.parse(str(fd, 'id')), postal, process.env.SENDER_NAME ?? '{{SENDER_NAME}}']);
  try { await approveOutreach(db, id.parse(str(fd, 'id')), s.uid); } catch (e) { console.error('approve refused:', e instanceof Error ? e.message : e); }
  revalidatePath('/admin');
}
export async function sent(fd: FormData) {
  const s = await requireAdmin(); const db = await getDb();
  try { await markSent(db, id.parse(str(fd, 'id')), s.uid); } catch (e) { console.error(e instanceof Error ? e.message : e); }
  revalidatePath('/admin');
}
export async function setStage(fd: FormData) {
  const s = await requireAdmin(); const db = await getDb();
  const stage = z.enum(['replied', 'qualified', 'lost', 'do_not_contact', 'customer']).parse(str(fd, 'stage'));
  await db.query(`update prospects set stage=$2 where id=$1`, [id.parse(str(fd, 'id')), stage]);
  if (stage === 'replied') await db.query(`update outreach set status='replied', replied_at=now() where prospect_id=$1 and status='sent'`, [str(fd, 'id')]);
  await auditLog(db, null, `user:${s.uid}`, `stage_${stage}`, 'prospect', str(fd, 'id'));
  revalidatePath('/admin');
}

/** Human-initiated pilot: creates org + business + owner login with an operator-chosen password (never emailed automatically). */
export async function startPilot(fd: FormData) {
  const s = await requireAdmin(); const db = await getDb();
  const d = z.object({ id, email: z.string().email(), password: z.string().min(12).max(100), tz: z.string().default('America/Chicago') })
    .parse({ id: str(fd, 'id'), email: str(fd, 'email'), password: str(fd, 'password'), tz: str(fd, 'tz') || 'America/Chicago' });
  const p = (await db.query<{ name: string; website: string | null; industry: string; location: string | null; phone: string | null }>(`select name, website, industry, location, phone from prospects where id=$1`, [d.id]))[0];
  if (!p) return;
  const org = (await db.query<{ id: string }>(`insert into organizations(name, status) values ($1,'pilot') returning id`, [p.name]))[0];
  await db.query(`insert into businesses(org_id, name, website, phone, industry, location, timezone) values ($1,$2,$3,$4,$5,$6,$7)`, [org.id, p.name, p.website, p.phone, p.industry, p.location, d.tz]);
  await db.query(`insert into users(email, password_hash, role, org_id) values ($1,$2,'owner',$3)`, [d.email.toLowerCase(), await hashPassword(d.password), org.id]);
  await db.query(`insert into subscriptions(org_id, plan, status) values ($1,'pilot','pilot')`, [org.id]);
  await db.query(`update prospects set stage='pilot' where id=$1`, [d.id]);
  await auditLog(db, org.id, `user:${s.uid}`, 'pilot_started', 'organization', org.id);
  revalidatePath('/admin');
}

/** Operator attests a payment actually received (invoice, Stripe dashboard, etc.). Recorded as REAL revenue. */
export async function recordPayment(fd: FormData) {
  const s = await requireAdmin(); const db = await getDb();
  const d = z.object({ org: id, dollars: z.coerce.number().min(1).max(100000), ref: z.string().min(3).max(100) })
    .parse({ org: str(fd, 'org'), dollars: str(fd, 'dollars'), ref: str(fd, 'ref') });
  await db.query(`insert into payments(org_id, amount_cents, external_id, is_simulated) values ($1,$2,$3,false) on conflict (external_id) do nothing`, [d.org, Math.round(d.dollars * 100), `manual:${d.ref}`]);
  await db.query(`update organizations set status='active' where id=$1 and status='pilot'`, [d.org]);
  await auditLog(db, d.org, `user:${s.uid}`, 'manual_payment_recorded', 'payment', d.ref, { dollars: d.dollars });
  revalidatePath('/admin');
}

export async function seedDemo() {
  await requireAdmin();
  // Demo tenants use a publicly documented password, so they are off in production unless explicitly enabled.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO !== '1') return;
  await seedDemoOrg(await getDb()); revalidatePath('/admin'); }
