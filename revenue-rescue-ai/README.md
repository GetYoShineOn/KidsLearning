# Revenue Rescue (working name)

Recovers revenue from leads a local service business already paid for: missed calls first, then web-lead speed, estimate follow-up, dormant reactivation.
Beachhead (from research): **residential HVAC**, then plumbing. First workflow: **missed-call text-back -> qualify -> book -> attribute revenue**.

> Lives in `revenue-rescue-ai/` inside the `KidsLearning` repo only because that is where the session started. The kids' math app in the repo root is untouched. Move to its own repo when convenient.

## Run
```
cd revenue-rescue-ai && npm install
cp .env.example .env.local   # set SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm test                     # 36 tests, embedded Postgres (PGlite), no services needed
npm run dev                  # http://localhost:3000  (public audit), /login -> /admin or /app
node scripts/financial-model.mjs 3000 > docs/FINANCIAL_MODEL.md
```
## Integration status (never assume more than this)
| Integration | Status |
|---|---|
| Postgres | REAL via `DATABASE_URL` (pg); PGlite embedded for dev/test |
| Public website audit (homepage fetch + analysis) | REAL, SSRF-guarded |
| Revenue estimate & recovery score | REAL code; all inputs are labeled ASSUMPTIONS |
| SMS (Twilio) | IMPLEMENTED, **NOT verified live** (needs credentials + A2P 10DLC). Default provider is SIMULATED |
| Twilio inbound/voice webhook | IMPLEMENTED with signature check, **NOT verified live** |
| Stripe webhook (`invoice.paid`) | IMPLEMENTED with signature check, tested with synthetic events, **NOT verified live** |
| Stripe Checkout link + subscription lifecycle webhooks | IMPLEMENTED (inline prices, no dashboard setup), tested with mock Stripe, **NOT verified live** |
| LLM (Anthropic) conversation/qualification | NOT IMPLEMENTED; intent capture is deterministic rules on purpose (see DECISION_LOG) |
| Calendar booking | NOT IMPLEMENTED (workflow creates an internal appointment or asks staff to confirm) |
| CRM write-back (Housecall Pro/Jobber/ServiceTitan) | NOT IMPLEMENTED |
| Email sending | NOT IMPLEMENTED by design: outreach is drafted, human approves and sends |
| Outbound voice / AI calling | NOT IMPLEMENTED |

Docs: `docs/DEPLOY.md`, `docs/ARCHITECTURE.md`, `ENVIRONMENT.md`, `SECURITY.md`, `DECISION_LOG.md`, `TESTING.md`, `FIRST_CUSTOMER_PLAYBOOK.md`, `FINANCIAL_MODEL.md`, `STATUS.md`, `research/`.
