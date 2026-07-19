# Scanned Pages Audit Report: VicPods

**Date:** June 13, 2026  
**Target Domain:** https://vicpods.com  
**Audit Objective:** Present a deduplicated, high-fidelity catalog of scanned pages, filtering out external redirect URLs and query parameter duplicates.

---

## 📊 Executive Summary Table

| Category | URL Path | Page Title | Primary H1 Header | Word Count | Internal Links | Ext. Links | Missing Alts |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| **Core** | `/` | VicPods - AI Podcast Planning and Launch Prep Workspace | AI podcast planning and launch prep for creators. | 1608 | 15 | 0 | 2 |
| **Core** | `/about` | About VicPods - VicPods | VicPods is a ready-to-record podcast planning and launch-prep app. | 522 | 12 | 0 | 2 |
| **Core** | `/examples` | Podcast Episode Examples – VicPods | See what a strong VicPods episode looks like before you start. | 842 | 15 | 0 | 0 |
| **Core** | `/help` | Help Center - VicPods | *Missing* | 699 | 12 | 0 | 2 |
| **Tool** | `/podcast-idea-generator` | Podcast Idea Generator – Free AI Tool | Podcast Idea Generator | 423 | 12 | 0 | 0 |
| **Auth** | `/auth/login` | Login - VicPods | Welcome back to VicPods | 185 | 4 | 0 | 0 |
| **Auth** | `/auth/register` | Create Account - VicPods | Create your VicPods account | 195 | 5 | 0 | 0 |
| **Auth** | `/auth/forgot-password` | Forgot Password - VicPods | *Missing* | 40 | 1 | 0 | 0 |
| **Legal** | `/cookie-policy` | Cookie Policy - VicPods | Cookie controls should be clear, reversible, and easy to reach. | 601 | 12 | 0 | 0 |
| **Legal** | `/data-rights` | Data Rights - VicPods | Users should be able to understand and exercise their rights without friction. | 514 | 12 | 0 | 0 |
| **Legal** | `/privacy-policy` | Privacy Policy - VicPods | Privacy that stays product-minded, not surveillance-minded. | 935 | 12 | 0 | 0 |
| **Legal** | `/terms` | Terms of Service - VicPods | *Audit Incomplete (Cut-off)* | — | — | — | — |

### 📖 Guides & Templates

| Sub-path | Page Title | Primary H1 Header | Word Count | Links (Int/Ext) | Missing Alts |
| :--- | :--- | :--- | :---: | :---: | :---: |
| `/guides` | Podcast Guides and Templates - VicPods | Podcast Guides and Templates | 418 | 21 / 0 | 0 |
| `/guides/how-to-plan-a-podcast-episode` | How to Plan a Podcast Episode Before You Record - VicPods | How to Plan a Podcast Episode | 436 | 15 / 0 | 0 |
| `/guides/how-to-plan-a-podcast-season` | How to Plan a Podcast Season Without Losing Momentum - VicPods | How to Plan a Podcast Season | 388 | 15 / 0 | 0 |
| `/guides/how-to-start-a-podcast` | How to Start a Podcast in 2026 - VicPods | How to Start a Podcast | 596 | 15 / 0 | 0 |
| `/guides/how-to-write-a-podcast-script` | How to Write a Podcast Script That Still Sounds Natural - VicPods | How to Write a Podcast Script | 390 | 15 / 0 | 0 |
| `/guides/podcast-content-calendar` | Podcast Content Calendar Guide for Consistent Publishing - VicPods | Podcast Content Calendar | 354 | 15 / 0 | 0 |
| `/guides/podcast-episode-outline-template` | Podcast Episode Outline Template for Clearer Recording - VicPods | Podcast Episode Outline Template | 387 | 15 / 0 | 0 |
| `/guides/podcast-interview-questions` | Podcast Interview Questions That Create Better Conversations - VicPods | Podcast Interview Questions | 387 | 15 / 0 | 0 |
| `/guides/podcast-launch-checklist` | Podcast Launch Checklist for a Stronger First Release - VicPods | Podcast Launch Checklist | 354 | 15 / 0 | 0 |
| `/guides/podcast-show-notes-template` | Podcast Show Notes Template for Stronger Episode Pages - VicPods | Podcast Show Notes Template | 355 | 15 / 0 | 0 |

---

## 🔧 Technical Fix Summary

### 1. External OAuth Redirect Pollution
* **The Symptom:** Crawler parsed Google Accounts URLs (`https://accounts.google.com/v3/signin/...`) because the internal endpoint `/auth/google` redirected to it.
* **The Root Cause:** Axios followed the redirect, changing `finalUrl` to the Google Accounts host and appending it to the unique visited pages queue.
* **The Fix:** Added a `sameHost` verification step inside [crawlerService.js](file:///home/brandon/Moyi/services/crawlerService.js) directly after `fetchPage(nextUrl)`. If the returned page's final URL resides on an external host, the crawler discards the page data and skips parsing its links.

### 2. Query Parameter Duplicate Crawl Loop
* **The Symptom:** Crawler scanned several copies of the homepage with trailing `?idea=...` parameters.
* **The Root Cause:** `normalizeUrl` left query strings intact, causing the visited queue to treat them as separate pages.
* **The Fix:** Updated `normalizeUrl` in [url.js](file:///home/brandon/Moyi/utils/url.js) to set `parsed.search = ''`, stripping all query strings by default.
