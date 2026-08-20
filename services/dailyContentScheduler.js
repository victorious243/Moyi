const Project = require('../models/Project');
const { executeDailyContentIntelligenceRun } = require('./dailyContentIntelligenceService');
const { getProjectLocalTime, isLocalDeliveryDue } = require('./dailyGrowthScheduler');

async function triggerDailyContentBatch({ now = new Date(), force = false } = {}) {
  const projects = await Project.find({ status: { $ne: 'archived' } });
  const results = [];
  for (const project of projects) {
    const config = project.cmoNotifications && project.cmoNotifications.dailyContentIntelligence || {};
    if (!force && config.enabled !== true) continue;
    const localTime = getProjectLocalTime(project.timezone || 'UTC', now);
    if (!force && !isLocalDeliveryDue(localTime, config.deliveryTime || '09:00')) continue;
    if (!force && config.lastGeneratedAt) {
      const lastLocal = getProjectLocalTime(project.timezone || 'UTC', new Date(config.lastGeneratedAt));
      if (lastLocal.dateString === localTime.dateString) continue;
    }
    try {
      const result = await executeDailyContentIntelligenceRun({ projectId: project._id, autoSaveDraft: true });
      project.cmoNotifications.dailyContentIntelligence.lastGeneratedAt = now;
      await project.save();
      results.push({ projectId: project._id, success: true, status: result.status });
    } catch (error) {
      results.push({ projectId: project._id, success: false, error: error.message });
    }
  }
  return results;
}

module.exports = { triggerDailyContentBatch };
