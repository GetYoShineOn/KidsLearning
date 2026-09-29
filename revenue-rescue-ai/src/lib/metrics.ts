import type { Db } from './db';

export interface CustomerMetrics {
  recoveredCents: number;          // HIGH + MEDIUM only
  possibleCents: number;           // LOW - shown separately, never in the headline
  leadsTotal: number;
  leadsRecovered: number;          // engaged, booked or won
  appointments: number;
  jobsWon: number;
  openOpportunities: number;
  followUpsDue: number;
  medianResponseSec: number | null;
  conversionRate: number | null;   // won / leads
  recoveryRate: number | null;     // recovered / leads
  costCents: number;
  roi: number | null;              // (recovered - cost) / cost, null until real cost exists
  simulatedOnly: boolean;
}

/** All queries are scoped by org_id. Simulated-data orgs are flagged so the UI can label them. */
export async function customerMetrics(db: Db, orgId: string): Promise<CustomerMetrics> {
  const one = async <T>(sql: string) => (await db.query<T>(sql, [orgId]))[0];
  const rev = await one<{ rec: string; pos: string; sim: boolean }>(
    `select coalesce(sum(amount_cents) filter (where confidence in ('HIGH','MEDIUM')),0) rec,
            coalesce(sum(amount_cents) filter (where confidence='LOW'),0) pos,
            coalesce(bool_and(is_simulated), false) sim from revenue_events where org_id=$1`);
  const l = await one<{ total: number; recovered: number; open: number; due: number; won: number; sim: boolean }>(
    `select count(*)::int total,
            count(*) filter (where status in ('engaged','appointment_booked','won'))::int recovered,
            count(*) filter (where status in ('engaged','appointment_booked'))::int open,
            count(*) filter (where status='contacted' and first_response_at < now() - interval '24 hours')::int due,
            count(*) filter (where status='won')::int won,
            coalesce(bool_and(is_simulated), false) sim
       from leads where org_id=$1`);
  const appts = await one<{ n: number }>(`select count(*)::int n from appointments where org_id=$1`);
  const med = await one<{ m: number | null }>(
    `select percentile_cont(0.5) within group (order by extract(epoch from (first_response_at - created_at)))::float m from leads where org_id=$1 and first_response_at is not null`);
  const cost = await one<{ c: string }>(`select coalesce(sum(amount_cents),0) c from payments where org_id=$1`);
  const costCents = Number(cost.c);
  const recoveredCents = Number(rev.rec);
  return {
    recoveredCents, possibleCents: Number(rev.pos), leadsTotal: l.total, leadsRecovered: l.recovered, appointments: appts.n,
    jobsWon: l.won, openOpportunities: l.open, followUpsDue: l.due,
    medianResponseSec: med.m === null ? null : Math.round(med.m),
    conversionRate: l.total ? l.won / l.total : null,
    recoveryRate: l.total ? l.recovered / l.total : null,
    costCents, roi: costCents > 0 ? (recoveredCents - costCents) / costCents : null,
    simulatedOnly: (l.total > 0 && l.sim),
  };
}

export interface AdminMetrics {
  funnel: Record<string, number>;
  audits: number; auditsPublic: number;
  outreach: Record<string, number>;
  orgsByStatus: Record<string, number>;
  mrrCents: number; arrCents: number; simulatedMrrCents: number;
  realRevenueCents: number; firstRealPaymentAt: string | null; daysTo1000: number | null;
  recoveredCents: number;
  byIndustry: { industry: string; prospects: number; customers: number }[];
  byWorkflow: { workflow: string; leads: number; recoveredCents: number }[];
  hardware: { costCents: number | null; paybackPct: number | null };
}

export async function adminMetrics(db: Db, opts: { hardwareCostCents?: number | null; now?: Date } = {}): Promise<AdminMetrics> {
  const kv = async (sql: string) => Object.fromEntries((await db.query<{ k: string; n: number }>(sql)).map(r => [r.k, r.n]));
  const funnel = await kv(`select stage k, count(*)::int n from prospects where not is_simulated group by 1`);
  const outreach = await kv(`select o.status k, count(*)::int n from outreach o join prospects p on p.id=o.prospect_id where not p.is_simulated group by 1`);
  const orgsByStatus = await kv(`select status k, count(*)::int n from organizations where not is_simulated group by 1`);
  const a = (await db.query<{ n: number; p: number }>(`select count(*)::int n, count(*) filter (where source='public')::int p from audits`))[0];
  const mrr = (await db.query<{ real: string; sim: string }>(
    `select coalesce(sum(monthly_cents) filter (where not is_simulated and status='active'),0) real,
            coalesce(sum(monthly_cents) filter (where is_simulated and status='active'),0) sim from subscriptions`))[0];
  const pay = (await db.query<{ total: string; first: string | null; t1000: string | null }>(
    `with p as (select paid_at, sum(amount_cents) over (order by paid_at) cum from payments where not is_simulated)
     select (select coalesce(sum(amount_cents),0) from payments where not is_simulated) total,
            (select min(paid_at) from p) first,
            (select min(paid_at) from p where cum >= 100000) t1000`))[0];
  const rec = (await db.query<{ c: string }>(`select coalesce(sum(amount_cents),0) c from revenue_events where not is_simulated and confidence in ('HIGH','MEDIUM')`))[0];
  const byIndustry = await db.query<{ industry: string; prospects: number; customers: number }>(
    `select industry, count(*)::int prospects, count(*) filter (where stage='customer')::int customers from prospects where not is_simulated group by 1 order by 2 desc`);
  const byWorkflow = await db.query<{ workflow: string; leads: number; recoveredCents: string }>(
    `select coalesce(l.workflow,'manual') workflow, count(distinct l.id)::int leads,
            coalesce(sum(r.amount_cents) filter (where r.confidence in ('HIGH','MEDIUM')),0) "recoveredCents"
       from leads l left join revenue_events r on r.lead_id=l.id where not l.is_simulated group by 1`);
  const now = opts.now ?? new Date();
  const first = pay.first ? new Date(pay.first) : null;
  const t1000 = pay.t1000 ? new Date(pay.t1000) : null;
  const hc = opts.hardwareCostCents ?? null;
  return {
    funnel, audits: a.n, auditsPublic: a.p, outreach, orgsByStatus,
    mrrCents: Number(mrr.real), arrCents: Number(mrr.real) * 12, simulatedMrrCents: Number(mrr.sim),
    realRevenueCents: Number(pay.total), firstRealPaymentAt: first ? first.toISOString() : null,
    daysTo1000: first && t1000 ? Math.ceil((t1000.getTime() - first.getTime()) / 86400000) : null,
    recoveredCents: Number(rec.c), byIndustry,
    byWorkflow: byWorkflow.map(w => ({ ...w, recoveredCents: Number(w.recoveredCents) })),
    hardware: { costCents: hc, paybackPct: hc ? Math.min(100, (Number(pay.total) / hc) * 100) : null },
  };
}
void 0;
