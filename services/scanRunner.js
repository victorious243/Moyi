const Project = require('../models/Project');
const Scan = require('../models/Scan');
const Page = require('../models/Page');
const SeoIssue = require('../models/SeoIssue');
const User = require('../models/User');
const CompetitorPage = require('../models/CompetitorPage');
const { planFor } = require('../config/plans');
const { crawlWebsite } = require('./crawlerService');
const { auditPages } = require('./auditService');
const { discoverCompetitorsForProject } = require('./competitorDiscoveryService');
const { generateCompetitorInsights } = require('./competitorInsightService');

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

  const competitorPageCount = await CompetitorPage.countDocuments({ projectId: project._id });
  if (!competitorPageCount) return;

  await generateCompetitorInsights({ projectId: project._id, userId });
}

function activeScanStatus(scan) {
  return scan.status === 'pending' || scan.status === 'running';
}

async function runScan(scanId) {
  const scan = await Scan.findById(scanId);
  if (!scan) return null;

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
    await Page.deleteMany({ scanId: scan._id });
    await SeoIssue.deleteMany({ scan: scan._id });
    let lastProgressSavedAt = 0;
    const result = await crawlWebsite(project.websiteUrl, {
      maxPages: plan.pagesPerScan,
      onPage: async ({ page, pages, pagesFound }) => {
        if (!activeScanStatus(scan)) return;

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

    const issuePayloads = auditPages(crawledPages).map((issue) => ({
      ...issue,
      project: project._id,
      scan: scan._id
    }));

    if (issuePayloads.length) {
      await SeoIssue.insertMany(issuePayloads, { ordered: false });
    }

    try {
      scan.currentStep = 'Comparing competitors';
      await scan.save();
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
