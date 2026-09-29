import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { usd } from '@/lib/format';
import type { AuditResult } from '@/lib/audit/estimate';

export const dynamic = 'force-dynamic';

export default async function AuditPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { token } = await params;
  const { sent } = await searchParams;
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) notFound();
  const db = await getDb();
  const a = (await db.query<{ input: { businessName: string; industry: string }; estimate: AuditResult & { scoreBreakdown: Record<string, number> } }>(
    `select input, estimate from audits where public_token=$1`, [token]))[0];
  if (!a) notFound();
  const e = a.estimate;
  return (
    <main>
      <p className="muted small">Lead-flow review for {a.input.businessName}</p>
      <h1>You may be leaving about <span style={{ color: 'var(--accent)' }}>{usd(e.totalLowMonthly)}-{usd(e.totalHighMonthly)}</span> a month on the table.</h1>
      <p className="lede"><span className="tag ESTIMATED">ESTIMATED</span>{e.disclaimer} Confidence: <b>{e.confidence}</b>.</p>
      <div className="card"><b>Why this confidence level</b><ul>{e.confidenceReasons.map(r => <li key={r}>{r}</li>)}</ul></div>

      <h2>Where it could be coming from</h2>
      {e.leaks.map(l => (
        <div className="card" key={l.leak}>
          <h3>{l.label}: {usd(l.lowMonthly)}-{usd(l.highMonthly)}/mo</h3>
          <details><summary className="small muted">Show assumptions</summary><ul className="small">{l.assumptions.map(x => <li key={x}>{x}</li>)}</ul></details>
        </div>
      ))}

      <h2>What we found on your homepage</h2>
      <div className="card"><ul className="plain">{e.findings.map(f => (
        <li key={f.id}><span className={`tag ${f.evidence}`}>{f.evidence}</span><b>{f.title}</b><div className="small muted">{f.detail}</div></li>))}</ul></div>

      <h2>Want to see what is really happening?</h2>
      {sent ? <div className="card"><b>Thanks. We will be in touch.</b><p className="small muted">A person will review this and reach out to the email you gave. Nothing is sent automatically.</p></div> :
      <form className="card" method="post" action="/api/pilot-request">
        <input type="hidden" name="token" value={token} />
        <p>A 14-day pilot texts back your missed callers and reports exactly what it recovered. No guarantee of results, month-to-month afterwards.</p>
        <label htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="email" />
        <p className="small muted">We use this only to follow up on this request. Reply "no thanks" at any time.</p>
        <button className="btn" type="submit">Start a 14-day pilot</button>
      </form>}
    </main>
  );
}
