const mongoose = require('mongoose');

const marketingGoalSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    metric: {
      type: String,
      enum: ['revenue', 'marketing_attributed_revenue', 'qualified_leads', 'signups', 'conversion_rate', 'organic_traffic', 'paid_traffic', 'cac', 'cpa', 'roas', 'followers', 'engagement', 'custom'],
      required: true,
      index: true
    },
    customMetricName: { type: String, trim: true, maxlength: 100, default: '' },
    direction: { type: String, enum: ['increase', 'decrease'], default: 'increase' },
    targetValue: { type: Number, required: true },
    currentValue: { type: Number, default: 0 },
    unit: { type: String, trim: true, maxlength: 24, default: '' },
    period: { type: String, enum: ['weekly', 'monthly', 'quarterly', 'annual', 'custom'], default: 'monthly' },
    periodStart: { type: Date, required: true, index: true },
    periodEnd: { type: Date, required: true, index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    status: {
      type: String,
      enum: ['not_started', 'on_track', 'ahead', 'at_risk', 'achieved', 'missed', 'paused'],
      default: 'not_started',
      index: true
    },
    dataSource: {
      type: String,
      enum: ['manual', 'search_console', 'tracking', 'social', 'ads', 'crm', 'custom'],
      default: 'manual'
    },
    warningThreshold: { type: Number, min: 1, max: 100, default: 85 },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    forecastValue: { type: Number, default: null },
    forecastLowerBound: { type: Number, default: null },
    forecastUpperBound: { type: Number, default: null },
    forecastConfidence: { type: Number, min: 0, max: 100, default: null },
    goalAchievementProbability: { type: Number, min: 0, max: 100, default: null },
    progressPercent: { type: Number, default: 0 },
    lastEvaluatedAt: { type: Date, default: null },
    lastForecastAlertAt: { type: Date, default: null },
    lastForecastAlertType: { type: String, default: '' },
    currentValueUpdatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

marketingGoalSchema.index({ projectId: 1, status: 1, periodEnd: 1 });

module.exports = mongoose.model('MarketingGoal', marketingGoalSchema);
