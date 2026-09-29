/**
 * Minimal Stripe client over fetch (no SDK). Status: IMPLEMENTED, unit-tested with a mock fetch,
 * NOT verified against live Stripe (no keys yet). Prices are inline (price_data), so no dashboard setup is needed.
 */
export interface CheckoutInput { orgId: string; orgName: string; monthlyCents: number; setupCents: number; baseUrl: string; email?: string }

export function checkoutParams(i: CheckoutInput): URLSearchParams {
  const p = new URLSearchParams();
  p.set('mode', 'subscription');
  p.set('client_reference_id', i.orgId);
  p.set('metadata[org_id]', i.orgId);
  p.set('subscription_data[metadata][org_id]', i.orgId);
  p.set('success_url', `${i.baseUrl}/app?paid=1`);
  p.set('cancel_url', `${i.baseUrl}/app`);
  if (i.email) p.set('customer_email', i.email);
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', 'usd');
  p.set('line_items[0][price_data][unit_amount]', String(i.monthlyCents));
  p.set('line_items[0][price_data][recurring][interval]', 'month');
  p.set('line_items[0][price_data][product_data][name]', `Stillwarm - monthly (${i.orgName})`);
  if (i.setupCents > 0) {
    p.set('line_items[1][quantity]', '1');
    p.set('line_items[1][price_data][currency]', 'usd');
    p.set('line_items[1][price_data][unit_amount]', String(i.setupCents));
    p.set('line_items[1][price_data][product_data][name]', 'One-time setup');
  }
  return p;
}

export async function createCheckoutSession(i: CheckoutInput, secretKey = process.env.STRIPE_SECRET_KEY, fetcher: typeof fetch = fetch): Promise<{ url: string }> {
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (!(i.monthlyCents >= 100) || i.setupCents < 0) throw new Error('Invalid price');
  const res = await fetcher('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: checkoutParams(i),
  });
  if (!res.ok) throw new Error(`Stripe checkout failed: HTTP ${res.status}`);
  const j = (await res.json()) as { url?: string };
  if (!j.url) throw new Error('Stripe returned no checkout URL');
  return { url: j.url };
}
