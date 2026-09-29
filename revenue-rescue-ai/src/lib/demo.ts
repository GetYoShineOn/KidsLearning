import type { Db } from './db';
import { hashPassword } from './security';
import { SimulatedSms } from './sms';
import { handleMissedCall, handleInboundSms } from './workflows/missedCall';
import { recordJobAndAttribute } from './attribution';

/** Creates a clearly SIMULATED demo tenant. Nothing here is real: is_simulated=true on org, leads, revenue. */
export async function seedDemoOrg(db: Db, suffix = String(Date.now()).slice(-5)) {
  const org = (await db.query<{ id: string }>(`insert into organizations(name, is_simulated) values ($1, true) returning id`, [`DEMO Comfort HVAC ${suffix}`]))[0];
  await db.query(`insert into businesses(org_id, name, industry, timezone, auto_book) values ($1,$2,'hvac','America/Chicago',true)`, [org.id, `DEMO Comfort HVAC ${suffix}`]);
  const email = `demo-${suffix}@example.test`;
  await db.query(`insert into users(email, password_hash, role, org_id) values ($1,$2,'owner',$3)`, [email, await hashPassword('demo-password-12345'), org.id]);
  const sms = new SimulatedSms();
  const noon = new Date(); noon.setUTCHours(17, 0, 0, 0);
  const ctx = { db, orgId: org.id, sms, now: noon };
  const callers = ['2145550101', '2145550102', '2145550103', '2145550104'];
  const ids: string[] = [];
  for (const c of callers) ids.push((await handleMissedCall(ctx, c)).leadId);
  await handleInboundSms(ctx, callers[0], 'No heat, furnace clicking'); await handleInboundSms(ctx, callers[0], '1');
  await handleInboundSms(ctx, callers[1], 'Quote for new AC install');
  await recordJobAndAttribute(db, org.id, ids[0], 485000, 'crm', 'demo', noon);
  await db.query(`insert into subscriptions(org_id, plan, status, monthly_cents, is_simulated) values ($1,'growth','active',59900,true)`, [org.id]);
  return { orgId: org.id, email };
}
