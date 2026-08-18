const Project = require('../models/Project');
const Usage = require('../models/Usage');
const User = require('../models/User');
const env = require('../config/env');
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

function socialPostAllowance(plan, usage = {}) {
  return Number(plan.socialPostsPerMonth || 0) + Number(usage.extraSocialPostCredits || 0);
}

function socialPublishLimitError(plan, usage = {}, amount = 1, allowance = null) {
  const requested = Math.max(Number(amount || 0), 0);
  const totalAllowed = allowance == null ? socialPostAllowance(plan, usage) : Number(allowance || 0);
  const used = Number(usage.socialPostsUsed || 0);
  const remaining = Math.max(totalAllowed - used, 0);
  const error = limitError(
    `You've used ${used}/${totalAllowed} social posts this month. This publish would use ${requested}, but you only have ${remaining} left. Upgrade your plan or request extra credits.`,
    'starter'
  );
  error.code = 'social_posts_limit_reached';
  error.details = {
    used,
    allowance: totalAllowed,
    remaining,
    requested,
    extraCredits: Number(usage.extraSocialPostCredits || 0),
    plan: plan.key || String(plan.name || '').toLowerCase()
  };
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

async function resolveUsageUser(userOrId) {
  const userId = (userOrId && userOrId._id) ? userOrId._id : userOrId;
  if (!userId) return null;
  const user = await User.findById(userId).select('_id plan role subscriptionStatus');
  return user || userOrId;
}

async function ensureMonthlyCapacity(user, field, limit, amount, message, upgradePlan = 'starter') {
  const usage = await getCurrentUsage(user._id);
  const requested = Math.max(Number(amount || 0), 0);
  if ((usage[field] || 0) + requested > limit) {
    throw limitError(message, upgradePlan);
  }
  return usage;
}

async function ensureAiOperationAllowed(user) {
  const usage = await getCurrentUsage(user._id);
  const used = Number(usage.aiOperationsUsed || 0) + Number(usage.aiOperationFailures || 0);
  if (used >= env.maxAiOperationsPerMonth) {
    throw limitError(`Monthly AI operation safety limit reached. Contact support if this account needs a higher limit.`, 'pro');
  }
  return usage;
}

async function recordAiOperation(userId, amount = 1) {
  return incrementUsage(userId, 'aiOperationsUsed', amount);
}

async function recordAiOperationFailure(userId) {
  const usage = await incrementUsage(userId, 'aiOperationFailures', 1);
  usage.lastAiFailureAt = new Date();
  await usage.save();
  return usage;
}

async function ensureScanAllowed(user) {
  const plan = planFor(user);
  await ensureMonthlyLimit(user, 'scansUsed', plan.scansPerMonth, `${plan.name} plan allows ${plan.scansPerMonth} scan${plan.scansPerMonth === 1 ? '' : 's'} per month.`, 'starter');
  return plan;
}

async function ensureAiReportAllowed(user) {
  const plan = planFor(user);
  await ensureAiOperationAllowed(user);
  await ensureMonthlyLimit(user, 'aiReportsUsed', plan.aiReportsPerMonth, `${plan.name} plan AI report limit reached for this month.`, 'starter');
  return plan;
}

async function ensureContentDraftAllowed(user) {
  const plan = planFor(user);
  await ensureAiOperationAllowed(user);
  await ensureMonthlyLimit(user, 'contentDraftsUsed', plan.contentDraftsPerMonth, `${plan.name} plan content draft limit reached for this month.`, 'starter');
  return plan;
}

async function ensureImageGenerationAllowed(user) {
  const plan = planFor(user);
  await ensureAiOperationAllowed(user);
  await ensureMonthlyLimit(
    user,
    'imageGenerationsUsed',
    plan.imageGenerationsPerMonth,
    `${plan.name} plan image generation limit reached for this month.`,
    'starter'
  );
  return plan;
}

async function ensureSocialPublishAllowed(userOrId, amount = 1) {
  const user = await resolveUsageUser(userOrId);
  const plan = planFor(user);
  const usageUser = user || { _id: userOrId };
  const usage = await getCurrentUsage(usageUser._id);
  const allowance = socialPostAllowance(plan, usage);
  const requested = Math.max(Number(amount || 0), 0);
  if (Number(usage.socialPostsUsed || 0) + requested > allowance) {
    throw socialPublishLimitError(plan, usage, requested, allowance);
  }
  return plan;
}

async function reserveSocialPublishUsage(userOrId, amount = 1) {
  const user = await resolveUsageUser(userOrId);
  const usageUser = user || { _id: userOrId };
  const plan = planFor(user);
  const requested = Math.max(Number(amount || 0), 0);
  const { periodStart, periodEnd } = currentPeriod();
  const existingUsage = await getCurrentUsage(usageUser._id);
  const allowance = socialPostAllowance(plan, existingUsage);
  const usage = await Usage.findOneAndUpdate(
    {
      userId: usageUser._id,
      periodStart,
      periodEnd,
      $expr: {
        $lte: [
          { $add: [{ $ifNull: ['$socialPostsUsed', 0] }, requested] },
          allowance
        ]
      }
    },
    { $inc: { socialPostsUsed: requested } },
    { returnDocument: 'after' }
  );
  if (!usage) {
    throw socialPublishLimitError(plan, existingUsage, requested, allowance);
  }
  return usage;
}

async function addSocialPostCredits(userId, amount = 0) {
  const credits = Math.max(Math.floor(Number(amount || 0)), 0);
  if (!credits) return getCurrentUsage(userId);
  const usage = await getCurrentUsage(userId);
  usage.extraSocialPostCredits = Number(usage.extraSocialPostCredits || 0) + credits;
  await usage.save();
  return usage;
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
  addSocialPostCredits,
  budgetBoundaryStatus,
  ensureAiReportAllowed,
  ensureContentDraftAllowed,
  ensureImageGenerationAllowed,
  ensureFeature,
  ensureAiOperationAllowed,
  ensureProjectLimit,
  ensureScanAllowed,
  ensureSocialPublishAllowed,
  getCurrentUsage,
  incrementUsage,
  limitError,
  recordAiOperation,
  recordAiOperationFailure,
  reserveSocialPublishUsage,
  socialPostAllowance,
  socialPublishLimitError,
  upgradeRedirect
};
