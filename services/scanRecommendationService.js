const Recommendation = require('../models/Recommendation');
const { buildEvidenceRecommendations } = require('./aiReportService');

async function replaceScanRecommendations({
  project,
  scanId,
  pages,
  issues,
  RecommendationModel = Recommendation
}) {
  const recommendations = buildEvidenceRecommendations({ project, pages, issues });

  await RecommendationModel.deleteMany({
    projectId: project._id,
    auditId: scanId
  });

  if (!recommendations.length) return [];

  return RecommendationModel.insertMany(recommendations.map((recommendation) => ({
    ...recommendation,
    projectId: project._id,
    auditId: scanId
  })));
}

module.exports = {
  replaceScanRecommendations
};
