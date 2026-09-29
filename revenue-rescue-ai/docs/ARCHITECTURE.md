# Architecture
Next.js (App Router, TS) + Postgres. One deployable. No microservices, no agent framework.

```
src/lib/audit/    analyzer (fetch+parse public homepage) -> estimate (ranges, evidence labels, score) -> run (persist)
src/lib/workflows missedCall: missed call -> compliance gate -> text-back -> reply capture -> slot -> appointment
src/lib/compliance.ts  quiet hours, opt-out, consent by purpose, AI disclosure footer
src/lib/attribution.ts job -> revenue_event with HIGH/MEDIUM/LOW confidence + stored evidence
src/lib/metrics.ts     customerMetrics(orgId) / adminMetrics()  (real vs simulated separated)
src/lib/outreach.ts    draft -> human approve -> human marks sent (no auto-send)
src/lib/payments.ts    idempotent Stripe event handler
src/app/               / (audit), /audit/[token], /login, /app (customer), /admin (operator), /api/*
```
Data model: see `src/lib/schema.ts`. Tenant tables carry `org_id`; every query in tenant code filters on it (tested). `is_simulated` on orgs/leads/revenue/subscriptions/payments keeps demo data out of real metrics.

## "Agents"
Deliberately few. Today's automation is deterministic code: Revenue Auditor (audit/), Lead Recovery (workflows/missedCall), Outreach Preparation (outreach.ts), Revenue Analyst (metrics.ts). Each has typed inputs/outputs, audit-log entries, tests, and human approval where consequential (outreach send, pilot start, payment recording). LLM agents are added only where rules demonstrably fail (open-ended qualification), behind the same interfaces.
