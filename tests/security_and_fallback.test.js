const test = require('node:test');
const assert = require('node:assert/strict');
const csrfProtection = require('../middleware/csrf');
const { generateAiCmoPlan } = require('../services/aiReportService');

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
