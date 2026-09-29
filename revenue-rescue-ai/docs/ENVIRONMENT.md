# Environment
See `.env.example`. Never commit `.env*`.
| Var | Needed for | Notes |
|---|---|---|
| SESSION_SECRET | prod (>=32 chars) | app refuses to start sessions in production without it |
| DATABASE_URL | prod | Postgres. Unset => PGlite in `.data/` (dev only, not for production) |
| ADMIN_EMAIL / ADMIN_PASSWORD | first boot | creates the first admin at first login attempt if none exists (password >=12 chars) |
| PUBLIC_BASE_URL | webhooks, outreach links | exact public origin (Twilio signature covers URL) |
| COMPANY_POSTAL_ADDRESS, SENDER_NAME | outreach | CAN-SPAM; drafts cannot be approved with unresolved placeholders |
| HARDWARE_COST_USD | admin dashboard | enables hardware-payback tracking |
| TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER | real SMS | plus A2P 10DLC brand+campaign registration and `businesses.inbound_number` |
| STRIPE_WEBHOOK_SECRET | payments webhook | |
| ALLOW_DEMO=1 | demo tenant in prod | demo tenants use a public password; leave off |
Deploy target: any Node host (Vercel/Fly/Render) + managed Postgres. NOT deployed yet.

## Monthly budget: ~$200 (owner-set)
Estimates from memory; verify before purchasing.
| Item | Est. $/mo |
|---|---|
| Hosting (Fly/Render/Railway; Vercel Hobby forbids commercial use, Pro is $20) | 5-20 |
| Postgres (free tier first, paid at first customers) | 0-25 |
| Twilio number + SMS (capped below) + one-time A2P 10DLC fees | 5-30 |
| Domain (~$12/yr) | ~1 |
| Stripe (per-charge only), error tracking/email free tiers | 0 |
| LLM: none today; if added, hard-cap ~$20 | 0 |
Not included: one-time attorney review of SMS consent/pilot terms; your Claude subscription.

**SMS caps (enforced in code, `src/lib/budget.ts`, tested):** counts real (not simulated) outbound segments; over-cap sends are stored as BLOCKED with a reason and written to the audit log. Defaults: `SMS_CAP_ORG_DAILY=100`, `SMS_CAP_ORG_MONTHLY=1200`, `SMS_CAP_GLOBAL_MONTHLY=2500` segments, about $25-30 worst case at ~$0.01/segment. Every required-footer text is about 2 segments. Lower the globals for a tighter budget.
