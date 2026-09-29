import { INDUSTRY_KEYS, VERTICALS } from '@/lib/audit/verticals';

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>See where your leads are slipping through.</h1>
      <p className="lede">You already pay to get the phone to ring. Find out what missed calls, slow replies and forgotten estimates may be costing you, in about 30 seconds.</p>
      <form className="card" method="post" action="/api/audit">
        {error && <p className="err" role="alert">{error}</p>}
        <label htmlFor="businessName">Business name</label>
        <input id="businessName" name="businessName" required minLength={2} autoComplete="organization" />
        <label htmlFor="website">Website</label>
        <input id="website" name="website" required inputMode="url" autoCapitalize="none" placeholder="yourcompany.com" />
        <div className="grid2">
          <div><label htmlFor="industry">Industry</label>
            <select id="industry" name="industry" defaultValue="hvac">
              {INDUSTRY_KEYS.map(k => <option key={k} value={k}>{VERTICALS[k].label}</option>)}
            </select></div>
          <div><label htmlFor="phone">Business phone (optional)</label><input id="phone" name="phone" type="tel" autoComplete="tel" /></div>
        </div>
        <label htmlFor="location">City, state (optional)</label>
        <input id="location" name="location" autoComplete="address-level2" />
        <details style={{ marginTop: 12 }}><summary className="small muted">Make the estimate sharper (optional)</summary>
          <div className="grid2">
            <div><label htmlFor="monthlyLeads">Leads per month (calls + forms)</label><input id="monthlyLeads" name="monthlyLeads" inputMode="numeric" /></div>
            <div><label htmlFor="avgJobValue">Average job value ($)</label><input id="avgJobValue" name="avgJobValue" inputMode="numeric" /></div>
          </div>
        </details>
        <div style={{ marginTop: 18 }}><button className="btn" type="submit">Find my lost revenue</button></div>
        <p className="small muted">We read only your public homepage. No login, no card, no sales call. The result is an estimate from stated assumptions, not a guarantee.</p>
      </form>
      <h2>How it works</h2>
      <ul className="plain">
        <li><b>1. Review.</b> We check your homepage for friction that costs calls and form fills, and label every finding as observed, estimated, inferred or unknown.</li>
        <li><b>2. Recover.</b> A 14-day pilot texts back missed callers within seconds, asks what they need, and hands your team ready-to-book leads.</li>
        <li><b>3. Prove it.</b> Your dashboard shows only revenue we can tie to a recovered lead, with a confidence level on each dollar.</li>
      </ul>
    </main>
  );
}
