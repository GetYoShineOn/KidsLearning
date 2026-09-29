import { createMemoryDb, type Db } from '@/lib/db';
import { hashPassword } from '@/lib/security';

export async function seedOrg(db: Db, name: string, opts: { autoBook?: boolean; tz?: string } = {}) {
  const org = (await db.query<{ id: string }>(`insert into organizations(name, is_simulated) values ($1, true) returning id`, [name]))[0];
  await db.query(`insert into businesses(org_id, name, industry, timezone, auto_book) values ($1,$2,'hvac',$3,$4)`, [org.id, name, opts.tz ?? 'America/Chicago', opts.autoBook ?? true]);
  const user = (await db.query<{ id: string }>(`insert into users(email, password_hash, role, org_id) values ($1,$2,'owner',$3) returning id`,
    [`${name.replace(/\W/g, '').toLowerCase()}@example.test`, await hashPassword('pw-test-1234'), org.id]))[0];
  return { orgId: org.id, userId: user.id };
}
export { createMemoryDb };
// Noon in Chicago (CDT, UTC-5) => 17:00 UTC: inside allowed hours.
export const DAYTIME = new Date('2026-06-10T17:00:00Z');
export const NIGHT = new Date('2026-06-10T05:00:00Z');
