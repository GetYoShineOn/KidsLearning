import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { hashPassword, verifyPassword, signSession, verifySession, verifyStripeSignature, isSafePublicUrl, rateLimit } from '@/lib/security';
import { fetchSite } from '@/lib/audit/analyzer';
import { auditInputSchema } from '@/lib/audit/run';
import { createMemoryDb } from './helpers';

describe('passwords & sessions', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('rejects tampered or expired sessions', () => {
    const t = signSession({ uid: 'u', role: 'owner', org: 'o' });
    expect(verifySession(t)?.org).toBe('o');
    const [p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'u', role: 'admin', org: null, exp: 9999999999 })).toString('base64url');
    expect(verifySession(`${forged}.${s}`)).toBeNull();
    expect(verifySession(`${p}.bad`)).toBeNull();
    expect(verifySession(t, Date.now() + 8 * 86400_000)).toBeNull();
    expect(verifySession(undefined)).toBeNull();
  });
});

describe('webhook signature', () => {
  const secret = 'whsec_test', body = '{"a":1}', now = 1_800_000_000_000, t = now / 1000;
  const sig = (ts: number, b = body) => `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${b}`).digest('hex')}`;
  it('accepts valid, rejects bad/stale/tampered', () => {
    expect(verifyStripeSignature(body, sig(t), secret, 300, now)).toBe(true);
    expect(verifyStripeSignature(body + ' ', sig(t), secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, sig(t - 1000), secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, sig(t), '', 300, now)).toBe(false);
  });
});

describe('SSRF guard', () => {
  it.each(['http://localhost', 'http://127.0.0.1', 'http://10.0.0.5', 'http://169.254.169.254/latest', 'http://192.168.1.1', 'http://172.20.0.1', 'file:///etc/passwd', 'ftp://x.com', 'http://[::1]/', 'http://user:pw@example.com', 'http://intranet'])(
    'blocks %s', u => expect(isSafePublicUrl(u)).toBeNull());
  it('allows public sites and adds https', () => expect(isSafePublicUrl('example.com')?.protocol).toBe('https:'));
  it('rejects redirects into private space and never throws', async () => {
    const f = (async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })) as unknown as typeof fetch;
    const s = await fetchSite('example.com', f);
    expect(s.fetched).toBe(false);
  });
  it('degrades gracefully on network failure', async () => {
    const f = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    expect((await fetchSite('example.com', f)).fetched).toBe(false);
  });
});

describe('input validation & rate limit', () => {
  it('rejects bad audit input', () => {
    expect(() => auditInputSchema.parse({ businessName: 'A', website: 'x', industry: 'hvac' })).toThrow();
    expect(() => auditInputSchema.parse({ businessName: 'Acme', website: 'acme.com', industry: 'hax' })).toThrow();
    expect(() => auditInputSchema.parse({ businessName: 'Acme', website: 'acme.com', industry: 'hvac', phone: '<script>' })).toThrow();
    expect(auditInputSchema.parse({ businessName: 'Acme', website: 'acme.com', industry: 'hvac', monthlyLeads: '' }).monthlyLeads).toBeUndefined();
  });
  it('limits per key and resets after window', async () => {
    const db = await createMemoryDb();
    const t0 = new Date('2026-01-01T00:00:00Z');
    expect(await rateLimit(db, 'k', 2, 60, t0)).toBe(true);
    expect(await rateLimit(db, 'k', 2, 60, t0)).toBe(true);
    expect(await rateLimit(db, 'k', 2, 60, t0)).toBe(false);
    expect(await rateLimit(db, 'other', 2, 60, t0)).toBe(true);
    expect(await rateLimit(db, 'k', 2, 60, new Date(t0.getTime() + 61_000))).toBe(true);
  });
});

import { verifyTwilioSignature } from '@/lib/security';
describe('twilio signature', () => {
  it('validates', () => {
    const tok = 'tok', url = 'https://x.test/api/webhooks/twilio', p = { From: '+1214', Body: 'hi' };
    const sig = createHmac('sha1', tok).update(url + 'BodyhiFrom+1214').digest('base64');
    expect(verifyTwilioSignature(tok, url, p, sig)).toBe(true);
    expect(verifyTwilioSignature(tok, url, { ...p, Body: 'x' }, sig)).toBe(false);
    expect(verifyTwilioSignature(tok, url, p, null)).toBe(false);
  });
});
