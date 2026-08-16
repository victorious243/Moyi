const Project = require('../models/Project');
const Scan = require('../models/Scan');
const Page = require('../models/Page');
const SeoIssue = require('../models/SeoIssue');
const Report = require('../models/Report');
const Recommendation = require('../models/Recommendation');
const ContentDraft = require('../models/ContentDraft');
const { normalizeUrl } = require('../utils/url');
const { enqueueScan } = require('../queues/scanQueue');
const { buildEvidenceRecommendations, generateAiCmoPlan } = require('./aiReportService');
const { generateCmoReport } = require('./cmoReportService');
const { generateDraftsForRecommendation } = require('./contentDraftService');
const {
  competitorSummary,
  persistDiscoveredCompetitors
} = require('./competitorDiscoveryService');
const { incrementUsage, recordAiOperation } = require('./usageService');
const { scanProjectForDiscovery } = require('./discoveryService');

function personaSummary(persona) {
  return [persona.name, persona.role].filter(Boolean).join(' - ');
}

async function notifyProgress(handler, update) {
  if (typeof handler !== 'function') return;
  await handler(update);
}

function createProjectWorkflowService(deps = {}) {
  const services = {
    Project,
    Scan,
    Page,
    SeoIssue,
    Report,
    Recommendation,
    ContentDraft,
    normalizeUrl,
    enqueueScan,
    buildEvidenceRecommendations,
    generateAiCmoPlan,
    generateCmoReport,
    generateDraftsForRecommendation,
    competitorSummary,
    persistDiscoveredCompetitors,
    incrementUsage,
    recordAiOperation,
    scanProjectForDiscovery,
    ...deps
  };

  async function bootstrapDiscoveryProject({
    userId,
    websiteUrl: rawWebsiteUrl,
    name = '',
    targetCountry = '',
    targetCity = '',
    businessModel = ''
  }) {
    const websiteUrl = services.normalizeUrl(rawWebsiteUrl);
    const discovery = await services.scanProjectForDiscovery(websiteUrl, {
      targetCountry,
      targetCity,
      businessModel
    });
    const brand = discovery.brandProfile || {};
    const approvedAudience = (brand.targetPersonas || []).map(personaSummary).filter(Boolean);
    const project = await services.Project.create({
      owner: userId,
      name: name || brand.brandName || new URL(websiteUrl).hostname,
      websiteUrl,
      industry: '',
      targetAudience: approvedAudience.join(', ') || (brand.personas || []).join(', '),
      targetCountry: brand.targetCountry || targetCountry,
      targetCity: brand.targetCity || targetCity,
      businessModel: brand.businessModel || businessModel || 'other',
      mainGoal: 'Convert discovered demand into qualified pipeline.',
      mainOffer: (brand.valueProps || [])[0] || '',
      brandTone: (brand.toneAdjectives || []).join(', '),
      status: 'draft',
      brand_profile: {
        ...brand,
        diagnostics: discovery.diagnostics
      },
      competitors: discovery.competitors.map(services.competitorSummary),
      competitorDiscovery: {
        ...discovery.diagnostics,
        completedAt: new Date()
      }
    });

    await services.persistDiscoveredCompetitors({
      project,
      userId,
      competitors: discovery.competitors
    });

    return { project, discovery };
  }

  async function startProjectScan({ projectId, userId }) {
    const scan = await services.Scan.create({ projectId, status: 'pending' });
    try {
      await services.enqueueScan(scan._id);
      await services.incrementUsage(userId, 'scansUsed', 1);
    } catch (error) {
      scan.status = 'failed';
      scan.errorMessage = error.message;
      scan.completedAt = new Date();
      scan.currentStep = 'Failed before scan start';
      await scan.save();
      throw error;
    }

    return scan;
  }

  async function generateStrategyPlan({ project, userId, recommendationLimit = Infinity, onProgress = null }) {
    await notifyProgress(onProgress, {
      currentStep: 'Finding the latest completed scan',
      progressPercent: 10
    });
    const scan = await services.Scan.findOne({ projectId: project._id, status: 'completed' }).sort({ completedAt: -1, createdAt: -1 });
    if (!scan) {
      const error = new Error('Run a completed website scan before generating an AI CMO plan.');
      error.statusCode = 422;
      throw error;
    }

    await notifyProgress(onProgress, {
      currentStep: 'Loading scanned pages and audit issues',
      progressPercent: 25
    });
    const [pages, issues] = await Promise.all([
      services.Page.find({ projectId: project._id, scanId: scan._id }).sort({ url: 1 }),
      services.SeoIssue.find({ project: project._id, scan: scan._id }).sort({ severity: 1, createdAt: -1 })
    ]);

    try {
      await notifyProgress(onProgress, {
        currentStep: 'Generating the AI CMO strategy and recommendations',
        progressPercent: 55
      });
      const result = await services.generateAiCmoPlan({
        project,
        scan,
        pages,
        issues
      });

      await notifyProgress(onProgress, {
        currentStep: 'Saving the strategy report',
        progressPercent: 78
      });
      const report = await services.Report.findOneAndUpdate(
        { projectId: project._id, auditId: scan._id },
        {
          ...result.report,
          projectId: project._id,
          auditId: scan._id,
          status: 'ready',
          sourceIssueIds: issues.map((issue) => issue._id),
          sourcePageUrls: pages.map((page) => page.url),
          model: result.model,
          errorMessage: ''
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );

      const generatedRecommendations = Array.isArray(result.recommendations)
        ? result.recommendations
        : [];
      const evidenceRecommendations = generatedRecommendations.length
        ? generatedRecommendations
        : services.buildEvidenceRecommendations({ project, pages, issues });
      const recommendations = evidenceRecommendations.slice(0, recommendationLimit);
      await notifyProgress(onProgress, {
        currentStep: 'Saving prioritized recommendations',
        progressPercent: 90
      });
      await services.Recommendation.deleteMany({ projectId: project._id, auditId: scan._id });
      if (recommendations.length) {
        await services.Recommendation.insertMany(recommendations.map((recommendation) => ({
          ...recommendation,
          projectId: project._id,
          auditId: scan._id
        })));
      }

      await services.incrementUsage(userId, 'aiReportsUsed', 1);
      await services.recordAiOperation(userId, 1);
      await notifyProgress(onProgress, {
        currentStep: 'AI CMO plan is ready',
        progressPercent: 100
      });
      return { report, recommendations, scan };
    } catch (error) {
      await services.Report.findOneAndUpdate(
        { projectId: project._id, auditId: scan._id },
        {
          projectId: project._id,
          auditId: scan._id,
          status: 'failed',
          errorMessage: error.message,
          model: error.code === 'missing_api_key' ? 'not-configured' : ''
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );

      throw error;
    }
  }

  async function createSearchConsoleOpportunityDraft({
    project,
    userId,
    opportunityType,
    query,
    pageUrl
  }) {
    const latestScan = await services.Scan.findOne({ projectId: project._id, status: 'completed' }).sort({ completedAt: -1, createdAt: -1 });
    if (!latestScan) {
      const error = new Error('Run a website scan before creating optimization drafts from Search Console opportunities.');
      error.statusCode = 422;
      throw error;
    }

    const isCtrOpportunity = opportunityType === 'boost_ctr';
    const page = services.normalizeUrl(pageUrl);
    const recommendation = await services.Recommendation.create({
      projectId: project._id,
      auditId: latestScan._id,
      title: isCtrOpportunity ? `Boost CTR for "${query}"` : `Push "${query}" toward page 1`,
      category: 'Search Console opportunity',
      priority: isCtrOpportunity ? 2 : 3,
      reason: isCtrOpportunity
        ? `Search Console shows "${query}" ranking on page 1 for ${page}, but CTR is below the project average.`
        : `Search Console shows "${query}" ranking on page 2 with meaningful impressions for ${page}.`,
      expectedImpact: isCtrOpportunity
        ? 'Better search result copy can capture more qualified clicks from existing rankings.'
        : 'More complete page content can improve relevance and help the query move toward page 1.',
      effort: isCtrOpportunity ? 'low' : 'medium',
      actionType: isCtrOpportunity ? 'fix_metadata' : 'content',
      targetUrls: [page],
      status: 'accepted'
    });

    const drafts = await services.generateDraftsForRecommendation({
      project,
      recommendation,
      requestedType: isCtrOpportunity ? 'meta_title' : 'content_brief',
      keyword: query
    });
    const created = drafts.length ? await services.ContentDraft.insertMany(drafts) : [];
    if (created.length) {
      await services.incrementUsage(userId, 'contentDraftsUsed', created.length);
      await services.recordAiOperation(userId, 1);
    }

    return {
      recommendation,
      drafts: created,
      firstDraft: created[0] || null
    };
  }

  async function syncSearchConsoleWindow({ project, userId, days, syncSearchConsoleProject, onProgress = null }) {
    await notifyProgress(onProgress, {
      currentStep: 'Checking the connected Search Console property',
      progressPercent: 12
    });
    const result = await syncSearchConsoleProject({
      project,
      userId,
      days,
      onProgress
    });
    await services.incrementUsage(userId, 'searchConsoleSyncsUsed', 1);
    await notifyProgress(onProgress, {
      currentStep: 'Search Console sync is ready',
      progressPercent: 100
    });
    return result;
  }

  async function generateMeasurementReport({ project, userId, type, onProgress = null }) {
    return services.generateCmoReport({ project, userId, type, onProgress });
  }

  return {
    bootstrapDiscoveryProject,
    createSearchConsoleOpportunityDraft,
    generateMeasurementReport,
    generateStrategyPlan,
    startProjectScan,
    syncSearchConsoleWindow
  };
}

module.exports = {
  ...createProjectWorkflowService(),
  createProjectWorkflowService
};
