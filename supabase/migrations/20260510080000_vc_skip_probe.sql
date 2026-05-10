-- 0007_vc_skip_probe.sql
-- Add skip-probe flag for VCs whose ATS endpoint is unreachable
-- (private board, JS-rendered, or unsupported ATS). Orchestrator skips
-- these on every scrape; discover_slugs preserves the flag.

alter table vcs
  add column if not exists skip_probe boolean not null default false,
  add column if not exists skip_reason text;

comment on column vcs.skip_probe is
  'True ⇒ orchestrator and discover_slugs ignore this VC. Set when the ATS board exists publicly but its API is unreachable, or the ATS provider is not yet supported.';
comment on column vcs.skip_reason is
  'Free-text reason (e.g. "ashby private API", "zoho recruit unsupported", "JS-only render"). For audit only.';

create index if not exists idx_vcs_active_probe on vcs (skip_probe) where skip_probe = false;
