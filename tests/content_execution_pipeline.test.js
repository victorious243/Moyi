const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ContentDraft = require('../models/ContentDraft');
const {
  buildExecutionContext,
  pipelineAssetOptions,
  selectDraftTypes
} = require('../services/contentDraftService');

function sampleRecommendation(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    title: 'Refresh homepage metadata',
    priority: 1,
    actionType: 'fix_metadata',
    reason: 'The homepage snippet is generic and undersells the offer.',
    expectedImpact: 'Improve qualified click-through rate on high-intent searches.',
    targetUrls: ['https://moyi.example/'],
    ...overrides
  };
}

function sampleProject() {
  return {
    name: 'Moyi',
    websiteUrl: 'https://moyi.example',
    targetAudience: 'B2B SaaS marketing teams',
    mainGoal: 'Create more qualified pipeline',
    mainOffer: 'AI CMO workspace',
    brand_profile: {
      callsToAction: ['Book a strategy call']
    }
  };
}

test('Phase 3 execution pipeline maps metadata recommendations to brief-first asset generation', () => {
  const recommendation = sampleRecommendation();
  const options = pipelineAssetOptions(recommendation);

  assert.deepEqual(
    options.map((option) => option.type),
    ['page_improvement_brief', 'meta_title', 'meta_description']
  );
  assert.equal(options[0].label, 'Page improvement brief');
});

test('Phase 3 execution pipeline rejects asset types outside the recommendation pipeline', () => {
  const recommendation = sampleRecommendation();

  assert.throws(
    () => selectDraftTypes(recommendation, 'comparison_page_draft'),
    /does not match this recommendation pipeline/
  );
});

test('Phase 3 execution context carries business goal, persona, search intent, proof, and CTA', () => {
  const context = buildExecutionContext({
    project: sampleProject(),
    recommendation: sampleRecommendation({
      actionType: 'new_page',
      title: 'Launch comparison page',
      reason: 'Buyers near decision stage need a clearer comparison page.',
      expectedImpact: 'Capture more decision-stage demand.'
    }),
    page: {
      url: 'https://moyi.example/compare',
      title: 'Compare Moyi',
      h1: ['Compare Moyi'],
      wordCount: 420,
      internalLinks: ['https://moyi.example/pricing'],
      schemaTypes: ['WebPage'],
      statusCode: 200
    },
    issues: [{ title: 'Thin commercial page', evidence: 'Page has limited proof and weak CTA placement.' }],
    type: 'comparison_page_draft',
    keyword: 'Moyi vs Competitor'
  });

  assert.equal(context.targetPersona, 'B2B SaaS marketing teams');
  assert.match(context.searchIntent, /decision-stage/i);
  assert.equal(context.primaryCta, 'Book a strategy call');
  assert.ok(context.proofPoints.some((point) => point.includes('AI CMO workspace')));
  assert.ok(context.evidenceHighlights.some((item) => item.includes('Thin commercial page')));
});

test('content draft model defaults new execution assets to awaiting review', () => {
  const draft = new ContentDraft({
    projectId: new mongoose.Types.ObjectId(),
    recommendationId: new mongoose.Types.ObjectId(),
    targetUrl: 'https://moyi.example/',
    type: 'content_brief',
    executionContext: {
      businessGoal: 'Create more qualified pipeline',
      targetPersona: 'B2B SaaS marketing teams'
    }
  });

  assert.equal(draft.status, 'awaiting_review');
  assert.equal(draft.validateSync(), undefined);
});
