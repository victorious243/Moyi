const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    // AI-CMO SPEC COMPLIANCE: Subsystem D - channel spend boundaries for
    // autonomous execution and budget-shift trust gates.
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    goal: {
      type: String,
      default: ''
    },
    channel: {
      type: String,
      enum: ['linkedin', 'facebook', 'x', 'instagram', 'email', 'multi'],
      default: 'multi',
      index: true
    },
    cadence: {
      type: String,
      enum: ['single', 'weekly', 'monthly', 'custom'],
      default: 'custom',
      index: true
    },
    startDate: {
      type: Date,
      required: true,
      index: true
    },
    endDate: {
      type: Date,
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['planned', 'active', 'completed', 'paused'],
      default: 'planned',
      index: true
    },
    dailySpendLimit: {
      type: Number,
      min: 0,
      max: 10000,
      default: 0,
      validate: {
        validator(value) {
          return !this.monthlySpendLimit || !value || value <= this.monthlySpendLimit;
        },
        message: 'Daily spend limit cannot exceed monthly spend limit.'
      }
    },
    monthlySpendLimit: {
      type: Number,
      min: 0,
      max: 250000,
      default: 0
    },
    currentDailySpend: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator(value) {
          return !this.dailySpendLimit || !value || value <= this.dailySpendLimit;
        },
        message: 'Current daily spend is above the campaign daily limit.'
      }
    },
    currentMonthlySpend: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator(value) {
          return !this.monthlySpendLimit || !value || value <= this.monthlySpendLimit;
        },
        message: 'Current monthly spend is above the campaign monthly limit.'
      }
    }
  },
  { timestamps: true }
);

campaignSchema.index({ projectId: 1, startDate: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
