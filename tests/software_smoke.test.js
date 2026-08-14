const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

test('application and production-critical services load', () => {
  const app = require('../app');
  const emailService = require('../services/emailService');
  const webhookService = require('../services/webhookService');
  const publishRetryService = require('../services/publishRetryService');
  const adminService = require('../services/adminDashboardService');
  const logger = require('../services/appLogger');
  const quickScanService = require('../services/publicQuickScanService');
  const contentImageService = require('../services/contentImageService');
  const emailVerificationService = require('../services/emailVerificationService');

  assert.ok(app);
  assert.equal(typeof emailService.sendCustomerEmail, 'function');
  assert.equal(typeof emailService.sendNewsletterEmail, 'function');
  assert.equal(typeof webhookService.retryWebhookDelivery, 'function');
  assert.equal(typeof publishRetryService.retryPublishAction, 'function');
  assert.equal(typeof adminService.buildAdminDashboard, 'function');
  assert.equal(typeof logger.recordAppLog, 'function');
  assert.equal(typeof quickScanService.runPublicQuickScan, 'function');
  assert.equal(typeof contentImageService.generateContentImage, 'function');
  assert.equal(typeof contentImageService.deleteContentImagesForProject, 'function');
  assert.equal(typeof emailVerificationService.requestEmailVerification, 'function');
  assert.equal(typeof emailVerificationService.verifyEmailPin, 'function');
});

test('login template shows invalid password feedback on the sign-in page', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/auth/login.ejs'),
    {
      appName: 'Moyi',
      title: 'Sign in',
      currentUser: null,
      errorMessage: 'Email or password is incorrect.'
    }
  );

  assert.match(html, /Sign-in issue/);
  assert.match(html, /Email or password is incorrect\./);
});

test('email verification template renders the PIN workflow', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/auth/verify-email.ejs'),
    {
      appName: 'Moyi',
      title: 'Verify email',
      currentUser: null,
      email: 'founder@example.com',
      errorMessage: '',
      successMessage: 'Your verification PIN has been sent.'
    }
  );

  assert.match(html, /Check your inbox/);
  assert.match(html, /founder@example\.com/);
  assert.match(html, /name="pin"/);
  assert.match(html, /Send a new PIN/);
});

test('workspace recovery routes are registered', () => {
  const indexRouter = require('../routes/index');
  const getPaths = indexRouter.stack
    .filter((layer) => layer.route && layer.route.methods.get)
    .map((layer) => layer.route.path);

  assert.ok(getPaths.includes('/workspace'));
  assert.ok(getPaths.includes('/show'));
  assert.ok(getPaths.includes('/features'));
  assert.ok(getPaths.includes('/how-it-works'));
  assert.ok(getPaths.includes('/docs'));
  assert.ok(getPaths.includes('/demo'));
  assert.ok(getPaths.includes('/reports'));
  assert.ok(getPaths.includes('/llms.txt'));
  assert.ok(getPaths.includes('/roadmap'));
  assert.ok(getPaths.includes('/about'));
  assert.ok(getPaths.includes('/contact'));
});

test('public documentation and contact pages render real destinations', async () => {
  const publicPages = require('../config/publicPages');
  const infoHtml = await ejs.renderFile(
    path.join(__dirname, '../views/public/info.ejs'),
    {
      appName: 'Moyi',
      title: publicPages.docs.title,
      currentUser: null,
      page: publicPages.docs
    }
  );
  const contactHtml = await ejs.renderFile(
    path.join(__dirname, '../views/public/contact.ejs'),
    {
      appName: 'Moyi',
      title: 'Contact Moyi',
      currentUser: null,
      contactSuccess: '',
      contactError: '',
      formData: {},
      supportEmail: 'support@example.com'
    }
  );

  assert.match(infoHtml, /Use Moyi from evidence to execution/);
  assert.match(infoHtml, /Gather website evidence/);
  assert.match(contactHtml, /action="\/contact" method="post"/);
  assert.match(contactHtml, /support@example\.com/);
});

test('footer product links use standalone routes for authenticated users', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/partials/footer.ejs'),
    { appName: 'Moyi', currentUser: { role: 'owner' } }
  );

  assert.match(html, /href="\/features"/);
  assert.match(html, /href="\/how-it-works"/);
  assert.doesNotMatch(html, /href="\/#features"/);
  assert.doesNotMatch(html, /href="\/#how-it-works"/);
});

test('shared header renders SEO, social, canonical, and schema metadata', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/partials/header.ejs'),
    {
      appName: 'Moyi-CMO',
      title: 'AI CMO Software for SEO Growth and Content Reports',
      currentUser: null,
      canonicalUrl: 'https://moyi-cmo.com',
      seoDescription: 'Moyi-CMO turns website scans and Google Search Console evidence into SEO recommendations, content drafts, campaign planning, and reports.',
      ogImageUrl: 'https://moyi-cmo.com/images/brand/moyi-mark-512.png',
      organizationSchema: {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Moyi-CMO',
        url: 'https://moyi-cmo.com'
      },
      softwareSchema: {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Moyi-CMO'
      }
    }
  );

  assert.match(html, /<meta name="description"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/moyi-cmo\.com"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /"@type":"Organization"/);
  assert.match(html, /"@type":"SoftwareApplication"/);
});

test('public quick scan scoring and snapshot helpers produce gated preview data', () => {
  const { pageSnapshot, publicScore, visibleIssues } = require('../services/publicQuickScanService');
  const page = {
    url: 'https://example.com',
    title: 'Example CRM for service businesses',
    metaDescription: 'A CRM built for service teams that need cleaner follow-up.',
    h1: ['Win more repeat customers'],
    headings: ['Built for local teams', 'Follow up faster'],
    schemaTypes: ['Organization'],
    wordCount: 420,
    imagesCount: 3,
    imagesMissingAlt: 1
  };
  const snapshot = pageSnapshot(page, 'https://example.com');
  assert.equal(snapshot.host, 'example.com');
  assert.equal(snapshot.h1, 'Win more repeat customers');
  assert.equal(publicScore({ criticalCount: 1, warningCount: 1, opportunityCount: 2 }) < 100, true);
  assert.equal(visibleIssues([
    { title: 'One' },
    { title: 'Two' },
    { title: 'Three' },
    { title: 'Four' }
  ]).length, 3);
});

test('scan detail template remains renderable during a rolling restart without recommendation locals', async () => {
  const template = path.join(__dirname, '../views/projects/scans/show.ejs');
  const locals = {
    appName: 'Moyi',
    title: 'Website Scan',
    project: { _id: 'project_1', name: 'Moyi' },
    scan: {
      _id: 'scan_1',
      status: 'completed',
      pagesScanned: 1,
      pagesFound: 1,
      currentStep: 'Completed',
      currentUrl: '',
      errorMessage: ''
    },
    failedPages: [],
    issueSummary: {
      criticalCount: 0,
      warningCount: 0,
      opportunityCount: 0,
      issueCount: 0
    },
    issues: [],
    competitors: [],
    competitorInsights: [],
    pages: []
  };
  const html = await ejs.renderFile(template, locals);

  assert.match(html, /Actions from this scan/);
  assert.match(html, /Download PDF Report/);
  assert.match(html, /did not produce a supported recommendation/);

  const findingHtml = await ejs.renderFile(template, {
    ...locals,
    issueSummary: {
      criticalCount: 0,
      warningCount: 1,
      opportunityCount: 0,
      issueCount: 1
    },
    issues: [{
      severity: 'warning',
      title: 'Missing meta description',
      url: 'https://moyi.example',
      recommendation: 'Add a useful meta description.'
    }]
  });

  assert.match(findingHtml, /Review Missing meta description/);
  assert.match(findingHtml, /Add a useful meta description/);
});

test('recommendation template removes rejected records from the active queue with older route data', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/projects/recommendations.ejs'),
    {
      appName: 'Moyi',
      title: 'Recommendations',
      project: { _id: 'project_1', name: 'Moyi' },
      recommendations: [{
        _id: 'recommendation_1',
        auditId: null,
        title: 'Rejected recommendation should be archived',
        priority: 3,
        status: 'rejected',
        expectedImpact: 'Test impact',
        effort: 'low',
        actionType: 'content',
        reason: 'Test reason',
        targetUrls: ['https://moyi.example'],
        assetOptions: []
      }]
    }
  );

  assert.doesNotMatch(html, /Rejected recommendation should be archived/);
  assert.match(html, /No active recommendations/);
  assert.match(html, /Rejected\s+<span>1<\/span>/);
});

test('non-article content draft renders the complete image review workspace', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/content/show.ejs'),
    {
      appName: 'Moyi',
      title: 'Article draft',
      currentUser: { role: 'owner' },
      project: { _id: 'project_1', name: 'Moyi' },
      draft: {
        _id: 'draft_1',
        type: 'service_page_section',
        title: 'Evidence-backed growth planning',
        keyword: 'growth planning',
        body: 'A grounded article body.',
        status: 'awaiting_review',
        executionContext: {},
        reviewNotes: ''
      },
      recommendation: null,
      draftStatusLabel: 'awaiting review',
      wordpressIntegration: null,
      webflowIntegration: null,
      shopifyIntegration: null,
      publishActions: [],
      postBodyHtml: '<p>A grounded article body shown in preview.</p>',
      contentImages: [{
        _id: 'image_1',
        source: 'generated',
        status: 'candidate',
        filename: 'moyi-article.jpg',
        altText: 'A marketing planning workspace',
        caption: '',
        guidance: 'Use a clear editorial composition.'
      }],
      imageError: '',
      imageSuccess: '',
      publishError: '',
      publishSuccess: '',
      webhookStatus: '',
      workspaceStep: 'visual'
    }
  );

  assert.match(html, /Generate with Moyi/);
  assert.match(html, /Upload your image/);
  assert.match(html, /Generate New Candidate/);
  assert.match(html, /Preview with Post/);
  assert.match(html, /post-preview-body"><p>A grounded article body shown in preview\.<\/p>/);
  assert.doesNotMatch(html, /Use a clear editorial composition\./);
  assert.match(html, /\/content\/draft_1\/images\/image_1\/select/);
  assert.match(html, /\/content\/draft_1\/images\/image_1\/file\?download=1/);
  assert.match(html, /\/content\/draft_1\/images\/image_1\/reject/);
  assert.match(html, /data-workflow-tab="write"/);
  assert.match(html, /data-workflow-panel="visual"/);
  assert.match(html, /Next: Choose Visual/);
  assert.match(html, /Approve and Continue/);
  assert.match(html, /Choose where it goes/);
});

test('content preview renders Markdown while escaping embedded HTML', () => {
  const { renderContentBody } = require('../services/contentPreviewService');
  const html = renderContentBody('## Useful heading\n\nA **clear** message.\n\n<script>alert("no")</script>');

  assert.match(html, /<h2>Useful heading<\/h2>/);
  assert.match(html, /<strong>clear<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('calendar renders the selected image with each linked social draft', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/projects/calendar.ejs'),
    {
      appName: 'Moyi',
      title: 'Calendar',
      currentUser: { role: 'owner' },
      project: { _id: 'project_1', name: 'Moyi' },
      campaigns: [],
      socialDrafts: [{
        _id: 'social_1',
        sourceContentDraftId: 'draft_1',
        contentImageId: 'image_1',
        channel: 'linkedin',
        status: 'draft',
        title: 'LinkedIn post',
        body: 'Useful post copy.',
        scheduledFor: new Date('2026-07-31T09:00:00Z')
      }],
      successMessage: ''
    }
  );

  assert.match(html, /\/content\/draft_1\/images\/image_1\/file/);
  assert.match(html, /Download Image/);
  assert.match(html, /Useful post copy\./);
});

test('calendar renders native image tools for standalone social drafts', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/projects/calendar.ejs'),
    {
      appName: 'Moyi',
      title: 'Calendar',
      currentUser: { role: 'owner' },
      project: { _id: 'project_1', name: 'Moyi' },
      campaigns: [],
      socialDrafts: [{
        _id: 'social_1',
        sourceContentDraftId: null,
        contentImageId: 'image_social_1',
        channel: 'instagram',
        status: 'draft',
        title: 'Standalone social post',
        body: 'Post copy with a visual.',
        scheduledFor: new Date('2026-08-10T09:00:00Z')
      }],
      socialDraftImagesByDraftId: {
        social_1: [{
          _id: 'image_social_1',
          draftId: 'social_1',
          status: 'selected',
          source: 'generated',
          altText: 'A clean product poster',
          caption: 'Launch visual'
        }]
      },
      successMessage: '',
      errorMessage: ''
    }
  );

  assert.match(html, /\/social-drafts\/social_1\/images\/image_social_1\/file/);
  assert.match(html, /Post copy with a visual\./);
  assert.match(html, /Generate Image/);
  assert.match(html, /Upload Image/);
});


test('content studio renders creation choices and generated work in one workspace', async () => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/projects/content.ejs'),
    {
      appName: 'Moyi',
      title: 'Content Studio',
      currentUser: { role: 'owner' },
      project: { _id: 'project_1', name: 'Moyi' },
      drafts: [{
        _id: 'draft_1',
        type: 'blog_article',
        title: 'A useful guide',
        body: 'Grounded content.',
        status: 'awaiting_review'
      }],
      socialDrafts: [{
        _id: 'social_1',
        channel: 'linkedin',
        title: 'Campaign post',
        status: 'draft',
        scheduledFor: new Date('2026-08-03T09:00:00Z')
      }],
      campaigns: [{ _id: 'campaign_1', name: 'Launch' }],
      job: null,
      pipelineDrafts: [],
      successMessage: '',
      errorMessage: '',
      today: '2026-08-03'
    }
  );

  assert.match(html, /Single post/);
  assert.match(html, /Weekly plan/);
  assert.match(html, /Monthly plan/);
  assert.match(html, /Find everything here/);
  assert.match(html, /A useful guide/);
  assert.match(html, /Campaign post/);
  assert.match(html, /\/projects\/project_1\/calendar/);
});

test('admin router exposes operator dashboard and critical actions', () => {
  const adminRouter = require('../routes/admin');
  const routes = adminRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).sort()
    }));

  assert.ok(routes.some((route) => route.path === '/' && route.methods.includes('get')));
  assert.ok(routes.some((route) => route.path === '/users/:id' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/users/:id/social-post-credits' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/publish-actions/:id/retry' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/webhook-deliveries/:id/retry' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/email/customer' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/email/newsletter' && route.methods.includes('post')));
});

test('social draft routes support calendar editing and removal', () => {
  const socialRouter = require('../routes/socialDrafts');
  const routes = socialRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

  assert.ok(routes.some((route) => route.path === '/:id/update' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/:id/delete' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/:id/images/upload' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/:id/images/generate' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/:id/images/:imageId/file' && route.methods.includes('get')));
  assert.ok(routes.some((route) => route.path === '/:id/images/:imageId/select' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/:id/media/upload' && route.methods.includes('post')));
  assert.ok(routes.some((route) => route.path === '/:id/media-status' && route.methods.includes('get')));
  assert.ok(routes.some((route) => route.path === '/:id/media/:assetId/file' && route.methods.includes('get')));
  assert.ok(routes.some((route) => route.path === '/:id/tiktok-creator-info' && route.methods.includes('get')));
});

test('platform admin middleware blocks non-admin users', () => {
  const { requirePlatformAdmin } = require('../middleware/platformAdmin');
  const req = { user: { role: 'owner' } };
  let error = null;
  requirePlatformAdmin(req, {}, (err) => {
    error = err || null;
  });

  assert.ok(error);
  assert.equal(error.statusCode, 403);
});
