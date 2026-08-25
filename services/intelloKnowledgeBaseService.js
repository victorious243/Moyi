const IntelloArticle = require('../models/IntelloArticle');
const Project = require('../models/Project');
const User = require('../models/User');
const emailService = require('./emailService');
const env = require('../config/env');
const { recordAppLog } = require('./appLogger');

/**
 * Catalog of Real Marketer & Founder Struggles
 * Used by Intello Daily to discover uncovered problems and build deep-dive solution playbooks.
 */
const MARKET_STRUGGLES_CATALOG = [
  {
    slug: 'striking-distance-keywords-google-search-console',
    category: 'search_console',
    primaryKeyword: 'striking distance keywords google search console',
    secondaryKeywords: ['page 2 seo ranking', 'gsc impression velocity', 'search console keyword optimization'],
    title: 'How to Mine Striking-Distance Keywords in Google Search Console for Rapid SEO Wins',
    struggleSummary: 'Your website receives thousands of Google impressions for high-intent queries, but rankings are stuck on page two (positions 8–20) where CTR is under 1.5%.',
    struggleSymptoms: [
      'High impression volume in GSC with almost zero organic clicks.',
      'Core landing pages fluctuating between position 9 and position 18 for months.',
      'Competitors with lower domain authority outranking you for transactional terms.'
    ],
    rootCauseAnalysis: 'Google has already evaluated your domain authority and found your page relevant, but is waiting for stronger on-page topical completeness (H2 sub-intent answers, structured tables, or internal links) before ranking you in the top 3.',
    manualSolution: '1. Filter Google Search Console for queries in positions 8 to 20 with >300 monthly impressions.\n2. Identify the specific sub-questions searchers are asking that your page currently misses.\n3. Add dedicated H2 headings and concise answer blocks directly answering those sub-queries.\n4. Build 2–3 contextual internal links from high-authority existing pages to the target URL.',
    howMoyiSolves: 'Moyi connects directly to your Google Search Console via read-only API, autonomously mines striking-distance queries with high impression velocity, and drafts exact on-page H2 additions and internal linking plans in Content Studio for 1-click human approval.',
    faqs: [
      {
        question: 'What is considered a striking-distance keyword?',
        answer: 'Striking-distance keywords are search queries where your page ranks between positions 8 and 20 (the bottom of page one and the entirety of page two).'
      },
      {
        question: 'How quickly do rankings move after optimizing striking-distance keywords?',
        answer: 'Ranking adjustments typically take 7 to 21 days as search engine crawlers re-index and evaluate the expanded content.'
      },
      {
        question: 'Should I create a new page for striking-distance variations?',
        answer: 'In most cases, no. Expanding an existing ranking page preserves existing URL authority and prevents keyword cannibalization.'
      }
    ],
    sources: ['Google Search Central Guidelines', 'Search Engine Land SEO Playbook'],
    internalLinks: [
      { targetUrl: '/features/daily-content-intelligence', anchorText: 'Intello Daily Content Intelligence', reason: 'Feature discovery' },
      { targetUrl: '/google-search-console-reporting-tool', anchorText: 'Search Console Reporting Tool', reason: 'Diagnostic tool' },
      { targetUrl: '/pricing', anchorText: 'Moyi Pricing & Plans', reason: 'Commercial CTA' }
    ]
  },
  {
    slug: 'keyword-cannibalization-seo-diagnosis',
    category: 'seo_rankings',
    primaryKeyword: 'keyword cannibalization seo diagnosis',
    secondaryKeywords: ['duplicate search intent', 'internal ranking competition', 'ranking fluctuation fix'],
    title: 'How to Detect and Fix Keyword Cannibalization Before It Destroys Your Organic Traffic',
    struggleSummary: 'Multiple pages on your domain compete for the exact same search term, causing Google to constantly swap URLs in search results and suppress overall rankings.',
    struggleSymptoms: [
      'Search Console shows 2 or more URLs sharing impressions for the same primary query.',
      'Rankings oscillate erratically between position 4 and position 40 from week to week.',
      'Backlinks are fragmented across 3 different blog posts instead of 1 authoritative pillar page.'
    ],
    rootCauseAnalysis: 'When multiple pages target identical search intent without clear topical hierarchy, search algorithms cannot determine which URL is the definitive canonical source, diluting internal link equity and ranking potential.',
    manualSolution: '1. Audit Search Console by filtering queries with multiple ranking URLs.\n2. Pick the strongest URL based on historical conversions and backlinks as your primary canonical asset.\n3. Consolidate competing secondary pages into the primary guide or 301-redirect outdated duplicates.\n4. Re-align internal anchor text across your site to point strictly to the designated pillar page.',
    howMoyiSolves: 'Moyi’s Anti-Cannibalization Matrix automatically cross-references every new content proposal against your existing indexed pages. If high overlap is detected, Moyi flags it as "Existing Coverage" and recommends expanding the existing URL rather than publishing duplicate clutter.',
    faqs: [
      {
        question: 'What causes keyword cannibalization?',
        answer: 'It occurs when multiple blog posts or product pages target the same search query without clear differentiation in search intent.'
      },
      {
        question: 'Is 301 redirecting always the best fix?',
        answer: 'If the secondary page has no unique traffic or backlinks, 301 redirecting is ideal. If it serves a distinct niche audience, re-optimizing its H1/H2 tags for long-tail intent is better.'
      }
    ],
    sources: ['Ahrefs Keyword Cannibalization Study', 'Google Search Central URL Canonicalization'],
    internalLinks: [
      { targetUrl: '/seo-growth-software', anchorText: 'SEO Growth Software', reason: 'Product context' },
      { targetUrl: '/features', anchorText: 'Core Platform Features', reason: 'Platform overview' }
    ]
  },
  {
    slug: 'social-media-revenue-attribution-for-b2b',
    category: 'social_distribution',
    primaryKeyword: 'social media revenue attribution b2b',
    secondaryKeywords: ['closed loop social tracking', 'utm attribution model', 'linkedin organic conversion tracking'],
    title: 'The Closed-Loop Social Attribution Playbook: Proving B2B Revenue from Organic Posts',
    struggleSummary: 'Your marketing team publishes content on LinkedIn, X, and Instagram every day, but executives dismiss social media because you cannot prove direct pipeline or revenue attribution.',
    struggleSymptoms: [
      'High vanity metrics (likes, impressions, reposts) with zero visibility into resulting website signups.',
      'Google Analytics 4 dumps social traffic into generic "Direct / None" due to missing UTM parameters.',
      'Leadership questions social media marketing budget and resource allocation.'
    ],
    rootCauseAnalysis: 'Most social publishing tools only measure in-platform vanity metrics and fail to append first-party UTM parameters or track multi-touch website conversion funnels.',
    manualSolution: '1. Establish a strict UTM tagging protocol for every social post (utm_source, utm_medium, utm_campaign, utm_content).\n2. Configure first-party event tracking on high-intent conversion actions (trial signups, demo requests, pricing views).\n3. Attribute first-click, last-click, and linear conversion paths across a 30-day attribution window.',
    howMoyiSolves: 'Moyi builds native closed-loop attribution directly into every scheduled post. When you publish from Content Studio, Moyi attaches tamper-proof first-party UTM parameters and tracks conversion telemetry directly into your project dashboard.',
    faqs: [
      {
        question: 'Why does GA4 report social traffic as Direct?',
        answer: 'Mobile social apps (LinkedIn, X, Instagram) often strip referrer headers when opening links in in-app web views unless explicit UTM tags are attached.'
      },
      {
        question: 'What is closed-loop marketing attribution?',
        answer: 'Closed-loop attribution connects top-of-funnel marketing activity (social posts, blog articles) directly to bottom-of-funnel revenue events (signups, purchases).'
      }
    ],
    sources: ['HubSpot B2B Attribution Report', 'Google Analytics 4 Multi-Channel Funnels Documentation'],
    internalLinks: [
      { targetUrl: '/social-media-publishing-tool', anchorText: 'Social Media Publishing Tool', reason: 'Feature exploration' },
      { targetUrl: '/pricing', anchorText: 'View Pricing', reason: 'Pricing CTA' }
    ]
  },
  {
    slug: 'b2b-competitor-keyword-hijacking-defense',
    category: 'competitor_intel',
    primaryKeyword: 'b2b competitor keyword hijacking defense',
    secondaryKeywords: ['competitor comparison pages', 'alternatives keyword strategy', 'brand search defense'],
    title: 'How to Defend Your Brand Search Queries and Win Competitor Alternative Keywords',
    struggleSummary: 'Competitors are bidding on your brand name in Google Ads or ranking "vs" and "alternatives" comparison pages that steer your potential buyers to their software.',
    struggleSymptoms: [
      'Searching for your brand name shows competitor comparison ads in the top 2 Google positions.',
      'Prospects on demo calls mention inaccurate competitor claims found on third-party comparison blogs.',
      'Competitor "Alternative to [Your Brand]" pages rank higher than your own feature pages.'
    ],
    rootCauseAnalysis: 'High-intent buyers in the consideration phase explicitly search for comparison keywords ("Brand A vs Brand B", "Alternatives to Brand A"). If you do not own the narrative with transparent, evidence-backed comparison pages, competitors will control it.',
    manualSolution: '1. Map all competitor comparison keywords using Search Console and competitor crawling.\n2. Build dedicated, objective comparison pages ("Moyi vs Competitor") highlighting verifiable factual differentiators.\n3. Publish transparent feature matrices, pricing comparisons, and customer migration guides.\n4. Secure top organic positions for your own brand comparison terms.',
    howMoyiSolves: 'Moyi includes automated Competitor Intelligence scanning that monitors competitor crawl changes, tracks ranking gaps, and drafts objective "vs" and "alternatives" comparison pages in Content Studio with 1-click publishing.',
    faqs: [
      {
        question: 'Is it legal to create comparison pages against competitors?',
        answer: 'Yes, comparative advertising is legally protected in most jurisdictions provided all statements and pricing facts are truthful, substantiated, and not misleading.'
      },
      {
        question: 'Should comparison pages be biased?',
        answer: 'No. Modern buyers trust objective, balanced comparison pages that honestly state where each tool excels rather than one-sided promotional fluff.'
      }
    ],
    sources: ['FTC Comparative Advertising Policy', 'Google Ads Trademark Guidelines'],
    internalLinks: [
      { targetUrl: '/compare/moyi-vs-ahrefs', anchorText: 'Moyi vs Ahrefs Comparison', reason: 'Comparison example' },
      { targetUrl: '/features', anchorText: 'Explore Features', reason: 'Product overview' }
    ]
  },
  {
    slug: 'saas-high-traffic-low-conversion-audit',
    category: 'conversion_cro',
    primaryKeyword: 'saas high traffic low conversion audit',
    secondaryKeywords: ['blog conversion optimization', 'product led content strategy', 'cro heuristic analysis'],
    title: 'Why Your High-Traffic Blog Generates Zero Leads (And the 4-Step CRO Fix)',
    struggleSummary: 'Your organic search traffic is growing every month, but free trial signups, demo bookings, and pipeline remain completely flat.',
    struggleSymptoms: [
      'Thousands of monthly organic blog visitors with a sitewide conversion rate below 0.3%.',
      'High bounce rates (>85%) on top-ranking informational articles.',
      'Generic "Subscribe to our newsletter" popups that visitors immediately dismiss.'
    ],
    rootCauseAnalysis: 'Most SaaS blogs publish top-of-funnel informational content that answers a question without showing how the product actually solves the underlying problem (missing product-led narrative and contextual CTAs).',
    manualSolution: '1. Conduct a MECLABS heuristic audit on top 10 traffic pages (Motivation, Value Prop, Incentive vs Friction & Anxiety).\n2. Replace generic newsletter CTAs with contextual product-led mini-tools, templates, or live diagnostic workflows.\n3. Embed annotated product screenshots showing the exact workflow solution inside the article body.\n4. Add sticky bottom-bar action banners tailored to the specific search intent of the page.',
    howMoyiSolves: 'Moyi’s CRO Experimentation Engine analyzes page intent, scores friction points using MECLABS heuristics, and generates product-led CTA blocks and contextual proof points designed specifically to turn readers into active software users.',
    faqs: [
      {
        question: 'What is product-led content?',
        answer: 'Product-led content is educational marketing material where your software product is naturally woven into the advice as the most efficient solution to the problem.'
      },
      {
        question: 'What is a good conversion rate for a SaaS blog?',
        answer: 'Industry benchmarks for SaaS blog-to-trial conversion range from 1.2% to 3.5% for well-optimized product-led articles.'
      }
    ],
    sources: ['MECLABS Conversion Heuristic Guidelines', 'ProductLed Marketing Strategy Guide'],
    internalLinks: [
      { targetUrl: '/solutions/ai-cmo-for-b2b-saas', anchorText: 'AI CMO for B2B SaaS', reason: 'Solution page' },
      { targetUrl: '/pricing', anchorText: 'Start Free Trial', reason: 'Conversion CTA' }
    ]
  },
  {
    slug: 'eliminating-expensive-marketing-agency-retainers',
    category: 'marketing_strategy',
    primaryKeyword: 'eliminating expensive marketing agency retainers',
    secondaryKeywords: ['autonomous digital cmo', 'saas marketing automation', 'in house seo vs agency'],
    title: 'Why Modern Founders Are Replacing €5k/Month Marketing Agency Retainers with Autonomous AI CMOs',
    struggleSummary: 'Founders spend €3,000 to €8,000 every month on marketing agencies, only to receive slow communication, junior account managers, and static PDF reports with no daily execution.',
    struggleSymptoms: [
      'Paying thousands in monthly retainer fees while waiting 2–3 weeks for simple blog drafts or campaign updates.',
      'Receiving retrospective monthly slide decks that explain what happened 30 days ago rather than what to do today.',
      'Agency recommendations that lack technical depth or require your team to do all the actual work.'
    ],
    rootCauseAnalysis: 'Traditional agency economics rely on billing hours and junior staff juggling 10+ accounts. They lack continuous real-time data access to make daily tactical decisions for your specific business.',
    manualSolution: '1. Transition from passive retrospective reporting to daily continuous intelligence.\n2. Use first-party telemetry and Search Console mining to identify daily growth opportunities.\n3. Implement structured human-in-the-loop workflows where AI proposes data-backed work and humans maintain approval governance.',
    howMoyiSolves: 'Moyi acts as your 24/7 Autonomous Digital CMO for a fraction of the cost. Every morning, Moyi diagnoses search signals, creates multi-channel copy and Swiss-grid visuals, tracks baselines, and prepares 1-click approvals in your Operator Dashboard.',
    faqs: [
      {
        question: 'Can an AI CMO truly replace a marketing agency?',
        answer: 'For analytics, Search Console mining, daily copy drafting, visual asset creation, and performance reporting, an AI CMO is faster, continuous, and grounded in real data. Strategy and final approvals remain with the founder.'
      },
      {
        question: 'What does "Moyi proposes, humans decide" mean?',
        answer: 'It is our core governance principle: Moyi does the heavy analytical and creative drafting, but never publishes anything without your explicit 1-click review.'
      }
    ],
    sources: ['Gartner CMO Spend Survey', 'Harvard Business Review Marketing Technology Report'],
    internalLinks: [
      { targetUrl: '/features/daily-content-intelligence', anchorText: 'Intello Daily Platform', reason: 'Feature link' },
      { targetUrl: '/pricing', anchorText: 'View Transparent Pricing', reason: 'Pricing link' }
    ]
  }
];

/**
 * Format complete markdown/HTML content for an Intello KB Article
 */
function renderArticleMarkdown(struggle) {
  return `
# ${struggle.title}

## The Searcher's Problem & Warning Signs
${struggle.struggleSummary}

### Key Symptoms You Might Observe:
${(struggle.struggleSymptoms || []).map((s) => `- **${s}**`).join('\n')}

---

## Root Cause Analysis: Why This Happens
${struggle.rootCauseAnalysis}

---

## The Step-by-Step Actionable Solution
${struggle.manualSolution}

---

## How Moyi Eliminates This Struggle Autonomously
${struggle.howMoyiSolves}

> **Core Governance Principle:** *Moyi proposes. Humans decide.* Moyi automates the continuous data mining and content drafting, but nothing goes live without your 1-click human review.

---

## Frequently Asked Questions
${(struggle.faqs || []).map((faq) => `### ${faq.question}\n${faq.answer}\n`).join('\n')}

---

## Verified Sources & Further Reading
${(struggle.sources || []).map((src) => `- ${src}`).join('\n')}
  `.trim();
}

/**
 * Discover an uncovered marketing struggle for daily KB generation
 * Guarantees deduplication: Skips any struggle already published or in review.
 */
async function discoverDailyMarketStruggles({ force = false } = {}) {
  const existingArticles = await IntelloArticle.find({}).select('slug primaryKeyword').lean();
  const existingSlugs = new Set(existingArticles.map((a) => a.slug));
  const existingKeywords = new Set(existingArticles.map((a) => a.primaryKeyword.toLowerCase()));

  // Find candidate from catalog that is not yet covered
  for (const candidate of MARKET_STRUGGLES_CATALOG) {
    if (!existingSlugs.has(candidate.slug) && !existingKeywords.has(candidate.primaryKeyword.toLowerCase())) {
      return {
        found: true,
        candidate,
        isNew: true
      };
    }
  }

  // If all catalog items covered, generate dynamic long-tail variation
  const dateSuffix = new Date().toISOString().slice(0, 10);
  const dynamicCandidate = {
    slug: `daily-growth-diagnostic-${dateSuffix}`,
    category: 'seo_rankings',
    primaryKeyword: `daily organic search optimization ${dateSuffix}`,
    secondaryKeywords: ['automated marketing telemetry', 'continuous seo workflow'],
    title: `Daily Organic Search Optimization: Solving Emerging Algorithm Volatility (${dateSuffix})`,
    struggleSummary: 'Search engine ranking shifts occur continuously. Managing fluctuations without daily telemetry leads to delayed recovery.',
    struggleSymptoms: [
      'Sudden ranking drops on high-value commercial pages.',
      'Delayed awareness of competitor content updates.',
      'Unresolved crawl errors sitting in Search Console for weeks.'
    ],
    rootCauseAnalysis: 'Weekly or monthly SEO reviews leave a 7-to-30 day blind spot where search engine adjustments damage organic pipeline without prompt detection.',
    manualSolution: '1. Review daily impression velocity on primary landing pages.\n2. Inspect crawl diagnostics and fix newly detected 404 or canonicalization errors.\n3. Refresh out-of-date content sections with fresh proof points and updated schema markup.',
    howMoyiSolves: 'Moyi runs 24/7 continuous audits, tracks 6-dimensional growth scores, and generates daily morning action plans in Content Studio.',
    faqs: [
      {
        question: 'How often does Google update search rankings?',
        answer: 'Google updates search index rankings continuously throughout the day based on user interaction signals and real-time crawling.'
      }
    ],
    sources: ['Google Search Central Documentation'],
    internalLinks: [
      { targetUrl: '/features/daily-content-intelligence', anchorText: 'Intello Daily Platform', reason: 'Feature link' },
      { targetUrl: '/pricing', anchorText: 'Start Free Trial', reason: 'Pricing CTA' }
    ]
  };

  return {
    found: true,
    candidate: dynamicCandidate,
    isNew: !existingSlugs.has(dynamicCandidate.slug)
  };
}

/**
 * Generate a complete Intello Solution Article and save to DB
 */
async function generateIntelloSolutionArticle(struggle, options = {}) {
  const content = renderArticleMarkdown(struggle);
  const articleData = {
    slug: struggle.slug,
    title: struggle.title,
    seoTitle: `${struggle.title} | Moyi Intello KB`,
    seoDescription: struggle.struggleSummary.slice(0, 160),
    primaryKeyword: struggle.primaryKeyword,
    secondaryKeywords: struggle.secondaryKeywords || [],
    category: struggle.category || 'seo_rankings',
    struggleSummary: struggle.struggleSummary,
    struggleSymptoms: struggle.struggleSymptoms || [],
    rootCauseAnalysis: struggle.rootCauseAnalysis,
    manualSolution: struggle.manualSolution,
    howMoyiSolves: struggle.howMoyiSolves,
    articleContent: content,
    jsonBody: struggle,
    faqs: struggle.faqs || [],
    sources: struggle.sources || [],
    internalLinks: struggle.internalLinks || [],
    socialDistribution: {
      linkedIn: `Most growth teams struggle with ${struggle.primaryKeyword}.\n\nHere is what is happening: ${struggle.struggleSummary}\n\nRead the complete step-by-step resolution guide: https://moyi-cmo.com/intello/${struggle.slug}`,
      x: `Struggling with ${struggle.primaryKeyword}?\n\nHere is how to diagnose and fix it:\n↳ 1. Inspect Search Console\n↳ 2. Fix sub-intent alignment\n\nFull guide: https://moyi-cmo.com/intello/${struggle.slug}`,
      facebook: `New Intello KB Guide: ${struggle.title}.\n\n${struggle.struggleSummary}\n\nRead guide: https://moyi-cmo.com/intello/${struggle.slug}`
    },
    readingTimeMinutes: Math.max(3, Math.ceil(content.split(/\s+/).length / 200)),
    status: options.status || 'awaiting_review',
    publishedAt: options.status === 'published' ? new Date() : null,
    sourceProjectId: options.projectId || null
  };

  const article = await IntelloArticle.findOneAndUpdate(
    { slug: struggle.slug },
    { $set: articleData },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  return article;
}

/**
 * 1-Click Operator Approval & Publishing Pipeline
 */
async function publishIntelloArticle(articleId, operatorUser) {
  const article = await IntelloArticle.findById(articleId);
  if (!article) throw new Error('Intello Article not found.');

  article.status = 'published';
  article.publishedAt = new Date();
  article.approvedBy = operatorUser ? operatorUser._id : null;
  article.approvedAt = new Date();
  article.operatorNotes = `Published by Operator (${operatorUser ? operatorUser.email : 'system'}) at ${new Date().toISOString()}`;
  await article.save();

  return article;
}

/**
 * Operator Rejection Handler
 */
async function rejectIntelloArticle(articleId, reason, operatorUser) {
  const article = await IntelloArticle.findById(articleId);
  if (!article) throw new Error('Intello Article not found.');

  article.status = 'rejected';
  article.operatorNotes = reason || `Rejected by Operator (${operatorUser ? operatorUser.email : 'system'})`;
  await article.save();

  return article;
}

/**
 * Public Knowledge Base Hub Data Query
 */
async function getIntelloHubData({ category, query, page = 1, limit = 12 } = {}) {
  const filter = { status: 'published' };

  if (category && category !== 'all') {
    filter.category = category;
  }

  if (query && query.trim()) {
    const regex = new RegExp(query.trim().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i');
    filter.$or = [
      { title: regex },
      { primaryKeyword: regex },
      { struggleSummary: regex }
    ];
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

  const [articles, totalCount, categoriesCount] = await Promise.all([
    IntelloArticle.find(filter)
      .sort({ publishedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .lean(),
    IntelloArticle.countDocuments(filter),
    IntelloArticle.aggregate([
      { $match: { status: 'published' } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ])
  ]);

  const categories = {
    all: totalCount,
    seo_rankings: 0,
    search_console: 0,
    social_distribution: 0,
    conversion_cro: 0,
    competitor_intel: 0,
    marketing_strategy: 0
  };

  categoriesCount.forEach((c) => {
    if (categories[c._id] !== undefined) {
      categories[c._id] = c.count;
    }
  });

  return {
    articles,
    totalCount,
    currentPage: parseInt(page, 10),
    totalPages: Math.max(1, Math.ceil(totalCount / parseInt(limit, 10))),
    activeCategory: category || 'all',
    searchQuery: query || '',
    categories
  };
}

/**
 * Public Article Reader Query (Increments View Count)
 */
async function getIntelloArticleBySlug(slug) {
  const article = await IntelloArticle.findOneAndUpdate(
    { slug: String(slug).toLowerCase().trim(), status: 'published' },
    { $inc: { viewCount: 1 } },
    { returnDocument: 'after' }
  ).lean();

  if (!article) return null;

  // Fetch related articles in same category
  const relatedArticles = await IntelloArticle.find({
    category: article.category,
    slug: { $ne: article.slug },
    status: 'published'
  })
    .sort({ publishedAt: -1 })
    .limit(3)
    .select('slug title category struggleSummary readingTimeMinutes')
    .lean();

  return {
    article,
    relatedArticles
  };
}

/**
 * Seed initial published Intello KB articles if database is empty
 */
async function seedInitialIntelloArticles() {
  const count = await IntelloArticle.countDocuments({ status: 'published' });
  if (count > 0) return { seeded: 0, message: 'KB already populated.' };

  let seededCount = 0;
  for (const struggle of MARKET_STRUGGLES_CATALOG) {
    await generateIntelloSolutionArticle(struggle, { status: 'published' });
    seededCount += 1;
  }

  return { seeded: seededCount, message: `Successfully seeded ${seededCount} Intello KB articles.` };
}

module.exports = {
  MARKET_STRUGGLES_CATALOG,
  discoverDailyMarketStruggles,
  generateIntelloSolutionArticle,
  publishIntelloArticle,
  rejectIntelloArticle,
  getIntelloHubData,
  getIntelloArticleBySlug,
  seedInitialIntelloArticles
};
