import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyTwilioSignature } from '@/lib/security';
import { defaultSmsProvider } from '@/lib/sms';
import { handleInboundSms, handleMissedCall } from '@/lib/workflows/missedCall';

/**
 * One endpoint for Twilio voice-status and inbound-SMS webhooks. Status: IMPLEMENTED, NOT verified against live Twilio.
 * Voice: configure the business number's call-status callback here; a 'no-answer'/'busy' status triggers missed-call recovery.
 */
export async function POST(req: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 501 });
  const params = Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
  const publicUrl = (process.env.PUBLIC_BASE_URL ?? '') + new URL(req.url).pathname;
  if (!verifyTwilioSignature(token, publicUrl, params, req.headers.get('x-twilio-signature'))) return NextResponse.json({ error: 'bad signature' }, { status: 403 });
  const db = await getDb();
  const to = params.To ?? params.Called;
  const biz = to ? (await db.query<{ org_id: string }>(`select org_id from businesses where inbound_number=$1`, [to]))[0] : undefined;
  if (!biz) return NextResponse.json({ ignored: 'unknown number' });
  const ctx = { db, orgId: biz.org_id, sms: defaultSmsProvider() };
  if (params.Body !== undefined && params.From) return NextResponse.json(await handleInboundSms(ctx, params.From, params.Body));
  if (['no-answer', 'busy'].includes(params.CallStatus ?? '') && params.From) return NextResponse.json(await handleMissedCall(ctx, params.From));
  return NextResponse.json({ ignored: true });
}
