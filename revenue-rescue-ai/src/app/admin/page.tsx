import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { adminMetrics } from '@/lib/metrics';
import { usdCents } from '@/lib/format';
import { INDUSTRY_KEYS, VERTICALS } from '@/lib/audit/verticals';
import { createPaymentLink, addProspect, approve, auditProspect, draftOutreach, recordPayment, seedDemo, sent, setStage, startPilot } from './actions';
import { signOut } from '../app/actions';

export const dynamic = 'force-dynamic';

export default async function Admin({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { link } = await searchParams;
  await requireAdmin();
  const db = await getDb();
  const hw = process.env.HARDWARE_COST_USD ? Math.round(Number(process.env.HARDWARE_COST_USD) * 100) : null;
  const m = await adminMetrics(db, { hardwareCostCents: hw });
  const prospects = await db.query<{ id: string; name: string; industry: string; stage: string; score: number | null; is_simulated: boolean; website: string | null; contact_email: string | null }>(
    `select id, name, industry, stage, score, is_simulated, website, contact_email from prospects order by score desc nulls last, created_at desc limit 50`);
  const drafts = await db.query<{ id: string; name: string; status: string; body: string; subject: string }>(
    `select o.id, p.name, o.status, o.body, o.subject from outreach o join prospects p on p.id=o.prospect_id where o.status in ('draft','approved') order by o.created_at desc limit 20`);
  const orgs = await db.query<{ id: string; name: string; status: string; is_simulated: boolean; email: string | null }>(`select o.id, o.name, o.status, o.is_simulated, (select email from users where org_id=o.id limit 1) email from organizations o order by o.created_at desc limit 20`);
  const stages = ['researched', 'audited', 'approved_for_outreach', 'contacted', 'replied', 'qualified', 'pilot', 'customer'];
  const first = m.firstRealPaymentAt;
  return (
    <main>
      <h1>Operations</h1>
      <p className="muted small">Real numbers only. Simulated/demo data is excluded from every figure below except where labeled.</p>
      <div className="stats">
        <div className="stat"><b>{usdCents(m.mrrCents)}</b>MRR (real)</div>
        <div className="stat"><b>{usdCents(m.arrCents)}</b>ARR (real)</div>
        <div className="stat"><b>{usdCents(m.realRevenueCents)}</b>Cash collected</div>
        <div className="stat"><b>{first ? new Date(first).toISOString().slice(0, 10) : 'none yet'}</b>First real dollar</div>
        <div className="stat"><b>{m.daysTo1000 ?? 'n/a'}</b>Days first $ to $1,000</div>
        <div className="stat"><b>{m.hardware.paybackPct === null ? 'set HARDWARE_COST_USD' : `${m.hardware.paybackPct.toFixed(1)}%`}</b>Hardware paid back</div>
        <div className="stat"><b>{usdCents(m.recoveredCents)}</b>Customer revenue recovered</div>
        <div className="stat"><b>{m.audits}</b>Audits ({m.auditsPublic} public)</div>
      </div>
      {m.simulatedMrrCents > 0 && <p className="small"><span className="tag SIMULATED">SIMULATED</span>Demo MRR of {usdCents(m.simulatedMrrCents)} exists in demo orgs and is NOT counted above.</p>}

      <h2>Pipeline</h2>
      <div className="card"><table><tbody>{stages.map(st => <tr key={st}><td>{st.replaceAll('_', ' ')}</td><td>{m.funnel[st] ?? 0}</td></tr>)}</tbody></table>
        <p className="small muted">Outreach: {['draft', 'approved', 'sent', 'replied', 'rejected'].map(k => `${k} ${m.outreach[k] ?? 0}`).join(' · ')}</p></div>

      <h2>What is working</h2>
      <div className="card scroll"><table><thead><tr><th>Vertical</th><th>Prospects</th><th>Customers</th></tr></thead><tbody>
        {m.byIndustry.map(r => <tr key={r.industry}><td>{VERTICALS[r.industry]?.label ?? r.industry}</td><td>{r.prospects}</td><td>{r.customers}</td></tr>)}</tbody></table>
        <table><thead><tr><th>Workflow</th><th>Leads</th><th>Recovered</th></tr></thead><tbody>
        {m.byWorkflow.map(r => <tr key={r.workflow}><td>{r.workflow}</td><td>{r.leads}</td><td>{usdCents(r.recoveredCents)}</td></tr>)}</tbody></table>
        <p className="small muted">CAC, LTV, churn and gross margin need real customers and costs; they are computed in docs/FINANCIAL_MODEL.md scenarios until then. Not fabricated here.</p></div>

      <h2>Prospects</h2>
      <form className="card" action={addProspect}>
        <div className="grid2"><div><label htmlFor="pn">Business</label><input id="pn" name="name" required /></div><div><label htmlFor="pw">Website</label><input id="pw" name="website" required /></div>
          <div><label htmlFor="pi">Industry</label><select id="pi" name="industry">{INDUSTRY_KEYS.map(k => <option key={k} value={k}>{VERTICALS[k].label}</option>)}</select></div>
          <div><label htmlFor="pl">Location</label><input id="pl" name="location" /></div>
          <div><label htmlFor="pp">Phone (business line)</label><input id="pp" name="phone" /></div><div><label htmlFor="pe">Contact email (only if publicly listed for business use)</label><input id="pe" name="email" type="email" /></div></div>
        <div style={{ marginTop: 12 }}><button className="btn wide">Add prospect</button></div>
      </form>
      <div className="card scroll"><table><thead><tr><th>Prospect</th><th>Stage</th><th>Score</th><th>Actions</th></tr></thead><tbody>
        {prospects.map(p => <tr key={p.id}><td>{p.name}{p.is_simulated && <span className="tag SIMULATED">SIM</span>}<div className="small muted">{VERTICALS[p.industry]?.label}</div></td>
          <td>{p.stage.replaceAll('_', ' ')}</td><td>{p.score ?? '-'}</td>
          <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <form action={auditProspect}><input type="hidden" name="id" value={p.id} /><button className="btn small ghost">Audit</button></form>
            <form action={draftOutreach}><input type="hidden" name="id" value={p.id} /><button className="btn small ghost">Draft email</button></form>
            {['contacted'].includes(p.stage) && <form action={setStage}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="stage" value="replied" /><button className="btn small ghost">Replied</button></form>}
            <form action={setStage}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="stage" value="do_not_contact" /><button className="btn small ghost">DNC</button></form>
            {['qualified', 'replied'].includes(p.stage) && <details><summary className="small">Start pilot</summary>
              <form action={startPilot}><input type="hidden" name="id" value={p.id} /><input name="email" type="email" placeholder="owner login email" defaultValue={p.contact_email ?? ''} required /><input name="password" type="password" minLength={12} placeholder="temp password (12+)" required /><input name="tz" defaultValue="America/Chicago" /><button className="btn small">Create pilot</button></form></details>}
          </td></tr>)}</tbody></table></div>

      <h2>Outreach awaiting human action</h2>
      <p className="small muted">Nothing is ever sent by this system. Approve, then send from your own email, then mark sent.</p>
      {drafts.map(d => <div className="card" key={d.id}><b>{d.name}</b> <span className="tag">{d.status}</span><p className="small muted">{d.subject}</p><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }} className="small">{d.body}</pre>
        {d.status === 'draft' ? <form action={approve}><input type="hidden" name="id" value={d.id} /><button className="btn small">Approve</button></form> : <form action={sent}><input type="hidden" name="id" value={d.id} /><button className="btn small">I sent this</button></form>}</div>)}

      <h2>Customers / pilots</h2>
      {link && /^https:\/\/checkout\.stripe\.com\//.test(link) && <div className="card"><b>Payment link (send it yourself):</b><p className="small" style={{ wordBreak: 'break-all' }}>{link}</p></div>}
      <div className="card scroll"><table><tbody>{orgs.map(o => <tr key={o.id}><td>{o.name}{o.is_simulated && <span className="tag SIMULATED">SIM</span>}{o.is_simulated && <div className="small muted">{o.email} / demo-password-12345</div>}</td><td>{o.status}</td><td>
        {!o.is_simulated && process.env.STRIPE_SECRET_KEY && <details><summary className="small">Payment link</summary><form action={createPaymentLink}><input type="hidden" name="org" value={o.id} /><input name="monthly" inputMode="decimal" placeholder="$/month" defaultValue="599" required /><input name="setup" inputMode="decimal" placeholder="$ setup" defaultValue="497" required /><button className="btn small">Create link</button></form></details>}
        {!o.is_simulated && <details><summary className="small">Record payment received</summary><form action={recordPayment}><input type="hidden" name="org" value={o.id} /><input name="dollars" inputMode="decimal" placeholder="$ amount" required /><input name="ref" placeholder="invoice / reference" required /><button className="btn small">Record</button></form></details>}</td></tr>)}</tbody></table>
        <form action={seedDemo} style={{ marginTop: 10 }}><button className="btn small ghost">Create SIMULATED demo tenant</button></form></div>
      <form action={signOut}><button className="btn ghost small">Sign out</button></form>
    </main>
  );
}
