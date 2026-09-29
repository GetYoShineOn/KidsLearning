// Idempotent schema. is_simulated separates demo data from real data everywhere money/leads appear.
export const SCHEMA_SQL = `

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pilot' check (status in ('pilot','active','paused','churned')),
  is_simulated boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin','owner','member')),
  org_id uuid references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((role = 'admin' and org_id is null) or (role <> 'admin' and org_id is not null))
);

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  website text,
  phone text,
  industry text not null,
  location text,
  timezone text not null default 'America/Chicago',
  avg_job_value_cents integer,
  auto_book boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  phone text,
  industry text not null,
  location text,
  source text not null default 'manual',
  stage text not null default 'researched'
    check (stage in ('researched','audited','approved_for_outreach','contacted','replied','qualified','pilot','customer','lost','do_not_contact')),
  score integer,
  notes text,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists audits (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique,
  prospect_id uuid references prospects(id) on delete set null,
  org_id uuid references organizations(id) on delete set null,
  input jsonb not null,
  findings jsonb not null,
  estimate jsonb not null,
  score integer not null,
  confidence text not null check (confidence in ('LOW','MEDIUM','HIGH')),
  source text not null default 'public',
  created_at timestamptz not null default now()
);

create table if not exists outreach (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  channel text not null check (channel in ('email','phone_script','linkedin','sms')),
  subject text,
  body text not null,
  status text not null default 'draft' check (status in ('draft','approved','sent','replied','rejected')),
  approved_by uuid references users(id),
  approved_at timestamptz,
  sent_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text,
  phone text,
  email text,
  sms_consent boolean not null default false,
  consent_source text,
  consent_at timestamptz,
  opted_out_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  source text not null check (source in ('missed_call','web_form','estimate','dormant','no_show','manual')),
  status text not null default 'new' check (status in ('new','contacted','engaged','appointment_booked','won','lost','no_response','opted_out')),
  service_need text,
  est_value_cents integer,
  workflow text,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now(),
  first_response_at timestamptz
);
create index if not exists leads_org_idx on leads(org_id, created_at desc);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  direction text not null check (direction in ('outbound','inbound')),
  channel text not null check (channel in ('sms','email','voice')),
  body text not null,
  delivery_mode text not null check (delivery_mode in ('REAL','SIMULATED','BLOCKED')),
  blocked_reason text,
  created_at timestamptz not null default now()
);
create index if not exists messages_lead_idx on messages(org_id, lead_id, created_at);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  starts_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked','completed','no_show','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  value_cents integer not null check (value_cents >= 0),
  status text not null default 'won' check (status in ('won','completed','cancelled')),
  reported_by text not null default 'customer' check (reported_by in ('customer','crm','operator')),
  created_at timestamptz not null default now()
);

create table if not exists revenue_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  workflow text not null,
  amount_cents integer not null check (amount_cents >= 0),
  confidence text not null check (confidence in ('HIGH','MEDIUM','LOW')),
  evidence jsonb not null,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists revenue_org_idx on revenue_events(org_id, created_at desc);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  plan text not null,
  status text not null check (status in ('pilot','active','past_due','cancelled')),
  monthly_cents integer not null default 0,
  stripe_customer_id text,
  stripe_subscription_id text,
  is_simulated boolean not null default false,
  started_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  external_id text unique,
  is_simulated boolean not null default false,
  paid_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  actor text not null,
  action text not null,
  entity text,
  entity_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists webhook_events (
  id text primary key,
  source text not null,
  received_at timestamptz not null default now()
);

create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
`;
