const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildReportModel,
  generateScanPdfReport
} = require('../services/scanPdfReportService');

test('scan PDF report creates a detailed evidence-backed PDF buffer', () => {
  const project = {
    _id: 'project_1',
    name: 'Moyi-CMO',
    websiteUrl: 'https://moyi-cmo.com'
  };
  const scan = {
    _id: 'scan_1',
    status: 'completed',
    pagesScanned: 16,
    pagesFound: 19,
    startedAt: new Date('2026-08-01T10:00:00Z'),
    completedAt: new Date('2026-08-01T10:05:00Z')
  };
  const issues = [{
    severity: 'warning',
    type: 'missing_meta_description',
    title: 'Missing meta description',
    url: 'https://moyi-cmo.com',
    recommendation: 'Add a useful meta description.'
  }];
  const recommendations = [{
    priority: 3,
    title: 'Fix missing meta descriptions',
    reason: 'Observed on the scanned homepage.',
    expectedImpact: 'Improve search result clarity and click readiness.'
  }];
  const competitorInsights = [{
    priority: 1,
    title: 'Metadata gap',
    insight: 'Competitors explain the product purpose more clearly in search snippets.',
    opportunity: 'Write sharper metadata for public pages.'
  }];
  const pages = [{
    url: 'https://moyi-cmo.com',
    statusCode: 200,
    title: 'AI CMO platform',
    metaDescription: '',
    h1: ['Moyi-CMO turns evidence into action'],
    wordCount: 973,
    imagesMissingAlt: 2
  }];

  const model = buildReportModel({
    project,
    scan,
    issueSummary: {
      issueCount: 1,
      criticalCount: 0,
      warningCount: 1,
      opportunityCount: 0
    },
    issues,
    recommendations,
    competitorInsights,
    pages,
    failedPages: []
  });
  const result = generateScanPdfReport({
    project,
    scan,
    issueSummary: model.summary,
    issues,
    recommendations,
    competitorInsights,
    pages,
    failedPages: []
  });

  assert.equal(model.summary.pagesScanned, 16);
  assert.equal(model.topIssueTypes[0].type, 'missing meta description');
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.match(result.buffer.toString('latin1', 0, 8), /%PDF-1\.4/);
  assert.match(result.filename, /moyi-cmo-scan-1-scan-report\.pdf/);
  assert.ok(result.buffer.length > 1000);
});
