# Demo Script — fa-track

> 3-minute Lightning Demo, Lovable Founder Series Berlin, 2026-05-07.

## Talk Track (memorize)

**[0:00–0:20] Hook (your story)**
> "I'm Troels. CLSBE Master grad. Like most of my classmates I was on the consulting track. Then AI happened. Lovable, Claude, the whole stack — what you can build in an afternoon now is insane. I want to build."

**[0:20–0:60] Problem (the business-background trap)**
> "Here's the trap: business / consulting background means the relevant startup-entry-roles are tiny. Outside sales, almost every job posting wants engineering. Founders Associate, BizOps, Strategy — these are the few real entry-points. Scattered across VC career-pages, stealth LinkedIn-DMs, accelerator cohorts. Super competitive. And nobody helps you figure out: where do I actually fit, what skills do I miss, what should I build next."

**[0:60–1:15] Mission**
> "I want to help people like me — business-background, want into startups — find these roles, close skill-gaps, and learn from every rejection AND every offer. Build a realistic mirror of where you fit and where you don't."

**[1:15–1:35] Demo Step 1 — Onboarding + CV-Upload**
> "Watch." → Type live: `"FA roles at AI-startups, Berlin/Remote, business-background, 0-2y exp"` → AI clarifies → profile-card emerges
> Drag CV PDF → Claude extracts → "Strong: B2B-sales, structured thinking. Gap: SaaS-metrics, ML fundamentals." → Profile enriched

**[1:35–2:00] Demo Step 2 — Add Application**
> "Let me add an application I'm actually working on." → Paste Avi or Rust JD-URL → AI parses → `fit_score: 8.4/10, "matches your B2B background, lacks SaaS-metrics — recommend SaaStr-basics before interview"` → Row appears

**[2:00–2:25] Demo Step 3 — Sync Inbox (THE WOW MOMENT)**
> "I pre-loaded 8 example emails so we don't waste demo-time on data-entry. Click Sync." → Watch:
> - Pedlar rejection → Pedlar-row updates → status `rejected`, side-panel pops "Want feedback? Here's draft email"
> - Avi interview-invite → Avi-row → `status: interview-2, next: Thu 3pm`
> - Project A follow-up question → flagged → "Reply needed: B2B deal example"
> All happen in 3 seconds.

**[2:25–2:40] Demo Step 4 — Insights Panel**
> "Patterns I didn't see myself: 'B2B-roles respond 3× more than B2C. Picus-pipeline avg is 21 days — be patient.' This is the self-mirror — what's actually working for me, not what I think is working."

**[2:40–2:50] Vision-Teaser (the big play)**
> "Today: tracker + insights + role-feed. Long-term: a Career Buddy that knows your full career for 3+ years. Tells you when to switch jobs, how to negotiate salary, which Headhunter to talk to, what Maven-Cohort to take this quarter. The buddy that knows you 3 years > any recruiter."

**[2:50–3:00] CTA**
> "Public repo: github.com/enigkt1-prog/fa-track. If you're business-background trying to break into startups — ping me. Beta tonight."

## Backup Q&A

| Q | A |
|---|---|
| Why not engineers? | Engineers have GitHub + Stack-Overflow + a thousand technical job-boards. Business-grads have nothing comparable for FA / BizOps / Strategy roles. |
| Why monolithic vs. just-tracker? | Context-flywheel. Tracker is wedge. Real moat = 3-year-Career-Buddy that no transactional competitor catches. |
| What if Clera adds memory? | Possible but they have to rebuild around it. We start from memory-first design. |
| Privacy on Gmail-access? | Layer 1+: read-only scope, classification can run on-device, no email-storage by default — only structured-events extracted. |
| TAM? | DACH alone: ~50k business-background-grads/year graduating from top programs. Global: 500k+. €9–79/mo pricing × 5% conversion = real ARR. |
| Why you? | I'm in the trap myself: CLSBE-grad applying to FA-roles right now. Built MVP in 2 hours. Bucerius/CLSBE/CDTM-network = direct funnel. |
| What about non-EU? | DACH-first wedge (Picus/Cherry/Earlybird/Project A density). Year-2 expansion: London + Paris + Amsterdam + NYC. |
| How is this different from a course like On-Deck? | On-Deck = community + curriculum, no application-tracking or self-mirror. fa-track wraps applications + outcomes into the learning loop. |

## Visual Flow Cheat-Sheet (during build)

```
┌────────────────────────────────────────────────────────┐
│  [Onboarding Chat]                                      │
│  "Tell me about your career goal..."                   │
└────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────┐
│  [CV Upload]    [Profile Card]                          │
│  drag PDF       Target: FA / AI startups               │
│                 Strong: B2B-sales, structured           │
│                 Gap: SaaS-metrics                       │
└────────────────────────────────────────────────────────┘
                         ↓
┌────────────────┬─────────────────────────────────────┐
│  [Applications]│  [Insights Panel]                   │
│  Pedlar  ❌    │  → B2B responds 3× than B2C         │
│  Avi     📅 Thu│  → Picus-pipeline avg 21d           │
│  Rust    ⏳ 7d │  → Strong-fit: Series-A + Berlin    │
│  Picus   ✅ 8.4│                                     │
├────────────────┤  [Jobs Feed — top 3]                │
│  [+ Add app]   │  Cherry IA   8.7/10                 │
│  [Sync inbox]  │  Earlybird   7.9/10                 │
│                │  Project A   7.6/10                 │
└────────────────┴─────────────────────────────────────┘
```

## On-Stage Behavior

- **Don't read** — eye-contact with jury, scan the room
- **Pause before "Sync"** — let them anticipate, then click → 3 seconds of magic
- **Self-deprecate sparingly** — "rough demo, built in 2h" is fine, don't overdo
- **End strong** — Vision-Teaser delivered slowly, last word lands clean
- **Repo-URL** on a slide or written board — they should be able to type it during demo
