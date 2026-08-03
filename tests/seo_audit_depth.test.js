const test = require('node:test');
const assert = require('node:assert/strict');

const { auditPages } = require('../services/auditService');
const { extractPage } = require('../services/crawlerService');
const { buildEvidenceRecommendations } = require('../services/aiReportService');

test('crawler extracts professional SEO, GEO, social, analytics, and performance signals', () => {
  const html = `
    <html>
      <head>
        <title>Short</title>
        <meta name="description" content="Too short">
        <meta property="og:title" content="Open graph title">
        <script src="https://www.googletagmanager.com/gtag/js?id=G-TEST123"></script>
      </head>
      <body>
        <h1>AI CMO platform</h1>
        <a href="https://linkedin.com/company/moyi">LinkedIn</a>
        <a href="https://x.com/moyi">X</a>
        <a href="/features" rel="nofollow">Features</a>
        <img src="/logo.png">
        <section style="color: red">Inline style</section>
      </body>
    </html>
  `;

  const page = extractPage(html, 'https://moyi-cmo.com', 200, '', {
    redirectCount: 2,
    httpVersion: '1.1'
  });

  assert.equal(page.lang, '');
  assert.equal(page.viewport, '');
  assert.equal(page.analyticsTools.includes('Google Analytics'), true);
  assert.equal(page.socialProfiles.linkedin, true);
  assert.equal(page.socialProfiles.x, true);
  assert.equal(page.inlineStyleCount, 1);
  assert.equal(page.nofollowLinksCount, 1);
  assert.equal(page.redirectCount, 2);
  assert.equal(page.httpVersion, '1.1');
  assert.equal(page.twitterCard.card, '');
});

test('audit detects competitor-level scan diagnostics from observable evidence', () => {
  const page = extractPage(`
    <html>
      <head>
        <title>Short</title>
        <meta name="description" content="Too short">
      </head>
      <body>
        <h1>AI CMO platform</h1>
        <h2>Website evidence</h2>
        <img src="/hero.png">
        <section style="color:red">Moyi turns website evidence into recommendations.</section>
      </body>
    </html>
  `, 'https://moyi-cmo.com', 200, '', {
    redirectCount: 2,
    httpVersion: '1.1'
  });

  const issues = auditPages([page], {
    robotsTxt: { exists: true, blocksMajorSearch: false, blocksAiCrawlers: false },
    sitemap: { exists: false, statusCode: 404 },
    llmsTxt: { exists: false, statusCode: 404 }
  });
  const issueTypes = new Set(issues.map((issue) => issue.type));

  [
    'title_length',
    'missing_canonical',
    'missing_schema',
    'missing_identity_schema',
    'missing_open_graph',
    'missing_x_cards',
    'analytics_not_detected',
    'inline_styles',
    'multiple_redirects',
    'outdated_http_protocol',
    'missing_xml_sitemap',
    'missing_llms_txt',
    'missing_image_alt',
    'missing_lang_attribute',
    'missing_viewport'
  ].forEach((type) => {
    assert.equal(issueTypes.has(type), true, `${type} should be detected`);
  });
});

test('new SEO diagnostics become actionable recommendations', () => {
  const project = { name: 'Moyi-CMO' };
  const page = {
    _id: 'page_1',
    url: 'https://moyi-cmo.com'
  };
  const issues = [{
    _id: 'issue_1',
    url: page.url,
    type: 'missing_llms_txt',
    severity: 'opportunity',
    title: 'llms.txt was not detected',
    evidence: { statusCode: 404 },
    recommendation: 'Add an llms.txt file for AI search systems.'
  }];

  const recommendations = buildEvidenceRecommendations({
    project,
    pages: [page],
    issues
  });

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].category, 'GEO');
  assert.equal(recommendations[0].actionType, 'technical');
});
