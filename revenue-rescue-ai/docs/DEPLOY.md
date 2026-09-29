# Deploy (nothing here has been run; you create the accounts)
Target: Fly.io (~$5-10/mo) + a managed Postgres (Neon/Supabase free tier first). Any Docker host works.
1. Postgres: create a project, copy the pooled connection string (with `sslmode=require`).
2. `fly launch --no-deploy --copy-config` (edit `app` name in fly.toml), then:
   ```
   fly secrets set SESSION_SECRET=$(openssl rand -hex 32) DATABASE_URL='postgres://...' \
     ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD='<16+ chars>' PUBLIC_BASE_URL=https://your-domain \
     COMPANY_POSTAL_ADDRESS='...' SENDER_NAME='...' HARDWARE_COST_USD=...
   fly deploy
   ```
3. Log in at `/login` with the admin credentials, then **remove `ADMIN_PASSWORD` from secrets** (`fly secrets unset ADMIN_PASSWORD`); it is only used to create the first admin.
4. Stripe: add webhook endpoint `https://your-domain/api/webhooks/stripe` for `checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.deleted`; set `STRIPE_WEBHOOK_SECRET` and `STRIPE_SECRET_KEY`. Use test mode first: create a payment link in /admin and pay with a test card.
5. Twilio (after A2P approval): set the three TWILIO_* secrets, put the number in `businesses.inbound_number` (E.164), point the number's messaging webhook and the voice call-status callback at `https://your-domain/api/webhooks/twilio`.
6. Custom domain: `fly certs add your-domain`, then DNS.
The app refuses to start in production without `SESSION_SECRET` and `DATABASE_URL`. Health probe: `/api/health`.
Backups: enable your Postgres provider's automated backups/PITR before storing customer data.
