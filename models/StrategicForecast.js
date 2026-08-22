const mongoose = require('mongoose');

const strategicForecastSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  goalId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingGoal', default: null, index: true },
  metric: { type: String, required: true, index: true },
  horizon: { type: String, enum: ['end_of_week', 'end_of_month', 'goal_period'], required: true, index: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true, index: true },
  method: { type: String, enum: ['linear_daily_trend', 'weighted_ratio', 'insufficient_data'], required: true },
  observedDays: { type: Number, min: 0, default: 0 },
  historyDays: { type: Number, min: 0, default: 0 },
  currentValue: { type: Number, default: null },
  forecastValue: { type: Number, default: null },
  lowerBound: { type: Number, default: null },
  upperBound: { type: Number, default: null },
  targetValue: { type: Number, default: null },
  goalAchievementProbability: { type: Number, min: 0, max: 100, default: null },
  confidence: {
    score: { type: Number, min: 0, max: 100, default: 0 },
    band: { type: String, enum: ['insufficient', 'low', 'medium', 'high'], default: 'insufficient' },
    rSquared: { type: Number, min: 0, max: 1, default: null },
    coverage: { type: Number, min: 0, max: 1, default: 0 },
    reason: { type: String, default: '' }
  },
  evidence: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  generatedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

strategicForecastSchema.index({ projectId: 1, metric: 1, horizon: 1, goalId: 1 }, { unique: true });

module.exports = mongoose.model('StrategicForecast', strategicForecastSchema);
