import { createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from './db';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `s1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [v, saltHex, keyHex] = stored.split('$');
  if (v !== 's1' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET (>=32 chars) is required in production');
    return 'dev-only-insecure-secret-do-not-use-in-production!!';
  }
  return s;
}

export interface Session { uid: string; role: 'admin' | 'owner' | 'member'; org: string | null; exp: number }

export function signSession(s: Omit<Session, 'exp'>, ttlSec = 60 * 60 * 24 * 7, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Math.floor(now / 1000) + ttlSec })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function verifySession(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    return s.exp * 1000 > now ? s : null;
  } catch { return null; }
}

/** Verify a Stripe-style webhook signature: header "t=<ts>,v1=<hmac>" over `${t}.${rawBody}`. */
export function verifyStripeSignature(rawBody: string, header: string | null, whSecret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header || !whSecret) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', whSecret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(parts.v1), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fixed-window rate limit backed by the DB (works across instances). Returns true if allowed. */
export async function rateLimit(db: Db, key: string, limit: number, windowSec: number, now = new Date()): Promise<boolean> {
  const rows = await db.query<{ count: number }>(
    `insert into rate_limits(key, window_start, count) values ($1, $2, 1)
     on conflict (key) do update set
       count = case when rate_limits.window_start < $2::timestamptz - make_interval(secs => $3) then 1 else rate_limits.count + 1 end,
       window_start = case when rate_limits.window_start < $2::timestamptz - make_interval(secs => $3) then $2::timestamptz else rate_limits.window_start end
     returning count`,
    [key, now.toISOString(), windowSec],
  );
  return rows[0].count <= limit;
}

export async function auditLog(db: Db, orgId: string | null, actor: string, action: string, entity?: string, entityId?: string, meta: object = {}) {
  await db.query(`insert into audit_logs(org_id, actor, action, entity, entity_id, meta) values ($1,$2,$3,$4,$5,$6)`,
    [orgId, actor, action, entity ?? null, entityId ?? null, JSON.stringify(meta)]);
}

/** SSRF guard for fetching prospect websites: https/http only, no private/loopback/link-local hosts. */
export function isSafePublicUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (/^\[/.test(h) || h.includes(':')) return null; // no IPv6 literals
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return null;
  }
  return u;
}

/** Twilio request validation: base64(HMAC-SHA1(authToken, url + sorted(key+value)...)). */
export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, header: string | null): boolean {
  if (!authToken || !header) return false;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
