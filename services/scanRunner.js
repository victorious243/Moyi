const Project = require('../models/Project');
const Scan = require('../models/Scan');
const Page = require('../models/Page');
const Competitor = require('../models/Competitor');
const SeoIssue = require('../models/SeoIssue');
const User = require('../models/User');
const CompetitorPage = require('../models/CompetitorPage');
const { planFor } = require('../config/plans');
const { crawlWebsite } = require('./crawlerService');
const { auditPages } = require('./auditService');
const { discoverCompetitorsForProject } = require('./competitorDiscoveryService');
const { crawlCompetitor } = require('./competitorCrawlerService');
const { generateCompetitorInsights } = require('./competitorInsightService');
const { replaceScanRecommendations } = require('./scanRecommendationService');

function uniquePagesByUrl(pages) {
  const seenUrls = new Set();
  const uniquePages = [];

  pages.forEach((page) => {
    if (!page || !page.url || seenUrls.has(page.url)) return;
    seenUrls.add(page.url);
    uniquePages.push(page);
  });

  return uniquePages;
}

async function ensureCompetitorIntelligence({ project, userId, projectPages }) {
  await discoverCompetitorsForProject({ project, userId, projectPages });

  const competitors = await Competitor.find({ projectId: project._id, userId }).sort({ createdAt: -1 });
  for (const competitor of competitors) {
    const hasUsablePage = await CompetitorPage.exists({
      projectId: project._id,
      competitorId: competitor._id,
      statusCode: { $gte: 200, $lt: 400 },
      $or: [{ title: { $ne: '' } }, { wordCount: { $gt: 0 } }]
    });
    if (!hasUsablePage) {
      await crawlCompetitor({ projectId: project._id, competitor });
    }
  }

  const competitorPageCount = await CompetitorPage.countDocuments({ projectId: project._id });
  if (!competitorPageCount) return;

  await generateCompetitorInsights({ projectId: project._id, userId });
}

function activeScanStatus(scan) {
  return scan.status === 'pending' || scan.status === 'running';
}

class ScanCancelledError extends Error {
  constructor() {
    super('Scan was stopped by the user.');
    this.name = 'ScanCancelledError';
  }
}

async function throwIfCancelled(scan) {
  const latest = await Scan.findById(scan._id).select('status completedAt');
  if (!latest || latest.status === 'cancelled') {
    scan.status = 'cancelled';
    scan.completedAt = latest && latest.completedAt ? latest.completedAt : new Date();
    scan.currentStep = 'Stopped by user';
    scan.currentUrl = '';
    throw new ScanCancelledError();
  }
}

async function runScan(scanId) {
  const scan = await Scan.findById(scanId);
  if (!scan) return null;
  if (!activeScanStatus(scan)) return scan;

  const project = await Project.findById(scan.projectId);
  if (!project) {
    scan.status = 'failed';
    scan.errorMessage = 'Project not found.';
    scan.completedAt = new Date();
    await scan.save();
    return scan;
  }
  const owner = await User.findById(project.owner);
  const plan = planFor(owner);

  scan.status = 'running';
  scan.startedAt = new Date();
  scan.errorMessage = '';
  scan.currentStep = 'Preparing crawl';
  scan.currentUrl = '';
  await scan.save();

  try {
    await throwIfCancelled(scan);
    await Page.deleteMany({ scanId: scan._id });
    await SeoIssue.deleteMany({ scan: scan._id });
    let lastProgressSavedAt = 0;
    const result = await crawlWebsite(project.websiteUrl, {
      maxPages: plan.pagesPerScan,
      shouldStop: async () => {
        try {
          await throwIfCancelled(scan);
          return false;
        } catch (error) {
          if (error instanceof ScanCancelledError) return true;
          throw error;
        }
      },
      onPage: async ({ page, pages, pagesFound }) => {
        await throwIfCancelled(scan);

        scan.pagesScanned = pages.length;
        scan.pagesFound = pagesFound;
        scan.currentStep = 'Crawling pages';
        scan.currentUrl = page.url;

        const now = Date.now();
        if (pages.length === 1 || now - lastProgressSavedAt >= 1200) {
          lastProgressSavedAt = now;
          await scan.save();
        }
      }
    });
    await throwIfCancelled(scan);
    const crawledPages = uniquePagesByUrl(result.pages);
    const pages = crawledPages.map((page) => ({
      ...page,
      projectId: project._id,
      scanId: scan._id
    }));

    if (pages.length) {
      await Page.insertMany(pages, { ordered: false });
    }

    scan.pagesScanned = pages.length;
    scan.pagesFound = result.pagesFound;
    scan.currentStep = 'Auditing scanned pages';
    scan.currentUrl = '';
    await scan.save();
    await throwIfCancelled(scan);

    const issuePayloads = auditPages(crawledPages, result.siteSignals).map((issue) => ({
      ...issue,
      project: project._id,
      scan: scan._id
    }));

    if (issuePayloads.length) {
      await SeoIssue.insertMany(issuePayloads, { ordered: false });
    }

    scan.currentStep = 'Creating evidence-backed recommendations';
    await scan.save();
    await throwIfCancelled(scan);
    const [savedPages, savedIssues] = await Promise.all([
      Page.find({ projectId: project._id, scanId: scan._id }),
      SeoIssue.find({ project: project._id, scan: scan._id }).sort({ severity: 1, createdAt: -1 })
    ]);
    await replaceScanRecommendations({
      project,
      scanId: scan._id,
      pages: savedPages,
      issues: savedIssues
    });
    await throwIfCancelled(scan);

    try {
      scan.currentStep = 'Comparing competitors';
      await scan.save();
      await throwIfCancelled(scan);
      await ensureCompetitorIntelligence({
        project,
        userId: project.owner,
        projectPages: crawledPages
      });
    } catch (error) {
      console.warn(`Competitor intelligence skipped for project ${project._id}: ${error.message}`);
    }

    scan.status = 'completed';
    scan.completedAt = new Date();
    scan.currentStep = 'Completed';
    scan.currentUrl = '';
    await scan.save();

    return scan;
  } catch (error) {
    if (error instanceof ScanCancelledError) {
      scan.status = 'cancelled';
      scan.completedAt = scan.completedAt || new Date();
      scan.currentStep = 'Stopped by user';
      scan.currentUrl = '';
      scan.pagesScanned = await Page.countDocuments({ scanId: scan._id });
      await scan.save();
      return scan;
    }

    scan.status = 'failed';
    scan.errorMessage = error.message;
    scan.completedAt = new Date();
    scan.pagesScanned = await Page.countDocuments({ scanId: scan._id });
    scan.currentStep = 'Failed';
    scan.currentUrl = '';
    await scan.save();
    return scan;
  }
}

module.exports = {
  runScan
};
