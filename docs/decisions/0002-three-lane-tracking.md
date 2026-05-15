# 0002 — Three-lane tracking: repo / Obsidian / Notion

- **Status:** Accepted
- **Date:** 2026-05-08
- **Deciders:** Project lead

## Context

Career-Buddy is both a code project and a long-running business / strategy bet. The work splits naturally into three classes of artefact:

1. **Reproducible build artefacts.** Specs, ADRs, build instructions, code, schemas. Other people (or future-self forking the repo) need to read these.
2. **Strategy and ideation.** Vision, competitive analysis, distribution plays, founder-thoughts, scratchpad. These are private and evolve faster than they should be committed.
3. **Operational data.** Active job applications (own funnel), VC database, accelerator/fellowship pages, competitor intel. Structured, frequently updated, mobile-accessible.

Dumping everything into `/docs/` mixes private strategy with public spec. Dumping everything into Obsidian or Notion loses git diffability and makes the repo hollow. The user explicitly asked (2026-05-08) to build smart and clean from day 1, including business-thoughts not just code.

## Decision

Three lanes, each with a single responsibility:

| Lane | Lives in | Stores |
|---|---|---|
| **Build** | Repo `/docs/` and code | Specs (`brief.md`, `build.md`, `design.md`, `scraper-plan.md`), ADRs (`/docs/decisions/`), code, schemas, fixtures. Reproducible. Public-ready. |
| **Strategy** | Obsidian `Startup_Ideation_Vault/01_Ideas/Career Buddy.md` and linked notes | Vision, layer-roadmap, distribution plays, founder-thoughts, ideation scratchpad, links to other vault ideas. Private. Fast iteration. |
| **Operational** | Notion (Karriere workspace) | Own job-application funnel, VC pages, accelerator/fellowship pages, competitor intel pages (Pumpkin etc.), outreach state. Structured tables. Mobile-accessible. |

Default routing rule: ideation/why → Obsidian, spec/decision → repo ADR or `/docs/`, operational data → Notion.

Promotion rule: when an Obsidian note's content matures into a build-affecting decision, distill it into a repo ADR. The Obsidian note stays as the long-form rationale; the ADR is the canonical short reference.

## Consequences

**Positive:**
- Repo stays clean and forkable. A reader can understand the build without seeing private strategy.
- Strategy iterates in Obsidian without polluting git history with half-formed thoughts.
- Operational data lives where it is queried (Notion mobile, Notion AI search), not in flat Markdown files.
- Each lane has one obvious answer to "where does this go?" — reduces decision fatigue.

**Negative:**
- Three places to look when researching context. Mitigated by the promotion rule: anything that affects a build decision must end up as a repo ADR pointing back to its Obsidian source.
- Notion content cannot be diff-tracked. Acceptable: operational data is point-in-time anyway.
- Cross-lane links break if Notion pages move. Acceptable: ADRs reference the Notion page title and date, not the URL alone.

**Neutral:**
- The Notion VC pages and accelerator pages will become Layer-1 scraper seed data anyway (per `scraper-plan.md` Phase A). Already-structured Notion content compresses the manual classification work.

## Alternatives considered

- **Single Notion workspace for everything.** Tempting because Notion has AI search, mobile, and operational data already lives there. Rejected because losing git diff on specs and ADRs would force re-recording the rationale every time the spec changed. Public forkability also dies.
- **Single Obsidian vault for everything.** Already used for strategy. Rejected because Obsidian is local-first and private — the repo build artefacts must be public-ready, and operational tables (funnel, VC list) need mobile sync.
- **Repo monorepo with `/strategy/` and `/operational/` subdirs gitignored.** Avoids three tools. Rejected because it loses Notion's mobile + AI-search and Obsidian's wiki-link graph; both add real workflow value over flat Markdown in a hidden folder.
