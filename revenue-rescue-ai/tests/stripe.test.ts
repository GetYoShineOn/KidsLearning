import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryDb, seedOrg } from './helpers';
import type { Db } from '@/lib/db';
import { checkoutParams, createCheckoutSession } from '@/lib/stripe';
import { handleStripeEvent } from '@/lib/payments';
import { adminMetrics } from '@/lib/metrics';

let db: Db;
beforeEach(async () => { db = await createMemoryDb(); });

describe('checkout session creation', () => {
  const base = { orgId: 'o1', orgName: 'Acme', monthlyCents: 59900, setupCents: 49700, baseUrl: 'https://app.test' };
  it('builds subscription params with recurring + one-time setup and org metadata', () => {
    const p = checkoutParams(base);
    expect(p.get('mode')).toBe('subscription');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('59900');
    expect(p.get('line_items[0][price_data][recurring][interval]')).toBe('month');
    expect(p.get('line_items[1][price_data][unit_amount]')).toBe('49700');
    expect(p.get('line_items[1][price_data][recurring][interval]')).toBeNull();
    expect(p.get('subscription_data[metadata][org_id]')).toBe('o1');
    expect(checkoutParams({ ...base, setupCents: 0 }).get('line_items[1][quantity]')).toBeNull();
  });
  it('calls Stripe with bearer auth and returns the URL; fails safely', async () => {
    let seen: { url?: string; auth?: string } = {};
    const f = (async (u: string, init: RequestInit) => { seen = { url: u, auth: (init.headers as Record<string, string>).authorization }; return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/x' }), { status: 200 }); }) as unknown as typeof fetch;
    expect((await createCheckoutSession(base, 'sk_test_x', f)).url).toContain('checkout.stripe.com');
    expect(seen.auth).toBe('Bearer sk_test_x');
    await expect(createCheckoutSession(base, undefined, f)).rejects.toThrow(/not configured/);
    await expect(createCheckoutSession({ ...base, monthlyCents: 5 }, 'sk', f)).rejects.toThrow(/Invalid price/);
    const bad = (async () => new Response('no', { status: 402 })) as unknown as typeof fetch;
    await expect(createCheckoutSession(base, 'sk', bad)).rejects.toThrow(/HTTP 402/);
  });
});

describe('subscription lifecycle events', () => {
  it('checkout -> invoice.paid -> failed -> cancelled, with real MRR and out-of-order retry', async () => {
    const { orgId } = await seedOrg(db, 'Life');
    await db.query(`update organizations set is_simulated=false, status='pilot' where id=$1`, [orgId]);
    await db.query(`insert into subscriptions(org_id, plan, status) values ($1,'pilot','pilot')`, [orgId]);
    const invoice = { id: 'in_1', amount_paid: 109600, customer: 'cus_1', lines: { data: [{ amount: 59900, price: { recurring: {} } }, { amount: 49700, price: {} }] } };
    // invoice arrives BEFORE checkout completion: cannot resolve org -> unresolved, not recorded, so Stripe retries
    expect((await handleStripeEvent(db, { id: 'e1', type: 'invoice.paid', data: { object: invoice } })).status).toBe('unresolved');
    expect((await handleStripeEvent(db, { id: 'e2', type: 'checkout.session.completed', data: { object: { client_reference_id: orgId, customer: 'cus_1', subscription: 'sub_1' } } })).status).toBe('recorded');
    expect((await handleStripeEvent(db, { id: 'e1', type: 'invoice.paid', data: { object: invoice } })).status).toBe('recorded'); // the retry
    expect((await handleStripeEvent(db, { id: 'e1', type: 'invoice.paid', data: { object: invoice } })).status).toBe('duplicate');
    let m = await adminMetrics(db);
    expect(m.realRevenueCents).toBe(109600);   // setup + first month
    expect(m.mrrCents).toBe(59900);            // recurring only, setup excluded
    await handleStripeEvent(db, { id: 'e3', type: 'invoice.payment_failed', data: { object: { id: 'in_2', customer: 'cus_1' } } });
    expect((await db.query<{ status: string }>(`select status from subscriptions where org_id=$1`, [orgId]))[0].status).toBe('past_due');
    await handleStripeEvent(db, { id: 'e4', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } });
    m = await adminMetrics(db);
    expect(m.mrrCents).toBe(0);
    expect((await db.query<{ status: string }>(`select status from organizations where id=$1`, [orgId]))[0].status).toBe('churned');
  });
  it('ignores unknown events and zero-amount invoices', async () => {
    expect((await handleStripeEvent(db, { id: 'x1', type: 'charge.refunded', data: { object: {} } })).status).toBe('ignored');
    expect((await handleStripeEvent(db, { id: 'x2', type: 'invoice.paid', data: { object: { amount_paid: 0 } } })).status).toBe('ignored');
  });
});
