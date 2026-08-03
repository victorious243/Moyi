const test = require('node:test');
const assert = require('node:assert/strict');
const csrfProtection = require('../middleware/csrf');
const { generateAiCmoPlan, _private: aiReportPrivate } = require('../services/aiReportService');

test('CSRF Middleware: bypasses GET requests and sets cookie', () => {
  let cookieName = '';
  let cookieValue = '';
  const req = {
    method: 'GET',
    cookies: {},
    path: '/dashboard'
  };
  const res = {
    cookie(name, value) {
      cookieName = name;
      cookieValue = value;
    },
    locals: {}
  };
  let nextCalled = false;
  csrfProtection(req, res, () => {
    nextCalled = true;
  });

  assert.ok(nextCalled);
  assert.equal(cookieName, 'csrf_token');
  assert.ok(cookieValue);
  assert.equal(res.locals.csrfToken, cookieValue);
});

test('CSRF Middleware: blocks POST requests with missing token', () => {
  const req = {
    method: 'POST',
    cookies: { csrf_token: 'valid_token' },
    body: {},
    headers: {},
    path: '/projects'
  };
  const res = {
    cookie() {},
    locals: {}
  };
  let errorVal = null;
  csrfProtection(req, res, (err) => {
    errorVal = err;
  });

  assert.ok(errorVal);
  assert.equal(errorVal.status, 403);
  assert.equal(errorVal.message, 'Invalid or missing CSRF token.');
});

test('CSRF Middleware: permits POST requests with matching token', () => {
  const req = {
    method: 'POST',
    cookies: { csrf_token: 'valid_token' },
    body: { _csrf: 'valid_token' },
    headers: {},
    path: '/projects'
  };
  const res = {
    cookie() {},
    locals: {}
  };
  let nextCalled = false;
  csrfProtection(req, res, (err) => {
    if (!err) nextCalled = true;
  });

  assert.ok(nextCalled);
});

test('CSRF Middleware: permits signed upload token when CSRF cookie is missing', () => {
  let generatedToken = '';
  csrfProtection({
    method: 'GET',
    cookies: {},
    path: '/projects/123/edit'
  }, {
    cookie(name, value) {
      if (name === 'csrf_token') generatedToken = value;
    },
    locals: {}
  }, () => {});

  assert.match(generatedToken, /^[a-f0-9]{64}\.[a-f0-9]{64}$/);

  let restoredCookie = '';
  let nextCalled = false;
  csrfProtection({
    method: 'POST',
    cookies: {},
    query: { _csrf: generatedToken },
    body: undefined,
    headers: {},
    path: '/projects/123'
  }, {
    cookie(name, value) {
      if (name === 'csrf_token') restoredCookie = value;
    },
    locals: {}
  }, (err) => {
    if (!err) nextCalled = true;
  });

  assert.ok(nextCalled);
  assert.equal(restoredCookie, generatedToken);
});

test('CSRF Middleware: permits signed form token when browser cookie is stale', () => {
  let generatedToken = '';
  csrfProtection({
    method: 'GET',
    cookies: {},
    path: '/content/123'
  }, {
    cookie(name, value) {
      if (name === 'csrf_token') generatedToken = value;
    },
    locals: {}
  }, () => {});

  let restoredCookie = '';
  let nextCalled = false;
  csrfProtection({
    method: 'POST',
    cookies: { csrf_token: 'old_cookie_value' },
    query: { _csrf: generatedToken },
    body: {},
    headers: {},
    path: '/social-drafts/123/images/generate'
  }, {
    cookie(name, value) {
      if (name === 'csrf_token') restoredCookie = value;
    },
    locals: {}
  }, (err) => {
    if (!err) nextCalled = true;
  });

  assert.ok(nextCalled);
  assert.equal(restoredCookie, generatedToken);
});

test('CSRF Middleware: bypasses stripe webhook and tracking requests', () => {
  const req = {
    method: 'POST',
    cookies: {},
    body: {},
    headers: {},
    path: '/webhooks/stripe'
  };
  const res = {
    cookie() {},
    locals: {}
  };
  let nextCalled = false;
  csrfProtection(req, res, (err) => {
    if (!err) nextCalled = true;
  });

  assert.ok(nextCalled);
});

test('AI CMO Plan Fallback: generates report and recommendations when OpenAI key is missing', async () => {
  const project = {
    _id: '60c72b2f9b1d8b2e5c8b4567',
    name: 'Test Project',
    websiteUrl: 'https://test.example',
    industry: 'Technology',
    targetAudience: 'Software Developers',
    mainOffer: 'AI Code Assistant',
    brandTone: 'professional',
    competitors: []
  };
  const scan = {
    _id: '60c72b2f9b1d8b2e5c8b4568',
    status: 'completed',
    pagesFound: 1,
    pagesScanned: 1
  };
  const pages = [
    {
      _id: '60c72b2f9b1d8b2e5c8b4569',
      url: 'https://test.example',
      statusCode: 200,
      title: '',
      h1: []
    }
  ];
  const issues = [
    {
      _id: '60c72b2f9b1d8b2e5c8b4570',
      url: 'https://test.example',
      type: 'missing_title',
      severity: 'critical',
      title: 'Missing title tag',
      recommendation: 'Add a title.'
    }
  ];

  const env = require('../config/env');
  const oldKey = env.openaiApiKey;
  env.openaiApiKey = '';

  try {
    const result = await generateAiCmoPlan({ project, scan, pages, issues });
    assert.equal(result.model, 'rule-based-fallback');
    assert.ok(result.report.executiveSummary.includes('Test Project'));
    assert.equal(result.recommendations.length, 1);
    assert.equal(result.recommendations[0].title, 'Fix Missing title tag');
  } finally {
    env.openaiApiKey = oldKey;
  }
});

test('AI CMO recommendations only attach URLs backed by issue or crawl evidence', () => {
  const pages = [
    {
      _id: '60c72b2f9b1d8b2e5c8b4569',
      url: 'https://test.example',
      statusCode: 200,
      title: 'Home'
    }
  ];
  const issues = [
    {
      _id: '60c72b2f9b1d8b2e5c8b4570',
      url: 'https://test.example',
      type: 'missing_title',
      severity: 'critical',
      title: 'Missing title tag',
      recommendation: 'Add a title.'
    }
  ];

  const recommendations = aiReportPrivate.sanitizeRecommendations({
    recommendations: [
      {
        title: 'Rewrite the homepage title',
        category: 'Metadata',
        priority: 5,
        reason: 'The title is missing.',
        expectedImpact: 'Clearer search result appearance.',
        effort: 'low',
        actionType: 'fix_metadata',
        relatedIssueIds: ['60c72b2f9b1d8b2e5c8b4570'],
        targetUrls: ['https://not-in-the-crawl.example']
      }
    ]
  }, { pages, issues });

  assert.equal(recommendations.length, 1);
  assert.deepEqual(recommendations[0].targetUrls, ['https://test.example']);
  assert.deepEqual(recommendations[0].relatedIssueIds, ['60c72b2f9b1d8b2e5c8b4570']);
});

test('AI CMO recommendation fallback never returns zero when scan evidence exists', () => {
  const project = {
    name: 'Test Project',
    websiteUrl: 'https://test.example'
  };
  const pages = [
    { url: 'https://test.example' }
  ];
  const issues = [
    {
      _id: '60c72b2f9b1d8b2e5c8b4570',
      url: 'https://test.example',
      type: 'thin_content',
      severity: 'opportunity',
      title: 'Page has limited crawlable text',
      recommendation: 'Expand the page with useful information.'
    }
  ];

  const recommendations = aiReportPrivate.buildEvidenceRecommendations({ project, pages, issues });
  assert.ok(recommendations.length > 0);
  assert.equal(recommendations[0].title, 'Review Page has limited crawlable text');
  assert.deepEqual(recommendations[0].relatedIssueIds, ['60c72b2f9b1d8b2e5c8b4570']);
  assert.deepEqual(recommendations[0].targetUrls, ['https://test.example']);
});

test('AI CMO marks conditional indexing findings for review instead of claiming they are errors', () => {
  const recommendations = aiReportPrivate.buildEvidenceRecommendations({
    project: {
      name: 'Test Project',
      websiteUrl: 'https://test.example'
    },
    pages: [
      { url: 'https://test.example/login' }
    ],
    issues: [
      {
        _id: '60c72b2f9b1d8b2e5c8b4571',
        url: 'https://test.example/login',
        type: 'noindex',
        severity: 'critical',
        title: 'Page includes a noindex directive',
        evidence: 'robots meta contains noindex',
        recommendation: 'Remove noindex if this page should appear in search results.'
      }
    ]
  });

  assert.equal(recommendations[0].title, 'Review Page includes a noindex directive');
  assert.match(recommendations[0].reason, /if this page should appear in search results/);
});

test('AI CMO recommendation fallback does not invent work when no issues exist', () => {
  const recommendations = aiReportPrivate.buildEvidenceRecommendations({
    project: {
      name: 'Test Project',
      websiteUrl: 'https://test.example'
    },
    pages: [
      { url: 'https://test.example' }
    ],
    issues: []
  });

  assert.deepEqual(recommendations, []);
});
