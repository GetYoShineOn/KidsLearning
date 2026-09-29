import type { Db } from './db';
import { auditLog } from './security';

interface ProspectRow { id: string; name: string; industry: string; location: string | null }
interface AuditRow { public_token: string; findings: { findings: { id: string; title: string; evidence: string; detail: string }[] }; estimate: { totalLowMonthly: number; totalHighMonthly: number; confidence: string } }

/**
 * Prepare (never send) a first-touch email draft. Personalisation uses ONLY OBSERVED findings from the prospect's own public
 * homepage. No invented facts, no fake familiarity, no claimed customer results. Requires human approval before any send.
 */
export async function draftEmail(db: Db, prospectId: string, opts: { senderName: string; baseUrl: string }) {
  const p = (await db.query<ProspectRow>(`select id, name, industry, location from prospects where id=$1`, [prospectId]))[0];
  if (!p) throw new Error('Prospect not found');
  const a = (await db.query<AuditRow>(`select public_token, findings, estimate from audits where prospect_id=$1 order by created_at desc limit 1`, [prospectId]))[0];
  if (!a) throw new Error('Run an audit before drafting outreach');
  const observed = a.findings.findings.filter(f => f.evidence === 'OBSERVED').slice(0, 2);
  const lines = observed.length ? observed.map(f => `- ${f.title}: ${f.detail}`).join('\n') : '- I did not find obvious issues on your homepage, so the estimate below rests mostly on industry assumptions.';
  const body = `Hi ${p.name} team,

I reviewed your public website and put together a short, free review of where leads could be slipping through. Two things I could see directly:
${lines}

Based on the information available, I estimate a possible opportunity of roughly $${a.estimate.totalLowMonthly.toLocaleString()}-$${a.estimate.totalHighMonthly.toLocaleString()} per month. That is an estimate from industry assumptions (confidence: ${a.estimate.confidence}), not a measurement of your actual results. The assumptions are all listed in the review.

Full review: ${opts.baseUrl}/audit/${a.public_token}

If it is useful, I can run a 14-day pilot on your missed calls. No guarantees on results. Happy to just answer questions either way.

${opts.senderName}

{{COMPANY_POSTAL_ADDRESS}}
If you would rather not hear from me, reply "no thanks" and I will not contact you again.`;
  const row = (await db.query<{ id: string }>(
    `insert into outreach(prospect_id, channel, subject, body) values ($1,'email',$2,$3) returning id`,
    [prospectId, `A quick look at ${p.name}'s lead flow`, body]))[0];
  return row.id;
}

/** Human approval gate. Refuses to approve while the CAN-SPAM postal-address placeholder is unresolved. */
export async function approveOutreach(db: Db, outreachId: string, userId: string) {
  const o = (await db.query<{ body: string; status: string; prospect_id: string; stage: string }>(
    `select o.body, o.status, o.prospect_id, p.stage from outreach o join prospects p on p.id=o.prospect_id where o.id=$1`, [outreachId]))[0];
  if (!o) throw new Error('Outreach not found');
  if (o.status !== 'draft') throw new Error(`Cannot approve a ${o.status} message`);
  if (o.stage === 'do_not_contact') throw new Error('Prospect is on the do-not-contact list');
  if (o.body.includes('{{')) throw new Error('Unresolved placeholder in message (e.g. postal address required by CAN-SPAM)');
  await db.query(`update outreach set status='approved', approved_by=$2, approved_at=now() where id=$1`, [outreachId, userId]);
  await db.query(`update prospects set stage='approved_for_outreach' where id=$1 and stage in ('researched','audited')`, [o.prospect_id]);
  await auditLog(db, null, `user:${userId}`, 'outreach_approved', 'outreach', outreachId);
}

/** Human marks that they personally sent the approved message (this system never auto-sends cold outreach). */
export async function markSent(db: Db, outreachId: string, userId: string) {
  const r = await db.query(`update outreach set status='sent', sent_at=now() where id=$1 and status='approved' returning prospect_id`, [outreachId]) as { prospect_id: string }[];
  if (!r[0]) throw new Error('Only approved messages can be marked sent');
  await db.query(`update prospects set stage='contacted' where id=$1 and stage in ('approved_for_outreach','audited','researched')`, [r[0].prospect_id]);
  await auditLog(db, null, `user:${userId}`, 'outreach_marked_sent', 'outreach', outreachId);
}
