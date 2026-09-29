# Decision log
1. **Vertical: residential HVAC, then plumbing** - highest ticket + urgency + phone-first lead flow among researched verticals; roofing later for estimate follow-up. (research/market-vertical-pricing.md; scores are researcher estimates.)
2. **First workflow: missed-call text-back with qualification + booking** - clearest, fastest to prove, but text-back alone is commoditized ($20-300/mo), so differentiation = audit-first entry + dollars-recovered attribution + (later) CRM write-back.
3. **Name is a problem.** Exact-name competitor and a crowded "Revenue Rescue"/"LeadRescue" cluster found (research/brand-name.md). Brand isolated in `src/lib/brand.ts`; human must pick a name after WHOIS/USPTO/attorney checks. Working name kept only as placeholder.
4. **Pricing hypothesis (unvalidated)**: Growth ~$599/mo + $497 setup, month-to-month, 14-day pilot with no revenue guarantee. Starter/Pro tiers in research file.
5. **Estimate = central value x [0.4, 2.2] band** after first version compounded low/high assumptions into a $200-$116k range (found in browser test). Never HIGH confidence from public data.
6. **Deterministic intent handling, no LLM yet** - rules are testable, injection-proof, and sufficient for "what do you need / morning or afternoon". Add an LLM only for open-ended qualification.
7. **PGlite for dev/test, pg for prod** - real Postgres semantics without a server. `gen_random_uuid()` built-in (pgcrypto unavailable in PGlite).
8. **Outreach is never auto-sent.** Draft -> human approve (blocked on unresolved CAN-SPAM address) -> human sends -> human marks sent.
9. **Attribution**: only HIGH+MEDIUM counted as recovered; LOW shown separately; customer-reported jobs cap at MEDIUM.
10. **Compliance defaults**: strictest-state quiet hours 8am-8pm, opt-out honored, one text-back per missed call, marketing reactivation requires recorded consent, AI disclosure + STOP in every message.
11. Placed in `revenue-rescue-ai/` subfolder to leave the existing kids' app untouched.
12. **$200/month budget**; SMS is the only metered cost, so it has hard caps (per-org daily/monthly, global monthly) that block rather than overspend. No LLM in the hot path.
