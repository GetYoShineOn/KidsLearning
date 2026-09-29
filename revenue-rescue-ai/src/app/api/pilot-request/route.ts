import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { auditLog, rateLimit } from '@/lib/security';

const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{10,40}$/), email: z.string().trim().toLowerCase().email().max(200) });

export async function POST(req: Request) {
  const db = await getDb();
  const base = new URL(req.url);
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const parsed = schema.safeParse(Object.fromEntries((await req.formData()).entries()));
  if (!parsed.success || !(await rateLimit(db, `pilot:${ip}`, 5, 3600))) return NextResponse.redirect(new URL('/', base), 303);
  const { token, email } = parsed.data;
  const a = (await db.query<{ id: string; prospect_id: string | null; input: { businessName: string; website: string; industry: string; location?: string; phone?: string } }>(
    `select id, prospect_id, input from audits where public_token=$1`, [token]))[0];
  if (!a) return NextResponse.redirect(new URL('/', base), 303);
  let pid = a.prospect_id;
  if (pid) {
    await db.query(`update prospects set stage = case when stage in ('do_not_contact') then stage else 'qualified' end, contact_email=$2 where id=$1`, [pid, email]);
  } else {
    pid = (await db.query<{ id: string }>(
      `insert into prospects(name, website, phone, industry, location, source, stage, contact_email, score)
       select $1,$2,$3,$4,$5,'inbound_audit','qualified',$6, score from audits where id=$7 returning id`,
      [a.input.businessName, a.input.website, a.input.phone ?? null, a.input.industry, a.input.location ?? null, email, a.id]))[0].id;
    await db.query(`update audits set prospect_id=$1 where id=$2`, [pid, a.id]);
  }
  await auditLog(db, null, 'public', 'pilot_requested', 'prospect', pid);
  return NextResponse.redirect(new URL(`/audit/${token}?sent=1`, base), 303);
}
