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
const { planFor } = require('../config/plans');
const { getCurrentUsage } = require('../services/usageService');
const { exportAccountData, deleteAccountData } = require('../services/accountDataService');
const { recordAuditEvent } = require('../services/auditLogService');
const { sendCustomerEmail, sendGoodbyeEmail, smtpConfigured, verifyEmailTransport } = require('../services/emailService');
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
    title: 'AI CMO platform',
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
    `Sitemap: ${publicBaseUrl()}/sitemap.xml`
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
      title: 'AI CMO platform',
      quickScanResult: null,
      quickScanError: errors.array().map((error) => error.msg).join(', '),
      quickScanUrl: req.body.websiteUrl || ''
    });
  }

  try {
    const quickScanResult = await runPublicQuickScan(req.body.websiteUrl);
    res.render('index', {
      title: `${quickScanResult.snapshot.host} quick scan`,
      quickScanResult,
      quickScanError: '',
      quickScanUrl: quickScanResult.websiteUrl
    });
  } catch (error) {
    res.render('index', {
      title: 'AI CMO platform',
      quickScanResult: null,
      quickScanError: error.message,
      quickScanUrl: req.body.websiteUrl || ''
    });
  }
}));

Object.entries(publicPages).forEach(([slug, page]) => {
  router.get(`/${slug}`, (req, res) => {
    res.render('public/info', { title: page.title, page });
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
    emailConfigured: smtpConfigured(),
    emailTestTo: env.emailTestTo || req.user.email,
    accountMessage: req.query.message || '',
    accountError: req.query.error || ''
  });
}));

router.post('/account/test-email', requireAuth, asyncHandler(async (req, res) => {
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
      <p>Welcome to Moyi ("we," "our," "us"). By accessing or using our website, services, and AI CMO planning tools (collectively, the "Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.</p>
      
      <h2>1. Description of Service</h2>
      <p>Moyi provides an Express/Mongo/EJS software-as-a-service (SaaS) platform that performs website crawls, audits SEO factors, generates evidence-based marketing plans, content drafts, connects to Google Search Console/WordPress/Stripe, and tracks first-party user analytics.</p>
      
      <h2>2. Accounts and Subscriptions</h2>
      <p>To access certain features, you must register for an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. Subscriptions are billed through Stripe and governed by our pricing plans. You can manage or cancel your subscription at any time via the Stripe Customer Portal accessible in your Account Settings.</p>
      
      <h2>3. Acceptable Use</h2>
      <p>You agree not to use the Service for any unlawful or unauthorized purposes. You must not attempt to compromise the security of the Service, run automated scripts to scrape our application, or bypass any rate limits. The website crawler provided is intended to analyze domains you own or have explicit permission to audit.</p>
      
      <h2>4. Intellectual Property & Content Ownership</h2>
      <p>You retain all intellectual property rights to the websites you scan and the content drafts you edit and publish. Moyi owns all rights, titles, and interests in the underlying technology, AI templates, and codebase.</p>
      
      <h2>5. Disclaimers & Limitation of Liability</h2>
      <p>The Service, including the AI-generated CMO plans and recommendations, is provided "as is" without warranty of any kind. While we strive to provide factual, evidence-led marketing strategies, we do not guarantee specific search engine ranking improvements, traffic increases, or revenue results. We are not liable for any indirect, incidental, or consequential damages resulting from your use of the Service.</p>
    `
  });
});

router.get('/privacy', (req, res) => {
  res.render('legal', {
    title: 'Privacy',
    heading: 'Privacy Policy',
    body: `
      <p>At Moyi, we take your privacy seriously. This Privacy Policy describes how we collect, use, and protect your personal information when you use our Service or when our tracking script is embedded on your website.</p>
      
      <h2>1. Information We Collect</h2>
      <ul>
        <li><strong>Account Data:</strong> When you register, we collect your name, email address, password hash, and subscription details.</li>
        <li><strong>Project & Integration Data:</strong> We store details about your projects, including URLs, brand profiles, competitor sites, encrypted Google Search Console OAuth tokens, and WordPress credentials.</li>
        <li><strong>First-Party Analytics Data:</strong> When you embed our tracker on your website, we securely record visitor page views, referrers, UTM parameters, device/browser details, and conversion goals. IP addresses are processed securely using salted cryptographic hashes to protect user privacy.</li>
      </ul>
      
      <h2>2. How We Use Information</h2>
      <p>We use your information to operate and improve the Service, generate personalized marketing recommendations, export approved drafts to your CMS, track user-driven conversions for attribution metrics, and process billing via Stripe.</p>
      
      <h2>3. Data Protection and AI Providers</h2>
      <p>When generating SEO reports and content drafts, website audit issues and page context are analyzed using artificial intelligence. We share only contextually relevant, non-personally identifiable site data with OpenAI API endpoints under strict privacy terms. Your data is never sold or used for training external models without consent.</p>
      
      <h2>4. Cookies & Security</h2>
      <p>We use secure cookie tokens to manage session authentication (e.g. <code>moyi_token</code>) and protect forms against cross-site request forgery (<code>csrf_token</code>). We implement production security policies including Helmet content security policies (CSP) and CORS origin constraints to protect your data from unauthorized access.</p>
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
