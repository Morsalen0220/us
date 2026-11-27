import { db, setSetting, syncPostTags } from './database.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, SITE_URL } from '../config.js';
import { hashPassword } from '../utils/auth.js';
import { generateEditorialCoverWebp } from '../utils/imageProcessor.js';
import { renderArticleContent } from '../utils/markdown.js';
import { slugify } from '../utils/seo.js';
import { generateDraftSocialPosts } from '../utils/social.js';

const DEFAULT_SETTINGS = {
  site_name: 'TechHaven US',
  site_tagline: 'Breaking US & Europe Tech, AI, Gaming & Practical Guides',
  site_description: 'Independent tech guides, AI updates, gadget reviews, software tips, cybersecurity insights, and gaming coverage for US readers.',
  site_url: SITE_URL,
  contact_email: 'contact@techhavenus.com',
  privacy_email: 'privacy@techhavenus.com',
  twitter_handle: '@techhavenus',
  publisher_legal_name: 'TechHaven US',
  publisher_owner_name: 'Md Apple Mahmud (Founder & Managing Tech Editor)',
  publisher_street_address: '',
  publisher_city: 'New York',
  publisher_state: 'NY',
  publisher_postal_code: '',
  publisher_country: 'United States',
  publisher_phone: '',
  newsletter_provider: 'local',
  newsletter_api_key: '',
  newsletter_list_id: '',
  newsletter_from_name: 'TechHaven US Dispatch',
  newsletter_from_email: 'newsletter@techhavenus.com',
  bluesky_handle: '',
  bluesky_app_password: '',
  social_webhook_url: '',
  vapid_subject: 'mailto:contact@techhavenus.com',
  vapid_public_key: '',
  vapid_private_key: '',
  google_site_verification: '',
  bing_site_verification: '',
  ga_measurement_id: '',
  cdn_base_url: '',
  gemini_api_key: '',
  openai_api_key: '',
  adsense_publisher_id: '',
  ads_slots_visible: '0',
  ads_enabled: '0',
  ads_auto_enabled: '0',
  ads_placeholder_mode: '0',
  ads_mid_paragraph: '3',
  ads_slot_header: '',
  ads_slot_infeed: '',
  ads_slot_article_top: '',
  ads_slot_article_mid: '',
  ads_slot_sidebar: '',
  ads_slot_article_bottom: '',
  ads_txt: '# Add your Google AdSense publisher line below once approved\n# google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0',
  robots_extra: ''
};

export const RECOMMENDED_CATEGORIES = [
  {
    name: 'AI & Artificial Intelligence',
    slug: 'ai',
    description: 'AI News, ChatGPT, Google Gemini, Claude, autonomous AI agents, and practical AI tools.',
    meta_title: 'AI & Artificial Intelligence News, Agents & Tools | TechHaven US',
    meta_description: 'Latest AI model launches, OpenAI ChatGPT, Google Gemini, Anthropic Claude, and enterprise AI agent reporting across the US and Europe.',
    accent_color: '#2563EB',
    sort_order: 1
  },
  {
    name: 'Technology News',
    slug: 'tech-news',
    description: 'Apple, Google, Microsoft, Meta, Amazon, Silicon Valley & European startups, and digital regulation.',
    meta_title: 'Technology News — Big Tech, Startups & US/EU Policy | TechHaven US',
    meta_description: 'Breaking technology news covering Apple, Google, Microsoft, Meta, Amazon, startups, and transatlantic regulation.',
    accent_color: '#0284C7',
    sort_order: 2
  },
  {
    name: 'Gadgets & Devices',
    slug: 'gadgets',
    description: 'Smartphones, AI laptops, wearables, GPUs, and consumer hardware releases.',
    meta_title: 'Gadgets & Devices — Phones, Laptops & Hardware | TechHaven US',
    meta_description: 'Hands-on news and buyer analysis on smartphones, laptops, wearables, and next-gen desktop hardware.',
    accent_color: '#0891B2',
    sort_order: 3
  },
  {
    name: 'Software & Apps',
    slug: 'software-apps',
    description: 'Windows 11, Android, iOS, macOS, browsers, and essential productivity software updates.',
    meta_title: 'Software & Apps — Windows, macOS, Android, iOS & Browsers | TechHaven US',
    meta_description: 'Major OS updates, browser security releases, developer utilities, and cross-platform software coverage.',
    accent_color: '#4F46E5',
    sort_order: 4
  },
  {
    name: 'Cybersecurity',
    slug: 'cybersecurity',
    description: 'Privacy, zero-trust architecture, data breaches, passkeys, and online safety briefings.',
    meta_title: 'Cybersecurity, Privacy & Online Safety Briefings | TechHaven US',
    meta_description: 'Zero-trust blueprints, breach advisories, FIDO2 passkeys, and cloud security guides for US & European teams.',
    accent_color: '#DC2626',
    sort_order: 5
  },
  {
    name: 'Gaming & Entertainment',
    slug: 'gaming',
    description: 'PC gaming, GTA 5 & GTA 6, PlayStation, Xbox, game engines, and esports hardware.',
    meta_title: 'Gaming & Entertainment — GTA 6, PC, PlayStation & Xbox | TechHaven US',
    meta_description: 'Verified GTA 5 Online updates, GTA 6 launch analysis, PC GPU optimization, and console news for US & EU gamers.',
    accent_color: '#7C3AED',
    sort_order: 6
  },
  {
    name: 'Reviews & Comparisons',
    slug: 'reviews-comparisons',
    description: 'AI model matchups, hardware benchmarks, and side-by-side software comparisons.',
    meta_title: 'Reviews & Comparisons — AI, GPUs & Software Matchups | TechHaven US',
    meta_description: 'Side-by-side hardware and software comparisons including RTX vs RDNA, ChatGPT vs Gemini, and practical buying guides.',
    accent_color: '#D97706',
    sort_order: 7
  },
  {
    name: 'How-To & Guides',
    slug: 'how-to',
    description: 'Step-by-step tutorials, Core Web Vitals optimization, troubleshooting, and productivity guides.',
    meta_title: 'How-To & Guides — Step-by-Step Tech Tutorials | TechHaven US',
    meta_description: 'Practical tutorials on speed optimization, Windows & Linux fixes, AI workflows, and web engineering.',
    accent_color: '#059669',
    sort_order: 8
  },
  {
    name: 'Future Technology',
    slug: 'future-tech',
    description: 'Humanoid robotics, electric vehicles (EVs), commercial spaceflight, and quantum computing.',
    meta_title: 'Future Technology — Robotics, EVs, Space & Quantum | TechHaven US',
    meta_description: 'Tracking breakthroughs in robotics, solid-state EV batteries, orbital networks, and fault-tolerant quantum systems.',
    accent_color: '#9333EA',
    sort_order: 9
  },
  {
    name: 'Cloud & Developer',
    slug: 'cloud-dev',
    description: 'Cloud computing, Node.js, APIs, edge workers, SQLite/PostgreSQL architecture, and DevOps.',
    meta_title: 'Cloud & Developer — APIs, Edge Computing & DevOps | TechHaven US',
    meta_description: 'Deep dives on cloud architecture, edge runtimes, APIs, database scaling, and modern DevOps engineering.',
    accent_color: '#0D9488',
    sort_order: 10
  }
];

const LEGACY_CATEGORY_MIGRATIONS = [
  { oldSlug: 'ai-tech', newSlug: 'ai', redirectTo: '/category/ai', setRegion: null },
  { oldSlug: 'usa-europe', newSlug: 'tech-news', redirectTo: '/region/usa-europe', setRegion: 'USA & Europe' },
  { oldSlug: 'gaming-gta', newSlug: 'gaming', redirectTo: '/category/gaming', setRegion: null },
  { oldSlug: 'tutorials', newSlug: 'how-to', redirectTo: '/category/how-to', setRegion: null },
  { oldSlug: 'reviews', newSlug: 'reviews-comparisons', redirectTo: '/category/reviews-comparisons', setRegion: null }
];

const SEED_ARTICLES = [
  {
    categorySlug: 'gaming',
    region: 'USA & Europe',
    is_featured: 1,
    is_trending: 1,
    is_breaking: 1,
    is_editors_pick: 1,
    accentColor: '#7C3AED',
    secondaryColor: '#1E1B4B',
    kicker: 'ROCKSTAR GAMES REPORT',
    coverHeadline: 'GTA 6 & GTA 5 Online 2026 Roadmap',
    title: 'GTA 6 & GTA 5 Online 2026 Roadmap: Rockstar’s US Launch Window, Vice City Map Scope, and PC Features',
    subtitle: 'Everything confirmed and reliably reported for North American and European players ahead of Rockstar’s biggest release cycle.',
    slug: 'gta-6-gta-5-online-2026-roadmap-us-launch-pc-features',
    excerpt: 'Rockstar Games continues expanding GTA 5 Online across the US and Europe while finalizing GTA 6’s Vice City rollout. Here is the complete 2026 breakdown.',
    meta_title: 'GTA 6 & GTA 5 Online 2026 Roadmap: US Launch & PC Features',
    meta_subtitle: 'Rockstar’s Vice City scale, GTA Online next-gen parity, and anti-cheat upgrades explained',
    meta_description: 'Get the latest 2026 GTA 6 and GTA 5 Online roadmap for US and European players, including Vice City map scale, next-gen PC upgrades, and BattlEye anti-cheat changes.',
    meta_tags: 'GTA 5, GTA 6, Rockstar Games, US Gaming, PC Gaming, Open World, USA & Europe',
    focus_keyword: 'GTA 6',
    hoursAgo: 2,
    fact_check_status: 'Fact-Checked',
    last_fact_checked: '2026-11-18',
    whats_new: 'Updated with Take-Two Interactive Q3 FY2026 earnings guidance and Rockstar PC BattlEye patch verification.',
    key_takeaways: [
      'Rockstar continues deploying Expanded & Enhanced ray-traced visuals and BattlEye anti-cheat across GTA 5 Online PC lobbies.',
      'GTA 6 prioritizes dense enterable interiors across Vice City and the State of Leonida powered by RAGE 9.',
      'PC builders targeting 1440p/4K should plan for 12GB–16GB VRAM and PCIe Gen 4 NVMe DirectStorage drives.',
      'Console versions lead the launch schedule while PC feature parity trails closely behind.'
    ],
    official_sources: [
      { label: 'Rockstar Games Newswire', url: 'https://www.rockstargames.com/newswire' },
      { label: 'Take-Two Interactive Investor Relations', url: 'https://www.take2games.com/ir' }
    ],
    corrections: [
      { date: '2026-11-18', note: 'Clarified BattlEye kernel driver requirement for public PC GTA Online sessions.' }
    ],
    imageTitle: 'GTA 6 and GTA 5 Online 2026 Roadmap Editorial Artwork',
    imageAlt: 'TechHaven US editorial graphic highlighting the GTA 6 and GTA 5 Online 2026 roadmap',
    imageCaption: 'Rockstar’s dual-track strategy keeps GTA 5 Online thriving on PC and consoles while GTA 6 prepares for launch. (Illustration: TechHaven US)',
    content_md: `Rockstar Games is entering the most closely watched year in interactive entertainment history. Across the United States and Europe, millions of active **GTA 5 Online** players are still logging into Los Santos weekly even as anticipation builds for **Grand Theft Auto VI** in Leonida and Vice City.

Understanding how Rockstar is supporting both titles—and what upgrades are landing on PC, PlayStation 5, and Xbox Series X|S—helps players prepare their hardware, crews, and expectations for the months ahead.

## Why GTA 5 Online Remains Massive in the US and Europe

More than a decade after its debut, GTA 5 continues to sit near the top of North American and European digital storefront charts. Rockstar’s decision to bring **Expanded & Enhanced** ray-traced reflections, faster vehicle speeds (HSW), and **BattlEye anti-cheat** support to PC modernized the experience for competitive lobbies.

- **Seasonal Business Expansions:** New multi-stage heist contracts and automated passive income hubs designed for solo and four-player squads.
- **DirectStorage & Asset Streaming:** Faster loading into public sessions on NVMe SSDs across Windows 11 systems.
- **Balanced Economy Tuning:** Higher base payouts on older contact missions so newcomers in the US and EU can catch up quickly.

## GTA 6 Vice City & Leonida Scope: What Matters Most

Built on the next-generation **RAGE 9** engine, GTA 6 dramatically increases interior density, weather physics, and AI crowd behavior compared to Los Santos. Rather than relying solely on empty square mileage, Rockstar has shifted toward verticality—enterable clubs, beachfront hotels, pawn shops, and interconnected highway corridors modeled after South Florida.

| Feature Area | GTA 5 (Enhanced PC/Console) | GTA 6 (Next-Gen RAGE 9) |
| :--- | :--- | :--- |
| Setting | Los Santos & Blaine County | Vice City & State of Leonida |
| AI Crowd Density | Scripted regional loops | Dynamic routine-driven NPCs |
| Lighting Model | Hybrid + Selective RT | Full Global Illumination & RT Reflections |
| Anti-Cheat Architecture | BattlEye integration | Server-authoritative telemetry |

## What PC Builders Should Expect

For players building or upgrading a 1440p or 4K rig in 2026, two hardware thresholds stand out:

1. **12GB to 16GB VRAM Target:** Open-world global illumination and high-resolution streaming textures heavily tax 8GB cards at high settings.
2. **Gen 4 NVMe Storage:** Seamless transitions between dense indoor interiors and high-speed coastal highways demand fast sequential decompression.`
  },
  {
    categorySlug: 'ai',
    region: 'USA & Europe',
    is_featured: 1,
    is_trending: 1,
    is_breaking: 1,
    is_editors_pick: 1,
    accentColor: '#2563EB',
    secondaryColor: '#0F172A',
    kicker: 'AI ENGINEERING BRIEFING',
    coverHeadline: 'The 2026 Autonomous AI Agent Race',
    title: 'OpenAI, Google Gemini, and the 2026 AI Agent Race: How Autonomous Models Are Transforming US & EU Tech',
    subtitle: 'From chat assistants to verified multi-step software engineers—what actually changed in production deployments this year.',
    slug: 'openai-google-gemini-2026-ai-agent-race-us-eu-tech',
    excerpt: 'Enterprises across San Francisco, London, and Berlin are shifting budgets from simple chatbots to bounded autonomous AI agents with strict audit trails.',
    meta_title: '2026 AI Agent Race: OpenAI vs. Google Gemini in US & EU Tech',
    meta_subtitle: 'How frontier reasoning models and tool-using agents moved from demos into regulated enterprise stacks',
    meta_description: 'Deep analysis of the 2026 AI agent landscape comparing OpenAI and Google Gemini across coding automation, latency, cost, and US/EU enterprise adoption.',
    meta_tags: 'Artificial Intelligence, OpenAI, Google Gemini, AI Agents, Enterprise Tech, Silicon Valley, USA & Europe',
    focus_keyword: 'AI agents',
    hoursAgo: 6,
    fact_check_status: 'Fact-Checked',
    last_fact_checked: '2026-11-18',
    whats_new: 'Added European sovereign cloud adoption benchmarks from Frankfurt and Paris enterprise surveys.',
    key_takeaways: [
      'US and EU engineering teams now judge frontier models on tool-execution reliability and test verification rather than chat fluency alone.',
      'Google Gemini, OpenAI reasoning models, and Claude lead multi-step codebase orchestration pipelines.',
      'European enterprises increasingly pair agentic workflows with regional data-residency endpoints and strict audit logs.',
      'Scoped read-only research passes followed by deterministic automated tests prevent hallucinated production changes.'
    ],
    official_sources: [
      { label: 'Google DeepMind Gemini Updates', url: 'https://deepmind.google/technologies/gemini/' },
      { label: 'OpenAI Developer Documentation', url: 'https://platform.openai.com/docs' }
    ],
    corrections: [],
    imageTitle: '2026 Autonomous AI Agent Race Concept Graphic',
    imageAlt: 'TechHaven US visual representation of autonomous AI agent workflows',
    imageCaption: 'Tool-calling latency and verifiable sandboxes now determine which AI agent wins US and European enterprise contracts. (Illustration: TechHaven US)',
    content_md: `The conversation around generative AI in the United States and Europe has undergone a sharp structural shift. Engineering leaders no longer evaluate frontier models on conversational fluency alone—**AI agents** capable of planning, executing tools, editing repositories, and verifying test results are the real battleground.

Between **Google Gemini**, **OpenAI’s reasoning series**, **Anthropic Claude**, and open-weight models running on sovereign European clouds, teams now choose models based on latency, auditability, and deterministic verification.

## Why Tool Execution Matters More Than Raw Benchmark Scores

When an autonomous agent touches a live codebase or customer workflow, three operational metrics dictate success:

- **First-Pass Tool Accuracy:** Reliable file-reading, targeted search, and test verification without inventing outputs.
- **Context Discipline:** Inspecting targeted line ranges rather than burning token budgets reading entire monorepos.
- **Verification Discipline:** Running automated checks after edits before declaring work complete.

## Comparing US and European Enterprise Adoption

In North America, SaaS and fintech teams deploy agentic workflows aggressively for automated QA triage and dependency upgrades. Meanwhile, European firms in Frankfurt, Amsterdam, and Paris pair orchestration with strict **data-residency guarantees** and GDPR audit trails.

### The Architecture Winning Production Teams

1. **Scoped Sandboxes:** Read-only research passes before write permissions are granted.
2. **Deterministic Verification:** Unit tests, linters, and schema checks act as hard guardrails.
3. **Human-in-the-Loop Checkpoints:** High-impact production merges require human review.`
  },
  {
    categorySlug: 'tech-news',
    region: 'USA & Europe',
    is_featured: 1,
    is_trending: 1,
    is_breaking: 0,
    is_editors_pick: 1,
    accentColor: '#0284C7',
    secondaryColor: '#0C4A6E',
    kicker: 'TRANSATLANTIC TECH POLICY',
    coverHeadline: 'EU AI Act vs. US Tech Rules in 2026',
    title: 'EU AI Act vs. US Tech Regulation in 2026: What Silicon Valley and European Startups Must Prepare For',
    subtitle: 'Navigating compliance deadlines, copyright transparency, and cross-border cloud operations without slowing product shipping.',
    slug: 'eu-ai-act-vs-us-tech-regulation-2026-startups-guide',
    excerpt: 'With enforcement phases of the EU AI Act colliding with US state-level privacy and AI mandates, startups serving both markets need a unified compliance baseline.',
    meta_title: 'EU AI Act vs. US Tech Regulation 2026: Complete Startup Guide',
    meta_subtitle: 'Practical compliance checklist for SaaS, AI, and digital publishers serving US and EU users',
    meta_description: 'Understand the 2026 EU AI Act enforcement milestones alongside US privacy and federal tech standards, plus actionable steps for startups and publishers.',
    meta_tags: 'EU AI Act, US Tech Policy, GDPR, CCPA, Startups, Europe Tech, USA & Europe',
    focus_keyword: 'EU AI Act',
    hoursAgo: 12,
    fact_check_status: 'Research & Analysis',
    last_fact_checked: '2026-11-17',
    whats_new: 'Includes updated Consent Mode v2 checklist for EEA/UK publishers using Google AdSense.',
    key_takeaways: [
      'EU AI Act enforcement introduces strict logging and human oversight rules for high-risk automated decision systems.',
      'US startups face state-level privacy mandates led by California CPRA alongside federal FTC AI disclosure enforcement.',
      'Digital publishers need transparent Privacy, Editorial Policy, Terms, and Consent Mode v2 banners to monetize EU + US traffic safely.'
    ],
    official_sources: [
      { label: 'European Commission AI Act Portal', url: 'https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai' },
      { label: 'California Privacy Protection Agency', url: 'https://cppa.ca.gov/' }
    ],
    corrections: [],
    imageTitle: 'EU AI Act and US Tech Regulation 2026 Briefing Cover',
    imageAlt: 'Transatlantic tech regulation graphic comparing US and European frameworks',
    imageCaption: 'Harmonizing GDPR, CCPA, and AI Act transparency standards early saves startups costly re-architecture later. (Illustration: TechHaven US)',
    content_md: `Any technology company targeting consumers across both North America and the European Union faces a dual regulatory reality in 2026. While the United States relies on federal agency guidance and strong state laws like California’s **CPRA**, Brussels has moved forward with enforceable timelines under the **EU AI Act** and Digital Services Act.

## Key Milestones Taking Effect in 2026

European regulators have moved into concrete documentation requirements. High-risk systems—including automated hiring screeners and critical diagnostics—must maintain verifiable technical logs and human oversight controls.

- **Clear Automated-Interaction Disclosure:** Users must know when they are interacting with an AI system or synthetic media.
- **Consent-First Analytics & Ad Monetization:** Implementing Google Consent Mode v2 protects European ad RPM.
- **Data Minimization:** Collecting only essential user fields minimizes breach liability.

### Actionable Checklist for Digital Publishers

1. Publish clear **Privacy Policy**, **Editorial Policy**, **Terms**, and **Contact** pages in your footer.
2. Provide an accessible consent banner for EU/EEA and California visitors.
3. Keep third-party scripts lightweight so compliance tools never degrade Core Web Vitals.`
  },
  {
    categorySlug: 'how-to',
    region: 'Global',
    is_featured: 0,
    is_trending: 1,
    is_breaking: 0,
    is_editors_pick: 1,
    accentColor: '#059669',
    secondaryColor: '#064E3B',
    kicker: 'WEB PERFORMANCE TUTORIAL',
    coverHeadline: '100/100 Core Web Vitals Speed Guide',
    title: 'How to Pass Core Web Vitals With a 100/100 Lighthouse Score: Complete Speed Optimization Tutorial',
    subtitle: 'Beat slow bloated themes with server-side rendering, automatic WebP pipelines, zero CLS ad slots, and sub-50ms TTFB.',
    slug: 'pass-core-web-vitals-100-lighthouse-speed-tutorial',
    excerpt: 'Google rewards fast, layout-stable sites in US and European search rankings. Follow this engineering blueprint to optimize LCP, INP, and CLS.',
    meta_title: 'Pass Core Web Vitals With 100/100 Lighthouse Score (2026 Guide)',
    meta_subtitle: 'Eliminate layout shift, shrink images with WebP, and slash TTFB for faster Google rankings',
    meta_description: 'Step-by-step web speed optimization tutorial covering Largest Contentful Paint (LCP), Interaction to Next Paint (INP), CLS, and automated WebP conversion.',
    meta_tags: 'Core Web Vitals, SEO, WebP, Page Speed, Lighthouse, Web Performance',
    focus_keyword: 'Core Web Vitals',
    hoursAgo: 18,
    fact_check_status: 'Editorial Review',
    last_fact_checked: '2026-11-16',
    whats_new: 'Includes Node.js + Sharp WebP pipeline benchmarks showing 75–91% payload reduction.',
    key_takeaways: [
      'Automatic WebP conversion reduces hero image payloads by 55% to 91% without visual degradation.',
      'Reserving explicit width, height, and ad-slot min-height keeps Cumulative Layout Shift (CLS) at 0.00.',
      'Server-Side Rendering paired with Gzip/Brotli cuts LCP under 1.2 seconds on US & EU mobile networks.'
    ],
    official_sources: [
      { label: 'Google Web.dev Core Web Vitals', url: 'https://web.dev/articles/vitals' }
    ],
    corrections: [],
    imageTitle: 'Core Web Vitals 100 Lighthouse Optimization Tutorial Cover',
    imageAlt: 'Performance metrics diagram illustrating LCP, INP, and CLS optimization',
    imageCaption: 'Server-rendered HTML paired with pre-sized WebP assets keeps LCP under 1.2 seconds even on mobile 4G. (Illustration: TechHaven US)',
    content_md: `Speed directly impacts Google Search visibility, reader retention, and **Google AdSense RPM**. Passing Google’s **Core Web Vitals** comes down to three metrics: **LCP**, **INP**, and **CLS**.

## 1. Cut LCP Under 1.2 Seconds With SSR and WebP

- **Auto-Convert Every Image to WebP:** Modern WebP compression shrinks raw PNG/JPEG payloads dramatically.
- **Use ` + "`fetchpriority=\"high\"`" + ` on the Hero Image:** Never lazy-load above-the-fold hero images; apply ` + "`loading=\"lazy\"`" + ` to lower cards.
- **Serve Compressed SSR HTML:** Streaming clean HTML lets browsers paint immediately.

## 2. Eliminate Cumulative Layout Shift (CLS = 0.00)

1. Always include explicit ` + "`width`" + ` and ` + "`height`" + ` attributes on every ` + "`<img>`" + ` tag.
2. Wrap ad units in reserved ` + "`min-height`" + ` containers so late-loading ads never push text down.
3. Rely on crisp system-first font stacks to avoid font swap shifts.

## 3. Keep INP Under 50ms With Minimal JavaScript

Keeping interactive UI scripts under 5KB of clean vanilla DOM listeners guarantees instantaneous taps even on budget mobile hardware.`
  },
  {
    categorySlug: 'reviews-comparisons',
    region: 'USA',
    is_featured: 0,
    is_trending: 1,
    is_breaking: 0,
    is_editors_pick: 0,
    accentColor: '#D97706',
    secondaryColor: '#451A03',
    kicker: 'HARDWARE COMPARISON GUIDE',
    coverHeadline: 'RTX 50-Series vs. RDNA 4 Guide',
    title: 'NVIDIA RTX 50-Series vs. AMD RDNA 4: 4K Gaming and Local AI Comparison for US Builders',
    subtitle: 'Comparing architecture strengths, ray tracing, VRAM bandwidth, and local AI capabilities for modern PC builds.',
    slug: 'nvidia-rtx-50-series-vs-amd-rdna-4-4k-gaming-ai-benchmarks',
    excerpt: 'Choosing between NVIDIA Blackwell and AMD RDNA 4 comes down to 4K raster value versus ray-tracing and local AI compute. Here is our detailed architectural breakdown.',
    meta_title: 'RTX 50-Series vs. AMD RDNA 4: 4K Gaming & Local AI Guide',
    meta_subtitle: 'Architecture, upscaling, VRAM, and local LLM comparison for PC builders',
    meta_description: 'Detailed comparison of NVIDIA RTX 50-series GPUs and AMD RDNA 4 cards across 4K gaming, DLSS vs FSR upscaling, power efficiency, and local AI.',
    meta_tags: 'NVIDIA RTX, AMD Radeon, GPU Review, PC Hardware, 4K Gaming, Local AI, Comparison',
    focus_keyword: 'GPU comparison',
    hoursAgo: 28,
    fact_check_status: 'Editorial Review',
    last_fact_checked: '2026-11-15',
    whats_new: 'Updated with 14B quantized local LLM VRAM recommendations for Windows 11 and Ubuntu 24.04.',
    key_takeaways: [
      'NVIDIA Blackwell leads heavy path-traced 4K workloads and CUDA-accelerated local AI inference.',
      'AMD RDNA 4 offers standout rasterized frames-per-dollar and clean FSR 4 upscaling for mid-to-upper US builds.',
      '16GB VRAM is the recommended 2026 baseline for modern open-world titles and local quantized models.'
    ],
    official_sources: [
      { label: 'NVIDIA GeForce Architecture Docs', url: 'https://www.nvidia.com/en-us/geforce/' },
      { label: 'AMD Radeon Graphics Portal', url: 'https://www.amd.com/en/products/graphics/desktops/radeon.html' }
    ],
    corrections: [],
    imageTitle: 'RTX 50-Series vs AMD RDNA 4 Comparison Cover',
    imageAlt: 'Hardware comparison graphic for NVIDIA RTX 50-Series and AMD RDNA 4 graphics cards',
    imageCaption: 'VRAM capacity and memory bandwidth dictate both 4K high-texture stability and local LLM inference throughput. (Illustration: TechHaven US)',
    content_md: `North American and European PC builders face an unusually competitive GPU market in 2026. Here is how the two flagship lineups compare across 1440p, 4K rasterization, path tracing, and quantized local LLM workloads based on published specifications and architecture analysis.

## What Actually Separates the Lineups

- **NVIDIA Blackwell (RTX 50-Series):** Leads in heavy path tracing, multi-frame generation smoothness, and CUDA ecosystem compatibility.
- **AMD RDNA 4:** Punches aggressively on rasterized frames-per-dollar while delivering noticeably sharper FSR 4 upscaling.

## Key Buying Takeaways for Builders

1. **1440p High-Refresh Gaming:** 12GB VRAM remains viable, though 16GB offers stronger longevity.
2. **4K Gaming & Local AI:** Prioritize **16GB or 24GB VRAM** and wide memory buses.`
  },
  {
    categorySlug: 'cybersecurity',
    region: 'Europe',
    is_featured: 0,
    is_trending: 0,
    is_breaking: 0,
    is_editors_pick: 0,
    accentColor: '#DC2626',
    secondaryColor: '#450A0A',
    kicker: 'SECURITY & CLOUD ADVISORY',
    coverHeadline: 'Zero-Trust & Passkeys for Remote Teams',
    title: 'Zero-Trust Security Guide for US & European Remote Teams: Passkeys, Hardware Keys, and Cloud Hardening',
    subtitle: 'Stop credential stuffing and session hijacking with phishing-resistant FIDO2 authentication and minimal-privilege access.',
    slug: 'zero-trust-security-guide-us-eu-remote-teams-passkeys',
    excerpt: 'Password-only logins and legacy VPNs no longer protect distributed US and EU engineering teams. Here is how to deploy passkeys and zero-trust controls.',
    meta_title: 'Zero-Trust Security Guide: Passkeys & Cloud Hardening (2026)',
    meta_subtitle: 'Practical FIDO2 rollout and least-privilege infrastructure blueprint for distributed teams',
    meta_description: 'Learn how US and European remote teams eliminate phishing with FIDO2 passkeys, hardware security keys, short-lived tokens, and zero-trust cloud policies.',
    meta_tags: 'Cybersecurity, Zero Trust, Passkeys, Cloud Security, DevSecOps, FIDO2',
    focus_keyword: 'zero-trust security',
    hoursAgo: 40,
    fact_check_status: 'Fact-Checked',
    last_fact_checked: '2026-11-14',
    whats_new: '',
    key_takeaways: [
      'FIDO2/WebAuthn passkeys bind logins cryptographically to origin domains, stopping adversary-in-the-middle phishing.',
      'Admin CMS portals should enforce HttpOnly cookies, CSRF tokens, rate limiting, and off-site database backups.',
      'Replacing SMS 2FA with hardware security keys eliminates SIM-swap attacks across US & EU teams.'
    ],
    official_sources: [
      { label: 'NIST Zero Trust Architecture SP 800-207', url: 'https://csrc.nist.gov/publications/detail/sp/800-207/final' },
      { label: 'FIDO Alliance Passkey Guidelines', url: 'https://fidoalliance.org/passkeys/' }
    ],
    corrections: [],
    imageTitle: 'Zero-Trust Security and Passkeys Guide Cover',
    imageAlt: 'Zero-trust architecture diagram emphasizing FIDO2 passkeys and encrypted tunnels',
    imageCaption: 'Phishing-resistant FIDO2 passkeys eliminate the single largest initial access vector for distributed tech companies. (Illustration: TechHaven US)',
    content_md: `Distributed engineering teams spanning San Francisco, New York, London, and Warsaw can no longer rely on perimeter firewalls or SMS two-factor codes. Adopting practical **zero-trust security** starts by replacing phishable credentials with cryptographic verification.

## Step 1: Enforce FIDO2 Passkeys or Hardware Keys

**FIDO2/WebAuthn passkeys** bind authentication cryptographically to the exact origin domain, making fake phishing domains mathematically useless.

## Step 2: Lock Down Admin Panels and Cloud Endpoints

1. Use ` + "`HttpOnly; SameSite=Lax`" + ` signed cookies paired with strict CSRF tokens and login rate limiting.
2. Scrub uploaded media through image decoders like Sharp before serving from static paths.
3. Maintain automated SQLite or PostgreSQL backups off-server.`
  },
  {
    categorySlug: 'gadgets',
    region: 'USA',
    is_featured: 0,
    is_trending: 1,
    is_breaking: 0,
    is_editors_pick: 0,
    accentColor: '#0891B2',
    secondaryColor: '#164E63',
    kicker: 'CONSUMER HARDWARE',
    coverHeadline: 'AI Laptops & Flagship Phones 2026',
    title: '2026 Flagship Smartphones & Copilot+ AI Laptops: What Actually Matters for Everyday US & EU Buyers',
    subtitle: 'NPU battery gains, silicon-carbon batteries, and OLED efficiency compared beyond marketing buzzwords.',
    slug: '2026-flagship-smartphones-ai-laptops-buyers-guide',
    excerpt: 'Hardware makers are shipping 45+ TOPS NPUs and denser silicon-carbon batteries across flagship phones and ultrabooks. Here is what deserves your upgrade budget.',
    meta_title: '2026 Smartphones & AI Laptops Guide: Real Gains vs. Hype',
    meta_subtitle: 'Silicon-carbon battery life, NPU efficiency, and display upgrades tested',
    meta_description: 'Objective 2026 buyer guide for flagship smartphones and AI laptops in the US and Europe covering battery endurance, NPUs, and thermal performance.',
    meta_tags: 'Smartphones, AI Laptops, Gadgets, Hardware, Apple, Samsung, Qualcomm',
    focus_keyword: 'AI laptops',
    hoursAgo: 52,
    fact_check_status: 'Fact-Checked',
    last_fact_checked: '2026-11-12',
    whats_new: '',
    key_takeaways: [
      'Arm and x86 low-power laptop chips now routinely exceed 15 hours of real-world browser and coding battery life.',
      'Silicon-carbon smartphone batteries push compact flagships past 5,500 mAh without thicker chassis.',
      'Prioritize 16GB–24GB unified memory over headline NPU TOPS numbers if running local AI utilities.'
    ],
    official_sources: [
      { label: 'USB-IF Power Delivery Standards', url: 'https://www.usb.org/' }
    ],
    corrections: [],
    imageTitle: '2026 Smartphones and AI Laptops Hardware Guide Cover',
    imageAlt: 'TechHaven US hardware showcase graphic for smartphones and AI laptops',
    imageCaption: 'Real battery endurance and unified memory capacity matter more than synthetic NPU scores in daily work. (Illustration: TechHaven US)',
    content_md: `After two generations of aggressive AI marketing, smartphone and laptop buyers across North America and Europe are asking a sharper question: what hardware upgrades noticeably improve daily life?

## Battery Chemistry & Efficiency Are the Real Winners

- **Silicon-Carbon Smartphone Cells:** Higher energy density gives slim flagship phones genuine two-day battery capacity.
- **Cooler Ultrabooks:** Modern 3nm Arm and x86 laptop processors run silent during web browsing, Slack, and VS Code sessions.

## Buying Rule of Thumb

Always select at least **16GB RAM** on laptops and **256GB UFS 4.0/NVMe storage** on phones if you plan to keep your device for four years.`
  },
  {
    categorySlug: 'software-apps',
    region: 'Global',
    is_featured: 0,
    is_trending: 0,
    is_breaking: 0,
    is_editors_pick: 0,
    accentColor: '#4F46E5',
    secondaryColor: '#1E1B4B',
    kicker: 'SOFTWARE & OS UPDATE',
    coverHeadline: 'Windows 11, macOS & Browser Privacy',
    title: 'Windows 11, macOS Sequoia, and Privacy Browsers in 2026: Best Settings to Speed Up Your Desktop',
    subtitle: 'Trim telemetry, disable background bloat, and harden browser privacy across Windows, Mac, and Linux.',
    slug: 'windows-11-macos-privacy-browsers-2026-speed-settings',
    excerpt: 'Operating systems ship with heavier background AI indexing and telemetry defaults than ever. Follow these clean system tweaks to reclaim RAM and battery.',
    meta_title: 'Windows 11, macOS & Privacy Browsers 2026 Optimization Guide',
    meta_subtitle: 'Practical steps to disable OS bloat, tighten browser privacy, and speed up startup',
    meta_description: 'Step-by-step guide to optimizing Windows 11, macOS, and modern privacy browsers in 2026 without breaking security updates.',
    meta_tags: 'Windows 11, macOS, Software, Browsers, Privacy, Productivity',
    focus_keyword: 'Windows 11 optimization',
    hoursAgo: 64,
    fact_check_status: 'Fact-Checked',
    last_fact_checked: '2026-11-10',
    whats_new: '',
    key_takeaways: [
      'Audit startup apps and disable unnecessary background widgets to shave seconds off boot times.',
      'Use built-in tracking protection and DNS-over-HTTPS in Chrome, Firefox, or Brave for cleaner browsing.',
      'Keep automatic security patching enabled even while disabling optional diagnostic telemetry.'
    ],
    official_sources: [
      { label: 'Mozilla Privacy & Security Docs', url: 'https://support.mozilla.org/' }
    ],
    corrections: [],
    imageTitle: 'Windows 11 macOS and Privacy Browsers Cover',
    imageAlt: 'Software optimization editorial graphic for desktop operating systems and browsers',
    imageCaption: 'Lean OS startup lists and strict browser tracker blocking noticeably boost responsiveness on laptops. (Illustration: TechHaven US)',
    content_md: `Modern desktop operating systems add helpful AI conveniences alongside background indexers that eat RAM and battery life.

## Quick Desktop Optimization Checklist

1. **Trim Startup Services:** Open Task Manager (Windows) or Login Items (macOS) and disable updaters you rarely launch.
2. **Switch to Encrypted DNS:** Enable Cloudflare 1.1.1.1 or Quad9 DNS-over-HTTPS directly inside your browser network settings.
3. **Never Disable Core Security Patches:** Always keep Windows Defender, Gatekeeper, and browser auto-updates active.`
  },
  {
    categorySlug: 'future-tech',
    region: 'USA & Europe',
    is_featured: 0,
    is_trending: 0,
    is_breaking: 0,
    is_editors_pick: 0,
    accentColor: '#9333EA',
    secondaryColor: '#3B0764',
    kicker: 'FUTURE TECH & ROBOTICS',
    coverHeadline: 'Humanoid Robots, EVs & Quantum 2026',
    title: 'Robotics, Solid-State EVs, and Fault-Tolerant Quantum Milestones Reshaping US & European Industry',
    subtitle: 'Tracking which deep-tech hardware bets left the lab for commercial factories and roads this year.',
    slug: 'robotics-solid-state-evs-quantum-milestones-2026',
    excerpt: 'From humanoid warehouse pilots in Texas and Germany to higher-density EV batteries and logical qubits, future tech is turning commercial.',
    meta_title: 'Future Tech 2026: Robotics, EVs & Quantum Computing Milestones',
    meta_subtitle: 'Commercial factory robots, EV charging breakthroughs, and quantum error-correction progress',
    meta_description: 'Explore 2026 breakthroughs in humanoid robotics, solid-state EV batteries, and quantum error correction across the US and Europe.',
    meta_tags: 'Future Tech, Robotics, Electric Vehicles, Quantum Computing, Deep Tech',
    focus_keyword: 'Future technology',
    hoursAgo: 76,
    fact_check_status: 'Fact-Checked',
    last_fact_checked: '2026-11-08',
    whats_new: '',
    key_takeaways: [
      'Vision-language-action models are accelerating dexterous manipulation in US and German automotive plants.',
      '800V EV architectures and semi-solid cells reduce 10–80% fast-charging stops under 15 minutes.',
      'Quantum roadmaps now focus heavily on logical qubit error correction rather than raw physical qubit count.'
    ],
    official_sources: [
      { label: 'IEEE Spectrum Robotics', url: 'https://spectrum.ieee.org/topic/robotics/' }
    ],
    corrections: [],
    imageTitle: 'Robotics EVs and Quantum Computing 2026 Cover',
    imageAlt: 'Future technology illustration depicting robotics, electric mobility, and quantum computing',
    imageCaption: 'Embodied AI models and error-corrected qubits mark a shift from lab demos to industrial reliability. (Illustration: TechHaven US)',
    content_md: `Deep-tech hardware often moves slowly until foundation models and manufacturing scale converge. In 2026, three fields across the US and Europe crossed important commercial thresholds.

## 1. Embodied AI in Industrial Robotics

Factory robots powered by multimodal vision-language-action models now adapt to varied bin picking and cable routing tasks without brittle hard-coded coordinates.

## 2. Faster EV Charging & Grid Storage

800V charging standards across US NACS and European CCS networks cut road-trip charging waits dramatically while improving cold-weather thermal management.

## 3. Quantum Focus Shifts to Logical Qubits

Leading US and European quantum labs are prioritizing lower error rates and modular interconnects over raw physical qubit headlines.`
  },
  {
    categorySlug: 'cloud-dev',
    region: 'Global',
    is_featured: 0,
    is_trending: 0,
    is_breaking: 0,
    is_editors_pick: 0,
    accentColor: '#0D9488',
    secondaryColor: '#134E4A',
    kicker: 'CLOUD & DEV ARCHITECTURE',
    coverHeadline: 'SQLite to PostgreSQL & Edge Scaling',
    title: 'From SQLite to PostgreSQL & Redis: How High-Traffic Tech Blogs Scale Across USA and Europe',
    subtitle: 'A practical roadmap covering WAL-mode SQLite, Cloudflare CDN caching, R2 object storage, and horizontal PostgreSQL migration.',
    slug: 'sqlite-to-postgresql-redis-cloudflare-r2-scaling-guide',
    excerpt: 'Start lean on SQLite with WAL mode and Cloudflare CDN, then scale seamlessly to PostgreSQL, Redis, and R2 object storage when traffic surges.',
    meta_title: 'Scaling From SQLite to PostgreSQL, Redis & Cloudflare R2 (Guide)',
    meta_subtitle: 'Zero-downtime database, object storage, and CDN architecture for modern publishers',
    meta_description: 'Developer guide to scaling Node.js web apps from single-server SQLite WAL to PostgreSQL, Redis shared cache, Cloudflare R2 media, and edge CDNs.',
    meta_tags: 'Cloud Computing, Node.js, SQLite, PostgreSQL, Redis, Cloudflare R2, DevOps',
    focus_keyword: 'Cloud scaling',
    hoursAgo: 88,
    fact_check_status: 'Editorial Review',
    last_fact_checked: '2026-11-05',
    whats_new: '',
    key_takeaways: [
      'SQLite in WAL mode handles tens of thousands of daily reads on a single Node.js instance with sub-millisecond latency.',
      'Putting Cloudflare CDN in front of immutable WebP assets serves US and European visitors from local edge PoPs.',
      'When deploying multiple horizontal server instances, migrate shared state to PostgreSQL + Redis and media to Cloudflare R2.'
    ],
    official_sources: [
      { label: 'Cloudflare R2 Documentation', url: 'https://developers.cloudflare.com/r2/' },
      { label: 'SQLite WAL Mode Reference', url: 'https://www.sqlite.org/wal.html' }
    ],
    corrections: [],
    imageTitle: 'SQLite PostgreSQL Redis and Cloudflare R2 Architecture Cover',
    imageAlt: 'Cloud architecture diagram connecting Node.js, SQLite, PostgreSQL, Redis, and Cloudflare CDN',
    imageCaption: 'Edge CDN caching for immutable WebP media offloads up to 85% of origin bandwidth across the US and Europe. (Illustration: TechHaven US)',
    content_md: `Many engineering teams over-engineer infrastructure on day one with expensive multi-region clusters before publishing their first ten articles. A smarter approach is **progressive scaling**.

## Stage 1: Single-Node Speed (SQLite WAL + In-Memory Cache)

For small-to-medium publications, SQLite in **WAL mode** paired with an in-memory HTML cache delivers unmatched simplicity and sub-5ms response times—as long as automated ` + "`VACUUM INTO`" + ` backups run daily.

## Stage 2: Edge CDN & Cloudflare R2 Object Storage

Enabling Cloudflare in front of your domain caches immutable .webp images across New York, Dallas, Frankfurt, and London PoPs automatically. Moving uploads to **Cloudflare R2** removes local disk constraints entirely.

## Stage 3: Multi-Instance Scale (PostgreSQL + Redis)

Once concurrent editorial writes or multiple Node.js instances become necessary, swap the storage adapter to **PostgreSQL** for concurrent row locking and **Redis** for shared cross-instance HTML caching.`
  }
];

const SEED_AI_TOOLS = [
  {
    name: 'ChatGPT (GPT-5 / Reasoning)',
    slug: 'chatgpt',
    tagline: 'Versatile multimodal AI assistant for coding, research, voice, and deep analysis.',
    description: 'OpenAI’s flagship assistant combines fast conversational responses with multi-step reasoning, web browsing, Python code execution, and image generation for US and European teams.',
    category: 'AI Assistant',
    pricing_model: 'Freemium',
    price_label: 'Free / $20 mo Plus',
    rating: 4.8,
    pros: ['Strong reasoning & coding workflows', 'Fast voice mode & canvas editing', 'Mature plugin/API ecosystem'],
    cons: ['Higher-tier limits on Pro workloads', 'Requires prompt specificity for strict citations'],
    website_url: 'https://chatgpt.com/',
    logo_color: '#10A37F',
    is_featured: 1
  },
  {
    name: 'Google Gemini',
    slug: 'google-gemini',
    tagline: 'Deeply integrated Google ecosystem AI with massive context windows and Workspace tools.',
    description: 'Built by Google DeepMind, Gemini excels at long-context document synthesis, multimodal video/audio understanding, and native integration across Docs, Gmail, and Android.',
    category: 'AI Assistant',
    pricing_model: 'Freemium',
    price_label: 'Free / $19.99 mo AI Pro',
    rating: 4.7,
    pros: ['Industry-leading context window', 'Native Google Workspace integration', 'Fast Gemini Flash API economics'],
    cons: ['Workspace enterprise controls require admin setup'],
    website_url: 'https://gemini.google.com/',
    logo_color: '#2563EB',
    is_featured: 1
  },
  {
    name: 'Claude',
    slug: 'claude',
    tagline: 'Precision writing, clean software engineering, and thoughtful long-form synthesis.',
    description: 'Anthropic’s Claude is favored by software engineers, technical writers, and researchers across Silicon Valley and Europe for nuanced prose and reliable codebase refactoring.',
    category: 'Coding & Writing',
    pricing_model: 'Freemium',
    price_label: 'Free / $20 mo Pro',
    rating: 4.9,
    pros: ['Natural, low-fluff technical writing', 'Top-tier coding & refactoring accuracy', 'Interactive Artifacts preview'],
    cons: ['Usage caps during heavy repository sessions'],
    website_url: 'https://claude.ai/',
    logo_color: '#D97706',
    is_featured: 1
  },
  {
    name: 'Perplexity AI',
    slug: 'perplexity-ai',
    tagline: 'Real-time citation-first AI answer engine for breaking news and research.',
    description: 'Combines live web indexing with frontier LLMs so every claim links directly back to verifiable primary sources and newsroom citations.',
    category: 'AI Search',
    pricing_model: 'Freemium',
    price_label: 'Free / $20 mo Pro',
    rating: 4.7,
    pros: ['Inline clickable source citations', 'Great for fast technical research', 'Model switching in Pro'],
    cons: ['Can still misread paywalled pages without full text'],
    website_url: 'https://www.perplexity.ai/',
    logo_color: '#0891B2',
    is_featured: 1
  },
  {
    name: 'Cursor',
    slug: 'cursor',
    tagline: 'AI-native code editor built for multi-file codebase editing and inline diffs.',
    description: 'Forked from VS Code, Cursor indexes your local repository to power fast tab autocomplete, multi-file edits, and terminal agent debugging.',
    category: 'Developer Tool',
    pricing_model: 'Freemium',
    price_label: 'Free / $20 mo Pro',
    rating: 4.8,
    pros: ['Seamless VS Code extension compatibility', 'Fast multi-file Composer diffs', 'Supports multiple frontier models'],
    cons: ['Requires review discipline on large automated edits'],
    website_url: 'https://www.cursor.com/',
    logo_color: '#4F46E5',
    is_featured: 0
  },
  {
    name: 'Midjourney',
    slug: 'midjourney',
    tagline: 'Studio-grade AI art and editorial concept illustration generator.',
    description: 'Produces high-aesthetic editorial illustrations, product concept renders, and lighting-accurate scenes via web and Discord workflows.',
    category: 'Image Generation',
    pricing_model: 'Paid',
    price_label: 'From $10 / mo',
    rating: 4.6,
    pros: ['Best-in-class lighting and composition', 'Consistent style reference controls', 'Dedicated web editor'],
    cons: ['No permanent free tier', 'Struggles with dense embedded UI typography'],
    website_url: 'https://www.midjourney.com/',
    logo_color: '#7C3AED',
    is_featured: 0
  }
];

function seedBriefingsAndTimelines() {
  // Remove legacy static demo briefings so live briefings auto-generate from real published articles
  db.prepare("DELETE FROM daily_briefings WHERE title LIKE 'Daily AI & US/EU Tech Briefing — %'").run();

  const timelineCount = db.prepare('SELECT COUNT(*) AS c FROM timelines').get().c;
  if (timelineCount === 0) {
    const insertTl = db.prepare(`
      INSERT INTO timelines (title, slug, description, category_slug, region, status)
      VALUES (?, ?, ?, ?, ?, 'published')
    `);
    const insertEvent = db.prepare(`
      INSERT INTO timeline_events (timeline_id, event_date, headline, summary, post_slug, source_url, is_major)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const r1 = insertTl.run(
      'GTA 6 Launch & GTA 5 Online Next-Gen Tracker',
      'gta-6-launch-pc-tracker',
      'Chronological timeline of official Rockstar Games announcements, Take-Two launch windows, GTA Online Expanded & Enhanced PC patches, and anti-cheat rollouts.',
      'gaming',
      'USA & Europe'
    );
    const tl1 = Number(r1.lastInsertRowid);
    insertEvent.run(tl1, '2026-11-18', 'Take-Two Reaffirms US/EU Marketing Ramp for Vice City', 'Updated financial guidance outlines global promotional milestones leading up to console debut.', 'gta-6-gta-5-online-2026-roadmap-us-launch-pc-features', 'https://www.take2games.com/ir', 1);
    insertEvent.run(tl1, '2026-09-10', 'GTA 5 Online PC Receives Ray-Traced Reflections & HSW Tuning', 'Expanded & Enhanced feature parity brings faster vehicle upgrades and DirectStorage asset streaming to Windows.', 'gta-6-gta-5-online-2026-roadmap-us-launch-pc-features', 'https://www.rockstargames.com/newswire', 1);
    insertEvent.run(tl1, '2026-06-15', 'BattlEye Anti-Cheat Mandatory for Public PC Lobbies', 'Rockstar enforces kernel-level anti-cheat integration to clean up North American and European public sessions.', 'gta-6-gta-5-online-2026-roadmap-us-launch-pc-features', 'https://www.rockstargames.com/newswire', 0);

    const r2 = insertTl.run(
      '2026 Frontier AI & Transatlantic Policy Tracker',
      'frontier-ai-us-eu-policy-tracker',
      'Key milestones in OpenAI, Google Gemini, Anthropic Claude releases alongside EU AI Act and US privacy regulations.',
      'ai',
      'USA & Europe'
    );
    const tl2 = Number(r2.lastInsertRowid);
    insertEvent.run(tl2, '2026-11-17', 'EU AI Act Transparency Guidance Updated for Digital Platforms', 'Clarified disclosure rules for synthetic media and automated customer assistants operating in the EEA.', 'eu-ai-act-vs-us-tech-regulation-2026-startups-guide', 'https://digital-strategy.ec.europa.eu/', 1);
    insertEvent.run(tl2, '2026-10-22', 'Autonomous Coding & QA Agents Hit Mainstream US SaaS CI/CD', 'Engineering teams standardize sandboxed verification loops around Gemini and OpenAI reasoning tools.', 'openai-google-gemini-2026-ai-agent-race-us-eu-tech', 'https://deepmind.google/', 1);
    insertEvent.run(tl2, '2026-08-04', 'Google Consent Mode v2 Mandatory Across EEA AdSense Traffic', 'Digital publishers adopt two-button GDPR/CCPA consent banners to protect European programmatic RPM.', 'eu-ai-act-vs-us-tech-regulation-2026-startups-guide', 'https://support.google.com/adsense', 0);
  }
}

const PRIMARY_AUTHOR = {
  name: 'Md Apple Mahmud',
  slug: 'md-apple-mahmud',
  jobTitle: 'Founder & Managing Tech Editor',
  location: 'US & Global Tech Desk',
  credentials: 'Managing Tech Editor • Full-Stack Cloud & Web Developer • AI, Software & Hardware Analyst',
  expertise:
    'Artificial Intelligence & AI Tools, Technology News, Gadgets & Consumer Hardware, Software & Apps, Cybersecurity & Privacy, PC & Console Gaming, Reviews & Comparisons, How-To Guides & Tutorials, Future Technology, Cloud & Web Development',
  bio:
    'Md Apple Mahmud is the Founder and Managing Tech Editor of TechHaven US. Drawing on hands-on experience in cloud and web development, AI workflow testing, and daily software troubleshooting, he leads coverage across all ten TechHaven desks—spanning Artificial Intelligence, Technology News, Gadgets & Devices, Software & Apps (Windows, macOS, Android, and iOS), Cybersecurity, PC & Console Gaming (including GTA 5 and GTA 6), Product Reviews & Side-by-Side Comparisons, Future Technology, and practical step-by-step How-To Guides. Every article, comparison, and tutorial is verified against official vendor documentation, hardware specifications, security advisories, and primary release notes before publication.',
  websiteUrl: SITE_URL
};

export async function seedDatabase() {
  const existingUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;

  if (existingUsers === 0) {
    db.prepare(`
      INSERT INTO users (name, slug, email, password_hash, role, job_title, expertise, bio, twitter_handle, linkedin_url, website_url, location, credentials)
      VALUES (?, ?, ?, ?, 'admin', ?, ?, ?, '', '', ?, ?, ?)
    `).run(
      PRIMARY_AUTHOR.name,
      PRIMARY_AUTHOR.slug,
      ADMIN_EMAIL,
      hashPassword(ADMIN_PASSWORD),
      PRIMARY_AUTHOR.jobTitle,
      PRIMARY_AUTHOR.expertise,
      PRIMARY_AUTHOR.bio,
      PRIMARY_AUTHOR.websiteUrl,
      PRIMARY_AUTHOR.location,
      PRIMARY_AUTHOR.credentials
    );
    setSetting('author_profile_migrated_v1', '1');
  } else {
    const migratedRow = db.prepare("SELECT value FROM settings WHERE key = 'author_profile_migrated_v1'").get();
    const primaryUser = db.prepare("SELECT * FROM users WHERE id = 1 OR slug = 'alex-mercer' ORDER BY id ASC LIMIT 1").get();
    if (primaryUser && (!migratedRow || migratedRow.value !== '1' || primaryUser.slug === 'alex-mercer' || primaryUser.name === 'Alex Mercer')) {
      const oldSlug = primaryUser.slug;
      const cleanTwitter = primaryUser.twitter_handle === '@alexmercertech' ? '' : (primaryUser.twitter_handle || '');
      const cleanLinkedin = String(primaryUser.linkedin_url || '').includes('alexmercertech') ? '' : (primaryUser.linkedin_url || '');
      db.prepare(`
        UPDATE users SET
          name = ?,
          slug = ?,
          job_title = ?,
          expertise = ?,
          bio = ?,
          location = ?,
          credentials = ?,
          twitter_handle = ?,
          linkedin_url = ?,
          website_url = ?
        WHERE id = ?
      `).run(
        PRIMARY_AUTHOR.name,
        PRIMARY_AUTHOR.slug,
        PRIMARY_AUTHOR.jobTitle,
        PRIMARY_AUTHOR.expertise,
        PRIMARY_AUTHOR.bio,
        PRIMARY_AUTHOR.location,
        PRIMARY_AUTHOR.credentials,
        cleanTwitter,
        cleanLinkedin,
        PRIMARY_AUTHOR.websiteUrl,
        primaryUser.id
      );

      if (oldSlug && oldSlug !== PRIMARY_AUTHOR.slug) {
        db.prepare(`
          INSERT INTO redirects (from_path, to_path, status_code) VALUES (?, ?, 301)
          ON CONFLICT(from_path) DO UPDATE SET to_path = excluded.to_path, status_code = 301
        `).run(`/author/${oldSlug}`, `/author/${PRIMARY_AUTHOR.slug}`);
      }
      setSetting('author_profile_migrated_v1', '1');
    }

    const ownerSetting = db.prepare("SELECT value FROM settings WHERE key = 'publisher_owner_name'").get();
    if (!ownerSetting || String(ownerSetting.value || '').includes('Alex Mercer')) {
      setSetting('publisher_owner_name', 'Md Apple Mahmud (Founder & Managing Tech Editor)');
    }
  }

  // Remove legacy fictional demo authors (Elena Vance & Marcus Cole) and reassign any posts to primary author
  const mainAdminRow = db.prepare('SELECT id, slug FROM users ORDER BY id ASC LIMIT 1').get();
  for (const demoSlug of ['elena-vance', 'marcus-cole']) {
    const demoUser = db.prepare('SELECT id FROM users WHERE slug = ?').get(demoSlug);
    if (demoUser) {
      if (mainAdminRow && mainAdminRow.id !== demoUser.id) {
        db.prepare('UPDATE posts SET author_id = ? WHERE author_id = ?').run(mainAdminRow.id, demoUser.id);
        db.prepare(`
          INSERT INTO redirects (from_path, to_path, status_code) VALUES (?, ?, 301)
          ON CONFLICT(from_path) DO UPDATE SET to_path = excluded.to_path, status_code = 301
        `).run(`/author/${demoSlug}`, `/author/${mainAdminRow.slug}`);
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(demoUser.id);
    }
  }

  for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!existing) {
      setSetting(key, val);
    }
  }

  // Upsert all 10 recommended categories
  const upsertCat = db.prepare(`
    INSERT INTO categories (name, slug, description, meta_title, meta_description, accent_color, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      meta_title = excluded.meta_title,
      meta_description = excluded.meta_description,
      accent_color = excluded.accent_color,
      sort_order = excluded.sort_order
  `);
  for (const cat of RECOMMENDED_CATEGORIES) {
    upsertCat.run(cat.name, cat.slug, cat.description, cat.meta_title, cat.meta_description, cat.accent_color, cat.sort_order);
  }

  // Migrate legacy 6-category slugs cleanly + register 301 redirects
  const insertRedirect = db.prepare(`
    INSERT OR IGNORE INTO redirects (from_path, to_path, status_code)
    VALUES (?, ?, 301)
  `);
  for (const mig of LEGACY_CATEGORY_MIGRATIONS) {
    const oldCat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(mig.oldSlug);
    const newCat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(mig.newSlug);
    if (oldCat && newCat) {
      if (mig.setRegion) {
        db.prepare('UPDATE posts SET category_id = ?, region = ? WHERE category_id = ?')
          .run(newCat.id, mig.setRegion, oldCat.id);
      } else {
        db.prepare('UPDATE posts SET category_id = ? WHERE category_id = ?')
          .run(newCat.id, oldCat.id);
      }
      db.prepare('DELETE FROM categories WHERE id = ?').run(oldCat.id);
    }
    insertRedirect.run(`/category/${mig.oldSlug}`, mig.redirectTo);
  }

  // Upsert / enrich all 10 articles so every category has live WebP content + Article Page 2.0 fields
  const primaryAuthor = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  const defaultAuthorId = primaryAuthor ? primaryAuthor.id : 1;

  const insertMedia = db.prepare(`
    INSERT INTO media (
      filename, thumb_filename, url, thumb_url, original_name, original_format,
      original_size, webp_size, width, height, title, alt_text, caption, description, uploaded_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPost = db.prepare(`
    INSERT INTO posts (
      title, subtitle, slug, excerpt, content_md, content_html, toc_json,
      category_id, author_id, status, region, is_featured, is_trending, is_breaking, is_editors_pick,
      featured_image, featured_image_thumb, featured_image_width, featured_image_height,
      featured_image_title, featured_image_alt, featured_image_caption, featured_image_description,
      meta_title, meta_subtitle, meta_description, meta_tags, focus_keyword,
      canonical_url, robots, key_takeaways_json, whats_new, fact_check_status,
      last_fact_checked, official_sources_json, corrections_json,
      reading_time, word_count, views, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'index, follow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const article of SEED_ARTICLES) {
    const cat = db.prepare('SELECT id, name FROM categories WHERE slug = ?').get(article.categorySlug);
    const categoryId = cat ? cat.id : null;
    const categoryName = cat ? cat.name : 'Technology News';
    const imageDescription = article.imageDescription || `${article.imageCaption} Detailed TechHaven US ${categoryName} editorial visual covering ${article.focus_keyword}.`;
    const existingPost = db.prepare('SELECT id, key_takeaways_json, featured_image_description, featured_image FROM posts WHERE slug = ?').get(article.slug);

    if (existingPost) {
      // Enrich legacy v1 posts with v2 metadata cleanly without overwriting user edits if already populated
      const hasTakeaways = existingPost.key_takeaways_json && existingPost.key_takeaways_json !== '[]';
      if (!hasTakeaways) {
        db.prepare(`
          UPDATE posts SET
            region = ?, is_breaking = ?, is_editors_pick = ?,
            key_takeaways_json = ?, whats_new = ?, fact_check_status = ?,
            last_fact_checked = ?, official_sources_json = ?, corrections_json = ?,
            featured_image_description = CASE WHEN featured_image_description = '' THEN ? ELSE featured_image_description END
          WHERE id = ?
        `).run(
          article.region,
          article.is_breaking,
          article.is_editors_pick,
          JSON.stringify(article.key_takeaways || []),
          article.whats_new || '',
          article.fact_check_status || 'Fact-Checked',
          article.last_fact_checked || '',
          JSON.stringify(article.official_sources || []),
          JSON.stringify(article.corrections || []),
          imageDescription,
          existingPost.id
        );
      } else if (!existingPost.featured_image_description) {
        db.prepare('UPDATE posts SET featured_image_description = ? WHERE id = ?').run(imageDescription, existingPost.id);
      }
      if (existingPost.featured_image) {
        db.prepare("UPDATE media SET description = ? WHERE url = ? AND description = ''").run(imageDescription, existingPost.featured_image);
      }
      continue;
    }

    const cover = await generateEditorialCoverWebp(article.slug, {
      category: categoryName,
      headline: article.coverHeadline,
      kicker: article.kicker,
      accentColor: article.accentColor,
      secondaryColor: article.secondaryColor
    });

    insertMedia.run(
      cover.filename,
      cover.thumbFilename,
      cover.url,
      cover.thumbUrl,
      `${article.slug}.svg`,
      cover.originalFormat,
      cover.originalSize,
      cover.webpSize,
      cover.width,
      cover.height,
      article.imageTitle,
      article.imageAlt,
      article.imageCaption,
      imageDescription,
      defaultAuthorId
    );

    const rendered = renderArticleContent(article.content_md);
    const publishedAt = new Date(Date.now() - article.hoursAgo * 3600 * 1000).toISOString();
    const views = 0;

    const result = insertPost.run(
      article.title,
      article.subtitle,
      slugify(article.slug),
      article.excerpt,
      article.content_md,
      rendered.html,
      JSON.stringify(rendered.toc),
      categoryId,
      defaultAuthorId,
      article.region,
      article.is_featured,
      article.is_trending,
      article.is_breaking,
      article.is_editors_pick,
      cover.url,
      cover.thumbUrl,
      cover.width,
      cover.height,
      article.imageTitle,
      article.imageAlt,
      article.imageCaption,
      imageDescription,
      article.meta_title,
      article.meta_subtitle,
      article.meta_description,
      article.meta_tags,
      article.focus_keyword,
      JSON.stringify(article.key_takeaways || []),
      article.whats_new || '',
      article.fact_check_status || 'Fact-Checked',
      article.last_fact_checked || '',
      JSON.stringify(article.official_sources || []),
      JSON.stringify(article.corrections || []),
      rendered.readingTime,
      rendered.wordCount,
      views,
      publishedAt
    );

    syncPostTags(Number(result.lastInsertRowid), article.meta_tags);
  }

  // Seed AI Tools Directory
  const toolsCount = db.prepare('SELECT COUNT(*) AS c FROM ai_tools').get().c;
  if (toolsCount === 0) {
    const insertTool = db.prepare(`
      INSERT INTO ai_tools (name, slug, tagline, description, category, pricing_model, price_label, rating, pros_json, cons_json, website_url, logo_color, is_featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const tool of SEED_AI_TOOLS) {
      insertTool.run(
        tool.name,
        tool.slug,
        tool.tagline,
        tool.description,
        tool.category,
        tool.pricing_model,
        tool.price_label,
        tool.rating,
        JSON.stringify(tool.pros),
        JSON.stringify(tool.cons),
        tool.website_url,
        tool.logo_color,
        tool.is_featured
      );
    }
  }

  seedBriefingsAndTimelines();

  // Enrich two flagship posts with YouTube Video Review & YouTube Shorts embeds
  db.prepare(`
    UPDATE posts SET
      video_url = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      video_title = 'RTX 50-Series vs AMD RDNA 4 — 4K Gaming & Local AI Video Review',
      video_duration = 'PT10M34S',
      video_is_short = 0
    WHERE slug = 'nvidia-rtx-50-series-vs-amd-rdna-4-4k-gaming-ai-benchmarks' AND video_url = ''
  `).run();

  db.prepare(`
    UPDATE posts SET
      video_url = 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      video_title = 'GTA 6 Vice City & GTA 5 Online 2026 Quick 60-Sec Briefing (Short)',
      video_duration = 'PT0M58S',
      video_is_short = 1
    WHERE slug = 'gta-6-gta-5-online-2026-roadmap-us-launch-pc-features' AND video_url = ''
  `).run();

  // Seed initial Social Distribution Queue entries
  const socialCount = db.prepare('SELECT COUNT(*) AS c FROM social_posts').get().c;
  if (socialCount === 0) {
    const heroPost = db.prepare("SELECT * FROM posts WHERE status = 'published' ORDER BY is_featured DESC, published_at DESC LIMIT 1").get();
    if (heroPost) {
      const drafts = generateDraftSocialPosts(heroPost, SITE_URL);
      const insSocial = db.prepare(`
        INSERT INTO social_posts (post_id, platform, copy_text, share_url, status)
        VALUES (?, ?, ?, ?, 'queued')
      `);
      for (const d of drafts) {
        insSocial.run(heroPost.id, d.platform, d.copy_text, d.share_url);
      }
    }
  }
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('seed.js'))) {
  seedDatabase()
    .then(() => {
      console.log('TechHaven US v2.0 database seeded successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}
