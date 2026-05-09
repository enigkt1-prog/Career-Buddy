-- 0001 — Layer-0 baseline (already applied to Career-Buddy Supabase project).
-- This file is the historical first migration. It is identical in content to
-- ../schema.sql and exists here so future contributors can replay the full
-- migration history from a clean database.
--
-- DO NOT EDIT once a migration has been applied. Add a new file with a higher
-- sequence number instead.

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- users
-- ============================================================
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  email text unique,
  name text,
  target_role text,
  target_geo text,
  background text,
  cv_text text,
  profile_json jsonb,
  created_at timestamptz default now()
);

-- ============================================================
-- applications
-- ============================================================
create table if not exists applications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  company text not null,
  role text,
  url text,
  applied_date date default current_date,
  status text default 'applied',
  fit_score numeric,
  notes text,
  last_event_date timestamptz default now(),
  next_action text,
  created_at timestamptz default now()
);

create index if not exists idx_applications_user on applications(user_id);
create index if not exists idx_applications_company on applications(lower(company));

-- ============================================================
-- events
-- ============================================================
create table if not exists events (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid references applications(id) on delete cascade,
  event_type text not null,
  email_subject text,
  email_body text,
  parsed_action text,
  parsed_at timestamptz default now()
);

create index if not exists idx_events_application on events(application_id);

-- ============================================================
-- vc_jobs (Layer-0 hackathon fixture; superseded by `jobs` in migration 0002,
-- but kept for backward compatibility with the Lovable Layer-0 build)
-- ============================================================
create table if not exists vc_jobs (
  id uuid primary key default uuid_generate_v4(),
  company text not null,
  role text not null,
  location text,
  url text,
  description text,
  requirements text,
  posted_date date,
  scraped_at timestamptz default now()
);
