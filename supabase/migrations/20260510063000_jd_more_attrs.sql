do $$ begin
  create type job_level as enum (
    'intern','junior','mid','senior','lead','principal','executive'
  );
exception when duplicate_object then null;
end $$;

alter table jobs
  add column if not exists level job_level,
  add column if not exists country text,
  add column if not exists city text,
  add column if not exists visa_sponsorship boolean,
  add column if not exists is_international boolean;

create index if not exists idx_jobs_level on jobs(level);
create index if not exists idx_jobs_country on jobs(country);
create index if not exists idx_jobs_city on jobs(city);
create index if not exists idx_jobs_visa on jobs(visa_sponsorship) where visa_sponsorship is not null;
create index if not exists idx_jobs_intl on jobs(is_international) where is_international = true;
