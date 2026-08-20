const MarketingGoal = require('../models/MarketingGoal');
const Project = require('../models/Project');
const { createAndDispatchNotification } = require('./notificationDeliveryService');

const DECREASE_METRICS = new Set(['cac', 'cpa']);
const REVENUE_METRICS = new Set(['revenue', 'marketing_attributed_revenue']);

function metricDirection(metric) {
  return DECREASE_METRICS.has(metric) ? 'decrease' : 'increase';
}

function periodDates(period = 'monthly', now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);
  if (period === 'weekly') {
    const day = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - day);
    start.setUTCHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 7);
  } else if (period === 'quarterly') {
    start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3, 1);
    start.setUTCHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setUTCMonth(end.getUTCMonth() + 3);
  } else if (period === 'annual') {
    start.setUTCMonth(0, 1);
    start.setUTCHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setUTCFullYear(end.getUTCFullYear() + 1);
  } else {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  end.setUTCMilliseconds(-1);
  return { start, end };
}

function roundMetric(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function evaluateGoalForecast(goal, now = new Date()) {
  const start = new Date(goal.periodStart);
  const end = new Date(goal.periodEnd);
  const target = Number(goal.targetValue || 0);
  const current = Number(goal.currentValue || 0);
  const direction = goal.direction || metricDirection(goal.metric);
  const duration = Math.max(1, end.getTime() - start.getTime());
  const elapsed = Math.max(0, Math.min(1, (now.getTime() - start.getTime()) / duration));
  const ended = now > end;
  const hasMeasurement = current > 0;
  const targetReached = hasMeasurement && (direction === 'decrease' ? current <= target : current >= target);
  const forecastValue = direction === 'increase'
    ? (elapsed > 0 ? current / elapsed : current)
    : current;
  const progressPercent = target > 0
    ? (direction === 'decrease' && current > 0 ? (target / current) * 100 : (current / target) * 100)
    : 0;
  const warningThreshold = Number(goal.warningThreshold || 85);
  let status = 'not_started';

  if (goal.status === 'paused') status = 'paused';
  else if (targetReached) status = 'achieved';
  else if (ended) status = 'missed';
  else if (!hasMeasurement) status = 'not_started';
  else if (direction === 'decrease') {
    if (forecastValue <= target * 0.95) status = 'ahead';
    else if (forecastValue <= target) status = 'on_track';
    else if (progressPercent < warningThreshold) status = 'at_risk';
    else status = 'on_track';
  } else if (forecastValue >= target * 1.05) status = 'ahead';
  else if (forecastValue >= target) status = 'on_track';
  else if ((forecastValue / Math.max(target, 1)) * 100 < warningThreshold) status = 'at_risk';
  else status = 'on_track';

  return {
    status,
    forecastValue: roundMetric(forecastValue),
    progressPercent: roundMetric(Math.max(0, progressPercent)),
    elapsedPercent: roundMetric(elapsed * 100),
    targetReached,
    ended
  };
}

function metricLabel(goal) {
  if (goal.metric === 'custom') return goal.customMetricName || 'Custom KPI';
  return String(goal.metric || 'KPI').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatGoalValue(goal, value) {
  const amount = roundMetric(Number(value || 0)).toLocaleString('en-US');
  if (goal.unit === '%') return `${amount}%`;
  if (goal.unit && /^[£$€]$/.test(goal.unit)) return `${goal.unit}${amount}`;
  return [amount, goal.unit].filter(Boolean).join(' ');
}

function goalRecommendation(goal, evaluation) {
  const gap = Math.max(0, Number(goal.targetValue || 0) - Number(evaluation.forecastValue || 0));
  const label = metricLabel(goal).toLowerCase();
  if (['qualified_leads', 'signups', 'conversion_rate'].includes(goal.metric)) {
    return `Review the highest-converting acquisition source, remove the weakest funnel step, and assign an owner to close the projected ${formatGoalValue(goal, gap)} ${label} gap.`;
  }
  if (['organic_traffic', 'paid_traffic'].includes(goal.metric)) {
    return 'Prioritize the pages and campaigns already showing demand, then pause low-yield work until the forecast returns to target.';
  }
  if (REVENUE_METRICS.has(goal.metric)) {
    return 'Focus the next campaign on the offer and audience producing the strongest qualified pipeline, and verify attribution before increasing spend.';
  }
  if (['cac', 'cpa', 'roas'].includes(goal.metric)) {
    return 'Reallocate spend toward efficient campaigns, review conversion quality, and correct tracking gaps before changing the target.';
  }
  return 'Review the strongest contributing channel, assign the next corrective action, and update this KPI after the action has had time to influence results.';
}

function goalAlertForTransition(goal, previousStatus, evaluation, now = new Date()) {
  if (evaluation.status === previousStatus) {
    if (!goal.lastForecastAlertAt || now.getTime() - new Date(goal.lastForecastAlertAt).getTime() < 7 * 24 * 60 * 60 * 1000) return '';
    if (evaluation.status === 'at_risk') return 'forecast_below_target';
    if (evaluation.status === 'ahead') return 'forecast_above_target';
    return '';
  }
  return {
    ahead: 'goal_ahead_of_plan',
    at_risk: 'goal_at_risk',
    achieved: 'goal_achieved',
    missed: 'goal_missed'
  }[evaluation.status] || '';
}

async function evaluateGoal(goal, { now = new Date(), notify = true } = {}) {
  const previousStatus = goal.status;
  const evaluation = evaluateGoalForecast(goal, now);
  goal.direction = goal.direction || metricDirection(goal.metric);
  goal.status = evaluation.status;
  goal.forecastValue = evaluation.forecastValue;
  goal.progressPercent = evaluation.progressPercent;
  goal.lastEvaluatedAt = now;
  await goal.save();

  const alertType = goalAlertForTransition(goal, previousStatus, evaluation, now);
  if (notify && alertType) {
    const project = await Project.findById(goal.projectId).populate('owner');
    if (project) {
      const severity = ['goal_missed'].includes(alertType) ? 'critical'
        : ['goal_at_risk', 'forecast_below_target'].includes(alertType) ? 'warning'
          : 'growth_opportunity';
      const summary = `${metricLabel(goal)} is projected to reach ${formatGoalValue(goal, evaluation.forecastValue)} against a ${goal.period} target of ${formatGoalValue(goal, goal.targetValue)}.`;
      await createAndDispatchNotification({
        project,
        type: alertType,
        category: REVENUE_METRICS.has(goal.metric) ? 'revenue' : 'goals',
        severity,
        urgency: severity === 'critical' ? 'immediate' : 'normal',
        confidence: evaluation.elapsedPercent < 20 ? 55 : 80,
        title: `${goal.name}: ${evaluation.status.replace(/_/g, ' ')}`,
        summary,
        businessImpact: evaluation.status === 'at_risk' || evaluation.status === 'missed'
          ? 'The current pace is unlikely to meet the agreed marketing outcome.'
          : 'Current performance is meeting or exceeding the agreed marketing outcome.',
        evidenceData: {
          metric: goal.metric,
          currentValue: goal.currentValue,
          targetValue: goal.targetValue,
          forecastValue: evaluation.forecastValue,
          progressPercent: evaluation.progressPercent,
          period: goal.period
        },
        recommendedAction: goalRecommendation(goal, evaluation),
        ctaUrl: `/projects/${project._id}/goals`,
        ctaLabel: 'Review Goals',
        dedupeKey: `goal:${goal._id}:${new Date(goal.periodEnd).toISOString().slice(0, 10)}:${alertType}`
      });
      goal.lastForecastAlertAt = now;
      goal.lastForecastAlertType = alertType;
      await goal.save();
    }
  }
  return evaluation;
}

async function evaluateProjectGoals(projectId, options = {}) {
  const goals = await MarketingGoal.find({
    projectId,
    status: { $ne: 'paused' },
    periodEnd: { $gte: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) }
  });
  return Promise.all(goals.map((goal) => evaluateGoal(goal, options)));
}

function buildGoalBriefingSummary(goals = []) {
  const active = goals.filter((goal) => goal.status !== 'paused');
  const atRisk = active.filter((goal) => ['at_risk', 'missed'].includes(goal.status));
  const winning = active.filter((goal) => ['ahead', 'achieved'].includes(goal.status));
  return {
    activeCount: active.length,
    onTrackCount: active.filter((goal) => ['on_track', 'ahead', 'achieved'].includes(goal.status)).length,
    atRiskCount: atRisk.length,
    biggestRisk: atRisk[0] || null,
    biggestOpportunity: winning[0] || active.find((goal) => goal.status === 'on_track') || null,
    needsDecision: atRisk[0] || null,
    nextAction: atRisk[0] ? goalRecommendation(atRisk[0], { forecastValue: atRisk[0].forecastValue }) : ''
  };
}

module.exports = {
  buildGoalBriefingSummary,
  evaluateGoal,
  evaluateGoalForecast,
  evaluateProjectGoals,
  formatGoalValue,
  goalAlertForTransition,
  goalRecommendation,
  metricDirection,
  metricLabel,
  periodDates
};
