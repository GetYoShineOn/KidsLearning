import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/security';
import { runAudit } from '@/lib/audit/run';

export async function POST(req: Request) {
  const db = await getDb();
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const base = new URL(req.url);
  const fail = (msg: string) => NextResponse.redirect(new URL(`/?error=${encodeURIComponent(msg)}`, base), 303);
  if (!(await rateLimit(db, `audit:${ip}`, 8, 3600))) return fail('Too many reviews from this connection. Try again later.');
  if (!(await rateLimit(db, 'audit:global', 600, 3600))) return fail('We are busy right now. Try again shortly.');
  try {
    const form = Object.fromEntries((await req.formData()).entries());
    const { token } = await runAudit(db, form);
    return NextResponse.redirect(new URL(`/audit/${token}`, base), 303);
  } catch (e) {
    if (e instanceof ZodError) return fail('Please check the highlighted details: ' + e.issues.map(i => i.path.join('.')).join(', '));
    console.error('audit failed', e instanceof Error ? e.message : e);
    return fail('Something went wrong. Please try again.');
  }
}
