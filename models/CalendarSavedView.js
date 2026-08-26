const mongoose = require('mongoose');

const calendarSavedViewSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    isDefault: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

calendarSavedViewSchema.index({ organizationId: 1, userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('CalendarSavedView', calendarSavedViewSchema);
