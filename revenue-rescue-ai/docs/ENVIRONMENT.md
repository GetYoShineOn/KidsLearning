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
