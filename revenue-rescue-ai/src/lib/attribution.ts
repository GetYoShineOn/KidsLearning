import type { Db } from './db';
import { auditLog } from './security';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AttributionEvidence {
  outreachSentAt: string | null;
  customerRepliedAfterOutreach: boolean;
  appointmentThroughWorkflow: boolean;
  jobReportedBy: 'customer' | 'crm' | 'operator';
  daysFromOutreachToJob: number | null;
  notes: string[];
}

/**
 * HIGH:   customer replied to our outreach AND booked through the workflow AND the job value came from the CRM.
 * MEDIUM: customer replied to our outreach AND (appointment via workflow OR job reported) but not all HIGH conditions.
 * LOW:    we contacted them but there is no evidence the customer engaged because of us. Never counted as "recovered".
 * Jobs more than 60 days after first outreach are capped at LOW.
 */
export function scoreAttribution(e: AttributionEvidence): Confidence {
  if (!e.outreachSentAt) return 'LOW';
  if (e.daysFromOutreachToJob !== null && e.daysFromOutreachToJob > 60) return 'LOW';
  if (!e.customerRepliedAfterOutreach) return 'LOW';
  if (e.appointmentThroughWorkflow && e.jobReportedBy === 'crm') return 'HIGH';
  return 'MEDIUM';
}

export async function recordJobAndAttribute(db: Db, orgId: string, leadId: string, valueCents: number,
  reportedBy: 'customer' | 'crm' | 'operator', actor: string, now = new Date()) {
  const lead = (await db.query<{ id: string; workflow: string | null; is_simulated: boolean }>(
    `select id, workflow, is_simulated from leads where id=$1 and org_id=$2`, [leadId, orgId]))[0];
  if (!lead) throw new Error('Lead not found');
  const firstOut = (await db.query<{ created_at: string }>(
    `select created_at from messages where org_id=$1 and lead_id=$2 and direction='outbound' and delivery_mode <> 'BLOCKED' order by created_at limit 1`, [orgId, leadId]))[0];
  const replied = firstOut ? (await db.query<{ n: number }>(
    `select count(*)::int n from messages where org_id=$1 and lead_id=$2 and direction='inbound' and created_at >= $3`, [orgId, leadId, firstOut.created_at]))[0].n > 0 : false;
  const appt = (await db.query<{ n: number }>(`select count(*)::int n from appointments where org_id=$1 and lead_id=$2`, [orgId, leadId]))[0].n > 0;
  const job = (await db.query<{ id: string }>(`insert into jobs(org_id, lead_id, value_cents, reported_by) values ($1,$2,$3,$4) returning id`, [orgId, leadId, valueCents, reportedBy]))[0];
  const days = firstOut ? Math.floor((now.getTime() - new Date(firstOut.created_at).getTime()) / 86400000) : null;
  const evidence: AttributionEvidence = {
    outreachSentAt: firstOut?.created_at ? new Date(firstOut.created_at).toISOString() : null,
    customerRepliedAfterOutreach: replied, appointmentThroughWorkflow: appt, jobReportedBy: reportedBy, daysFromOutreachToJob: days,
    notes: reportedBy === 'customer' ? ['Job value self-reported; not verified against CRM/invoice.'] : [],
  };
  const confidence = scoreAttribution(evidence);
  await db.query(`insert into revenue_events(org_id, lead_id, job_id, workflow, amount_cents, confidence, evidence, is_simulated) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [orgId, leadId, job.id, lead.workflow ?? 'manual', valueCents, confidence, JSON.stringify(evidence), lead.is_simulated]);
  await db.query(`update leads set status='won' where id=$1 and org_id=$2`, [leadId, orgId]);
  await auditLog(db, orgId, actor, 'job_recorded', 'lead', leadId, { valueCents, confidence, reportedBy });
  return { jobId: job.id, confidence, evidence };
}
