import { isSafePublicUrl } from '../security';

/** Signals extracted from a business's own public homepage. All fields OBSERVED (present/absent in fetched HTML). */
export interface SiteSignals {
  fetched: boolean;
  url: string;
  error?: string;
  https: boolean;
  hasViewport: boolean;
  telLinks: number;
  hasForm: boolean;
  formFieldCount: number;
  hasBookingWidget: boolean;
  hasChat: boolean;
  hasTextOrSmsCta: boolean;
  mentionsEmergency247: boolean;
  hasReviewsMention: boolean;
  hasFinancing: boolean;
  titleLength: number;
  bytes: number;
}

const BOOKING = /(calendly\.com|acuityscheduling|housecallpro\.com|servicetitan|jobber\.com|book\s*(now|online|appointment)|schedule\s*(service|online|now|an? appointment)|leadconnectorhq|setmore)/i;
const CHAT = /(intercom|drift\.com|livechat|tawk\.to|crisp\.chat|tidio|podium|birdeye|leadconnector|hubspot.*conversations|chat\s*with\s*us)/i;

export function analyzeHtml(html: string, url: string): SiteSignals {
  const text = html.slice(0, 500_000);
  const formMatch = text.match(/<form[\s\S]*?<\/form>/i);
  const fields = formMatch ? (formMatch[0].match(/<(input|textarea|select)\b(?![^>]*type=["']?(hidden|submit|button)["']?)/gi) ?? []).length : 0;
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
  return {
    fetched: true,
    url,
    https: url.startsWith('https://'),
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(text),
    telLinks: (text.match(/href=["']tel:/gi) ?? []).length,
    hasForm: !!formMatch,
    formFieldCount: fields,
    hasBookingWidget: BOOKING.test(text),
    hasChat: CHAT.test(text),
    hasTextOrSmsCta: /href=["']sms:|text\s+us|text\s+(now|us\s+at)/i.test(text),
    mentionsEmergency247: /24\s*\/\s*7|24\s*hour|24-hour|emergency\s+service/i.test(text),
    hasReviewsMention: /reviews?|testimonials?|stars?\b|google\s+rating/i.test(text),
    hasFinancing: /financing|payment\s+plans?/i.test(text),
    titleLength: title.length,
    bytes: html.length,
  };
}

export function failedSignals(url: string, error: string): SiteSignals {
  return { fetched: false, url, error, https: url.startsWith('https://'), hasViewport: false, telLinks: 0, hasForm: false, formFieldCount: 0,
    hasBookingWidget: false, hasChat: false, hasTextOrSmsCta: false, mentionsEmergency247: false, hasReviewsMention: false, hasFinancing: false, titleLength: 0, bytes: 0 };
}

export type Fetcher = typeof fetch;

/**
 * Fetch a public homepage. SSRF-guarded (each redirect re-validated), 8s timeout, 1MB cap, GET only, honest UA.
 * Content is treated strictly as untrusted DATA: only regex feature flags leave this function, never raw text.
 */
export async function fetchSite(rawUrl: string, fetcher: Fetcher = fetch): Promise<SiteSignals> {
  const first = isSafePublicUrl(rawUrl);
  if (!first) return failedSignals(rawUrl, 'URL rejected (not a public http(s) site)');
  let u: URL = first;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res: Response = await fetcher(u.toString(), {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'RevenueRescueAuditBot/0.1 (+public homepage review requested by the business owner)', accept: 'text/html' },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc: string | null = res.headers.get('location');
        const next: URL | null = loc ? isSafePublicUrl(new URL(loc, u).toString()) : null;
        if (!next) return failedSignals(u.toString(), 'Redirect rejected');
        u = next; continue;
      }
      if (!res.ok) return failedSignals(u.toString(), `HTTP ${res.status}`);
      const ct = res.headers.get('content-type') ?? '';
      if (!/text\/html|application\/xhtml/i.test(ct)) return failedSignals(u.toString(), 'Not an HTML page');
      const buf = await res.text();
      return analyzeHtml(buf.slice(0, 1_000_000), u.toString());
    }
    return failedSignals(u.toString(), 'Too many redirects');
  } catch (e) {
    return failedSignals(u.toString(), e instanceof Error ? e.name : 'fetch failed');
  }
}
