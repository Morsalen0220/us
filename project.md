# TechHaven US v2.0 — `https://techhavenus.com/`

**TechHaven US** is a full-stack, performance-engineered US-focused technology, AI, gaming (GTA 5/6), cybersecurity, and developer tutorial editorial publication built with **Node.js + Express 5 + EJS SSR + SQLite (WAL + FTS5) + Sharp Auto-WebP**. It combines sub-15ms cached SSR HTML, zero-CLS ad containers, automatic WebP image conversion with SVG watermark, clean editorial workflows, AI-era reader tools, and production deployment support for **BiswasHost (`http://biswashost.com/`)**.

---

## 1. Architecture & Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js ESM (`>=22.5`, built & verified on `v24.18.0`) | Persistent server + cPanel Passenger entrypoint (`app.cjs`) |
| **Backend** | Express `5.3.0` + `compression` + `helmet` | Fast SSR routing, 301 redirect manager, `/health` probe, security headers |
| **Templates** | EJS `3.1.10` Server-Side Rendering | Instant first paint, full SEO crawlability, zero SPA JS bloat |
| **Database** | Built-in `node:sqlite` (`DatabaseSync`, WAL mode, `FTS5`) | Zero-config relational storage + full-text search virtual table (`posts_fts`) |
| **Media Engine** | `sharp` `0.35.5` + `multer` `2.5.0` | Auto-converts any uploaded image into `.webp` + `640×360` `-thumb.webp` |
| **Content Engine** | `marked` `18.2.1` + `sanitize-html` `2.18.2` | Safe Markdown/HTML rendering, TOC generation, mid-article AdSense injection |
| **Frontend JS/CSS** | Vanilla CSS + Lightweight Vanilla JS | Light/Dark mode, `Ctrl+K` search, Save/Print, AI Assistant, GDPR/CCPA consent |

---

## 2. Category Structure (10 Topic Desks)

TechHaven US organizes all US-focused technology, AI, gaming, cybersecurity, and developer coverage into 10 clean topic categories:

| # | Category | Slug | Primary Coverage |
| :--- | :--- | :--- | :--- |
| `01` | **AI & Artificial Intelligence** | `/category/ai` | AI News, ChatGPT, Gemini, Claude, AI Agents, AI Tools |
| `02` | **Technology News** | `/category/tech-news` | Apple, Google, Microsoft, Meta, Amazon, Startups, US/EU Policy |
| `03` | **Gadgets & Devices** | `/category/gadgets` | Smartphones, AI Laptops, Wearables, GPUs, Consumer Hardware |
| `04` | **Software & Apps** | `/category/software-apps` | Windows 11, Android, iOS, macOS, Browsers |
| `05` | **Cybersecurity** | `/category/cybersecurity` | Privacy, Zero-Trust, Passkeys, Data Breaches, Online Safety |
| `06` | **Gaming & Entertainment** | `/category/gaming` | PC Gaming, PlayStation, Xbox, GTA 5 & GTA 6 |
| `07` | **Reviews & Comparisons** | `/category/reviews-comparisons` | AI Reviews, GPU/Product Benchmarks, Side-by-Side Comparisons |
| `08` | **How-To & Guides** | `/category/how-to` | Step-by-Step Tutorials, Core Web Vitals, Troubleshooting |
| `09` | **Future Technology** | `/category/future-tech` | Robotics, EVs, Space, Quantum Computing |
| `10` | **Cloud & Developer** | `/category/cloud-dev` | Cloud Computing, Node.js, PostgreSQL/SQLite, APIs, DevOps |

*(Legacy v1 slugs such as `/category/ai-tech` -> `/category/ai` and retired `/region/*` routes are automatically handled via **301 Redirects**.)*

---

## 3. Complete Implemented Features

### A. Homepage & Discovery (`views/public/index.ejs`)
- **Trending Ticker Bar**: Day/Night-adaptive blue `TRENDING` ticker fed by highlighted posts with category pills.
- **Compact Single-Row Navigation & AI-Era Access**: Clean single-row pill-dock header with quick access to `Daily AI Briefing`, `Timelines`, `AI Tools Directory`, `Videos`, and `My Personalized Feed`.
- **Hero Grid**: 1 lead story (`fetchpriority="high"` + LCP preload) + 3 side highlight cards.
- **Trending Now**: Thumbnail row cards highlighting top popular stories.
- **AI Today Band**: Dedicated AI coverage + today's **2-Minute Daily AI Briefing** card.
- **Editor's Picks**: Curated flagship stories (`is_editors_pick = 1`).
- **Latest Stories + In-Feed AdSense Slot**: Paginated story cards with zero-CLS native ad placement.
- **Reviews & Comparisons Section** + **How-To Guides Section**.
- **Weekly Tech Digest Banner**: Dedicated high-visibility newsletter signup band.

### B. Article Page Upgrades (`views/public/article.ejs`)
- **Key Takeaways Box**: 3–5 scannable bullet points at the top of the story.
- **Editorial Verification & Last Updated Date**: Optional editorial review / fact-check label + explicit date (no fabricated test or lab badges).
- **What's New Callout**: Highlights the latest update or patch added to an evolving story.
- **Official Sources Box**: Outbound `rel="noopener noreferrer nofollow"` links to primary vendor/regulator documentation.
- **Correction History**: Transparent edit/correction log under Editorial Policy.
- **Article Feedback (`👍 Helpful` / `👎 Not Helpful`)**: Live AJAX voting persisted to SQLite (`helpful_yes`, `helpful_no`) — real user counts only.
- **Save Article (`☆ Save`) & Print (`🖨️ Print`)**: Browser bookmarking stored in `localStorage` + `/saved` reading list + clean `@media print` stylesheet.
- **Author Expertise & Role**: Displays `job_title` and `expertise` tags alongside E-E-A-T bio.
- **Existing Core Features Preserved**: Reading progress bar, TOC, hero WebP `<figure>` + `<figcaption>`, mid/top/bottom AdSense slots, social share buttons, and Related Stories.

### C. Five AI-Era Signature Features
1. **AI Article Assistant (`POST /api/articles/:id/ask`, `src/utils/aiAssistant.js`)**: Readers ask questions directly inside any article (`Summarize Key Takeaways`, `Official Sources`, `What's New?`, or custom questions). Runs with a zero-cost deterministic grounded engine by default (strictly citing sections inside the article) and optionally upgrades to **Gemini 2.5 Flash** or **OpenAI** when an API key is added in Admin Settings.
2. **Daily AI Briefing (`/briefing`, `/briefing/:slug`)**: Concise daily executive scan of top AI, tech policy, and gaming updates.
3. **Tech Timelines (`/timelines`, `/timeline/:slug`)**: Chronological story trackers (e.g., *GTA 6 Launch & PC Update Tracker*, *2026 Frontier AI & Policy Tracker*) with milestone badges and official source links.
4. **AI Tools Directory (`/ai-tools`, `/ai-tools/:slug`)**: Searchable/filterable directory of AI tools with uploaded WebP logos, pricing tiers, Pros/Cons comparison boxes, and clean `SoftwareApplication` JSON-LD schema (without fabricated `aggregateRating`).
5. **Personalized Feed (`/my-feed`, `POST /api/preferences`)**: Readers pick favorite topic categories persisted in cookie `th_prefs`.

### D. Audience Growth Suite (Video, Social & Web Push)
1. **YouTube & YouTube Shorts Video Reviews (`/videos`, `src/utils/video.js`)**: Supports YouTube standard videos and vertical 9:16 Shorts via dedicated article video fields (`video_url`, `video_title`, `video_duration`, `video_is_short`) and inline Markdown `{{youtube:URL}}` shortcodes. Uses zero-lag click-to-play **Lite YouTube** facades (`.yt-lite`) to protect Core Web Vitals and injects `VideoObject` JSON-LD schema for Google Video Search.
2. **Dynamic Social Cards & Distribution Queue (`/og/:slug.png`, `/admin/social`, `src/utils/social.js`)**: Renders `1200×630` branded PNG social preview cards via `sharp` (`og:image` across Reddit, X, Bluesky, LinkedIn, and Hacker News), exposes 1-click platform share links on every article, and manages scheduled/manual posts with direct **Bluesky ATProto** and **Make/Zapier/n8n Webhook** dispatch.
3. **Web Push Breaking News Alerts (`/sw.js`, `/api/push/*`, `/admin/push`, `src/utils/push.js`)**: Standards-based VAPID Web Push subscriptions (`web-push`), header/homepage opt-in toggle (`#pushAlertBtn` / `#pushBannerBtn`), live broadcast console in `/admin/push`, and optional auto-broadcast when publishing breaking articles.

### E. Automatic WebP, SEO & Google AdSense
- **Author Page & Full `Person` Schema (`/author/:slug`, `src/utils/seo.js`)**: Dedicated author profile page displaying job title, location, credentials, `knowsAbout` expertise topics, verified X/Twitter, LinkedIn, and website links, article read stats, plus full `ProfilePage` + `Person` + `Organization` (`worksFor`) JSON-LD.
- **Ownership & Location (`/about#ownership`, `/contact`, footer, JSON-LD)**: Configurable legal entity name, founder/owner name, contact/editorial/privacy emails (`contact@techhavenus.com`, `editorial@techhavenus.com`, `privacy@techhavenus.com`), and clean location (`New York, NY, United States` inside `PostalAddress` in `Organization` JSON-LD — with no fabricated street address, ZIP, or phone).
- **GDPR / CAN-SPAM Double Opt-In Newsletter (`src/utils/newsletter.js`)**: Requires explicit consent checkbox, generates unique confirmation & unsubscribe tokens, supports **Brevo**, **Buttondown**, **Mailchimp**, **Resend**, or built-in **Local Double Opt-In**, verifies via `GET /newsletter/confirm?token=...`, and provides 1-click removal via `GET /newsletter/unsubscribe?token=...`.
- **Auto-WebP Media Pipeline (`src/utils/imageProcessor.js`)**: Converts PNG, JPG, GIF, TIFF, BMP, AVIF, SVG, or WebP uploads into `<=1400px` `.webp` + `640×360` `-thumb.webp` with automatic floating SVG watermark, storing full Image SEO metadata (`title`, `alt_text`, `caption`, `description`, `width`, `height`) and compression savings %.
- **Technical SEO (`src/utils/seo.js`)**: Full `meta_title`, `meta_subtitle` (`alternativeHeadline`), `meta_description`, `meta_tags`, `focus_keyword`, `canonical_url`, `hreflang` (`en-US`, `x-default`), Open Graph (`1200×630` dynamic PNG social cards via `/og/:slug.png`), Twitter cards, JSON-LD (`Article` with `ImageObject` `name`/`caption`/`description`, `VideoObject`, `WebSite`, `Organization`, `ProfilePage`, `Person`, `BreadcrumbList`, `SoftwareApplication`), `/sitemap.xml` (including `/videos` and Google Image tags), `/rss.xml`, and `/robots.txt`.
- **Google AdSense & Compliance**: 6 zero-CLS ad slots, toggleable layout placeholders, editable `/ads.txt`, GDPR/CCPA Cookie Consent Banner (Google Consent Mode v2), plus `/about`, `/editorial-policy`, `/contact`, `/privacy-policy`, `/terms`, and `/disclaimer`.

### F. Upgraded Admin CMS (`/admin`)
- **Content & Editorial Workflow**:
  - **Scheduled Publishing** (`status = 'scheduled'` auto-promoted every 60s and on page hits via `publishDueScheduledPosts()`).
  - **Breaking News** & **Editor's Pick** & **Featured** & **Trending** toggles.
  - **Article Revision History**: Every update snapshots the previous text into `post_revisions` with one-click **Restore**.
  - **Draft Autosave**: Periodic `localStorage` + background `POST /admin/api/posts/:id/autosave`.
  - **Multi-Author Roles** (`/admin/users`): `admin`, `editor` (can approve `in_review` queue), and `author` (submits to `in_review`).
  - **Editorial Calendar** (`/admin/calendar`): Review approval queue, scheduled queue, drafts, and recent releases.
- **SEO Management** (`/admin/seo-tools` & Editor):
  - **Internal Link Suggestions** (`GET /admin/api/seo/internal-links`) inside the post editor.
  - **301 / 302 Redirect Manager** (enforced on live requests + hit counter).
  - **Canonical URL Validator**, **Schema Validation**, and **Broken Internal Link Scanner** across all published posts.
- **Analytics** (`/admin/analytics`): Top articles, traffic by country & region (`USA` / `Europe` / `Global`), engagement metrics (helpful votes + bookmarks), search query tracking (`search_logs`), and newsletter subscriber sources.
- **Security, Backups, Health & Error Monitoring** (`/admin/system`, `GET /health`):
  - **SQLite-Backed Brute-Force & Rate Limiting (`src/utils/auth.js`)**: Tracks failed login attempts per IP (8 failures / 15 min) and per account (5 failures / 30 min) inside `login_attempts`, emits `429` + `Retry-After` headers, uses constant-time `scrypt` verification against user enumeration, applies progressive backoff delays, and displays an audit monitor + lockout reset button in `/admin/system`.
  - Automated daily SQLite snapshots (`VACUUM INTO` in `data/backups/`, retains last 10) + one-click manual `.db` backup & download.
  - Real-time `/health` JSON probe (DB latency, uptime, memory, cache size).
  - Server `error_logs` table capturing uncaught 500 errors.

---

## 4. Database Schema (`data/techhaven.db`)

Core SQLite tables (WAL mode + `FTS5`):
- `users` (`role`, `job_title`, `expertise`, `location`, `credentials`, `linkedin_url`, `website_url`, `bio`)
- `categories` (10 topic desks)
- `posts` (content, SEO meta, `region`, `is_breaking`, `is_editors_pick`, `video_url`, `video_title`, `video_duration`, `video_is_short`, `featured_image_title`, `featured_image_alt`, `featured_image_caption`, `featured_image_description`, `key_takeaways_json`, `whats_new`, `fact_check_status`, `last_fact_checked`, `official_sources_json`, `corrections_json`, `helpful_yes`, `helpful_no`, `save_count`, workflow timestamps)
- `tags`, `post_tags`, `media` (`title`, `alt_text`, `caption`, `description`, `width`, `height`, WebP size stats), `settings`, `subscribers` (`status`, `confirm_token`, `unsubscribe_token`, `gdpr_consent`, `consent_ip`, `provider_name`, `provider_synced`), `contact_messages`
- `post_revisions`, `redirects`, `page_views`, `search_logs`, `login_attempts`
- `ai_tools`, `daily_briefings`, `timelines`, `timeline_events`, `social_posts`, `push_subscriptions`, `push_campaigns`, `error_logs`
- `posts_fts` (`FTS5` virtual table synced via `INSERT/UPDATE/DELETE` triggers)

---

## 5. Scalability & Future Cloud Migration Plan

TechHaven US starts fast on a single server with SQLite WAL + in-memory cache (`MemoryCache`). As traffic scales to multi-server clusters:

| Component | Current (Single Server) | Future Scale Path |
| :--- | :--- | :--- |
| **Database** | Built-in `node:sqlite` (`WAL` mode) | Migrate SQL queries in `src/db/` to **PostgreSQL (`pg`)** for high-concurrency multi-writer workloads |
| **Page Cache** | In-memory `MemoryCache` (`src/utils/cache.js`) | Swap `get`/`set`/`clear` adapter to **Redis (`ioredis`)** for shared multi-instance caching |
| **Media Storage** | Local disk `public/uploads/*.webp` | Upload `.webp` buffers from `sharp` directly to **Cloudflare R2** (S3 API) and set `CDN Asset Base URL` in Admin Settings |
| **Global Edge CDN** | Direct Express static (`365d immutable`) | Put **Cloudflare Free/Pro DNS Proxy** in front of `techhavenus.com` to cache `.webp` & static CSS/JS across US & EU PoPs |
| **Backups & Monitoring** | Daily SQLite `VACUUM INTO` + `/health` + `error_logs` | Sync `data/backups/` to R2/S3 and point **UptimeRobot / Better Stack** at `https://techhavenus.com/health` |

---

## 6. Deploying to BiswasHost (`http://biswashost.com/`)

### Option A: BiswasHost cPanel with Node.js Selector (Recommended)
1. **Check Plan Support**: Log into your BiswasHost cPanel and look for **Setup Node.js App** (CloudLinux / Phusion Passenger).
   - *Note*: If your hosting package is a PHP-only Shared plan without **Setup Node.js App** or SSH/PM2 access, ask BiswasHost support to enable Node.js Selector or upgrade to a Node.js-enabled plan / KVM VPS (`biswashost.com` VPS plans work natively with PM2 + Nginx).
2. **Prepare & Upload Files**:
   - Compress/upload all files from `d:\777` **except** `node_modules/` and local `.env` into your server directory (e.g., `/home/username/techhavenus`).
   - Keep `data/` and `public/uploads/` writable (`755`).
3. **Create Node.js App in BiswasHost cPanel**:
   - Open **Setup Node.js App** -> **Create Application**.
   - **Node.js Version**: Select **Node 22.x** or **Node 24.x** (required for built-in `node:sqlite`).
   - **Application Mode**: `Production`.
   - **Application Root**: `techhavenus` (the folder where `package.json` and `app.cjs` live).
   - **Application URL**: `techhavenus.com`.
   - **Application Startup File**: **`app.cjs`** *(created specifically for cPanel Phusion Passenger + ESM compatibility!)*.
4. **Add Environment Variables** (inside cPanel Node.js App UI or `.env`):
   - `NODE_ENV=production`
   - `SITE_URL=https://techhavenus.com`
   - `SESSION_SECRET=<64-char-random-secret>`
   - `ADMIN_EMAIL=admin@techhavenus.com`
   - `ADMIN_PASSWORD=<your-strong-password>`
5. **Install Dependencies & Start**:
   - Click **Run NPM Install** inside cPanel (or run `npm install --omit=dev` in Terminal/SSH).
   - Click **Restart App** and visit `https://techhavenus.com/health` to confirm `{"status":"ok","dbOk":true}`.

### Option B: BiswasHost VPS (Ubuntu + PM2 + Nginx)
```bash
# 1. Install Node.js 24 LTS & PM2
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2

# 2. Deploy code to /var/www/techhavenus
cd /var/www/techhavenus
cp .env.example .env   # edit SITE_URL, SESSION_SECRET, ADMIN_PASSWORD
npm install --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
```
Proxy Nginx `server_name techhavenus.com www.techhavenus.com;` to `http://127.0.0.1:3000`, enable Let's Encrypt SSL (`certbot --nginx`), and place **Cloudflare** in front for instant US + Europe edge caching.

---

## 7. Local Commands & Default Login

```bash
npm install     # Install dependencies
npm start       # Start server on http://localhost:3000 (auto-migrates & seeds DB)
npm run dev     # Start with Node --watch auto-reload
npm run seed    # Run database seeder/migrator manually
```

- **Public Site**: `http://localhost:3000/`
- **Admin CMS**: `http://localhost:3000/admin`
- **Health Endpoint**: `http://localhost:3000/health`

