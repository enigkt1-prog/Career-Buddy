"""Slug-variant probe at scale.

Takes a hard-coded list of VCs / accelerators / well-known startups, generates
slug variants per entity, probes each variant against the four ATS public
APIs (Greenhouse, Lever, Ashby, Workable), and writes successful (entity,
provider, slug) triples into ``vcs.careers_url``.

The entity list intentionally mixes VCs, accelerators, and major operator-
hiring companies (Stripe, Personio, Helsing, etc.) so we hit > 100 jobs
even when most pure-VC firms have no public board for their own staff.

Run: ``uv run python -m career_buddy_scraper.cli.discover_slugs``.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
import time
from typing import Any
from urllib.parse import urlparse

from rich.console import Console

from ..db import REPO_ROOT
from ..http import RateLimitedClient, TokenBucket
from ..master_list import upsert_into_supabase
from ..models import VcRecord

console = Console()


# Hard-coded entity list. Entries are tuples:
#   (name, domain, geography, tier, sector_tags, source_tag, notes)
# Tier 1 = global elite, 2 = strong, 3 = niche.
ENTITIES: list[tuple[str, str, str, int, list[str], str, str]] = [
    # ────── Tier-1 European VCs (Notion-sourced) ──────
    (
        "Cherry Ventures",
        "cherry.vc",
        "DACH/Pan-EU",
        1,
        ["generalist"],
        "notion",
        "Tier-A. Berlin/London.",
    ),
    (
        "Project A Ventures",
        "project-a.com",
        "DACH/Pan-EU",
        1,
        ["generalist", "ai", "deeptech"],
        "notion",
        "Tier-A. Berlin/London.",
    ),
    (
        "EarlyBird Venture Capital",
        "earlybird.com",
        "DACH",
        1,
        ["deeptech", "ai"],
        "notion",
        "Tier-A. Berlin/Munich.",
    ),
    (
        "Speedinvest",
        "speedinvest.com",
        "DACH/UK/FR",
        1,
        ["fintech", "deeptech", "climate"],
        "notion",
        "Tier-A. Vienna+Berlin+London.",
    ),
    (
        "HV Capital",
        "hvcapital.com",
        "DACH",
        1,
        ["fintech", "climate", "b2b-saas"],
        "notion",
        "Tier-A. Munich/Berlin.",
    ),
    (
        "Point Nine Capital",
        "pointnine.com",
        "DACH/Pan-EU",
        1,
        ["b2b-saas", "ai"],
        "notion",
        "Tier-A. Berlin.",
    ),
    (
        "Index Ventures",
        "indexventures.com",
        "Pan-EU/US",
        1,
        ["ai", "b2b-saas", "fintech"],
        "notion",
        "Tier-S. London/SF.",
    ),
    (
        "Lakestar",
        "lakestar.com",
        "DACH/UK",
        1,
        ["ai", "deeptech"],
        "notion",
        "Tier-A. Zurich/Berlin/London.",
    ),
    (
        "Atomico",
        "atomico.com",
        "Pan-EU",
        1,
        ["ai", "deeptech"],
        "notion",
        "Tier-A. London + Paris/Berlin/Stockholm.",
    ),
    (
        "Plural Platform",
        "pluralplatform.com",
        "Pan-EU/CEE",
        1,
        ["deeptech", "climate"],
        "notion",
        "Tier-A. London/Tallinn.",
    ),
    (
        "Balderton Capital",
        "balderton.com",
        "Pan-EU",
        1,
        ["ai", "fintech", "b2b-saas"],
        "notion",
        "Tier-A. London/Paris/Berlin.",
    ),
    (
        "Notion Capital",
        "notion.vc",
        "UK/Pan-EU",
        1,
        ["b2b-saas", "fintech"],
        "notion",
        "Tier-A. London. NOT slug 'notion' on Ashby (that is Notion Labs).",
    ),
    (
        "Creandum",
        "creandum.com",
        "Nordics/DACH/UK",
        1,
        ["ai", "b2b-saas"],
        "notion",
        "Tier-A. Stockholm/Berlin/London.",
    ),
    (
        "General Catalyst",
        "generalcatalyst.com",
        "US/DACH/UK",
        1,
        ["ai", "health-bio"],
        "notion",
        "Tier-S.",
    ),
    (
        "Founders Fund",
        "foundersfund.com",
        "US",
        1,
        ["defense", "deeptech"],
        "notion",
        "Tier-S. SF only.",
    ),
    # ────── Tier-2 European VCs (Notion-sourced) ──────
    (
        "Heartcore Capital",
        "heartcore.com",
        "Nordics/DACH/FR",
        2,
        ["consumer", "ai"],
        "notion",
        "Tier-B.",
    ),
    ("Connect Ventures", "connectventures.co", "UK", 2, ["b2b-saas", "ai"], "notion", "Tier-B."),
    ("Felix Capital", "felixcap.com", "UK", 2, ["consumer", "ai"], "notion", "Tier-B."),
    (
        "Frontline Ventures",
        "frontline.vc",
        "UK/Pan-EU",
        2,
        ["b2b-saas"],
        "notion",
        "B2B SaaS PanEU.",
    ),
    ("Mosaic Ventures", "mosaicventures.com", "UK", 2, ["b2b-saas"], "notion", "Tier-B London."),
    ("Ada Ventures", "adaventures.com", "UK", 2, ["consumer", "ai"], "notion", "Tier-B London."),
    ("Hoxton Ventures", "hoxtonventures.com", "UK", 2, ["b2b-saas"], "notion", "Tier-B London."),
    ("MMC Ventures", "mmc.vc", "UK", 2, ["ai", "b2b-saas"], "notion", "Tier-B London."),
    ("OTB Ventures", "otb.vc", "CEE/Pan-EU", 2, ["deeptech"], "notion", "CEE deeptech."),
    ("EQT Ventures", "eqtventures.com", "Nordics", 2, ["b2b-saas"], "notion", "Stockholm."),
    (
        "Octopus Ventures",
        "octopusventures.com",
        "UK",
        2,
        ["b2b-saas", "deeptech"],
        "notion",
        "London.",
    ),
    ("Episode 1 Ventures", "episode1.com", "UK", 2, ["b2b-saas"], "notion", "London seed."),
    ("Stride VC", "stride.vc", "FR", 2, ["b2b-saas"], "notion", "Paris seed."),
    (
        "InReach Ventures",
        "inreachventures.com",
        "UK/Pan-EU",
        2,
        ["ai"],
        "notion",
        "London AI seed.",
    ),
    ("Planet A Ventures", "planet-a.com", "DACH", 2, ["climate"], "notion", "Berlin climate."),
    ("Concept Ventures", "conceptventures.vc", "UK", 2, ["b2b-saas"], "notion", "London preseed."),
    ("Air Street Capital", "airstreet.com", "UK", 2, ["ai"], "notion", "AI specialist."),
    ("Augmentum Fintech", "augmentum.vc", "UK", 2, ["fintech"], "notion", "London fintech."),
    (
        "Sofinnova Partners",
        "sofinnovapartners.com",
        "FR/Pan-EU",
        2,
        ["health-bio"],
        "notion",
        "Paris health/bio.",
    ),
    ("Extantia Capital", "extantia.com", "DACH", 2, ["climate"], "notion", "Climate."),
    ("Amadeus Capital", "amadeuscapital.com", "UK", 2, ["deeptech", "ai"], "notion", "London."),
    ("468 Capital", "468cap.com", "DACH/Pan-EU", 2, ["b2b-saas", "ai"], "notion", "Berlin."),
    ("IQ Capital", "iqcapital.vc", "UK", 2, ["deeptech", "ai"], "notion", "Cambridge UK deeptech."),
    ("Kindred Capital", "kindredcapital.vc", "UK", 2, ["b2b-saas"], "notion", "London."),
    ("Seedcamp", "seedcamp.com", "UK/Pan-EU", 2, ["b2b-saas"], "notion", "London preseed."),
    ("World Fund", "worldfund.vc", "DACH", 2, ["climate"], "notion", "Berlin climate."),
    ("Eurazeo", "eurazeo.com", "FR", 2, ["b2b-saas", "consumer"], "notion", "Paris growth."),
    (
        "Highland Europe",
        "highlandeurope.com",
        "Pan-EU",
        2,
        ["b2b-saas"],
        "notion",
        "London growth.",
    ),
    ("Northzone", "northzone.com", "Nordics/UK", 2, ["b2b-saas"], "notion", "Stockholm/London."),
    ("La Famiglia", "lafamiglia.vc", "DACH", 2, ["b2b-saas"], "notion", "Berlin (now part of GC)."),
    ("JoinCapital", "join.capital", "DACH", 2, ["b2b-saas"], "notion", "Berlin Series A."),
    ("byFounders", "byfounders.vc", "Nordics", 2, ["b2b-saas"], "notion", "Copenhagen."),
    ("Anthemis", "anthemis.com", "UK", 2, ["fintech"], "notion", "London fintech."),
    ("Coatue", "coatue.com", "US/Global", 1, ["ai", "fintech"], "notion", "Tier-S US growth."),
    (
        "Sequoia Capital",
        "sequoiacap.com",
        "US/Global",
        1,
        ["ai", "consumer", "b2b-saas"],
        "notion",
        "Tier-S global.",
    ),
    (
        "Andreessen Horowitz",
        "a16z.com",
        "US/UK",
        1,
        ["ai", "consumer", "crypto-web3"],
        "notion",
        "Tier-S a16z.",
    ),
    (
        "Bessemer Venture Partners",
        "bvp.com",
        "US/Global",
        1,
        ["b2b-saas", "ai"],
        "notion",
        "Tier-S BVP.",
    ),
    (
        "Lightspeed Venture Partners",
        "lsvp.com",
        "US/Global",
        1,
        ["b2b-saas", "ai"],
        "notion",
        "Tier-S Lightspeed.",
    ),
    (
        "Insight Partners",
        "insightpartners.com",
        "US/Global",
        1,
        ["b2b-saas"],
        "notion",
        "Tier-S Insight.",
    ),
    ("Accel", "accel.com", "US/UK/IN", 1, ["b2b-saas", "ai"], "notion", "Tier-S Accel."),
    ("Greylock", "greylock.com", "US", 1, ["ai", "b2b-saas"], "notion", "Tier-S Greylock."),
    # ────── Tier-3 / niche European (Notion-sourced) ──────
    ("9.5 Ventures", "95vc.com", "Pan-EU", 3, ["consumer"], "notion", "Niche."),
    ("Zinc VC", "zinc.vc", "UK", 3, ["impact"], "notion", "London impact."),
    # ────── Globally known top-tier US VCs (NOT in Notion) ──────
    (
        "Kleiner Perkins",
        "kleinerperkins.com",
        "US",
        1,
        ["ai", "b2b-saas"],
        "hardcoded",
        "Top-tier US.",
    ),
    ("Benchmark", "benchmark.com", "US", 1, ["b2b-saas"], "hardcoded", "Top-tier US."),
    (
        "Spark Capital",
        "sparkcapital.com",
        "US/UK",
        1,
        ["consumer", "b2b-saas"],
        "hardcoded",
        "Top-tier US/UK.",
    ),
    ("IVP", "ivp.com", "US", 1, ["b2b-saas"], "hardcoded", "Top-tier growth."),
    ("NEA", "nea.com", "US/Global", 1, ["b2b-saas", "health-bio"], "hardcoded", "Top-tier global."),
    ("Battery Ventures", "battery.com", "US/UK", 1, ["b2b-saas"], "hardcoded", "Top-tier."),
    ("Felicis", "felicis.com", "US", 2, ["b2b-saas"], "hardcoded", "Founder-friendly seed."),
    (
        "Founder Collective",
        "foundercollective.com",
        "US",
        2,
        ["b2b-saas"],
        "hardcoded",
        "Boston/SF seed.",
    ),
    ("First Round", "firstround.com", "US", 2, ["b2b-saas"], "hardcoded", "Seed-stage US."),
    ("Union Square Ventures", "usv.com", "US", 1, ["b2b-saas", "fintech"], "hardcoded", "USV NYC."),
    (
        "Forerunner Ventures",
        "forerunnerventures.com",
        "US",
        2,
        ["consumer"],
        "hardcoded",
        "Consumer specialist.",
    ),
    (
        "Initialized Capital",
        "initialized.com",
        "US",
        2,
        ["b2b-saas"],
        "hardcoded",
        "Garry Tan / now YC.",
    ),
    ("Conviction", "conviction.com", "US", 2, ["ai"], "hardcoded", "AI-only specialist."),
    ("Radical Ventures", "radical.vc", "Canada/US", 2, ["ai"], "hardcoded", "Toronto AI fund."),
    # ────── DACH not in Notion ──────
    (
        "Capnamic Ventures",
        "capnamic.com",
        "DACH",
        2,
        ["b2b-saas"],
        "hardcoded",
        "Cologne/Berlin Series A.",
    ),
    ("Senovo VC", "senovovc.com", "DACH", 2, ["b2b-saas"], "hardcoded", "Munich B2B SaaS."),
    ("Acton Capital", "actoncapital.com", "DACH", 2, ["b2b-saas"], "hardcoded", "Munich growth."),
    (
        "Target Global",
        "targetglobal.vc",
        "DACH",
        2,
        ["b2b-saas", "consumer"],
        "hardcoded",
        "Berlin global.",
    ),
    (
        "Holtzbrinck Ventures",
        "holtzbrinck-ventures.com",
        "DACH",
        2,
        ["b2b-saas"],
        "hardcoded",
        "Munich Holtzbrinck VC.",
    ),
    (
        "Atlantic Labs",
        "atlanticlabs.de",
        "DACH",
        2,
        ["b2b-saas", "ai"],
        "hardcoded",
        "Berlin builder.",
    ),
    (
        "UVC Partners",
        "uvcpartners.com",
        "DACH",
        2,
        ["b2b-saas", "deeptech"],
        "hardcoded",
        "Munich TUM.",
    ),
    ("Picus Capital", "picuscap.com", "DACH", 1, ["b2b-saas"], "hardcoded", "Berlin Tier-A."),
    ("Headline", "headline.com", "DACH/US", 2, ["b2b-saas"], "hardcoded", "ex-eventures."),
    (
        "DN Capital",
        "dncapital.com",
        "DACH/UK",
        2,
        ["b2b-saas", "fintech"],
        "hardcoded",
        "London/Berlin.",
    ),
    ("Lightrock", "lightrock.com", "Pan-EU", 2, ["climate"], "hardcoded", "Impact PanEU."),
    ("Flashpoint", "flashpoint.vc", "CEE", 2, ["b2b-saas"], "hardcoded", "London/CEE."),
    # ────── Accelerators (Notion-sourced and global) ──────
    ("Y Combinator", "ycombinator.com", "US", 1, ["generalist"], "notion", "Top accelerator."),
    (
        "Entrepreneur First",
        "joinef.com",
        "Global/UK",
        1,
        ["deeptech"],
        "notion",
        "EF cofounder builder.",
    ),
    ("Antler", "antler.co", "Global", 2, ["generalist"], "notion", "Antler global builder."),
    ("Techstars", "techstars.com", "Global", 2, ["generalist"], "notion", "Techstars program."),
    ("500 Global", "500.co", "Global", 2, ["generalist"], "notion", "500 Startups (now Global)."),
    (
        "Founders Factory",
        "foundersfactory.com",
        "UK",
        2,
        ["consumer"],
        "notion",
        "London corporate-VC.",
    ),
    ("Station F", "stationf.co", "FR", 2, ["generalist"], "notion", "Paris campus + program."),
    # ────── AI labs (BIG operator-hiring) ──────
    (
        "Anthropic",
        "anthropic.com",
        "US/UK",
        1,
        ["ai"],
        "hardcoded",
        "AI safety lab. Many operator roles.",
    ),
    ("OpenAI", "openai.com", "US/UK", 1, ["ai"], "hardcoded", "Largest AI lab."),
    ("Mistral AI", "mistral.ai", "FR", 1, ["ai"], "hardcoded", "Paris foundation models."),
    ("Cohere", "cohere.com", "Canada/US/UK", 1, ["ai"], "hardcoded", "Toronto/London."),
    ("Black Forest Labs", "bfl.ai", "DACH", 1, ["ai"], "hardcoded", "ex-StableDiffusion team."),
    # ────── Operator-heavy startups (high job count) ──────
    ("Stripe", "stripe.com", "US/UK/IE", 1, ["fintech"], "hardcoded", "Stripe global."),
    ("Plaid", "plaid.com", "US/UK", 1, ["fintech"], "hardcoded", "Plaid SF."),
    ("Figma", "figma.com", "US", 1, ["b2b-saas"], "hardcoded", "Figma SF."),
    ("Vercel", "vercel.com", "US/Remote", 1, ["b2b-saas"], "hardcoded", "Vercel remote."),
    ("Linear", "linear.app", "US/Remote", 1, ["b2b-saas"], "hardcoded", "Linear remote."),
    ("Anduril", "anduril.com", "US", 1, ["defense"], "hardcoded", "Anduril defense."),
    (
        "Helsing",
        "helsing.ai",
        "DACH/UK",
        1,
        ["defense", "ai"],
        "hardcoded",
        "Berlin/Munich/London defense AI.",
    ),
    ("Wayve", "wayve.ai", "UK", 1, ["ai", "deeptech"], "hardcoded", "London autonomous."),
    (
        "Quantum Systems",
        "quantum-systems.com",
        "DACH",
        1,
        ["defense"],
        "hardcoded",
        "Munich defense drones.",
    ),
    ("DeepL", "deepl.com", "DACH", 1, ["ai", "b2b-saas"], "hardcoded", "Cologne translation AI."),
    ("Personio", "personio.com", "DACH", 1, ["b2b-saas"], "hardcoded", "Munich HR SaaS."),
    (
        "Celonis",
        "celonis.com",
        "DACH/US",
        1,
        ["b2b-saas"],
        "hardcoded",
        "Munich/NY process mining.",
    ),
    ("N26", "n26.com", "DACH", 1, ["fintech"], "hardcoded", "Berlin neobank."),
    ("Klarna", "klarna.com", "Nordics/Global", 1, ["fintech"], "hardcoded", "Stockholm BNPL."),
    ("Wise", "wise.com", "UK/EE", 1, ["fintech"], "hardcoded", "London/Tallinn."),
    ("Revolut", "revolut.com", "UK", 1, ["fintech"], "hardcoded", "London."),
    ("Monzo", "monzo.com", "UK", 1, ["fintech"], "hardcoded", "London neobank."),
    # ────── Tier-1 EU operator-startups (many open roles) ──────
    (
        "Trade Republic",
        "traderepublic.com",
        "DACH",
        1,
        ["fintech"],
        "hardcoded",
        "Berlin neobroker.",
    ),
    ("Mistralai SDK", "mistral.ai", "FR", 1, ["ai"], "hardcoded", "(dup; merge)"),
    ("Pigment", "pigment.com", "FR", 2, ["b2b-saas"], "hardcoded", "Paris FP&A SaaS."),
    ("Qonto", "qonto.com", "FR/DACH", 1, ["fintech"], "hardcoded", "Paris SMB banking."),
    ("Alan", "alan.com", "FR", 2, ["health-bio"], "hardcoded", "Paris health insurance."),
    ("Doctolib", "doctolib.com", "FR/DACH", 1, ["health-bio"], "hardcoded", "Paris booking SaaS."),
    ("BlaBlaCar", "blablacar.com", "FR", 2, ["mobility"], "hardcoded", "Paris carpooling."),
    ("Mirakl", "mirakl.com", "FR/US", 2, ["b2b-saas"], "hardcoded", "Marketplace SaaS."),
    (
        "Contentsquare",
        "contentsquare.com",
        "FR/US",
        2,
        ["b2b-saas"],
        "hardcoded",
        "Digital experience analytics.",
    ),
    ("Gohenry", "gohenry.com", "UK/US", 2, ["fintech"], "hardcoded", "Kids fintech."),
    ("Zopa", "zopa.com", "UK", 2, ["fintech"], "hardcoded", "UK consumer fintech."),
    # ────── Crypto / Web3 (notable operator hires) ──────
    ("Coinbase", "coinbase.com", "US", 1, ["crypto-web3"], "hardcoded", "Largest crypto exchange."),
    ("Binance", "binance.com", "Global", 1, ["crypto-web3"], "hardcoded", "Binance global."),
    # ────── Round 3 expansion (2026-05-09) ─────────────────────────────
    # AI-native operator-startups (heavy hiring 2025-26)
    ("Scale AI", "scale.com", "US", 1, ["ai"], "hardcoded", "Data labeling + model eval."),
    ("Glean", "glean.com", "US", 1, ["b2b-saas", "ai"], "hardcoded", "Enterprise search AI."),
    ("Sierra", "sierra.ai", "US", 1, ["ai"], "hardcoded", "AI customer support, Bret Taylor."),
    ("Harvey", "harvey.ai", "US/UK", 1, ["ai"], "hardcoded", "Legal AI."),
    ("Hebbia", "hebbia.com", "US/UK", 1, ["ai"], "hardcoded", "AI search for finance."),
    ("Perplexity", "perplexity.ai", "US", 1, ["ai"], "hardcoded", "Conversational search."),
    ("Anysphere (Cursor)", "cursor.com", "US", 1, ["ai", "b2b-saas"], "hardcoded", "AI code editor."),
    ("Replicate", "replicate.com", "US", 1, ["ai"], "hardcoded", "AI model hosting."),
    ("Runway", "runwayml.com", "US", 1, ["ai"], "hardcoded", "Video generation AI."),
    ("ElevenLabs", "elevenlabs.io", "US/UK", 1, ["ai"], "hardcoded", "Voice AI."),
    ("Suno", "suno.com", "US", 1, ["ai", "consumer"], "hardcoded", "Music generation AI."),
    ("Speak", "speak.com", "US", 2, ["ai", "consumer"], "hardcoded", "Language learning AI."),
    ("Captions", "captions.ai", "US", 2, ["ai", "consumer"], "hardcoded", "Video captioning."),
    ("Decagon", "decagon.ai", "US", 2, ["ai"], "hardcoded", "Customer support AI."),
    ("Abridge", "abridge.com", "US", 1, ["ai", "health-bio"], "hardcoded", "Medical AI scribe."),
    ("Imbue", "imbue.com", "US", 1, ["ai"], "hardcoded", "AGI research lab."),
    ("Adept AI", "adept.ai", "US", 1, ["ai"], "hardcoded", "Action models."),
    ("Inflection AI", "inflection.ai", "US", 1, ["ai"], "hardcoded", "Pi assistant."),
    ("Character AI", "character.ai", "US", 1, ["ai", "consumer"], "hardcoded", "Conversational AI."),
    ("Together AI", "together.ai", "US", 1, ["ai"], "hardcoded", "Open-model infrastructure."),
    ("Fireworks AI", "fireworks.ai", "US", 2, ["ai"], "hardcoded", "Inference platform."),
    ("Modal", "modal.com", "US", 2, ["ai", "b2b-saas"], "hardcoded", "Serverless ML compute."),
    ("Anyscale", "anyscale.com", "US", 2, ["ai"], "hardcoded", "Ray AI infrastructure."),
    ("Pinecone", "pinecone.io", "US", 2, ["ai"], "hardcoded", "Vector DB."),
    ("Weaviate", "weaviate.io", "DACH/US", 2, ["ai"], "hardcoded", "Vector DB Amsterdam-rooted."),
    ("LangChain", "langchain.com", "US", 2, ["ai"], "hardcoded", "LLM dev framework."),
    ("LlamaIndex", "llamaindex.ai", "US", 2, ["ai"], "hardcoded", "RAG framework."),
    ("Hugging Face", "huggingface.co", "US/FR", 1, ["ai"], "hardcoded", "Open AI hub."),
    ("Together with Mistral", "mistral.ai", "FR", 1, ["ai"], "hardcoded", "(dup ok)"),
    # Top operator-startups (Stripe / Notion-class)
    ("Mercury", "mercury.com", "US", 1, ["fintech"], "hardcoded", "Startup banking."),
    ("Brex", "brex.com", "US", 1, ["fintech"], "hardcoded", "Corporate cards."),
    ("Ramp", "ramp.com", "US", 1, ["fintech"], "hardcoded", "Spend management."),
    ("Rippling", "rippling.com", "US/UK", 1, ["b2b-saas"], "hardcoded", "HR + IT platform."),
    ("Deel", "deel.com", "US/UK", 1, ["b2b-saas"], "hardcoded", "Global hiring + payroll."),
    ("Loom", "loom.com", "US", 1, ["b2b-saas"], "hardcoded", "Video messaging."),
    ("Airtable", "airtable.com", "US", 1, ["b2b-saas"], "hardcoded", "No-code DB."),
    ("Retool", "retool.com", "US", 1, ["b2b-saas"], "hardcoded", "Internal tools."),
    ("Webflow", "webflow.com", "US", 1, ["b2b-saas"], "hardcoded", "Visual web dev."),
    ("Zapier", "zapier.com", "US/Remote", 1, ["b2b-saas"], "hardcoded", "Automation platform."),
    ("Notion Labs", "notion.so", "US", 1, ["b2b-saas"], "hardcoded", "Notes/docs/wikis."),
    ("Asana", "asana.com", "US", 1, ["b2b-saas"], "hardcoded", "Project management."),
    ("Atlassian", "atlassian.com", "US/AU", 1, ["b2b-saas"], "hardcoded", "Jira/Confluence."),
    ("HubSpot", "hubspot.com", "US/IE", 1, ["b2b-saas"], "hardcoded", "CRM platform."),
    ("Datadog", "datadog.com", "US", 1, ["b2b-saas"], "hardcoded", "Monitoring."),
    ("Snowflake", "snowflake.com", "US", 1, ["b2b-saas"], "hardcoded", "Data warehouse."),
    ("Databricks", "databricks.com", "US", 1, ["b2b-saas", "ai"], "hardcoded", "Data + ML platform."),
    ("MongoDB", "mongodb.com", "US", 1, ["b2b-saas"], "hardcoded", "Database company."),
    ("Confluent", "confluent.io", "US", 1, ["b2b-saas"], "hardcoded", "Kafka company."),
    ("HashiCorp", "hashicorp.com", "US", 1, ["b2b-saas"], "hardcoded", "Terraform."),
    ("Cloudflare", "cloudflare.com", "US/Global", 1, ["b2b-saas"], "hardcoded", "Edge platform."),
    # Top DACH/EU operator-startups not yet listed
    ("Aleph Alpha", "aleph-alpha.com", "DACH", 1, ["ai"], "hardcoded", "Heidelberg LLM lab."),
    ("Lilium", "lilium.com", "DACH", 2, ["mobility"], "hardcoded", "eVTOL aircraft."),
    ("Tomorrow", "tomorrow.one", "DACH", 2, ["fintech"], "hardcoded", "Sustainable banking."),
    ("Solaris", "solarisgroup.com", "DACH", 2, ["fintech"], "hardcoded", "Banking-as-a-service."),
    ("HelloFresh", "hellofresh.com", "DACH/Global", 1, ["consumer"], "hardcoded", "Meal kits."),
    ("Delivery Hero", "deliveryhero.com", "DACH/Global", 1, ["consumer"], "hardcoded", "Food delivery."),
    ("Zalando", "zalando.com", "DACH/EU", 1, ["consumer"], "hardcoded", "Fashion e-com."),
    ("Forto", "forto.com", "DACH", 2, ["b2b-saas"], "hardcoded", "Digital freight."),
    ("TIER Mobility", "tier.app", "DACH", 2, ["mobility"], "hardcoded", "E-scooters."),
    ("Pitch", "pitch.com", "DACH", 2, ["b2b-saas"], "hardcoded", "Berlin presentation tool."),
    ("Flink", "goflink.com", "DACH", 2, ["consumer"], "hardcoded", "Quick-commerce."),
    ("Gorillas", "gorillas.io", "DACH", 2, ["consumer"], "hardcoded", "Quick-commerce."),
    ("Volocopter", "volocopter.com", "DACH", 2, ["mobility"], "hardcoded", "Bruchsal eVTOL."),
    ("XYO Network", "xyo.network", "DACH", 3, ["crypto-web3"], "hardcoded", "Geo-data network."),
    ("Sennder", "sennder.com", "DACH", 2, ["b2b-saas"], "hardcoded", "Berlin freight platform."),
    ("Adjust", "adjust.com", "DACH", 2, ["b2b-saas"], "hardcoded", "Mobile measurement."),
    ("GetYourGuide", "getyourguide.com", "DACH", 2, ["consumer"], "hardcoded", "Berlin tours."),
    ("Babbel", "babbel.com", "DACH", 2, ["consumer"], "hardcoded", "Language learning."),
    ("Sumup", "sumup.com", "DACH/UK", 2, ["fintech"], "hardcoded", "Card readers."),
    ("Smava", "smava.de", "DACH", 3, ["fintech"], "hardcoded", "Loan marketplace."),
    ("Raisin", "raisin.com", "DACH", 2, ["fintech"], "hardcoded", "Savings marketplace."),
    ("Scalable Capital", "scalable.capital", "DACH", 2, ["fintech"], "hardcoded", "Robo-advisor."),
    ("Klarna", "klarna.com", "Nordics/Global", 1, ["fintech"], "hardcoded", "(dup ok)"),
    # France/UK additional
    ("Spendesk", "spendesk.com", "FR", 2, ["fintech"], "hardcoded", "Spend management Paris."),
    ("Algolia", "algolia.com", "FR/US", 2, ["b2b-saas"], "hardcoded", "Search-as-a-service."),
    ("Sendinblue (Brevo)", "brevo.com", "FR", 2, ["b2b-saas"], "hardcoded", "Email marketing."),
    ("Ledger", "ledger.com", "FR", 2, ["crypto-web3"], "hardcoded", "Crypto hardware wallet."),
    ("Sorare", "sorare.com", "FR", 2, ["crypto-web3", "consumer"], "hardcoded", "NFT football."),
    ("Aircall", "aircall.io", "FR/US", 2, ["b2b-saas"], "hardcoded", "Cloud phone system."),
    ("Cohere AI", "cohere.com", "Canada/US/UK", 1, ["ai"], "hardcoded", "(dup ok)"),
    # Y Combinator alumni stars (W24/S24/W25/S25)
    ("Lovable", "lovable.dev", "Nordics/Global", 1, ["ai", "b2b-saas"], "hardcoded", "AI app builder."),
    ("Bolt.new (StackBlitz)", "stackblitz.com", "US", 2, ["b2b-saas"], "hardcoded", "AI app builder."),
    ("Tessl", "tessl.io", "UK", 2, ["b2b-saas"], "hardcoded", "AI native dev."),
    ("Cline", "cline.bot", "US", 3, ["ai"], "hardcoded", "AI coding agent."),
    ("Continue", "continue.dev", "US", 3, ["ai"], "hardcoded", "AI dev assistant."),
    ("11x AI", "11x.ai", "DACH/US", 2, ["ai"], "hardcoded", "AI sales agents."),
    ("Clay", "clay.com", "US", 2, ["b2b-saas"], "hardcoded", "Sales data enrichment."),
]


SLUG_NORMALISE_RE = re.compile(r"[^a-z0-9]+")
ATS_API: dict[str, str] = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs",
    "lever": "https://api.lever.co/v0/postings/{slug}?mode=json",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{slug}",
    "personio_de": "https://{slug}.jobs.personio.de/xml",
    "personio_com": "https://{slug}.jobs.personio.com/xml",
    "recruitee": "https://{slug}.recruitee.com/api/offers/",
}


def _slug_variants(name: str, domain: str) -> list[str]:
    """Generate plausible board slugs for a (name, domain) pair."""
    name_clean = SLUG_NORMALISE_RE.sub("", name.lower())
    name_kebab = SLUG_NORMALISE_RE.sub("-", name.lower()).strip("-")
    name_words = name.lower().split()
    first_word = SLUG_NORMALISE_RE.sub("", name_words[0]) if name_words else ""
    parsed = urlparse(domain if domain.startswith("http") else f"https://{domain}")
    host = parsed.netloc or parsed.path
    host_root = host.split(".")[0] if "." in host else host
    host_root_clean = SLUG_NORMALISE_RE.sub("", host_root.lower())
    candidates: list[str] = []
    seen: set[str] = set()
    for s in (
        name_clean,
        name_kebab,
        first_word,
        host_root_clean,
        f"{first_word}vc",
        f"{first_word}ventures",
        f"{first_word}capital",
        f"{name_clean}vc",
        f"{name_clean}ventures",
        host_root_clean.replace("-", ""),
    ):
        s = s.strip("-").strip()
        if s and s not in seen and len(s) >= 2:
            seen.add(s)
            candidates.append(s)
    return candidates


async def _probe_one(client: RateLimitedClient, provider: str, slug: str) -> tuple[bool, int]:
    """Return ``(success, job_count)``. ``success`` requires 200 + non-empty body."""
    url = ATS_API[provider].format(slug=slug)
    try:
        resp = await client.get(url)
    except Exception:
        return False, 0
    if resp.status_code != 200:
        return False, 0
    try:
        payload = resp.json()
    except ValueError:
        return False, 0
    if provider == "lever":
        return (isinstance(payload, list)), (len(payload) if isinstance(payload, list) else 0)
    if isinstance(payload, dict):
        jobs = payload.get("jobs", [])
        return (isinstance(jobs, list)), (len(jobs) if isinstance(jobs, list) else 0)
    return False, 0


async def _probe_workable(client: RateLimitedClient, slug: str) -> tuple[bool, int]:
    url = f"https://apply.workable.com/api/v3/accounts/{slug}/jobs"
    try:
        resp = await client.post(url, json={"limit": 100})
    except Exception:
        return False, 0
    if resp.status_code != 200:
        return False, 0
    try:
        payload = resp.json()
    except ValueError:
        return False, 0
    if isinstance(payload, dict):
        results = payload.get("results", [])
        return (isinstance(results, list)), (len(results) if isinstance(results, list) else 0)
    return False, 0


async def main() -> int:
    artifacts = REPO_ROOT / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())

    discovered: list[dict[str, Any]] = []
    not_found: list[dict[str, str]] = []

    async with RateLimitedClient(
        bucket=TokenBucket(100, 60.0),
        per_host_delay_s=0.2,
        cache_dir=artifacts / "cache",
    ) as client:
        for entity in ENTITIES:
            name, domain, geography, tier, sector_tags, source_tag, notes = entity
            variants = _slug_variants(name, domain)
            best: tuple[str, str, int] | None = None  # (provider, slug, count)
            for provider in ("greenhouse", "lever", "ashby", "personio_de", "personio_com", "recruitee"):
                for slug in variants:
                    ok, count = await _probe_one(client, provider, slug)
                    if ok and count > 0 and (best is None or count > best[2]):
                        best = (provider, slug, count)
                if best is not None and best[0] == provider and best[2] >= 5:
                    break  # solid hit on this provider; stop probing others
            if best is None:
                # Workable last because POST is heavier
                for slug in variants:
                    ok, count = await _probe_workable(client, slug)
                    if ok and count > 0:
                        best = ("workable", slug, count)
                        break
            if best is None:
                not_found.append({"name": name, "domain": domain})
                console.print(f"[dim]✗ {name:<32} no slug match[/dim]")
                continue
            provider, slug, count = best
            url = {
                "greenhouse": f"https://boards.greenhouse.io/{slug}",
                "lever": f"https://jobs.lever.co/{slug}",
                "ashby": f"https://jobs.ashbyhq.com/{slug}",
                "workable": f"https://apply.workable.com/{slug}",
                "personio_de": f"https://{slug}.jobs.personio.de",
                "personio_com": f"https://{slug}.jobs.personio.com",
                "recruitee": f"https://{slug}.recruitee.com",
            }[provider]
            provider_normalised = "personio" if provider.startswith("personio") else provider
            discovered.append(
                {
                    "name": name,
                    "domain": domain,
                    "geography": geography,
                    "tier": tier,
                    "sector_tags": sector_tags,
                    "source_tag": source_tag,
                    "notes": notes,
                    "provider": provider_normalised,
                    "slug": slug,
                    "careers_url": url,
                    "job_count": count,
                }
            )
            console.print(
                f"[green]✓[/green] {name:<32} → {provider_normalised:<10} {slug:<25} ({count})"
            )

    out_path = artifacts / f"slug-discovery-{timestamp}.json"
    out_path.write_text(
        json.dumps({"discovered": discovered, "not_found": not_found}, indent=2, default=str),
        encoding="utf-8",
    )

    # Build VcRecord list — both discovered (with ATS careers_url) and unmatched
    # (with homepage as careers_url). All go into vcs.
    records: list[VcRecord] = []
    for item in discovered:
        records.append(
            VcRecord(
                name=item["name"],
                domain=item["domain"],
                careers_url=item["careers_url"],
                stage_focus=None,
                sector_tags=list(item["sector_tags"]),
                geography=item["geography"],
                tier=int(item["tier"]),
                sources=[item["source_tag"]],
                notes=f"{item['notes']} | {item['provider']}:{item['slug']} ({item['job_count']} jobs at probe)",
            )
        )
    for item in not_found:
        # Find original entity to get full info
        for entity in ENTITIES:
            if entity[0] == item["name"]:
                records.append(
                    VcRecord(
                        name=entity[0],
                        domain=entity[1],
                        careers_url=f"https://{entity[1]}/careers",
                        stage_focus=None,
                        sector_tags=list(entity[4]),
                        geography=entity[2],
                        tier=entity[3],
                        sources=[entity[5]],
                        notes=f"{entity[6]} | no direct ATS slug found",
                    )
                )
                break

    inserted, updated = upsert_into_supabase(records)

    metrics: dict[str, Any] | None = None

    console.print()
    console.print(
        f"[bold]slug-discovery done[/bold]: {len(discovered)} hits, "
        f"{len(not_found)} misses across {len(ENTITIES)} entities"
    )
    console.print(f"  upsert: inserted={inserted}, updated={updated}")
    console.print(f"  output: {out_path}")
    if metrics:
        console.print(
            f"  HTTP: {metrics['total_requests']} reqs, peak/min {metrics['peak_per_minute']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
