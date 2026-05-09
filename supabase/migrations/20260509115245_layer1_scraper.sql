-- 0002 — Layer-1 scraper tables (vcs + jobs).
--
-- Adds the master VC list and the canonical operator-role job table that the
-- Layer-1 scraper writes to daily. Mirrors the Pydantic models in
-- backend/career_buddy_scraper/models.py and the schema sketch in
-- docs/scraper-plan.md.
--
-- This migration is idempotent: it can be re-applied safely.

-- ============================================================
-- vcs (Phase A master list)
-- ============================================================
create table if not exists vcs (
  id uuid primary key default uuid_generate_v4(),
  domain text not null unique,
  name text not null,
  careers_url text,
  stage_focus text,
  sector_tags text[] default '{}',
  geography text,
  portfolio_companies_url text,
  tier int,
  aum_bucket text,
  sources text[] default '{}',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_vcs_tier on vcs(tier);
create index if not exists idx_vcs_geography on vcs(geography);

-- ============================================================
-- jobs (Phase B+ canonical operator-role table)
-- ============================================================
create table if not exists jobs (
  id uuid primary key default uuid_generate_v4(),
  company_name text not null,
  company_domain text not null,
  role_title text not null,
  role_category text,
    -- founders-associate | bizops | strategy | bd | chief-of-staff
    -- | investment-analyst | other | NULL (awaiting Tier-2 classification)
  location text,
  location_normalized text,
  is_remote boolean default false,
  employment_type text,
  url text not null,
  description text,
  requirements text,
  posted_date date,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  is_active boolean default true,
  ats_source text not null,
    -- greenhouse | lever | ashby | workable | custom | manual
  raw_payload jsonb default '{}'::jsonb,
  unique (company_domain, role_title, url)
);

create index if not exists idx_jobs_active on jobs(is_active, posted_date desc);
create index if not exists idx_jobs_category on jobs(role_category, location_normalized);
create index if not exists idx_jobs_company_domain on jobs(company_domain);
create index if not exists idx_jobs_ats_source on jobs(ats_source);

-- ============================================================
-- updated_at trigger for vcs
-- ============================================================
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_vcs_updated_at on vcs;
create trigger trg_vcs_updated_at
  before update on vcs
  for each row execute function set_updated_at();
