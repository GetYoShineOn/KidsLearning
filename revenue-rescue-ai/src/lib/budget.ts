import type { Db } from './db';
import type { DeliveryMode } from './sms';

/**
 * SMS spend guard. Real texting costs roughly $0.01 per segment (estimate; verify current Twilio pricing).
 * Defaults keep a pilot phase around $25-30/month worst case. Override with env vars.
 * Simulated sends cost nothing and are never capped.
 */
export interface SmsCaps { orgDaily: number; orgMonthly: number; globalMonthly: number }

export function smsCaps(env: NodeJS.ProcessEnv = process.env): SmsCaps {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return { orgDaily: n(env.SMS_CAP_ORG_DAILY, 100), orgMonthly: n(env.SMS_CAP_ORG_MONTHLY, 1200), globalMonthly: n(env.SMS_CAP_GLOBAL_MONTHLY, 2500) };
}

export const segmentsFor = (body: string) => Math.max(1, Math.ceil(body.length / 153));

/** Returns a blocking reason if sending `body` would exceed a cap, else null. Counts REAL, non-blocked outbound segments. */
export async function smsCapReason(db: Db, orgId: string, mode: DeliveryMode, body: string, caps: SmsCaps = smsCaps(), now = new Date()): Promise<string | null> {
  if (mode !== 'REAL') return null;
  const q = async (orgScoped: boolean, since: string) => Number((await db.query<{ n: string }>(
    `select coalesce(sum(ceil(length(body) / 153.0)), 0) n from messages
      where direction='outbound' and delivery_mode='REAL' and created_at >= $1 ${orgScoped ? 'and org_id = $2' : ''}`,
    orgScoped ? [since, orgId] : [since]))[0].n);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const add = segmentsFor(body);
  if ((await q(true, dayStart)) + add > caps.orgDaily) return 'Daily SMS cap reached for this account';
  if ((await q(true, monthStart)) + add > caps.orgMonthly) return 'Monthly SMS cap reached for this account';
  if ((await q(false, monthStart)) + add > caps.globalMonthly) return 'Global monthly SMS budget reached';
  return null;
}
