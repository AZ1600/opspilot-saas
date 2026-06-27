create table if not exists businesses (
  id text primary key,
  name text not null,
  niche text not null,
  onboarding_completed boolean not null default false,
  primary_pain_point text not null check (primary_pain_point in ('missed_leads', 'overdue_invoices', 'customer_complaints', 'scheduling')) default 'missed_leads',
  billing_plan text not null check (billing_plan in ('starter', 'growth', 'pro')) default 'starter',
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('owner', 'manager', 'staff')),
  status text not null check (status in ('active', 'invited')) default 'invited',
  invited_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists connected_accounts (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  provider text not null,
  status text not null check (status in ('connected', 'pending', 'failed')),
  external_account_id text,
  account_label text not null default 'Not connected',
  encrypted_token_set text,
  oauth_scope text,
  last_imported_at timestamptz,
  message text,
  created_at timestamptz not null default now(),
  primary key (business_id, id)
);

create table if not exists customers (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  name text not null,
  email text,
  monthly_value_cents integer not null default 0,
  risk_level text not null check (risk_level in ('high', 'medium', 'low')) default 'low',
  created_at timestamptz not null default now(),
  primary key (business_id, id)
);

create table if not exists business_actions (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  customer_id text,
  title text not null,
  source text not null,
  customer_name text not null,
  priority text not null check (priority in ('urgent', 'normal', 'low')),
  status text not null check (status in ('pending', 'approved', 'dismissed')),
  estimated_value_cents integer not null default 0,
  age_label text not null,
  summary text not null,
  draft text not null,
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (business_id, id)
);

create index if not exists business_actions_business_status_idx
  on business_actions (business_id, status);

create table if not exists revenue_leaks (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  source text not null,
  issue text not null,
  customer_name text not null,
  value_cents integer not null default 0,
  age_label text not null,
  next_move text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, id)
);

create index if not exists revenue_leaks_business_idx
  on revenue_leaks (business_id);

create table if not exists customer_risks (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  customer_name text not null,
  risk_level text not null check (risk_level in ('high', 'medium', 'low')),
  monthly_value_cents integer not null default 0,
  reason text not null,
  next_move text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, id)
);

create table if not exists inbox_messages (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  provider text not null default 'Gmail',
  external_message_id text,
  sender text not null,
  subject text not null,
  received_label text not null,
  preview text not null,
  body text not null,
  status text not null check (status in ('unscanned', 'scanned')),
  estimated_value_cents integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (business_id, id)
);

create index if not exists inbox_messages_business_status_idx
  on inbox_messages (business_id, status);

create table if not exists ingestions (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  source text not null check (source in ('Manual paste', 'Gmail', 'QuickBooks', 'Calendar', 'Slack')),
  classifier text not null check (classifier in ('rules', 'openai')),
  raw_text text not null,
  detected_category text not null check (detected_category in ('lead', 'invoice', 'complaint', 'booking', 'general')),
  summary text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, id)
);

create index if not exists ingestions_business_created_idx
  on ingestions (business_id, created_at desc);

create table if not exists knowledge_documents (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  title text not null,
  document_type text not null check (document_type in ('Policy', 'Pricing', 'Playbook', 'Contract', 'Note')),
  body text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, id)
);

create table if not exists timeline_events (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  title text not null,
  due_label text not null,
  owner text not null,
  risk_level text not null check (risk_level in ('high', 'medium', 'low')),
  created_at timestamptz not null default now(),
  primary key (business_id, id)
);

create table if not exists approval_events (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  action_id text not null,
  user_id text not null references users(id) on delete restrict,
  action_title text not null,
  decision text not null check (decision in ('approved', 'dismissed')),
  actor_name text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, id),
  foreign key (business_id, action_id)
    references business_actions (business_id, id)
    on delete cascade
);

create index if not exists approval_events_business_created_idx
  on approval_events (business_id, created_at desc);

create table if not exists impact_entries (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  action_id text not null,
  action_title text not null,
  category text not null check (category in ('recovered_revenue', 'protected_revenue', 'invoice_follow_up', 'time_saved')),
  customer_name text not null,
  source text not null,
  amount_cents integer not null default 0,
  time_saved_minutes integer not null default 0,
  confidence text not null check (confidence in ('estimated', 'confirmed')) default 'estimated',
  note text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, id),
  foreign key (business_id, action_id)
    references business_actions (business_id, id)
    on delete cascade
);

create index if not exists impact_entries_business_created_idx
  on impact_entries (business_id, created_at desc);

create table if not exists execution_jobs (
  id text not null,
  business_id text not null references businesses(id) on delete cascade,
  action_id text not null,
  action_title text not null,
  job_type text not null check (job_type in ('send_email', 'create_follow_up', 'invoice_reminder', 'customer_recovery')),
  status text not null check (status in ('queued', 'completed', 'failed')) default 'queued',
  customer_name text not null,
  owner_name text not null,
  detail text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, id),
  foreign key (business_id, action_id)
    references business_actions (business_id, id)
    on delete cascade
);

create index if not exists execution_jobs_business_status_idx
  on execution_jobs (business_id, status);
