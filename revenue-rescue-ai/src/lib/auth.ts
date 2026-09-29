import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { hashPassword, signSession, verifyPassword, verifySession, type Session } from './security';

const COOKIE = 'rr_session';

export async function getSession(): Promise<Session | null> {
  return verifySession((await cookies()).get(COOKIE)?.value);
}
export async function requireAdmin(): Promise<Session> {
  const s = await getSession();
  if (!s || s.role !== 'admin') redirect('/login');
  return s;
}
export async function requireOrg(): Promise<Session & { org: string }> {
  const s = await getSession();
  if (!s || !s.org) redirect('/login');
  return s as Session & { org: string };
}

/** Create the first admin from ADMIN_EMAIL/ADMIN_PASSWORD if no admin exists. */
async function bootstrapAdmin() {
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: pw } = process.env;
  if (!email || !pw || pw.length < 12) return;
  const db = await getDb();
  const has = await db.query(`select 1 from users where role='admin' limit 1`);
  if (has.length === 0) await db.query(`insert into users(email, password_hash, role) values ($1,$2,'admin')`, [email.toLowerCase(), await hashPassword(pw)]);
}

export async function login(email: string, password: string): Promise<boolean> {
  await bootstrapAdmin();
  const db = await getDb();
  const u = (await db.query<{ id: string; password_hash: string; role: Session['role']; org_id: string | null }>(
    `select id, password_hash, role, org_id from users where email=$1`, [email.trim().toLowerCase()]))[0];
  // Verify against a dummy hash when the user is missing to keep timing uniform.
  const ok = await verifyPassword(password, u?.password_hash ?? 's1$00$00');
  if (!u || !ok) return false;
  (await cookies()).set(COOKIE, signSession({ uid: u.id, role: u.role, org: u.org_id }), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  });
  return true;
}
export async function logout() { (await cookies()).delete(COOKIE); }
