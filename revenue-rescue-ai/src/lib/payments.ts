import type { Db } from './db';
import { auditLog } from './security';

/**
 * Handle a verified Stripe event (signature already checked by the route). Idempotent by event id.
 * Only invoice.paid is handled. Status: IMPLEMENTED and unit-tested with synthetic signed payloads;
 * NOT verified against live Stripe (no keys configured).
 */
export async function handleStripeEvent(db: Db, evt: { id: string; type: string; data: { object: Record<string, unknown> } }) {
  const dup = await db.query(`insert into webhook_events(id, source) values ($1,'stripe') on conflict do nothing returning id`, [evt.id]);
  if (dup.length === 0) return { status: 'duplicate' as const };
  if (evt.type !== 'invoice.paid') return { status: 'ignored' as const };
  const o = evt.data.object as { id?: string; amount_paid?: number; metadata?: { org_id?: string }; customer?: string };
  const cents = Number(o.amount_paid ?? 0);
  let orgId = o.metadata?.org_id;
  if (!orgId && o.customer) {
    const r = await db.query<{ org_id: string }>(`select org_id from subscriptions where stripe_customer_id=$1 limit 1`, [o.customer]);
    orgId = r[0]?.org_id;
  }
  if (!orgId || !(cents > 0)) return { status: 'ignored' as const };
  await db.query(`insert into payments(org_id, amount_cents, external_id, is_simulated) values ($1,$2,$3,false) on conflict (external_id) do nothing`, [orgId, cents, o.id ?? evt.id]);
  await db.query(`update subscriptions set status='active' where org_id=$1 and is_simulated=false`, [orgId]);
  await db.query(`update organizations set status='active' where id=$1`, [orgId]);
  await auditLog(db, orgId, 'stripe', 'payment_recorded', 'payment', o.id ?? evt.id, { cents });
  return { status: 'recorded' as const };
}
