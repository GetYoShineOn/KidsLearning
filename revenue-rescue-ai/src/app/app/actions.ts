'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { logout, requireOrg } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { SimulatedSms } from '@/lib/sms';
import { handleMissedCall, handleInboundSms } from '@/lib/workflows/missedCall';
import { recordJobAndAttribute } from '@/lib/attribution';

export async function signOut() { await logout(); redirect('/login'); }

/** SIMULATOR ONLY: never sends a real message. Lets an owner see the workflow before real telephony is connected. */
export async function simulateMissedCall(fd: FormData) {
  const s = await requireOrg();
  const phone = z.string().regex(/^[0-9+()\-.\s]{7,20}$/).parse(String(fd.get('phone') ?? ''));
  const db = await getDb();
  await handleMissedCall({ db, orgId: s.org, sms: new SimulatedSms(), now: (() => { const d = new Date(); d.setUTCHours(17, 0, 0, 0); return d; })() }, phone);
  revalidatePath('/app');
}
export async function simulateReply(fd: FormData) {
  const s = await requireOrg();
  const phone = z.string().regex(/^[0-9+()\-.\s]{7,20}$/).parse(String(fd.get('phone') ?? ''));
  const text = z.string().min(1).max(500).parse(String(fd.get('text') ?? ''));
  const db = await getDb();
  await handleInboundSms({ db, orgId: s.org, sms: new SimulatedSms(), now: (() => { const d = new Date(); d.setUTCHours(17, 0, 0, 0); return d; })() }, phone, text);
  revalidatePath('/app');
}

/** Owner reports a job they won from a lead. Customer-reported => at most MEDIUM confidence. */
export async function reportJob(fd: FormData) {
  const s = await requireOrg();
  const leadId = z.string().uuid().parse(String(fd.get('leadId')));
  const dollars = z.coerce.number().min(1).max(1_000_000).parse(fd.get('amount'));
  const db = await getDb();
  await recordJobAndAttribute(db, s.org, leadId, Math.round(dollars * 100), 'customer', `user:${s.uid}`);
  revalidatePath('/app');
}
