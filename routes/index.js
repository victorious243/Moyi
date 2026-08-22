const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, validationResult } = require('express-validator');
const env = require('../config/env');
const Project = require('../models/Project');
const Scan = require('../models/Scan');
const Report = require('../models/Report');
const ContentDraft = require('../models/ContentDraft');
const SocialAccount = require('../models/SocialAccount');
const ProjectSearchProperty = require('../models/ProjectSearchProperty');
const ConversionGoal = require('../models/ConversionGoal');
const AuditLog = require('../models/AuditLog');
const ApiCredential = require('../models/ApiCredential');
const GrowthAlert = require('../models/GrowthAlert');
const { requireAuth } = require('../middleware/auth');
const { clearAuthCookie } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { planFor } = require('../config/plans');
const { getCurrentUsage, socialPostAllowance } = require('../services/usageService');
const { exportAccountData, deleteAccountData } = require('../services/accountDataService');
const { recordAuditEvent } = require('../services/auditLogService');
const { sendCustomerEmail, sendGoodbyeEmail, verifyEmailTransport } = require('../services/emailService');
const { DEFAULT_TEST_URL, fetchMetaOembed, missingMetaOembedKeys, normalizeOembedUrl } = require('../services/metaOembedService');
const { findAccessibleProjects } = require('../services/projectAccessService');
const { readinessPayload } = require('../services/runtimeHealthService');
const { statusPagePayload } = require('../services/enterpriseHardeningService');
const {
  canChangeProjectRole,
  canPublishProjectRole,
  projectAccessRole
} = require('../services/projectAccessService');
const { API_SCOPES, createApiCredential } = require('../services/apiCredentialService');
const { runPublicQuickScan } = require('../services/publicQuickScanService');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');
const publicPages = require('../config/publicPages');

const router = express.Router();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

router.get('/', function(req, res) {
  if (req.user) return res.redirect('/dashboard');
  res.render('index', {
    title: 'AI CMO Software for SEO Growth and Content Reports',
    seoDescription: 'Evidence-led AI CMO platform that turns website audits and Search Console queries into automated SEO content, paid ads, and campaign calendars.',
    quickScanResult: null,
    quickScanError: '',
    quickScanUrl: ''
  });
});

function publicBaseUrl() {
  return String(env.appUrl || 'https://moyi-cmo.com').replace(/\/$/, '');
}

function sitemapUrl(pathname, priority = '0.7', changefreq = 'weekly') {
  return {
    loc: `${publicBaseUrl()}${pathname}`,
    priority,
    changefreq
  };
}

function publicPageSchema(slug, page) {
  const url = `${publicBaseUrl()}/${slug}`;
  const schemas = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      url,
      description: page.seoDescription || page.intro,
      isPartOf: {
        '@type': 'WebSite',
        name: 'Moyi-CMO',
        url: publicBaseUrl()
      },
      about: page.schemaAbout || page.title
    }
  ];

  if (page.faqs && page.faqs.length) {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer
        }
      }))
    });
  }

  return schemas;
}

function idKey(value) {
  return String(value && value._id ? value._id : value);
}

async function countByProject(Model, match) {
  const rows = await Model.aggregate([
    { $match: match },
    { $group: { _id: '$projectId', count: { $sum: 1 } } }
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

async function buildWorkspaceSetupSummary(projects) {
  const projectIds = projects.map((project) => project._id);
  if (!projectIds.length) {
    return {
      readyProjects: 0,
      totalProjects: 0,
      averagePercent: 0,
      projectsNeedingAttention: [],
      blockers: []
    };
  }

  const [
    scanCounts,
    reportCounts,
    searchPropertyCounts,
    conversionGoalCounts,
    socialAccountCounts,
    approvedDraftCounts
  ] = await Promise.all([
    countByProject(Scan, { projectId: { $in: projectIds }, status: 'completed' }),
    countByProject(Report, { projectId: { $in: projectIds }, status: { $ne: 'failed' } }),
    countByProject(ProjectSearchProperty, { projectId: { $in: projectIds } }),
    countByProject(ConversionGoal, { projectId: { $in: projectIds } }),
    countByProject(SocialAccount, { projectId: { $in: projectIds }, status: 'connected' }),
    countByProject(ContentDraft, { projectId: { $in: projectIds }, status: 'approved', publishStatus: { $ne: 'published' } })
  ]);

  const labels = {
    scan: 'website scan',
    report: 'AI CMO plan',
    search: 'Search Console property',
    goals: 'conversion goal',
    social: 'social account',
    content: 'approved content'
  };
  const projectRows = projects.map((project) => {
    const key = idKey(project);
    const checks = {
      scan: scanCounts.has(key),
      report: reportCounts.has(key),
      search: searchPropertyCounts.has(key),
      goals: conversionGoalCounts.has(key),
      social: socialAccountCounts.has(key),
      content: approvedDraftCounts.has(key)
    };
    const completed = Object.values(checks).filter(Boolean).length;
    const missing = Object.keys(checks).filter((check) => !checks[check]);
    return {
      id: project._id,
      name: project.name,
      href: `/projects/${project._id}`,
      completed,
      total: Object.keys(checks).length,
      percent: Math.round((completed / Object.keys(checks).length) * 100),
      missing,
      nextLabel: missing.length ? labels[missing[0]] : 'weekly review',
      nextHref: missing[0] === 'search'
        ? `/projects/${project._id}/search-console/connect`
        : missing[0] === 'goals'
          ? `/projects/${project._id}/tracking/setup`
          : missing[0] === 'social'
            ? `/projects/${project._id}/integrations/social`
            : missing[0] === 'content'
              ? `/projects/${project._id}/content`
              : `/projects/${project._id}`
    };
  });
  const blockerCounts = Object.keys(labels).map((key) => ({
    key,
    label: labels[key],
    count: projectRows.filter((project) => project.missing.includes(key)).length
  })).filter((item) => item.count > 0);
  const averagePercent = Math.round(projectRows.reduce((sum, project) => sum + project.percent, 0) / projectRows.length);

  return {
    readyProjects: projectRows.filter((project) => project.percent === 100).length,
    totalProjects: projectRows.length,
    averagePercent,
    projectsNeedingAttention: projectRows
      .filter((project) => project.percent < 100)
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 4),
    blockers: blockerCounts
  };
}

const { COMPARISON_PAGES, SOLUTION_PAGES } = require('../config/programmaticPages');
const { TUTORIAL_PAGES } = require('../config/tutorialPages');
const {
  MARKET_STRUGGLES_CATALOG,
  getIntelloHubData,
  getIntelloArticleBySlug,
  seedInitialIntelloArticles
} = require('../services/intelloKnowledgeBaseService');

router.get('/sitemap.xml', (req, res) => {
  const urls = [
    sitemapUrl('/', '1.0', 'weekly'),
    sitemapUrl('/intello', '0.95', 'daily'),
    sitemapUrl('/pricing', '0.9', 'monthly'),
    ...Object.keys(publicPages).map((slug) => {
      const highIntent = [
        'ai-cmo-software',
        'seo-growth-software',
        'google-search-console-reporting-tool',
        'ai-content-marketing-platform',
        'social-media-publishing-tool',
        'agency-seo-reporting-software',
        'seo-audit-tool',
        'marketing-assistant-for-small-business',
        'marketing-tools-for-startups',
        'social-media-content-planner',
        'google-search-console-analysis',
        'marketing-platform-for-agencies',
        'marketing-software-for-small-business',
        'website-marketing-audit',
        'resources/striking-distance-keywords-google-search-console'
      ].includes(slug);
      return sitemapUrl(`/${slug}`, highIntent ? '0.9' : '0.8', 'monthly');
    }),
    ...Object.keys(COMPARISON_PAGES).map((slug) => sitemapUrl(`/compare/${slug}`, '0.85', 'weekly')),
    ...Object.keys(SOLUTION_PAGES).map((slug) => sitemapUrl(`/solutions/${slug}`, '0.85', 'weekly')),
    ...Object.keys(TUTORIAL_PAGES).map((slug) => sitemapUrl(`/docs/tutorials/${slug}`, '0.85', 'monthly')),
    ...MARKET_STRUGGLES_CATALOG.map((s) => sitemapUrl(`/intello/${s.slug}`, '0.9', 'weekly')),
    sitemapUrl('/features/daily-content-intelligence', '0.95', 'weekly'),
    sitemapUrl('/features/intello-daily', '0.9', 'weekly'),
    sitemapUrl('/status', '0.7', 'daily'),
    sitemapUrl('/contact', '0.6', 'monthly'),
    sitemapUrl('/privacy', '0.5', 'yearly'),
    sitemapUrl('/terms', '0.5', 'yearly'),
    sitemapUrl('/cookies', '0.5', 'yearly')
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => [
      '  <url>',
      `    <loc>${escapeHtml(url.loc)}</loc>`,
      `    <changefreq>${url.changefreq}</changefreq>`,
      `    <priority>${url.priority}</priority>`,
      '  </url>'
    ].join('\n')),
    '</urlset>'
  ].join('\n');

  res.type('application/xml').send(xml);
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /dashboard',
    'Disallow: /projects',
    'Disallow: /account',
    'Disallow: /billing',
    'Disallow: /admin',
    'Disallow: /organizations',
    'Disallow: /auth/verify-email',
    'Disallow: /auth/reset-password',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    'Disallow: /verify-email',
    'Disallow: /api/',
    '',
    `Sitemap: ${publicBaseUrl()}/sitemap.xml`,
    `Llms: ${publicBaseUrl()}/llms.txt`
  ].join('\n'));
});

router.get('/status', asyncHandler(async (req, res) => {
  const status = statusPagePayload(await readinessPayload());
  res.status(status.status === 'incident' ? 503 : 200).render('status', {
    title: 'System Status',
    seoDescription: 'Current operational status for Moyi-CMO web application, background jobs, integrations, and social publishing.',
    status
  });
}));

router.get('/llms.txt', (req, res) => {
  res.type('text/plain').send([
    '# Moyi-CMO',
    '',
    'Moyi-CMO is an evidence-led AI Chief Marketing Officer platform for website audits, Google Search Console insights, SEO recommendations, content drafts, campaign planning, and recurring growth reports.',
    '',
    '## What Moyi-CMO does',
    '- Crawls public website pages and records observable SEO, content, metadata, schema, link, image, and crawl-health signals.',
    '- Connects to Google Search Console with read-only access to analyze queries, pages, clicks, impressions, CTR, and average position.',
    '- Converts real evidence into prioritized recommendations, AI CMO plans, content drafts, campaign posts, image workflows, and measurement reports.',
    '- Keeps human review in control before publishing, exporting, or acting on generated work.',
    '',
    '## Important URLs',
    `- Homepage: ${publicBaseUrl()}/`,
    `- Intello Knowledge Base: ${publicBaseUrl()}/intello`,
    `- Intello Daily: ${publicBaseUrl()}/features/daily-content-intelligence`,
    `- Features: ${publicBaseUrl()}/features`,
    `- How it works: ${publicBaseUrl()}/how-it-works`,
    `- Documentation & Tutorials: ${publicBaseUrl()}/docs`,
    ...Object.values(TUTORIAL_PAGES).map((t) => `- Tutorial (${t.title}): ${publicBaseUrl()}/docs/tutorials/${t.slug}`),
    `- Reports guide: ${publicBaseUrl()}/reports`,
    `- Pricing: ${publicBaseUrl()}/pricing`,
    `- AI CMO software: ${publicBaseUrl()}/ai-cmo-software`,
    `- SEO growth software: ${publicBaseUrl()}/seo-growth-software`,
    `- Search Console reporting tool: ${publicBaseUrl()}/google-search-console-reporting-tool`,
    `- AI content marketing platform: ${publicBaseUrl()}/ai-content-marketing-platform`,
    `- Social media publishing tool: ${publicBaseUrl()}/social-media-publishing-tool`,
    `- Agency SEO reporting software: ${publicBaseUrl()}/agency-seo-reporting-software`,
    `- Privacy policy: ${publicBaseUrl()}/privacy`,
    `- Terms: ${publicBaseUrl()}/terms`,
    `- Contact: ${publicBaseUrl()}/contact`,
    '',
    '## Data and safety',
    'Moyi-CMO should report missing evidence honestly. It should not invent traffic, conversions, rankings, competitor facts, or customer proof. Google Search Console access is read-only.'
  ].join('\n'));
});

router.post('/quick-scan', [
  body('websiteUrl')
    .trim()
    .notEmpty()
    .withMessage('Enter a website URL.')
    .isLength({ max: 300 })
    .withMessage('Website URL is too long.')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).render('index', {
      title: 'AI CMO Software for SEO Growth and Content Reports',
      seoDescription: 'Moyi-CMO turns website scans and Google Search Console evidence into SEO recommendations, AI CMO plans, content drafts, campaign calendars, and weekly growth reports.',
      quickScanResult: null,
      quickScanError: errors.array().map((error) => error.msg).join(', '),
      quickScanUrl: req.body.websiteUrl || ''
    });
  }

  try {
    const quickScanResult = await runPublicQuickScan(req.body.websiteUrl);
    res.render('index', {
      title: `${quickScanResult.snapshot.host} quick scan`,
      seoDescription: 'Run a public website scan with Moyi-CMO to preview crawl evidence, SEO issues, content opportunities, and the next marketing actions to review.',
      quickScanResult,
      quickScanError: '',
      quickScanUrl: quickScanResult.websiteUrl
    });
  } catch (error) {
    res.render('index', {
      title: 'AI CMO Software for SEO Growth and Content Reports',
      seoDescription: 'Moyi-CMO turns website scans and Google Search Console evidence into SEO recommendations, AI CMO plans, content drafts, campaign calendars, and weekly growth reports.',
      quickScanResult: null,
      quickScanError: error.message,
      quickScanUrl: req.body.websiteUrl || ''
    });
  }
}));

function metaOembedReviewView(overrides = {}) {
  return {
    title: 'Meta oEmbed Read Test',
    seoDescription: 'A review-only Moyi-CMO page that demonstrates Meta oEmbed Read for public Facebook and Instagram URLs.',
    sourceUrl: DEFAULT_TEST_URL,
    embedResult: null,
    embedError: '',
    missingKeys: missingMetaOembedKeys(),
    ...overrides
  };
}

router.get('/meta-review/oembed', (req, res) => {
  try {
    res.render('public/meta-oembed-review', metaOembedReviewView({
      sourceUrl: normalizeOembedUrl(req.query.url)
    }));
  } catch (error) {
    res.status(error.statusCode || 400).render('public/meta-oembed-review', metaOembedReviewView({
      sourceUrl: DEFAULT_TEST_URL,
      embedError: error.message
    }));
  }
});

router.post('/meta-review/oembed', [
  body('sourceUrl')
    .trim()
    .notEmpty()
    .withMessage('Enter a public Facebook or Instagram URL.')
    .isLength({ max: 500 })
    .withMessage('The URL is too long.')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).render('public/meta-oembed-review', metaOembedReviewView({
      sourceUrl: req.body.sourceUrl || DEFAULT_TEST_URL,
      embedError: errors.array().map((error) => error.msg).join(' ')
    }));
  }

  try {
    const embedResult = await fetchMetaOembed(req.body.sourceUrl);
    res.render('public/meta-oembed-review', metaOembedReviewView({
      sourceUrl: embedResult.sourceUrl,
      embedResult
    }));
  } catch (error) {
    const status = error.statusCode || (error.response && error.response.status) || 500;
    const metaMessage = error.response && error.response.data && error.response.data.error && error.response.data.error.message
      ? error.response.data.error.message
      : error.message;
    res.status(status).render('public/meta-oembed-review', metaOembedReviewView({
      sourceUrl: req.body.sourceUrl || DEFAULT_TEST_URL,
      embedError: metaMessage
    }));
  }
}));

const renderIntelloDaily = (req, res) => {
  res.render('public/intello-daily', {
    title: 'Intello Daily — Autonomous Daily Content Intelligence | Moyi-CMO',
    seoDescription: 'Every morning at 7:00 AM, Intello Daily turns search queries and competitor shifts into fresh social posts, Swiss-grid carousels, 3D device mockups, and performance ads.',
    additionalSchemas: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Intello Daily — Autonomous Daily Content Intelligence',
        url: `${publicBaseUrl()}/features/daily-content-intelligence`,
        description: 'Autonomous Daily Content Intelligence engine delivering ready-to-publish social drafts, Swiss-grid carousels, 3D device mockups, and performance ads every morning at 7:00 AM.',
        isPartOf: {
          '@type': 'WebSite',
          name: 'Moyi-CMO',
          url: publicBaseUrl()
        }
      }
    ]
  });
};

router.get('/features/daily-content-intelligence', renderIntelloDaily);
router.get('/features/intello-daily', renderIntelloDaily);
router.get('/intello-daily', renderIntelloDaily);

// Public Intello Knowledge Base Hub & Solution Reader
router.get('/kb', (req, res) => {
  res.redirect(301, '/intello');
});

router.get('/intello', asyncHandler(async (req, res) => {
  await seedInitialIntelloArticles().catch(() => null);
  const data = await getIntelloHubData({
    category: req.query.category,
    query: req.query.q,
    page: req.query.page || 1,
    limit: 12
  });

  res.render('public/intello/hub', {
    title: 'Intello Knowledge Base — Solutions to Real Marketing & SEO Struggles | Moyi-CMO',
    seoDescription: 'Explore actionable problem-solving playbooks for Google Search Console, striking-distance keywords, keyword cannibalization, and social revenue attribution.',
    ...data
  });
}));

router.get('/intello/:slug', asyncHandler(async (req, res, next) => {
  await seedInitialIntelloArticles().catch(() => null);
  const data = await getIntelloArticleBySlug(req.params.slug);
  if (!data || !data.article) {
    return next();
  }

  res.render('public/intello/show', {
    title: `${data.article.title} | Moyi Intello KB`,
    seoDescription: data.article.seoDescription || data.article.struggleSummary.slice(0, 160),
    ...data
  });
}));

Object.entries(publicPages).forEach(([slug, page]) => {
  router.get(`/${slug}`, (req, res) => {
    res.render(slug === 'docs' ? 'public/docs' : 'public/info', {
      title: page.seoTitle || page.title,
      seoDescription: page.seoDescription || page.intro,
      additionalSchemas: publicPageSchema(slug, page),
      page
    });
  });
});

// Programmatic SEO: Competitor Comparison Pages
router.get('/compare/:slug', (req, res, next) => {
  const page = COMPARISON_PAGES[req.params.slug];
  if (!page) return next();
  return res.render('public/compare', {
    title: page.title,
    seoDescription: page.metaDescription,
    page
  });
});

// Programmatic SEO: Industry & Solution Pages
router.get('/solutions/:slug', (req, res, next) => {
  const page = SOLUTION_PAGES[req.params.slug];
  if (!page) return next();
  return res.render('public/solution', {
    title: page.title,
    seoDescription: page.metaDescription,
    page
  });
});

// Documentation Tutorials & Step-by-Step Walkthroughs
router.get('/docs/tutorials', (req, res) => {
  res.redirect(301, '/docs#setup-tutorials');
});

router.get('/docs/tutorials/:slug', (req, res, next) => {
  const tutorial = TUTORIAL_PAGES[req.params.slug];
  if (!tutorial) return next();
  return res.render('public/tutorial', {
    title: `${tutorial.seoTitle} | Moyi-CMO`,
    seoDescription: tutorial.seoDescription,
    tutorial
  });
});

function contactView(overrides = {}) {
  return {
    title: 'Contact Customer Support & Sales',
    seoDescription: 'Get in touch with Moyi-CMO for product inquiries, customer support, partnerships, and enterprise AI growth solutions.',
    contactSuccess: '',
    contactError: '',
    formData: {},
    supportEmail: env.supportEmail,
    ...overrides
  };
}

router.get('/contact', (req, res) => {
  res.render('public/contact', contactView());
});

const { validateContactSubmission } = require('../services/emailSecurityService');

router.post('/contact', [
  body('name').trim().notEmpty().withMessage('Your name is required.').isLength({ max: 120 }).withMessage('Your name is too long.'),
  body('email').isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('company').optional({ checkFalsy: true }).trim().isLength({ max: 160 }).withMessage('Company name is too long.'),
  body('topic').isIn(['sales', 'support', 'partnership', 'privacy', 'feedback']).withMessage('Choose a valid topic.'),
  body('message').trim().notEmpty().withMessage('Enter a message.').isLength({ max: 3000 }).withMessage('Message must be 3,000 characters or fewer.'),
  body('website').optional({ checkFalsy: true }).isEmpty().withMessage('Unable to submit this message.')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  const formData = {
    name: req.body.name || '',
    email: req.body.email || '',
    company: req.body.company || '',
    topic: req.body.topic || 'support',
    message: req.body.message || ''
  };
  if (!errors.isEmpty()) {
    return res.status(422).render('public/contact', contactView({
      contactError: errors.array().map((error) => error.msg).join(' '),
      formData
    }));
  }

  // 4-Layer Anti-Spam & Email Security Verification (Honeypot, Rate Limiting, Disposable Block, MX DNS)
  const clientIp = req.ip || req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  const securityCheck = await validateContactSubmission({
    email: formData.email,
    name: formData.name,
    message: formData.message,
    website: req.body.website,
    clientIp
  });
  if (!securityCheck.valid) {
    return res.status(422).render('public/contact', contactView({
      contactError: securityCheck.reason,
      formData
    }));
  }

  if (!env.supportEmail) {
    return res.status(503).render('public/contact', contactView({
      contactError: 'Contact delivery is not configured yet. Set SUPPORT_EMAIL and try again.',
      formData
    }));
  }

  try {
    await sendCustomerEmail({
      to: env.supportEmail,
      replyTo: formData.email,
      subject: `[Moyi ${formData.topic}] ${formData.company || formData.name}`,
      heading: `New ${escapeHtml(formData.topic)} enquiry`,
      intro: `Submitted by ${escapeHtml(formData.name)} (${escapeHtml(formData.email)})`,
      bodyHtml: `
        <p><strong>Company:</strong> ${escapeHtml(formData.company || 'Not provided')}</p>
        <p><strong>Topic:</strong> ${escapeHtml(formData.topic)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(formData.message).replace(/\n/g, '<br>')}</p>
      `
    });
    return res.render('public/contact', contactView({
      contactSuccess: 'Your message has been sent to the Moyi team.'
    }));
  } catch (error) {
    return res.status(503).render('public/contact', contactView({
      contactError: 'Moyi could not deliver your message right now. Please try again later.',
      formData
    }));
  }
}));

router.get('/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const [projects, allProjects, usage] = await Promise.all([
    findAccessibleProjects(req.user._id, { sort: { updatedAt: -1 }, limit: 6 }),
    findAccessibleProjects(req.user._id, { select: 'name', sort: { updatedAt: -1 } }),
    getCurrentUsage(req.user._id)
  ]);
  const projectCount = allProjects.length;
  const projectIds = allProjects.map((project) => project._id);
  const [
    recentScans,
    recentReports,
    socialAccountCount,
    reconnectAccountCount,
    approvalQueueCount,
    workspaceSetup
  ] = await Promise.all([
    Scan.find({ projectId: { $in: projectIds } }).sort({ createdAt: -1 }).limit(8),
    Report.find({ projectId: { $in: projectIds } }).sort({ createdAt: -1 }).limit(5),
    SocialAccount.countDocuments({ projectId: { $in: projectIds }, status: 'connected' }),
    SocialAccount.countDocuments({ projectId: { $in: projectIds }, status: 'reconnect_required' }),
    ContentDraft.countDocuments({ projectId: { $in: projectIds }, status: 'approved', publishStatus: { $ne: 'published' } }),
    buildWorkspaceSetupSummary(allProjects)
  ]);
  const scanProjectMap = new Map(allProjects.map((project) => [project._id.toString(), project]));
  const plan = planFor(req.user);
  const socialPostLimit = socialPostAllowance(plan, usage);

  res.render('dashboard', {
    title: 'Dashboard',
    projects,
    projectCount,
    recentScans,
    recentReports,
    scanProjectMap,
    socialAccountCount,
    reconnectAccountCount,
    approvalQueueCount,
    workspaceSetup,
    usage,
    plan,
    socialPostLimit
  });
}));

async function openLatestContentWorkspace(req, res) {
  const projects = await findAccessibleProjects(req.user._id, {
    select: '_id updatedAt',
    sort: { updatedAt: -1 }
  });
  if (!projects.length) return res.redirect('/projects/new');

  const projectIds = projects.map((project) => project._id);
  const draft = await ContentDraft.findOne({ projectId: { $in: projectIds } })
    .sort({ updatedAt: -1 })
    .select('_id');

  if (draft) return res.redirect(`/content/${draft._id}`);
  return res.redirect(`/projects/${projects[0]._id}/content`);
}

router.get('/workspace', requireAuth, asyncHandler(openLatestContentWorkspace));
router.get('/show', requireAuth, asyncHandler(openLatestContentWorkspace));

async function renderAccountSettings(req, res, additions = {}) {
  const [auditLogs, apiCredentials, apiProjects] = await Promise.all([
    AuditLog.find({ actorUserId: req.user._id }).sort({ createdAt: -1 }).limit(12).lean(),
    ApiCredential.find({ userId: req.user._id }).select('+prefix').sort({ createdAt: -1 }).populate('projectIds', 'name').lean(),
    findAccessibleProjects(req.user._id, { select: 'name organizationId', sort: { name: 1 } })
  ]);
  res.render('account', {
    title: 'Account Settings',
    plan: planFor(req.user),
    auditLogs,
    apiCredentials,
    apiProjects,
    apiScopes: API_SCOPES,
    oneTimeApiKey: '',
    accountMessage: req.query.message || '',
    accountError: req.query.error || '',
    ...additions
  });
}

router.get('/account', requireAuth, asyncHandler(async (req, res) => {
  await renderAccountSettings(req, res);
}));

router.post('/account/api-keys', requireAuth, [
  body('name').trim().notEmpty().isLength({ max: 120 }).withMessage('API key name is required.'),
  body('scopes').custom((value) => {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values.length > 0 && values.every((scope) => API_SCOPES.includes(scope));
  }).withMessage('Choose at least one valid API scope.'),
  body('projectIds').custom((value) => {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values.length > 0 && values.every((id) => /^[a-f\d]{24}$/i.test(String(id)));
  }).withMessage('Choose at least one valid API project.'),
  handleValidation
], asyncHandler(async (req, res) => {
  const scopes = [...new Set((Array.isArray(req.body.scopes) ? req.body.scopes : [req.body.scopes]).map(String))];
  const projectIds = [...new Set((Array.isArray(req.body.projectIds) ? req.body.projectIds : [req.body.projectIds]).map(String))];
  const projects = await Project.find({ _id: { $in: projectIds } });
  if (projects.length !== projectIds.length) throw new AppError('One or more selected API projects are unavailable.', 422);
  for (const project of projects) {
    const role = await projectAccessRole({ project, userId: req.user._id });
    if (!role || scopes.includes('publish:write') && !canPublishProjectRole(role)) {
      throw new AppError('Your current project role does not allow all selected API scopes.', 403);
    }
  }
  const { credential, apiKey } = await createApiCredential({
    userId: req.user._id,
    name: req.body.name,
    scopes,
    projectIds
  });
  await recordAuditEvent({
    user: req.user,
    eventType: 'api_credential_created',
    metadata: { apiCredentialId: credential._id, prefix: credential.prefix, scopes, projectIds },
    req
  });
  await renderAccountSettings(req, res, {
    oneTimeApiKey: apiKey,
    accountMessage: 'API key created. This is the only time Moyi will show the secret.'
  });
}));

router.post('/account/api-keys/:id/revoke', requireAuth, asyncHandler(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(String(req.params.id || ''))) throw new AppError('API key not found.', 404);
  const credential = await ApiCredential.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id, status: 'active' },
    { $set: { status: 'revoked' } },
    { new: true }
  );
  if (!credential) throw new AppError('Active API key not found.', 404);
  await recordAuditEvent({
    user: req.user,
    eventType: 'api_credential_revoked',
    metadata: { apiCredentialId: credential._id, name: credential.name },
    req
  });
  res.redirect(`/account?message=${encodeURIComponent('API key revoked.')}`);
}));

router.post('/account/test-email', requireAuth, requirePlatformAdmin, asyncHandler(async (req, res) => {
  const to = env.emailTestTo || req.user.email;

  try {
    await verifyEmailTransport();
    await sendCustomerEmail({
      to,
      subject: 'Moyi-CMO SMTP test email',
      heading: 'Moyi-CMO email server is working',
      intro: 'This confirms SMTP delivery is configured correctly.',
      bodyHtml: `<p>Account: ${req.user.email}</p><p>Sent at: ${new Date().toISOString()}</p>`
    });
    await recordAuditEvent({
      user: req.user,
      eventType: 'smtp_test_email_sent',
      metadata: { to },
      req
    });
    res.redirect(`/account?message=${encodeURIComponent(`Test email sent to ${to}.`)}`);
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      eventType: 'smtp_test_email_failed',
      status: 'failed',
      severity: 'warning',
      metadata: { to, errorMessage: error.message },
      req
    });
    res.redirect(`/account?error=${encodeURIComponent(error.message)}`);
  }
}));

function notificationAccessFilter({ userId, projectIds }) {
  return {
    projectId: { $in: projectIds },
    channels: 'in_app',
    $or: [
      { recipientUserIds: userId },
      {
        $and: [
          { $or: [{ recipientUserIds: { $exists: false } }, { recipientUserIds: { $size: 0 } }] },
          { 'recipientRouting.category': { $exists: false } }
        ]
      }
    ]
  };
}

function alertReadByUser(alert, userId) {
  if ((alert.readBy || []).some((entry) => String(entry.userId) === String(userId))) return true;
  const hasRecipientRouting = Boolean(alert.recipientRouting && alert.recipientRouting.category);
  return !hasRecipientRouting && Boolean(alert.readAt);
}

router.get('/api/notifications', requireAuth, asyncHandler(async (req, res) => {
  const accessibleProjects = await findAccessibleProjects(req.user._id, { select: '_id' });
  const projectIds = accessibleProjects.map((p) => p._id);

  const notifications = await GrowthAlert.find(notificationAccessFilter({ userId: req.user._id, projectIds }))
    .sort({ createdAt: -1 })
    .limit(25)
    .populate('projectId', 'name');

  const unreadCount = notifications.filter((notification) => !alertReadByUser(notification, req.user._id)).length;

  res.json({
    notifications: notifications.map((n) => ({
      _id: n._id,
      type: n.type,
      category: n.category,
      severity: n.severity,
      urgency: n.urgency,
      title: n.title,
      summary: n.summary,
      projectName: (n.projectId && n.projectId.name) || '',
      ctaUrl: n.ctaUrl || (n.projectId ? `/projects/${n.projectId._id}` : '/dashboard'),
      ctaLabel: n.ctaLabel || 'View in Moyi',
      resolutionStatus: n.resolutionStatus,
      isUnread: !alertReadByUser(n, req.user._id),
      createdAt: n.createdAt
    })),
    unreadCount
  });
}));

router.post('/api/notifications/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const accessibleProjects = await findAccessibleProjects(req.user._id, { select: '_id' });
  const projectIds = accessibleProjects.map((project) => project._id);
  const alert = await GrowthAlert.findOne({
    _id: req.params.id,
    ...notificationAccessFilter({ userId: req.user._id, projectIds })
  });
  if (alert) {
    if (!alertReadByUser(alert, req.user._id)) alert.readBy.push({ userId: req.user._id, readAt: new Date() });
    await alert.save();
  }
  res.json({ success: true });
}));

router.post('/api/notifications/read-all', requireAuth, asyncHandler(async (req, res) => {
  const accessibleProjects = await findAccessibleProjects(req.user._id, { select: '_id' });
  const projectIds = accessibleProjects.map((p) => p._id);

  await GrowthAlert.updateMany(
    {
      ...notificationAccessFilter({ userId: req.user._id, projectIds }),
      readBy: { $not: { $elemMatch: { userId: req.user._id } } }
    },
    { $push: { readBy: { userId: req.user._id, readAt: new Date() } } }
  );

  res.json({ success: true });
}));

router.post('/api/notifications/:id/resolve', requireAuth, asyncHandler(async (req, res) => {
  const alert = await GrowthAlert.findById(req.params.id);
  if (!alert) throw new AppError('Notification not found.', 404);
  const role = await projectAccessRole({ projectId: alert.projectId, userId: req.user._id });
  if (!canChangeProjectRole(role)) throw new AppError('You do not have permission to resolve this notification.', 403);
  alert.resolutionStatus = req.body.status === 'dismissed' ? 'dismissed' : 'resolved';
  alert.resolvedAt = new Date();
  alert.resolvedBy = req.user._id;
  await alert.save();
  res.json({ success: true, resolutionStatus: alert.resolutionStatus });
}));

router.post('/api/cmo-chat', requireAuth, asyncHandler(async (req, res) => {
  const { askCmoAssistant } = require('../services/cmoChatService');
  const { message, history, projectId } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }

  let targetProjectId = projectId;
  if (!targetProjectId) {
    const accessibleProjects = await findAccessibleProjects(req.user._id, { limit: 1 });
    if (accessibleProjects && accessibleProjects.length > 0) {
      targetProjectId = accessibleProjects[0]._id;
    }
  }

  const response = await askCmoAssistant({
    projectId: targetProjectId,
    message: message.trim(),
    history: Array.isArray(history) ? history : []
  });

  res.json(response);
}));

router.get('/account/export', requireAuth, asyncHandler(async (req, res) => {
  const payload = await exportAccountData(req.user._id);
  await recordAuditEvent({ user: req.user, eventType: 'account_data_exported', req });
  const safeEmail = String(req.user.email || 'account').replace(/[^a-z0-9._-]+/gi, '-');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="moyi-${safeEmail}-export.json"`);
  res.send(JSON.stringify(payload, null, 2));
}));

router.post('/account/delete', requireAuth, [
  body('confirmEmail').isEmail().withMessage('Confirm your account email.').normalizeEmail(),
  body('confirmText').trim().equals('DELETE').withMessage('Type DELETE to confirm account deletion.'),
  handleValidation
], asyncHandler(async (req, res) => {
  if (String(req.body.confirmEmail || '').toLowerCase() !== String(req.user.email || '').toLowerCase()) {
    return res.redirect(`/account?error=${encodeURIComponent('Confirmation email does not match this account.')}`);
  }

  const userSnapshot = {
    _id: req.user._id,
    email: req.user.email,
    name: req.user.name,
    plan: req.user.plan,
    subscriptionStatus: req.user.subscriptionStatus
  };
  const result = await deleteAccountData(req.user._id);
  await recordAuditEvent({
    user: userSnapshot,
    eventType: 'account_deleted',
    severity: 'critical',
    metadata: { deletedProjects: result.deletedProjects },
    req
  });
  try {
    await sendGoodbyeEmail({
      user: userSnapshot,
      reason: 'Your account was permanently deleted from the Moyi-CMO account area.'
    });
    await recordAuditEvent({ user: userSnapshot, eventType: 'goodbye_email_sent', req });
  } catch (emailError) {
    await recordAuditEvent({
      user: userSnapshot,
      eventType: 'goodbye_email_failed',
      status: 'failed',
      severity: 'warning',
      metadata: { errorMessage: emailError.message },
      req
    });
  }
  clearAuthCookie(res);
  res.redirect('/?accountDeleted=1');
}));

router.get('/terms', (req, res) => {
  res.render('legal', {
    title: 'Terms of Service',
    heading: 'Terms of Service',
    body: `
      <p>Welcome to Moyi-CMO ("Moyi," "we," "our," or "us"). These Terms of Service govern your access to and use of the Moyi-CMO platform, application, AI marketing workspace, website audits, recommendations, content generation tools, campaign workflows, integrations, and related software services (collectively, the "Service"). By creating an account, connecting a project, or using the Service, you enter into a legally binding agreement with us under these Terms.</p>
      <p>If you use Moyi-CMO on behalf of a company, agency, or client, you represent and warrant that you possess the full legal authority to bind that organization to these Terms and to authorize the connection of all websites, integrations, credentials, and data sources you configure.</p>
      
      <h2>1. Description of Service & Advisory Nature</h2>
      <p>Moyi-CMO is an evidence-led AI Chief Marketing Officer operating workspace. The Service audits websites, analyzes observable technical and content search signals, reads read-only Google Search Console performance data, generates AI CMO strategic plans, drafts marketing copy and campaign assets, and facilitates workflow distribution across supported channels.</p>
      <p><strong>Advisory AI Disclaimer:</strong> Moyi-CMO is an assistive operational tool designed to augment human marketing intelligence. It does not replace independent professional judgment, legal advice, financial advice, regulated advertising compliance, or final human editorial sign-off. All recommendations, projections, drafts, and strategies are advisory.</p>
      
      <h2>2. Accounts, Authentication & Security</h2>
      <p>To access the Service, you must create an account, verify your email address, and provide accurate registration information. You are responsible for safeguarding your login credentials, managing team workspace permissions, and for all actions conducted under your account.</p>
      <p>You agree to notify us immediately of any unauthorized access, compromised credentials, or security anomalies associated with your workspace.</p>
      
      <h2>3. Subscriptions, Stripe Billing & Cancellations</h2>
      <p>Paid tiers, feature limits, scan allowances, and billing frequencies (monthly or annual) are specified on our pricing and billing pages. All payments are processed securely via Stripe. By selecting a paid subscription, you authorize recurring charges to your designated payment method.</p>
      <ul>
        <li><strong>Billing Cycle:</strong> Subscription fees are billed in advance on a recurring monthly or annual basis.</li>
        <li><strong>Fair Usage & Limits:</strong> Project quotas, scan depth, and publishing allowances reset at the start of each billing period.</li>
        <li><strong>Cancellations:</strong> You may cancel your subscription at any time via the Stripe Customer Portal in your Account Settings. Upon cancellation, your plan remains active until the end of the current paid billing period.</li>
        <li><strong>Refunds:</strong> Fees are non-refundable except where mandated by statutory consumer protection law or approved in writing by Moyi-CMO management.</li>
      </ul>
      
      <h2>4. Acceptable Use & Crawl Authorization</h2>
      <p>You agree to use Moyi-CMO in compliance with all applicable laws and regulations. You must not:</p>
      <ul>
        <li>Scan, crawl, or analyze websites without explicit ownership, authorization, or lawful authority from the website proprietor.</li>
        <li>Generate deceptive, defamatory, discriminatory, fraudulent, spam, or infringing marketing materials.</li>
        <li>Attempt to reverse engineer, decompile, duplicate, or scrape the platform codebase, prompt structures, or proprietary scoring models.</li>
        <li>Bypass security controls, inject malicious payloads, probe system vulnerabilities, or overwhelm server infrastructure.</li>
        <li>Resell or white-label the Service to third parties without an active Agency tier license or formal partnership agreement.</li>
      </ul>
      
      <h2>5. Intellectual Property & Customer Ownership</h2>
      <p><strong>Your Data & Generated Deliverables:</strong> You retain exclusive ownership of all websites, uploaded brand assets, logos, customer prompts, project calibrations, and finalized approved marketing drafts, social posts, and images created through your workspace.</p>
      <p><strong>Platform IP:</strong> Moyi-CMO retains all rights, title, and interest in the platform software, algorithms, user interfaces, design tokens, deterministic audit heuristics, AI orchestration logic, and documentation.</p>
      <p><strong>Limited Operational License:</strong> You grant Moyi-CMO a strictly limited, non-exclusive license to host, process, format, and transmit your project inputs and crawled evidence solely to operate, secure, and deliver the Service to you.</p>

      <h2>6. AI Content Generation & Human-in-the-Loop</h2>
      <p>Moyi-CMO employs state-of-the-art AI language models (including enterprise OpenAI API endpoints) to assist in generating SEO briefs, articles, social posts, and visual suggestions. AI-generated outputs may occasionally contain factual oversights, stylistic variations, or hallucinated claims.</p>
      <p><strong>Mandatory Human Review:</strong> You acknowledge and agree that human review is required before publishing, exporting, or executing any AI-generated asset. You maintain sole legal and editorial responsibility for all content deployed to your audience or published to third-party CMS platforms.</p>
      <p><strong>Zero AI Model Training:</strong> Your private business data, prompts, and workspace content are never utilized by Moyi-CMO or its AI sub-processors to train public foundation models.</p>

      <h2>7. Third-Party Integrations & Platform APIs</h2>
      <p>The Service connects with third-party providers including Google Search Console, Stripe, Meta (Facebook, Instagram, Threads), LinkedIn, X (Twitter), TikTok, YouTube, Bluesky, WordPress, Webflow, and Shopify. Your utilization of these external services is governed by their respective developer policies and terms of service.</p>
      <p>You authorize Moyi-CMO to store, refresh, and encrypt integration credentials (using AES-256) strictly to execute user-initiated publishing and analytics retrieval. You may revoke API tokens at any time through our Integrations page or via the third-party provider's security portal.</p>

      <h2>8. Limitation of Liability & Warranty Disclaimers</h2>
      <p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR UNINTERRUPTED OPERATION.</p>
      <p>MOYI-CMO DOES NOT GUARANTEE SPECIFIC SEARCH ENGINE RANKINGS, TRAFFIC VOLUMES, CONVERSION RATES, SOCIAL ENGAGEMENT, REVENUE GAINS, OR ADVERTISING RESULTS.</p>
      <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, MOYI-CMO AND ITS DIRECTORS, EMPLOYEES, AND AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, NOR FOR ANY LOSS OF PROFITS, DATA, REVENUE, GOODWILL, OR BUSINESS OPPORTUNITY. IN ALL CASES, MOYI-CMO'S AGGREGATE LIABILITY SHALL NOT EXCEED THE TOTAL FEES PAID BY YOU TO MOYI-CMO IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.</p>

      <h2>9. Indemnification</h2>
      <p>You agree to indemnify, defend, and hold harmless Moyi-CMO and its officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses (including legal fees) arising from or relating to: (a) content published or deployed by you; (b) unauthorized scanning of third-party websites; (c) violation of applicable advertising, privacy, or consumer protection laws; or (d) breach of these Terms.</p>

      <h2>10. Termination & Workspace Deletion</h2>
      <p>You may terminate your account at any time via Account Settings. We reserve the right to suspend or terminate accounts that breach these Terms, engage in unlawful activity, fail to settle outstanding fees, or pose operational or security risks to the platform.</p>

      <h2>11. Governing Law & Dispute Resolution</h2>
      <p>These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles. Any dispute arising out of or relating to these Terms shall be resolved through good-faith negotiation, and if necessary, submitted to binding arbitration or competent courts having jurisdiction.</p>

      <h2>12. Contact & Notices</h2>
      <p>For questions or notices regarding these Terms, contact us through our <a href="/contact">Contact Page</a> or email our support desk at <code>customersupport@moyi-cmo.com</code>.</p>
    `
  });
});

router.get('/privacy', (req, res) => {
  res.render('legal', {
    title: 'Privacy Policy',
    heading: 'Privacy Policy',
    body: `
      <p>At Moyi-CMO ("Moyi," "we," "our," or "us"), privacy, data security, and trust are fundamental to our architecture. This Privacy Policy sets out how we collect, process, protect, and govern personal data across the Moyi-CMO platform, application workspaces, website audit scanners, AI marketing engines, tracking scripts, and integrations.</p>
      <p>We adhere to strict global data protection principles, including the <strong>General Data Protection Regulation (EU & UK GDPR)</strong>, the <strong>California Consumer Privacy Act as amended (CCPA/CPRA)</strong>, and international privacy standards.</p>
      
      <h2>1. Roles: Data Controller vs. Data Processor</h2>
      <ul>
        <li><strong>Moyi-CMO as Data Controller:</strong> We act as Data Controller regarding your account registration, billing credentials, direct support communications, authentication security logs, and website marketing interactions.</li>
        <li><strong>Moyi-CMO as Data Processor:</strong> When you connect client websites, crawl target pages, import Google Search Console metrics, or process campaign assets, you act as Data Controller and Moyi-CMO acts as Data Processor executing tasks under your instructions.</li>
      </ul>

      <h2>2. GDPR Legal Bases for Processing (Article 6 GDPR)</h2>
      <p>We process personal data only where a lawful legal basis applies:</p>
      <ul>
        <li><strong>Performance of a Contract (Art. 6(1)(b)):</strong> To authenticate users, run website scans, generate AI CMO plans, provide content drafts, schedule social posts, process subscriptions, and maintain account workspaces.</li>
        <li><strong>Legitimate Interests (Art. 6(1)(f)):</strong> To secure our infrastructure, prevent fraud and abuse, monitor system uptime, optimize platform performance, and produce aggregated product analytics that do not identify individuals.</li>
        <li><strong>Consent (Art. 6(1)(a)):</strong> For optional marketing communications, non-essential cookies (governed by Cookiebot CMP), and user-initiated third-party OAuth connections.</li>
        <li><strong>Compliance with Legal Obligations (Art. 6(1)(c)):</strong> To maintain statutory accounting and tax records, enforce terms, and comply with lawful regulatory requests.</li>
      </ul>

      <h2>3. Categories of Data We Collect</h2>
      <ul>
        <li><strong>Account & Identity Data:</strong> Name, business email, bcrypt-hashed password, email verification timestamp, role, subscription tier, and security audit events.</li>
        <li><strong>Project & Brand Telemetry:</strong> Domain URLs, target audience profiles, industry classification, competitors, uploaded PNG brand logos, brand voice parameters, and project notes.</li>
        <li><strong>Website Scan & Technical Data:</strong> Public crawled URLs, page titles, H1–H6 headings, meta tags, schema markup, status codes, internal link graphs, and technical SEO issue diagnostics.</li>
        <li><strong>Search Performance Data:</strong> Read-only Google Search Console queries, impressions, clicks, CTR, and average rank positions for connected properties.</li>
        <li><strong>Integration & API Credentials:</strong> OAuth refresh tokens, CMS access tokens, and webhook secrets (stored encrypted at rest using AES-256).</li>
        <li><strong>Financial & Payment Metadata:</strong> Stripe customer IDs, subscription status, invoice history, and billing dates. Full payment card details are processed directly by Stripe (PCI-DSS Level 1 certified) and are never stored on Moyi servers.</li>
        <li><strong>First-Party Analytics & Tracker Data:</strong> When the optional Moyi tracking snippet is installed, we record anonymized page views, referrers, UTM campaigns, session identifiers, and conversion events. IP addresses are cryptographically salted and hashed.</li>
      </ul>

      <h2>4. AI Architecture & Zero-Training Guarantee</h2>
      <p>Moyi-CMO integrates with enterprise AI infrastructure (including OpenAI APIs) to assist in generating strategic recommendations, copy drafts, and image prompts.</p>
      <ul>
        <li><strong>Zero Training on Customer Data:</strong> Your workspace data, prompts, crawl evidence, and content drafts are strictly isolated. We do not use, and do not permit third-party AI providers to use, your customer data to train public foundation AI models.</li>
        <li><strong>Human-in-the-Loop Governance:</strong> AI models generate draft suggestions and diagnostics. All publishing, CMS exporting, and operational decisions remain under human control.</li>
        <li><strong>Data Minimization:</strong> Prompts sent to AI inference endpoints contain only the contextual metadata required to execute the specific draft or audit task.</li>
      </ul>

      <h2>5. Trusted Sub-processors</h2>
      <p>We partner with vetted, enterprise-grade sub-processors to deliver core functionality. Each sub-processor is bound by strict Data Processing Agreements (DPAs):</p>
      <table>
        <thead>
          <tr>
            <th>Sub-processor</th>
            <th>Role / Service</th>
            <th>Location</th>
            <th>Data Safeguard</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Stripe, Inc.</strong></td>
            <td>Payment processing & billing portal</td>
            <td>USA / EU</td>
            <td>PCI-DSS Level 1, EU-US DPF / SCCs</td>
          </tr>
          <tr>
            <td><strong>OpenAI, LLC</strong></td>
            <td>AI text & visual inference API</td>
            <td>USA</td>
            <td>Enterprise Zero-Retention DPA, SCCs</td>
          </tr>
          <tr>
            <td><strong>Google Cloud / GSC</strong></td>
            <td>OAuth authentication & Search Console API</td>
            <td>USA / EU</td>
            <td>ISO 27001, EU-US DPF / SCCs</td>
          </tr>
          <tr>
            <td><strong>Usercentrics A/S (Cookiebot)</strong></td>
            <td>Consent Management Platform (CMP)</td>
            <td>Denmark / EU</td>
            <td>GDPR Certified, EU Hosting</td>
          </tr>
          <tr>
            <td><strong>MongoDB Atlas / Cloud Host</strong></td>
            <td>Encrypted database & cluster hosting</td>
            <td>EU / USA</td>
            <td>SOC 2 Type II, AES-256, SCCs</td>
          </tr>
          <tr>
            <td><strong>Meta / LinkedIn / X / TikTok</strong></td>
            <td>Social media publishing APIs</td>
            <td>USA / Global</td>
            <td>Developer DPAs & Standard OAuth</td>
          </tr>
        </tbody>
      </table>

      <h2>6. International Data Transfers</h2>
      <p>Where personal data is transferred outside the European Economic Area (EEA) or UK, we ensure appropriate safeguards are implemented in compliance with GDPR Chapter V, including European Commission Standard Contractual Clauses (SCCs), UK International Data Transfer Addendums, and certified participation in the EU-U.S. Data Privacy Framework.</p>

      <h2>7. Security & Cryptographic Safeguards</h2>
      <p>Moyi-CMO implements robust technical and organizational security controls:</p>
      <ul>
        <li><strong>Encryption in Transit:</strong> Mandatory TLS 1.3 encryption for all web and API traffic with strict HTTP Strict Transport Security (HSTS).</li>
        <li><strong>Encryption at Rest:</strong> Sensitive integration tokens and secrets are stored in encrypted vaults using AES-256.</li>
        <li><strong>Application Security:</strong> Signed HTTPOnly authentication cookies, CSRF nonces on all state-changing requests, automated rate-limiting, and hardened Content Security Policy (CSP) headers.</li>
        <li><strong>Audit Logging:</strong> Comprehensive immutable audit logs for authentication, role modifications, data exports, and deletions.</li>
      </ul>

      <h2>8. Data Retention & Erasure Schedules</h2>
      <ul>
        <li><strong>Active Workspaces:</strong> Data is retained for the active lifecycle of your account.</li>
        <li><strong>Account Deletion:</strong> Upon initiating account deletion (/account/delete), all project data, scans, content drafts, and OAuth credentials are immediately hard-deleted from active databases, and purged from rolling backups within 30 days.</li>
        <li><strong>Statutory Retention:</strong> Transactional billing records and audit logs are retained for statutory accounting and tax compliance periods (typically up to 7 years).</li>
      </ul>

      <h2>9. Your Data Subject Rights (GDPR & CCPA/CPRA)</h2>
      <p>Under GDPR (Articles 15–22) and applicable privacy laws, you possess fundamental rights regarding your personal data:</p>
      <ul>
        <li><strong>Right of Access & Portability (Art. 15 & 20):</strong> Instantly export your complete workspace and account data in machine-readable JSON format via <a href="/account/export">Account Export</a>.</li>
        <li><strong>Right to Rectification (Art. 16):</strong> Update your personal details and business calibrations directly inside Account and Project Settings.</li>
        <li><strong>Right to Erasure / "Right to be Forgotten" (Art. 17):</strong> Permanently delete your entire account and all project databases via <a href="/account">Account Deletion</a>.</li>
        <li><strong>Right to Restriction & Objection (Art. 18 & 21):</strong> Object to processing based on legitimate interests or request restricted handling.</li>
        <li><strong>Right to Withdraw Consent (Art. 7(3)):</strong> Revoke cookie consent at any time via the Cookiebot widget or disconnect third-party integrations with one click.</li>
        <li><strong>Right to Lodge a Complaint:</strong> You have the right to lodge a complaint with your national Data Protection Authority (e.g., DPC in Ireland, CNIL in France, ICO in the UK, or BfDI in Germany).</li>
      </ul>

      <h2>10. Children's Privacy</h2>
      <p>Moyi-CMO is an enterprise B2B software platform and is not intended for use by individuals under 18 years of age. We do not knowingly collect personal data from children.</p>

      <h2>11. Contact & Privacy Inquiries</h2>
      <p>To exercise your privacy rights, request a formal Data Processing Agreement (DPA), or speak with our Data Protection Lead, submit a request via our <a href="/contact">Contact Page</a> (select "Privacy request") or email <code>customersupport@moyi-cmo.com</code>.</p>
    `
  });
});

router.get('/data-deletion', (req, res) => {
  res.render('legal', {
    title: 'Data Deletion',
    heading: 'Data Deletion Instructions',
    body: `
      <p>In accordance with GDPR Article 17, CCPA/CPRA, and Meta/Google platform policies, Moyi-CMO provides automated, self-service data deletion tools for all users and connected integrations.</p>
      
      <h2>1. Self-Service Account & Data Deletion</h2>
      <p>You can permanently delete your entire account and all associated workspace data at any time without waiting for support intervention:</p>
      <ol>
        <li>Sign in to your Moyi-CMO account.</li>
        <li>Navigate to <strong>Account Settings</strong> (or visit <code>/account</code>).</li>
        <li>Scroll down to the <strong>Danger Zone</strong>.</li>
        <li>Confirm your email address and type <code>DELETE</code> to initiate permanent erasure.</li>
      </ol>
      <p>Upon confirmation, your user profile, projects, website scans, recommendations, AI drafts, uploaded images, and connected OAuth credentials are permanently purged from active databases.</p>

      <h2>2. Disconnecting Specific Social Integrations</h2>
      <p>If you wish to remove connected social accounts (Meta Facebook Pages, Instagram accounts, LinkedIn, X, TikTok, Bluesky, YouTube) without deleting your Moyi account:</p>
      <ol>
        <li>Go to your <strong>Project Workspace</strong> &rarr; <strong>Integrations / Social Accounts</strong>.</li>
        <li>Click <strong>Disconnect</strong> next to the desired account.</li>
        <li>Moyi immediately wipes the encrypted OAuth tokens and access secrets from the database.</li>
      </ol>

      <h2>3. Meta (Facebook / Instagram / Threads) Data Deletion Callback</h2>
      <p>If you remove Moyi-CMO permissions through your Facebook App Settings, Meta dispatches an automated data deletion request to our servers. We process these requests automatically, de-authorizing the account and clearing all associated platform tokens.</p>
      <p>To check the status of a Meta data deletion request or submit a manual deletion ticket, please use our <a href="/contact">Contact Page</a> selecting "Privacy request" and provide your connected Page or Account ID.</p>
    `
  });
});

router.get('/cookies', (req, res) => {
  res.render('legal', {
    title: 'Cookie Notice',
    heading: 'Cookie Notice & Consent Management',
    body: `
      <p>This Cookie Notice explains how Moyi-CMO ("Moyi," "we," "our," or "us") uses cookies and similar browser storage technologies to operate our platform, maintain security, remember user preferences, and analyze website engagement.</p>
      <p>We employ <strong>Cookiebot CMP</strong> (Usercentrics A/S) to guarantee complete compliance with the <strong>ePrivacy Directive</strong>, <strong>GDPR</strong>, and <strong>Google Consent Mode v2</strong>, ensuring non-essential cookies are blocked until you grant explicit consent.</p>

      <h2>1. What Are Cookies?</h2>
      <p>Cookies are small text files placed on your device by websites you visit. They are widely used to make web applications work efficiently, preserve user sessions, secure form submissions, and provide telemetry reporting.</p>

      <h2>2. Categories of Cookies We Use</h2>
      
      <h3>A. Strictly Necessary Cookies (Essential)</h3>
      <p>These cookies are required for the core operation of the platform. They cannot be disabled, as the site cannot function securely without them. They do not store personally identifiable information outside of authenticated session identifiers.</p>
      <table>
        <thead>
          <tr>
            <th>Cookie / Storage Name</th>
            <th>Provider</th>
            <th>Type / Duration</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>moyi_token</code></td>
            <td>Moyi-CMO</td>
            <td>HTTPOnly, Secure / 7 Days</td>
            <td>Maintains your authenticated, encrypted user session token across requests.</td>
          </tr>
          <tr>
            <td><code>csrf_token</code></td>
            <td>Moyi-CMO</td>
            <td>HTTPOnly, SameSite=Lax / Session</td>
            <td>Cryptographic token protecting forms against Cross-Site Request Forgery attacks.</td>
          </tr>
          <tr>
            <td><code>CookieConsent</code></td>
            <td>Cookiebot (Usercentrics)</td>
            <td>Persistent / 1 Year</td>
            <td>Stores your cookie consent state and preferences for this domain.</td>
          </tr>
        </tbody>
      </table>

      <h3>B. Functional & Payment Cookies</h3>
      <p>These cookies facilitate third-party security verification and checkout operations.</p>
      <table>
        <thead>
          <tr>
            <th>Cookie Name</th>
            <th>Provider</th>
            <th>Duration</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>__stripe_mid</code>, <code>__stripe_sid</code></td>
            <td>Stripe, Inc.</td>
            <td>1 Year / 30 Minutes</td>
            <td>Fraud prevention, security diagnostics, and checkout session management.</td>
          </tr>
        </tbody>
      </table>

      <h3>C. Analytics & Performance Cookies (Optional)</h3>
      <p>These cookies help us understand platform usage, traffic sources, and performance metrics so we can optimize workflows. They are loaded only with your consent.</p>
      <table>
        <thead>
          <tr>
            <th>Cookie / Storage Key</th>
            <th>Provider</th>
            <th>Duration</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>moyi_session_id</code></td>
            <td>Moyi Analytics (1st Party)</td>
            <td>LocalStorage / 30 Mins</td>
            <td>Anonymized session tracking for website engagement telemetry.</td>
          </tr>
          <tr>
            <td><code>moyi_tracker_sid</code></td>
            <td>Moyi Analytics (1st Party)</td>
            <td>LocalStorage / 1 Year</td>
            <td>Visitor attribution and conversion goal tracking for authorized websites.</td>
          </tr>
        </tbody>
      </table>

      <h2>3. Managing and Revoking Cookie Consent</h2>
      <p>You can change or withdraw your consent at any time directly through the Cookiebot preference center:</p>
      <p style="margin: 18px 0;">
        <button class="button button-secondary" type="button" onclick="if(window.Cookiebot){Cookiebot.renew();}else{alert('Cookie preference manager is loading. Please try again.');}">
          🍪 Change Cookie Preferences / Renew Consent
        </button>
      </p>
      <p>Alternatively, you can manage or block cookies through your browser settings (Chrome, Safari, Firefox, Edge). Please note that blocking essential cookies will prevent you from signing in or using the Moyi-CMO workspace.</p>

      <h2>4. Updates to This Notice</h2>
      <p>We may update this Cookie Notice periodically to reflect changes in our technology, integrations, or regulatory obligations. The latest version is always available on this page.</p>
    `
  });
});

module.exports = router;
