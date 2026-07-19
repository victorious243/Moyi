const Project = require('../models/Project');
const Usage = require('../models/Usage');
const { planFor } = require('../config/plans');

function currentPeriod() {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

async function getCurrentUsage(userId) {
  const { periodStart, periodEnd } = currentPeriod();
  return Usage.findOneAndUpdate(
    { userId, periodStart, periodEnd },
    { $setOnInsert: { userId, periodStart, periodEnd } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function incrementUsage(userId, field, amount = 1) {
  const usage = await getCurrentUsage(userId);
  usage[field] = (usage[field] || 0) + amount;
  await usage.save();
  return usage;
}

function limitError(message, upgradePlan = 'starter') {
  const error = new Error(message);
  error.statusCode = 402;
  error.upgradePlan = upgradePlan;
  return error;
}

async function ensureProjectLimit(user) {
  const plan = planFor(user);
  const count = await Project.countDocuments({ owner: user._id });
  if (count >= plan.projectLimit) {
    throw limitError(`${plan.name} plan allows ${plan.projectLimit} project${plan.projectLimit === 1 ? '' : 's'}. Upgrade to add more projects.`);
  }
}

async function ensureMonthlyLimit(user, field, limit, message, upgradePlan = 'starter') {
  const usage = await getCurrentUsage(user._id);
  if ((usage[field] || 0) >= limit) {
    throw limitError(message, upgradePlan);
  }
  return usage;
}

async function ensureScanAllowed(user) {
  const plan = planFor(user);
  await ensureMonthlyLimit(user, 'scansUsed', plan.scansPerMonth, `${plan.name} plan allows ${plan.scansPerMonth} scan${plan.scansPerMonth === 1 ? '' : 's'} per month.`, 'starter');
  return plan;
}

async function ensureAiReportAllowed(user) {
  const plan = planFor(user);
  await ensureMonthlyLimit(user, 'aiReportsUsed', plan.aiReportsPerMonth, `${plan.name} plan AI report limit reached for this month.`, 'starter');
  return plan;
}

async function ensureContentDraftAllowed(user) {
  const plan = planFor(user);
  await ensureMonthlyLimit(user, 'contentDraftsUsed', plan.contentDraftsPerMonth, `${plan.name} plan content draft limit reached for this month.`, 'starter');
  return plan;
}

function ensureFeature(user, feature, message, upgradePlan = 'pro') {
  const plan = planFor(user);
  if (!plan[feature]) {
    throw limitError(message || `${plan.name} plan does not include this feature.`, upgradePlan);
  }
  return plan;
}

function upgradeRedirect(projectId, message) {
  const target = projectId ? `/projects/${projectId}` : '/dashboard';
  return `${target}?limitMessage=${encodeURIComponent(message)}`;
}

function budgetBoundaryStatus(campaign) {
  const dailyLimit = Number(campaign.dailySpendLimit || 0);
  const monthlyLimit = Number(campaign.monthlySpendLimit || 0);
  const dailySpend = Number(campaign.currentDailySpend || 0);
  const monthlySpend = Number(campaign.currentMonthlySpend || 0);
  const alerts = [];

  if (dailyLimit > 0 && dailySpend >= dailyLimit * 0.85) {
    alerts.push({
      level: dailySpend > dailyLimit ? 'blocked' : 'warning',
      message: `Daily spend is ${Math.round((dailySpend / dailyLimit) * 100)}% of the campaign limit.`
    });
  }

  if (monthlyLimit > 0 && monthlySpend >= monthlyLimit * 0.85) {
    alerts.push({
      level: monthlySpend > monthlyLimit ? 'blocked' : 'warning',
      message: `Monthly spend is ${Math.round((monthlySpend / monthlyLimit) * 100)}% of the campaign limit.`
    });
  }

  return {
    allowed: !alerts.some((alert) => alert.level === 'blocked'),
    alerts
  };
}

module.exports = {
  currentPeriod,
  budgetBoundaryStatus,
  ensureAiReportAllowed,
  ensureContentDraftAllowed,
  ensureFeature,
  ensureProjectLimit,
  ensureScanAllowed,
  getCurrentUsage,
  incrementUsage,
  limitError,
  upgradeRedirect
};
