const mongoose = require('mongoose');

const conversionGoalSchema = new mongoose.Schema(
  {
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
    eventName: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    urlPattern: {
      type: String,
      trim: true,
      default: ''
    },
    funnelStage: {
      type: String,
      enum: ['lead', 'qualified_lead', 'signup', 'purchase', 'revenue'],
      default: 'lead'
    },
    defaultValue: {
      type: Number,
      min: 0,
      default: 0
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      default: ''
    }
  },
  { timestamps: true }
);

conversionGoalSchema.index({ projectId: 1, eventName: 1 });

module.exports = mongoose.model('ConversionGoal', conversionGoalSchema);
