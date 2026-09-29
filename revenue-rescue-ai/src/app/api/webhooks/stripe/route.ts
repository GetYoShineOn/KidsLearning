import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyStripeSignature } from '@/lib/security';
import { handleStripeEvent } from '@/lib/payments';

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 501 });
  const raw = await req.text();
  if (raw.length > 500_000 || !verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret)) return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  let evt; try { evt = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (typeof evt?.id !== 'string' || typeof evt?.type !== 'string') return NextResponse.json({ error: 'bad event' }, { status: 400 });
  const r = await handleStripeEvent(await getDb(), evt);
  // 'unresolved' (e.g. invoice before checkout completed): non-2xx so Stripe retries later.
  return NextResponse.json(r, { status: r.status === 'unresolved' ? 500 : 200 });
}
