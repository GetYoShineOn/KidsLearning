import { verticalFor } from './verticals';
import type { SiteSignals } from './analyzer';

export type Evidence = 'OBSERVED' | 'ESTIMATED' | 'INFERRED' | 'UNKNOWN';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AuditInput {
  businessName: string;
  website: string;
  phone?: string;
  industry: string;
  location?: string;
  /** Optional owner-supplied facts. Supplying them raises confidence. */
  monthlyLeads?: number;
  avgJobValue?: number;
}

export interface Finding {
  id: string;
  title: string;
  evidence: Evidence;
  detail: string;
  leak: 'missed_call' | 'web_lead' | 'estimate_followup' | 'dormant' | 'site' | 'none';
}

export interface LeakEstimate {
  leak: 'missed_call' | 'web_lead' | 'estimate_followup';
  label: string;
  lowMonthly: number;
  highMonthly: number;
  assumptions: string[];
}

export interface AuditResult {
  findings: Finding[];
  leaks: LeakEstimate[];
  totalLowMonthly: number;
  totalHighMonthly: number;
  confidence: Confidence;
  confidenceReasons: string[];
  disclaimer: string;
}

const r50 = (n: number) => Math.round(n / 50) * 50;

export function buildFindings(sig: SiteSignals, input: AuditInput): Finding[] {
  const f: Finding[] = [];
  const v = verticalFor(input.industry);
  if (!sig.fetched) {
    f.push({ id: 'site_unreadable', title: 'We could not read your website', evidence: 'UNKNOWN', leak: 'site',
      detail: `Site checks were skipped (${sig.error ?? 'unknown error'}). The estimate below relies on industry assumptions only.` });
    return f;
  }
  if (!sig.hasViewport) f.push({ id: 'no_viewport', title: 'Homepage may not be mobile-friendly', evidence: 'OBSERVED', leak: 'site',
    detail: 'No mobile viewport tag found. Most home-service searches happen on phones.' });
  if (sig.telLinks === 0) f.push({ id: 'no_tap_to_call', title: 'No tap-to-call link found', evidence: 'OBSERVED', leak: 'missed_call',
    detail: 'No tel: links on the homepage. Phone visitors must copy or retype your number.' });
  if (!sig.hasForm) f.push({ id: 'no_form', title: 'No contact form found on the homepage', evidence: 'OBSERVED', leak: 'web_lead',
    detail: 'Visitors who prefer not to call have no obvious way to request service.' });
  else if (sig.formFieldCount > 6) f.push({ id: 'long_form', title: `Contact form has ${sig.formFieldCount} fields`, evidence: 'OBSERVED', leak: 'web_lead',
    detail: 'Long forms tend to reduce completion, especially on mobile.' });
  if (!sig.hasBookingWidget) f.push({ id: 'no_booking', title: 'No online booking option detected', evidence: 'OBSERVED', leak: 'web_lead',
    detail: 'We found no scheduling widget or "book online" language.' });
  if (!sig.hasChat && !sig.hasTextOrSmsCta) f.push({ id: 'no_text_channel', title: 'No text or chat channel detected', evidence: 'OBSERVED', leak: 'missed_call',
    detail: 'No live chat or "text us" option found. A missed call has no low-effort alternative for the customer.' });
  if (v.emergency && !sig.mentionsEmergency247) f.push({ id: 'no_247_claim', title: 'No 24/7 or emergency availability shown', evidence: 'OBSERVED', leak: 'missed_call',
    detail: 'Urgent-service customers often call the next provider if nobody answers, especially after hours.' });
  if (!sig.https) f.push({ id: 'no_https', title: 'Site is not served over HTTPS', evidence: 'OBSERVED', leak: 'site', detail: 'Browsers flag non-HTTPS sites as "not secure", which erodes trust.' });
  // Things we cannot see from a public homepage:
  f.push({ id: 'answer_rate_unknown', title: 'Your actual missed-call rate', evidence: 'UNKNOWN', leak: 'missed_call',
    detail: 'Only your phone records can show this. We assume a range for your industry.' });
  f.push({ id: 'followup_unknown', title: 'Estimate and lead follow-up habits', evidence: 'UNKNOWN', leak: 'estimate_followup',
    detail: 'We cannot see your CRM. Estimate follow-up gaps are INFERRED from industry patterns, not observed.' });
  f.push({ id: 'dormant_unknown', title: 'Dormant lead and past-customer list', evidence: 'UNKNOWN', leak: 'dormant',
    detail: 'Reactivation value needs your customer list. Not estimated here.' });
  return f;
}

const gm = (a: number, b: number) => Math.sqrt(a * b);
/** Uncertainty band applied around the central estimate. Compounding every low/high assumption yields absurd ranges. */
export const BAND: [number, number] = [0.4, 2.2];

export function estimateOpportunity(input: AuditInput, sig: SiteSignals): AuditResult {
  const v = verticalFor(input.industry);
  const findings = buildFindings(sig, input);
  const has = (id: string) => findings.some(x => x.id === id);

  // Central values: what the owner told us, else the geometric midpoint of the vertical assumption range.
  const leads = input.monthlyLeads ?? gm(...v.monthlyLeads);
  const job = input.avgJobValue ?? gm(...v.jobValue);
  const close = gm(...v.closeRate);

  // Site friction nudges assumed rates upward (INFERRED). Small and bounded.
  const phoneFriction = (has('no_tap_to_call') ? 0.03 : 0) + (has('no_text_channel') ? 0.03 : 0) + (has('no_247_claim') ? 0.04 : 0);
  const webFriction = (has('no_form') ? 0.05 : 0) + (has('long_form') ? 0.04 : 0) + (has('no_booking') ? 0.03 : 0);

  const callShare = 0.6, webShare = 0.4, estShare = 0.35;
  const missed = 0.27 + phoneFriction;   // share of inbound calls unanswered (industry base ~27%, see docs/research)
  const textBack = 0.15;                 // share of missed callers who re-engage via a fast text (assumption)
  const slow = 0.3 + webFriction;        // share of web leads answered too slowly or never (assumption)
  const webRec = 0.12;                   // share of those recoverable with an instant reply (assumption)
  const noFollow = 0.3, estRec = 0.1;    // estimates with no structured follow-up / share winnable (assumption)

  const band = (c: number): [number, number] => [r50(c * BAND[0]), r50(c * BAND[1])];
  const jobTxt = input.avgJobValue ? `$${input.avgJobValue} (you told us)` : `about $${Math.round(job)} (industry assumption)`;
  const leadTxt = input.monthlyLeads ? `${input.monthlyLeads} inbound leads/month (you told us)` : `about ${Math.round(leads)} inbound leads/month (industry assumption)`;
  const bandTxt = `Range shown is the central estimate x${BAND[0]} to x${BAND[1]}, because every input above is uncertain.`;

  const mcC = leads * callShare * missed * textBack * close * job;
  const wlC = leads * webShare * slow * webRec * close * job;
  const efC = leads * estShare * noFollow * estRec * job;
  const [mcLo, mcHi] = band(mcC), [wlLo, wlHi] = band(wlC), [efLo, efHi] = band(efC);
  const leaks: LeakEstimate[] = [
    { leak: 'missed_call', label: 'Missed-call recovery', lowMonthly: mcLo, highMonthly: mcHi, assumptions: [
      leadTxt, `~${callShare * 100}% of leads arrive by phone`, `${Math.round(missed * 100)}% of calls assumed unanswered (not measured; only your phone records can show this)`,
      `${textBack * 100}% of missed callers assumed to re-engage after a fast text`, `${Math.round(close * 100)}% of engaged leads assumed to become jobs at ${jobTxt}`, bandTxt] },
    { leak: 'web_lead', label: 'Web-lead speed-to-response', lowMonthly: wlLo, highMonthly: wlHi, assumptions: [
      `~${webShare * 100}% of leads arrive via web forms`, `${Math.round(slow * 100)}% assumed answered too slowly or never`, `${webRec * 100}% of those assumed recoverable with an instant reply`, bandTxt] },
    { leak: 'estimate_followup', label: 'Estimate follow-up', lowMonthly: efLo, highMonthly: efHi, assumptions: [
      `~${estShare * 100}% of leads assumed to reach an estimate`, `${noFollow * 100}% of estimates assumed to get no structured follow-up (INFERRED, not observed)`, `${estRec * 100}% of those assumed winnable with timed follow-up`, bandTxt] },
  ];
  const totalLow = leaks.reduce((a, l) => a + l.lowMonthly, 0);
  const totalHigh = leaks.reduce((a, l) => a + l.highMonthly, 0);

  const reasons: string[] = [];
  let confidence: Confidence = 'LOW';
  if (input.monthlyLeads && input.avgJobValue) { confidence = 'MEDIUM'; reasons.push('You supplied lead volume and average job value.'); }
  else reasons.push('Lead volume and/or job value are industry assumptions.');
  if (!sig.fetched) { confidence = 'LOW'; reasons.push('Website could not be read.'); }
  reasons.push('No call records or CRM data were available. Confidence cannot be HIGH until we see real data.');

  return {
    findings, leaks, totalLowMonthly: totalLow, totalHighMonthly: Math.max(totalHigh, totalLow),
    confidence, confidenceReasons: reasons,
    disclaimer: 'Based on the information available, this is an estimated opportunity range, not a measurement of past losses and not a guarantee of future results.',
  };
}

/**
 * Revenue Recovery Score (0-100): an INTERNAL prospect-prioritisation heuristic, not a scientific measure.
 * Weights: economics 45, fixability 25, reachability 15, readiness 15.
 */
export function recoveryScore(res: AuditResult, sig: SiteSignals, input: AuditInput): { score: number; breakdown: Record<string, number> } {
  const econ = Math.min(1, Math.log10(1 + res.totalHighMonthly) / Math.log10(1 + 20000)) * 45;
  const observed = res.findings.filter(f => f.evidence === 'OBSERVED' && f.leak !== 'site').length;
  const fix = Math.min(1, observed / 4) * 25;
  const reach = ((input.phone ? 0.6 : 0) + (sig.telLinks > 0 ? 0.4 : 0.2)) * 15;
  const ready = (sig.fetched ? 0.6 : 0.2) * 15 + (input.monthlyLeads ? 0.4 * 15 : 0);
  const breakdown = { economics: Math.round(econ), fixability: Math.round(fix), reachability: Math.round(reach), readiness: Math.round(Math.min(15, ready)) };
  const score = Math.max(0, Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0)));
  return { score, breakdown };
}
