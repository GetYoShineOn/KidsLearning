export type DeliveryMode = 'REAL' | 'SIMULATED';
export interface SmsProvider {
  readonly mode: DeliveryMode;
  send(to: string, body: string): Promise<{ id: string }>;
}

/** SIMULATED: records nothing externally. Messages are stored with delivery_mode=SIMULATED. */
export class SimulatedSms implements SmsProvider {
  readonly mode = 'SIMULATED' as const;
  sent: { to: string; body: string }[] = [];
  async send(to: string, body: string) { this.sent.push({ to, body }); return { id: `sim_${this.sent.length}` }; }
}

/**
 * REAL (implemented, NOT yet verified against live Twilio - needs credentials + A2P 10DLC registration).
 * Uses Twilio's Messages REST API directly to avoid an SDK dependency.
 */
export class TwilioSms implements SmsProvider {
  readonly mode = 'REAL' as const;
  constructor(private sid: string, private token: string, private from: string, private fetcher: typeof fetch = fetch) {}
  async send(to: string, body: string) {
    const res = await this.fetcher(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(`${this.sid}:${this.token}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: this.from, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio send failed: HTTP ${res.status}`);
    const j = (await res.json()) as { sid: string };
    return { id: j.sid };
  }
}

export function defaultSmsProvider(): SmsProvider {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM_NUMBER: from } = process.env;
  return sid && tok && from ? new TwilioSms(sid, tok, from) : new SimulatedSms();
}

export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, '');
  const digits = d.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (d.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}
