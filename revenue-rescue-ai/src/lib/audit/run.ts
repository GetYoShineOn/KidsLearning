import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db';
import { INDUSTRY_KEYS } from './verticals';
import { fetchSite, type Fetcher } from './analyzer';
import { estimateOpportunity, recoveryScore, type AuditInput } from './estimate';

export const auditInputSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  website: z.string().trim().min(3).max(300),
  phone: z.string().trim().max(30).regex(/^[0-9+()\-.\s]*$/).optional().or(z.literal('').transform(() => undefined)),
  industry: z.string().refine(v => INDUSTRY_KEYS.includes(v), 'Unknown industry'),
  location: z.string().trim().max(120).optional(),
  monthlyLeads: z.coerce.number().int().min(1).max(5000).optional().or(z.literal('').transform(() => undefined)),
  avgJobValue: z.coerce.number().int().min(20).max(200000).optional().or(z.literal('').transform(() => undefined)),
});

export async function runAudit(db: Db, raw: unknown, opts: { fetcher?: Fetcher; source?: string; prospectId?: string } = {}) {
  const input = auditInputSchema.parse(raw) as AuditInput;
  const sig = await fetchSite(input.website, opts.fetcher);
  const result = estimateOpportunity(input, sig);
  const { score, breakdown } = recoveryScore(result, sig, input);
  const token = randomBytes(18).toString('base64url');
  const rows = await db.query<{ id: string }>(
    `insert into audits(public_token, prospect_id, input, findings, estimate, score, confidence, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [token, opts.prospectId ?? null, JSON.stringify(input), JSON.stringify({ findings: result.findings, signals: { ...sig } }),
      JSON.stringify({ ...result, scoreBreakdown: breakdown }), score, result.confidence, opts.source ?? 'public']);
  return { id: rows[0].id, token, score, result, signals: sig };
}
