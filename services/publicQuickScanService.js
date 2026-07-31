const { auditPages, summarizeIssues } = require('./auditService');
const { crawlWebsite } = require('./crawlerService');
const { normalizeUrl } = require('../utils/url');

const PUBLIC_SCAN_MAX_PAGES = 4;

function severityLabel(issues, severity) {
  return issues.filter((issue) => issue.severity === severity).length;
}

function visibleIssues(issues) {
  return issues.slice(0, 3).map((issue) => ({
    title: issue.title,
    severity: issue.severity,
    url: issue.url,
    recommendation: issue.recommendation
  }));
}

function hiddenOpportunityCount(issues) {
  return Math.max(issues.length - visibleIssues(issues).length, 0);
}

function pageSnapshot(page, fallbackUrl) {
  const target = page || {};
  let host = '';
  try {
    host = new URL(target.url || fallbackUrl).hostname.replace(/^www\./, '');
  } catch (error) {
    host = target.url || fallbackUrl;
  }

  return {
    host,
    url: target.url || fallbackUrl,
    title: target.title || host || 'Website snapshot',
    description: target.metaDescription || 'Moyi found the page and generated a partial public preview from visible website signals.',
    h1: (target.h1 || [])[0] || '',
    headings: (target.headings || []).slice(0, 4),
    schemaTypes: (target.schemaTypes || []).slice(0, 4),
    wordCount: target.wordCount || 0,
    imagesCount: target.imagesCount || 0,
    imagesMissingAlt: target.imagesMissingAlt || 0
  };
}

function publicScore(summary) {
  const starting = 100;
  const penalty = (summary.criticalCount * 16) + (summary.warningCount * 8) + (summary.opportunityCount * 4);
  return Math.max(35, Math.min(96, starting - penalty));
}

async function runPublicQuickScan(rawUrl) {
  const websiteUrl = normalizeUrl(rawUrl);
  const crawl = await crawlWebsite(websiteUrl, {
    maxPages: PUBLIC_SCAN_MAX_PAGES,
    delayMs: 0
  });
  const pages = crawl.pages || [];
  const issues = auditPages(pages);
  const summary = summarizeIssues(issues, pages);
  const homepage = pages[0] || null;

  return {
    scannedAt: new Date(),
    websiteUrl,
    pagesFound: crawl.pagesFound || pages.length,
    pagesScanned: pages.length,
    score: publicScore(summary),
    summary: {
      ...summary,
      criticalCount: severityLabel(issues, 'critical'),
      warningCount: severityLabel(issues, 'warning'),
      opportunityCount: severityLabel(issues, 'opportunity')
    },
    snapshot: pageSnapshot(homepage, websiteUrl),
    visibleIssues: visibleIssues(issues),
    hiddenOpportunityCount: hiddenOpportunityCount(issues),
    gatedInsights: [
      'Full prioritized 30-day SEO action plan',
      'AI-generated title and meta description drafts',
      'Content briefs matched to your business goal',
      'Search Console opportunity tracking after connection'
    ]
  };
}

module.exports = {
  PUBLIC_SCAN_MAX_PAGES,
  pageSnapshot,
  publicScore,
  runPublicQuickScan,
  visibleIssues
};
