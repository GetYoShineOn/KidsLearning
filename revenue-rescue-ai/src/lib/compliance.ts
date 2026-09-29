// Outbound messaging gate. Conservative by design (strictest-state rules applied everywhere). NOT LEGAL ADVICE.
export interface ContactConsent { sms_consent: boolean; opted_out_at: string | Date | null }

export type SendPurpose = 'missed_call_reply' | 'inbound_conversation' | 'marketing_reactivation';
export interface GateResult { ok: boolean; reason?: string }

export const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out)\s*[.!]*\s*$/i;
export const AI_DISCLOSURE = 'This is an automated assistant.';

/** Local hour (0-23) in an IANA timezone. */
export function localHour(now: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now)) % 24;
}

/**
 * - Opted out => never.
 * - Quiet hours 8am-8pm recipient-business local time => hold (strictest US state rule; FL/OK mini-TCPA).
 * - missed_call_reply: caller initiated contact; one immediate reply allowed without prior written consent.
 * - inbound_conversation: customer replied to us; conversational replies allowed.
 * - marketing_reactivation: requires recorded prior express written consent. No exceptions.
 */
export function canSendSms(c: ContactConsent, purpose: SendPurpose, now: Date, tz: string): GateResult {
  if (c.opted_out_at) return { ok: false, reason: 'Contact opted out' };
  const h = localHour(now, tz);
  const quiet = h < 8 || h >= 20;
  if (purpose === 'marketing_reactivation') {
    if (!c.sms_consent) return { ok: false, reason: 'No recorded SMS marketing consent' };
    if (quiet) return { ok: false, reason: 'Quiet hours (8am-8pm local)' };
    return { ok: true };
  }
  if (purpose === 'missed_call_reply' && quiet) {
    // An immediate reply to a customer-initiated call is low risk, but we still hold overnight texts until morning.
    return { ok: false, reason: 'Quiet hours (8am-8pm local); queue for morning' };
  }
  return { ok: true };
}

/** Every outbound customer message must disclose automation and offer opt-out. */
export function withRequiredFooter(body: string, businessName: string): string {
  return `${body}\n\n- ${businessName}. ${AI_DISCLOSURE} Reply STOP to opt out.`;
}
