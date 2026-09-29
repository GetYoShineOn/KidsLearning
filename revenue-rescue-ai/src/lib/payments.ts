import type { Db } from './db';
import { auditLog } from './security';

type Evt = { id: string; type: string; data: { object: Record<string, any> } }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Handle a verified Stripe event (signature already checked by the route). Idempotent: an event id is recorded only
 * AFTER it was handled, so an event we could not resolve yet (e.g. invoice.paid before checkout.session.completed)
 * returns 'unresolved' and the route answers 500 so Stripe retries it.
 * Handles: checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.deleted.
 * Status: IMPLEMENTED, tested with synthetic events; NOT verified against live Stripe.
 */
export async function handleStripeEvent(db: Db, evt: Evt): Promise<{ status: 'recorded' | 'duplicate' | 'ignored' | 'unresolved' }> {
  if ((await db.query(`select 1 from webhook_events where id=$1`, [evt.id])).length) return { status: 'duplicate' };
  const o = evt.data.object;
  const done = async (status: 'recorded' | 'ignored') => {
    await db.query(`insert into webhook_events(id, source) values ($1,'stripe') on conflict do nothing`, [evt.id]);
    return { status };
  };
  const orgByCustomer = async (cust?: string) =>
    cust ? (await db.query<{ org_id: string }>(`select org_id from subscriptions where stripe_customer_id=$1 limit 1`, [cust]))[0]?.org_id : undefined;

  switch (evt.type) {
    case 'checkout.session.completed': {
      const orgId = o.client_reference_id ?? o.metadata?.org_id;
      if (!orgId) return done('ignored');
      const total = Number(o.amount_total ?? 0);
      const existing = await db.query(`select id from subscriptions where org_id=$1 and is_simulated=false limit 1`, [orgId]);
      if (existing.length) await db.query(`update subscriptions set plan='growth', status='active', stripe_customer_id=$2, stripe_subscription_id=$3 where org_id=$1 and is_simulated=false`, [orgId, o.customer ?? null, o.subscription ?? null]);
      else await db.query(`insert into subscriptions(org_id, plan, status, monthly_cents, stripe_customer_id, stripe_subscription_id) values ($1,'growth','active',0,$2,$3)`, [orgId, o.customer ?? null, o.subscription ?? null]);
      await db.query(`update organizations set status='active' where id=$1`, [orgId]);
      await auditLog(db, orgId, 'stripe', 'checkout_completed', 'subscription', String(o.subscription ?? ''), { total });
      return done('recorded');
    }
    case 'invoice.paid': {
      const cents = Number(o.amount_paid ?? 0);
      if (!(cents > 0)) return done('ignored');
      const orgId = o.subscription_details?.metadata?.org_id ?? o.metadata?.org_id ?? await orgByCustomer(o.customer);
      if (!orgId) return { status: 'unresolved' };
      await db.query(`insert into payments(org_id, amount_cents, external_id, is_simulated) values ($1,$2,$3,false) on conflict (external_id) do nothing`, [orgId, cents, o.id ?? evt.id]);
      // Recurring amount = the largest recurring line, else the paid amount (first invoice may include one-time setup).
      const lines: { amount?: number; price?: { recurring?: unknown } }[] = o.lines?.data ?? [];
      const rec = lines.filter(l => l.price?.recurring).map(l => Number(l.amount ?? 0)).sort((a, b) => b - a)[0];
      await db.query(`update subscriptions set status='active', monthly_cents = case when $2 > 0 then $2 else monthly_cents end where org_id=$1 and is_simulated=false`, [orgId, rec ?? 0]);
      await db.query(`update organizations set status='active' where id=$1`, [orgId]);
      await auditLog(db, orgId, 'stripe', 'payment_recorded', 'payment', o.id ?? evt.id, { cents });
      return done('recorded');
    }
    case 'invoice.payment_failed': {
      const orgId = o.subscription_details?.metadata?.org_id ?? await orgByCustomer(o.customer);
      if (!orgId) return { status: 'unresolved' };
      await db.query(`update subscriptions set status='past_due' where org_id=$1 and is_simulated=false`, [orgId]);
      await auditLog(db, orgId, 'stripe', 'payment_failed', 'invoice', String(o.id ?? ''));
      return done('recorded');
    }
    case 'customer.subscription.deleted': {
      const orgId = o.metadata?.org_id ?? await orgByCustomer(o.customer);
      if (!orgId) return { status: 'unresolved' };
      await db.query(`update subscriptions set status='cancelled', cancelled_at=now() where org_id=$1 and is_simulated=false`, [orgId]);
      await db.query(`update organizations set status='churned' where id=$1`, [orgId]);
      await auditLog(db, orgId, 'stripe', 'subscription_cancelled', 'organization', orgId);
      return done('recorded');
    }
    default:
      return done('ignored');
  }
}
