import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
/** Liveness + DB check for the host's health probe. Reveals nothing sensitive. */
export async function GET() {
  try { await (await getDb()).query('select 1'); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ ok: false }, { status: 503 }); }
}
