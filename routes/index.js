const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, validationResult } = require('express-validator');
const env = require('../config/env');
const Project = require('../models/Project');
const Scan = require('../models/Scan');
const Report = require('../models/Report');
const ContentDraft = require('../models/ContentDraft');
const AuditLog = require('../models/AuditLog');
const { requireAuth } = require('../middleware/auth');
const { clearAuthCookie } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { planFor } = require('../config/plans');
const { getCurrentUsage } = require('../services/usageService');
const { exportAccountData, deleteAccountData } = require('../services/accountDataService');
const { recordAuditEvent } = require('../services/auditLogService');
const { sendCustomerEmail, sendGoodbyeEmail, verifyEmailTransport } = require('../services/emailService');
const { DEFAULT_TEST_URL, fetchMetaOembed, missingMetaOembedKeys, normalizeOembedUrl } = require('../services/metaOembedService');
const { findAccessibleProjects } = require('../services/projectAccessService');
const { runPublicQuickScan } = require('../services/publicQuickScanService');
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
    seoDescription: 'Moyi-CMO turns website scans and Google Search Console evidence into SEO recommendations, AI CMO plans, content drafts, campaign calendars, and weekly growth reports.',
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

router.get('/sitemap.xml', (req, res) => {
  const urls = [
    sitemapUrl('/', '1.0', 'weekly'),
    sitemapUrl('/features', '0.9', 'monthly'),
    sitemapUrl('/how-it-works', '0.9', 'monthly'),
    sitemapUrl('/pricing', '0.9', 'monthly'),
    sitemapUrl('/docs', '0.8', 'monthly'),
    sitemapUrl('/demo', '0.8', 'monthly'),
    sitemapUrl('/reports', '0.8', 'monthly'),
    sitemapUrl('/roadmap', '0.7', 'monthly'),
    sitemapUrl('/about', '0.7', 'monthly'),
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
    `Sitemap: ${publicBaseUrl()}/sitemap.xml`,
    `Llms: ${publicBaseUrl()}/llms.txt`
  ].join('\n'));
});

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
    `- Features: ${publicBaseUrl()}/features`,
    `- How it works: ${publicBaseUrl()}/how-it-works`,
    `- Documentation: ${publicBaseUrl()}/docs`,
    `- Reports guide: ${publicBaseUrl()}/reports`,
    `- Pricing: ${publicBaseUrl()}/pricing`,
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

Object.entries(publicPages).forEach(([slug, page]) => {
  router.get(`/${slug}`, (req, res) => {
    res.render('public/info', { title: page.title, seoDescription: page.intro, page });
  });
});

function contactView(overrides = {}) {
  return {
    title: 'Contact Moyi',
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
  const projects = await findAccessibleProjects(req.user._id, { sort: { updatedAt: -1 }, limit: 6 });
  const allProjects = await findAccessibleProjects(req.user._id, { select: 'name', sort: { updatedAt: -1 } });
  const projectCount = allProjects.length;
  const projectIds = allProjects.map((project) => project._id);
  const recentScans = await Scan.find({ projectId: { $in: projectIds } }).sort({ createdAt: -1 }).limit(8);
  const recentReports = await Report.find({ projectId: { $in: projectIds } }).sort({ createdAt: -1 }).limit(5);
  const scanProjectMap = new Map(allProjects.map((project) => [project._id.toString(), project]));
  const usage = await getCurrentUsage(req.user._id);
  const plan = planFor(req.user);

  res.render('dashboard', {
    title: 'Dashboard',
    projects,
    projectCount,
    recentScans,
    recentReports,
    scanProjectMap,
    usage,
    plan
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

router.get('/account', requireAuth, asyncHandler(async (req, res) => {
  const auditLogs = await AuditLog.find({ actorUserId: req.user._id }).sort({ createdAt: -1 }).limit(12).lean();
  res.render('account', {
    title: 'Account Settings',
    plan: planFor(req.user),
    auditLogs,
    accountMessage: req.query.message || '',
    accountError: req.query.error || ''
  });
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
    title: 'Terms',
    heading: 'Terms of Service',
    body: `
      <p>Welcome to Moyi-CMO ("Moyi," "we," "our," or "us"). These Terms of Service govern your access to and use of the Moyi-CMO website, application, AI marketing workspace, reports, recommendations, content generation tools, integrations, and related services (the "Service"). By creating an account, connecting a project, or using the Service, you agree to these Terms.</p>
      <p>If you use Moyi-CMO on behalf of a company, agency, or client, you confirm that you have authority to accept these Terms for that organization and to connect the websites, integrations, and data sources you add to the platform.</p>
      
      <h2>1. Description of Service</h2>
      <p>Moyi-CMO is an AI Chief Marketing Officer workspace for evidence-led SEO growth and content operations. The Service helps businesses audit websites, identify technical and content opportunities, generate AI CMO plans, create draft content, prepare campaign assets, track first-party performance signals, and organize marketing work across projects.</p>
      <p>Moyi-CMO is designed to support human decision-making. It does not replace professional judgment, legal advice, financial advice, compliance review, or final editorial approval.</p>
      
      <h2>2. Accounts and Subscriptions</h2>
      <p>To access most features, you must create an account and verify your email address. You are responsible for maintaining the confidentiality of your credentials, protecting access to your email account, and all activity that occurs under your account.</p>
      <p>Paid subscriptions are processed by Stripe. Plan limits, prices, billing intervals, usage allowances, and available features are shown on the pricing and billing pages. You can manage payment methods, invoices, renewals, and cancellations through the Stripe Customer Portal when available.</p>
      <p>Unless stated otherwise, subscription fees are billed in advance and are non-refundable except where required by law or where we expressly approve a refund. If payment fails, access to paid features may be limited, suspended, or downgraded until billing is resolved.</p>
      
      <h2>3. Acceptable Use</h2>
      <p>You agree to use Moyi-CMO lawfully and responsibly. You must not use the Service to scan, crawl, or analyze websites unless you own them, manage them, or have permission from the owner. You must not use the Service to send spam, mislead users, impersonate others, generate unlawful content, infringe intellectual property, bypass rate limits, attack infrastructure, or attempt to access accounts, projects, data, or systems without authorization.</p>
      <p>You are responsible for ensuring that any marketing content, claims, offers, pricing, regulated statements, images, campaigns, and tracking configurations you publish or deploy comply with applicable laws, platform rules, advertising standards, privacy rules, and industry obligations.</p>
      
      <h2>4. Intellectual Property & Content Ownership</h2>
      <p>You retain ownership of your websites, brand assets, uploaded logos, uploaded images, project data, customer-provided content, and approved outputs that you create through the Service, subject to any rights held by third parties or your customers.</p>
      <p>Moyi-CMO retains ownership of the platform, software, design systems, workflows, prompt templates, AI orchestration logic, reports structure, codebase, documentation, and underlying technology. You may not copy, resell, reverse engineer, or reproduce the Service except as allowed by law or by written permission.</p>
      <p>You grant Moyi-CMO a limited license to process your project data, uploads, website scan data, integration data, and generated content as needed to operate, secure, improve, and provide the Service to you.</p>

      <h2>5. AI Outputs and Human Review</h2>
      <p>Moyi-CMO uses AI to assist with SEO analysis, content drafting, campaign planning, recommendations, and image generation. AI outputs may contain errors, omissions, outdated assumptions, formatting issues, or content that requires review. You must review and approve all outputs before publishing, sending, exporting, or relying on them.</p>
      <p>Moyi-CMO aims to ground recommendations in observed scan data, project data, Search Console data where connected, and user-provided information. However, AI-generated suggestions are not guarantees of search ranking, revenue, traffic, conversion lift, legal compliance, or business performance.</p>

      <h2>6. Integrations and Third-Party Services</h2>
      <p>The Service may connect with Google Search Console, Stripe, WordPress, Webflow, Shopify, email providers, OpenAI, storage providers, and other third-party services. Your use of those services is governed by their own terms, policies, pricing, permissions, and availability.</p>
      <p>When you connect an integration, you authorize Moyi-CMO to access, store, encrypt, refresh, and use the credentials or tokens needed to provide the requested feature. You can revoke third-party access from the third-party provider or from Moyi-CMO where supported.</p>

      <h2>7. Publishing, Webhooks, and Manual Control</h2>
      <p>Moyi-CMO is built around human approval. Drafts, recommendations, images, social posts, and campaign assets should be reviewed before use. Connected CMS exports are intended to create drafts or unpublished content unless a workflow clearly states otherwise.</p>
      <p>If you configure outgoing webhooks, you are responsible for the receiving endpoint, signature verification, endpoint security, and anything your system does with the payload after receiving it.</p>

      <h2>8. Availability and Changes</h2>
      <p>We work to keep Moyi-CMO reliable, but the Service may be unavailable because of maintenance, upgrades, infrastructure issues, third-party outages, network problems, or security events. We may change, improve, suspend, or discontinue features when needed to protect the Service, comply with law, or improve the product.</p>

      <h2>9. Termination</h2>
      <p>You may stop using Moyi-CMO or request account deletion at any time. We may suspend or terminate access if you violate these Terms, misuse the Service, create risk for other users, fail to pay required fees, or use the platform in a way that could harm Moyi-CMO, our customers, or third parties.</p>
      
      <h2>10. Disclaimers and Limitation of Liability</h2>
      <p>The Service is provided "as is" and "as available." To the fullest extent allowed by law, we disclaim warranties of merchantability, fitness for a particular purpose, non-infringement, uninterrupted operation, and error-free results.</p>
      <p>We do not guarantee specific rankings, revenue, traffic, conversions, customer acquisition, ad performance, deliverability, or business outcomes. To the fullest extent allowed by law, Moyi-CMO will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, lost data, or business interruption.</p>

      <h2>11. Contact</h2>
      <p>Questions about these Terms can be sent through the contact page. For account, billing, privacy, or security concerns, include the email address associated with your Moyi-CMO account so we can investigate safely.</p>
    `
  });
});

router.get('/privacy', (req, res) => {
  res.render('legal', {
    title: 'Privacy',
    heading: 'Privacy Policy',
    body: `
      <p>At Moyi-CMO, privacy and trust are core parts of the product. This Privacy Policy explains what information we collect, how we use it, how we protect it, and what choices you have when using the Moyi-CMO website, application, AI marketing workspace, tracking tools, integrations, and related services.</p>
      <p>Moyi-CMO is built for business users who need honest, evidence-led marketing workflows. We do not sell personal information, and we do not use your private business data to train external AI models without permission.</p>
      
      <h2>1. Information We Collect</h2>
      <ul>
        <li><strong>Account data:</strong> name, email address, password hash, email verification status, login method, role, subscription plan, billing state, account settings, and security/audit events.</li>
        <li><strong>Project data:</strong> business name, website URL, industry, target audience, country, goals, brand tone, value proposition, competitors, uploaded logos, brand profile, project notes, and team access settings.</li>
        <li><strong>Website scan data:</strong> crawled URLs, page titles, headings, meta descriptions, status codes, internal links, structured data signals, page issues, recommendations, scan history, and report outputs.</li>
        <li><strong>Content and campaign data:</strong> recommendations, briefs, AI-generated drafts, edited body copy, metadata, keywords, campaign posts, calendar entries, image prompts, uploaded images, generated image candidates, approval notes, and publishing history.</li>
        <li><strong>Integration data:</strong> encrypted OAuth tokens, API tokens, CMS configuration, Search Console property identifiers, webhook URLs, signing secrets, and integration status. Sensitive credentials are stored encrypted where supported by the application.</li>
        <li><strong>First-party analytics data:</strong> when the tracking script is installed, we may collect page views, referrers, UTM parameters, device/browser details, session identifiers, conversion events, and configured goal data. IP addresses are processed using salted cryptographic hashing where supported by the tracker.</li>
        <li><strong>Billing data:</strong> Stripe customer IDs, subscription IDs, plan names, renewal dates, billing status, invoice/payment events, and usage limits. Full card details are handled by Stripe and are not stored by Moyi-CMO.</li>
        <li><strong>Support and communication data:</strong> messages sent through contact forms, support requests, admin emails, newsletter preferences, password reset requests, verification PIN events, and customer communication history.</li>
        <li><strong>Technical data:</strong> IP-derived security logs, browser information, device information, timestamps, error logs, request metadata, and operational diagnostics needed to protect and maintain the Service.</li>
      </ul>
      
      <h2>2. How We Use Information</h2>
      <p>We use information to create and secure your account, verify your email, provide project workspaces, run website scans, generate AI CMO plans, produce recommendations, create draft content and images, show campaign calendars, manage approvals, connect integrations, process billing, send transactional emails, provide support, monitor performance, prevent abuse, and improve the reliability and quality of the Service.</p>
      <p>We may also use aggregated or de-identified information to understand product usage, improve workflows, detect system issues, and make better product decisions. Aggregated information does not identify a specific customer or end user.</p>
      
      <h2>3. Data Protection and AI Providers</h2>
      <p>When generating reports, recommendations, content drafts, social posts, campaign plans, or images, Moyi-CMO may send relevant project context, scan evidence, content briefs, user instructions, uploaded reference details, and brand information to AI providers such as OpenAI. We send the information needed to perform the requested task and aim to avoid unnecessary personal data.</p>
      <p>AI outputs are stored in your workspace so you can review, edit, approve, download, export, or delete them according to available product controls. You should not enter sensitive personal data, confidential regulated data, payment card details, medical data, or government identifiers into prompts unless you have a lawful basis and understand the risks.</p>
      
      <h2>4. Third-Party Services</h2>
      <p>Moyi-CMO uses trusted third-party services to provide core functionality. These may include Stripe for payments and billing portals, Google for OAuth and Search Console access, OpenAI for AI generation, SMTP/email providers for transactional emails, Redis for background queues, MongoDB for data storage, hosting providers for infrastructure, and optional CMS providers such as WordPress, Webflow, or Shopify when connected by the user.</p>
      <p>When you connect a third-party integration, that provider may process information according to its own privacy policy and terms. You can revoke access from the third-party provider or remove the integration in Moyi-CMO where supported.</p>

      <h2>5. Cookies and Tracking</h2>
      <p>We use essential cookies and similar technologies to keep users signed in, protect forms against CSRF attacks, remember secure sessions, and operate the application. If you install the Moyi-CMO tracking script on your website, you are responsible for telling your visitors about that tracking and obtaining consent where required by law.</p>
      <p>More detail is available in our Cookie Notice.</p>

      <h2>6. Security</h2>
      <p>We use technical and organizational controls designed to protect information, including password hashing, signed authentication cookies, CSRF protection, encrypted integration credentials, audit logs, production configuration checks, secure headers, and access controls. No system can be guaranteed perfectly secure, but we work to reduce risk and respond responsibly to security issues.</p>

      <h2>7. Data Retention</h2>
      <p>We keep account, project, scan, recommendation, content, campaign, integration, billing, audit, and operational records for as long as needed to provide the Service, comply with legal obligations, resolve disputes, prevent abuse, and maintain business records. If you delete your account, active workspace data is removed or scheduled for removal, while limited audit, billing, security, and legal records may be retained where necessary.</p>

      <h2>8. Your Choices and Rights</h2>
      <p>You can update account information, manage projects, disconnect integrations, delete content, export account data where available, cancel subscriptions through Stripe, or request account deletion. Depending on your location, you may have rights to access, correct, delete, restrict, or object to certain processing of your personal information.</p>
      <p>To make a privacy request, use the contact page and include the email address connected to your Moyi-CMO account. We may need to verify your identity before acting on the request.</p>

      <h2>9. International Processing</h2>
      <p>Moyi-CMO and its service providers may process information in countries other than your own. Where required, we rely on appropriate safeguards for international transfers and work with providers that maintain privacy and security commitments suitable for SaaS operations.</p>

      <h2>10. Children's Privacy</h2>
      <p>Moyi-CMO is a business software product and is not intended for children. You must not create an account or use the Service if you are not old enough to enter into these terms under applicable law.</p>

      <h2>11. Changes to This Policy</h2>
      <p>We may update this Privacy Policy as the product, laws, integrations, or security practices change. The latest version will be posted on this page with an updated date. Material changes may also be communicated by email or in-app notice when appropriate.</p>

      <h2>12. Contact</h2>
      <p>For privacy, security, or data protection questions, contact us through the contact page and choose "Privacy request".</p>
    `
  });
});

router.get('/cookies', (req, res) => {
  res.render('legal', {
    title: 'Cookies',
    heading: 'Cookie Notice',
    body: `
      <p>This Cookie Notice explains how Moyi uses cookies and similar technologies to recognize you when you visit our platform. It explains what these technologies are and why we use them, as well as your rights to control our use of them.</p>
      
      <h2>1. What are cookies?</h2>
      <p>Cookies are small data files that are placed on your computer or mobile device when you visit a website. Cookies are widely used by website owners in order to make their websites work, or to work more efficiently, as well as to provide reporting information.</p>
      
      <h2>2. Cookies We Use</h2>
      <table>
        <thead>
          <tr>
            <th>Cookie Name</th>
            <th>Type</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>moyi_token</code></td>
            <td>Essential (HTTPOnly, SameSite=Lax)</td>
            <td>Maintains your authenticated secure user session. Preserved for 7 days.</td>
          </tr>
          <tr>
            <td><code>csrf_token</code></td>
            <td>Essential (HTTPOnly, SameSite=Lax)</td>
            <td>Protects our form submissions against Cross-Site Request Forgery (CSRF) attacks.</td>
          </tr>
          <tr>
            <td><code>moyi_session_id</code></td>
            <td>Analytics (LocalStorage)</td>
            <td>Used in the first-party analytics tracker to identify unique visitor sessions over time.</td>
          </tr>
          <tr>
            <td>Stripe Cookies</td>
            <td>Functional Third-Party</td>
            <td>Used securely by Stripe to coordinate billing, fraud prevention, and session portals.</td>
          </tr>
        </tbody>
      </table>
      
      <h2>3. Controlling Cookies</h2>
      <p>You have the right to decide whether to accept or reject cookies. You can set or amend your web browser controls to accept or refuse cookies. If you choose to reject cookies, you may still use our website though your access to some functionality and secure areas of our website may be restricted.</p>
    `
  });
});

module.exports = router;
