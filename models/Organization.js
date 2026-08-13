const mongoose = require('mongoose');
const slugify = require('slugify');

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
      index: true
    }
  },
  { timestamps: true }
);

organizationSchema.statics.uniqueSlug = async function uniqueSlug(name) {
  const root = slugify(String(name || 'agency'), { lower: true, strict: true }) || 'agency';
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix ? `${root}-${suffix + 1}` : root;
    if (!(await this.exists({ slug: candidate }))) return candidate;
  }
  return `${root}-${Date.now()}`;
};

module.exports = mongoose.model('Organization', organizationSchema);
