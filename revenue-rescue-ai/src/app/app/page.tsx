import { requireOrg } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { customerMetrics } from '@/lib/metrics';
import { dur, pct, usdCents } from '@/lib/format';
import { reportJob, signOut, simulateMissedCall, simulateReply } from './actions';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const s = await requireOrg();
  const db = await getDb();
  const org = (await db.query<{ name: string; is_simulated: boolean; status: string }>(`select name, is_simulated, status from organizations where id=$1`, [s.org]))[0];
  const m = await customerMetrics(db, s.org);
  const leads = await db.query<{ id: string; created_at: string; source: string; status: string; service_need: string | null; phone: string | null; delivery: string | null }>(
    `select l.id, l.created_at, l.source, l.status, l.service_need, c.phone,
            (select delivery_mode from messages where lead_id=l.id and org_id=l.org_id order by created_at limit 1) delivery
       from leads l left join contacts c on c.id=l.contact_id where l.org_id=$1 order by l.created_at desc limit 25`, [s.org]);
  return (
    <main>
      <p className="muted small">{org.name}</p>
      <h1>Is this making you money?</h1>
      {(org.is_simulated || m.simulatedOnly) && <div className="banner"><span className="tag SIMULATED">SIMULATED</span>Everything on this page is demo data. No real customers, messages or revenue.</div>}
      <div className="card">
        <div className="muted small">Revenue recovered (high and medium confidence only)</div>
        <div className="big">{usdCents(m.recoveredCents)}</div>
        {m.possibleCents > 0 && <p className="small muted">Plus {usdCents(m.possibleCents)} in low-confidence jobs we cannot tie to our follow-up. Not counted.</p>}
        <p className="small">Cost to date: {usdCents(m.costCents)}. ROI: {m.roi === null ? 'not available until you have paid an invoice' : `${(m.roi * 100).toFixed(0)}%`}.</p>
      </div>
      <div className="stats">
        <div className="stat"><b>{m.leadsRecovered}</b>Leads recovered</div>
        <div className="stat"><b>{m.appointments}</b>Appointments booked</div>
        <div className="stat"><b>{m.jobsWon}</b>Jobs won</div>
        <div className="stat"><b>{m.openOpportunities}</b>Open opportunities</div>
        <div className="stat"><b>{dur(m.medianResponseSec)}</b>Median response</div>
        <div className="stat"><b>{pct(m.conversionRate)}</b>Lead to job</div>
        <div className="stat"><b>{pct(m.recoveryRate)}</b>Recovery rate</div>
        <div className="stat"><b>{m.followUpsDue}</b>Follow-ups due</div>
      </div>

      <h2>Recent leads</h2>
      <div className="card scroll">
        {leads.length === 0 ? <p className="muted">No leads yet.</p> : <table><thead><tr><th>When</th><th>Caller</th><th>Status</th><th>Need</th><th /></tr></thead><tbody>
          {leads.map(l => <tr key={l.id}><td>{new Date(l.created_at).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })}</td>
            <td>{l.phone ? `***${l.phone.slice(-4)}` : '-'}</td><td>{l.status.replace('_', ' ')}</td><td>{l.service_need ?? '-'}</td>
            <td>{l.status !== 'won' && ['engaged', 'appointment_booked'].includes(l.status) &&
              <form action={reportJob} style={{ display: 'flex', gap: 6 }}><input type="hidden" name="leadId" value={l.id} />
                <input name="amount" inputMode="decimal" placeholder="Job $" aria-label="Job value in dollars" style={{ width: 90, minHeight: 40 }} /><button className="btn small">Won</button></form>}</td></tr>)}
        </tbody></table>}
      </div>

      <h2>Try the workflow <span className="tag SIMULATED">SIMULATED</span></h2>
      <div className="card"><p className="small muted">Real texting is not connected yet, so these buttons run the workflow in a sandbox. No message leaves this system.</p>
        <form action={simulateMissedCall}><label htmlFor="sp">Pretend this number just called and was missed</label><input id="sp" name="phone" defaultValue="214-555-0188" /><div style={{ marginTop: 10 }}><button className="btn ghost">Simulate missed call</button></div></form>
        <form action={simulateReply}><label htmlFor="rp">Customer number</label><input id="rp" name="phone" defaultValue="214-555-0188" /><label htmlFor="rt">Customer replies with</label><input id="rt" name="text" defaultValue="My AC stopped cooling" /><div style={{ marginTop: 10 }}><button className="btn ghost">Simulate reply</button></div></form>
      </div>
      <form action={signOut}><button className="btn ghost small">Sign out</button></form>
    </main>
  );
}
