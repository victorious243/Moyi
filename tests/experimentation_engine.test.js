const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Experiment = require('../models/Experiment');
const ExperimentLearning = require('../models/ExperimentLearning');
const ExperimentObservation = require('../models/ExperimentObservation');
const { detectCroSignals } = require('../services/experiments/croIntelligenceService');
const { evaluateExperimentData, learningPayload } = require('../services/experiments/evaluationService');
const { recommendationExperimentPayload } = require('../services/experiments/experimentService');
const { continuousComparison, rateComparison } = require('../services/experiments/statistics');
const { hasMeasurementBindings, sourceRefs } = require('../routes/projects/experimentRoutes');

function experiment(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    projectId: new mongoose.Types.ObjectId(),
    sourceRecommendationId: null,
    name: 'Founder message test',
    hypothesis: 'Founder-led messaging produces more qualified clicks.',
    type: 'messaging_angle',
    channel: 'website',
    primaryMetric: 'conversion_rate',
    metricKind: 'rate',
    minimumSamplePerVariant: 100,
    minimumDurationDays: 7,
    requiredConfidence: 95,
    startDate: new Date('2026-08-01T00:00:00Z'),
    endDate: new Date('2026-08-31T00:00:00Z'),
    status: 'running',
    decision: '',
    variants: [
      { key: 'control', name: 'Product-led', isControl: true },
      { key: 'founder', name: 'Founder-led', isControl: false }
    ],
    ...overrides
  };
}

function observations(controlSuccesses, variantSuccesses, sampleSize = 1000) {
  return [
    { variantKey: 'control', metric: 'conversion_rate', metricKind: 'rate', sampleSize, successes: controlSuccesses },
    { variantKey: 'founder', metric: 'conversion_rate', metricKind: 'rate', sampleSize, successes: variantSuccesses }
  ];
}

test('rate comparison calculates observed uplift and confidence from samples', () => {
  const result = rateComparison({ sampleSize: 1000, successes: 100 }, { sampleSize: 1000, successes: 140 });
  assert.equal(result.controlValue, 0.1);
  assert.equal(result.variantValue, 0.14);
  assert.ok(result.uplift > 0.39 && result.uplift < 0.41);
  assert.ok(result.confidence > 99);
});

test('winner is blocked until minimum duration and sample gates pass', () => {
  const tooEarly = evaluateExperimentData(experiment(), observations(100, 140), new Date('2026-08-04T00:00:00Z'));
  assert.equal(tooEarly.status, 'running');
  assert.equal(tooEarly.durationReady, false);

  const tooSmall = evaluateExperimentData(experiment(), observations(2, 10, 50), new Date('2026-08-15T00:00:00Z'));
  assert.equal(tooSmall.status, 'running');
  assert.equal(tooSmall.samplesReady, false);
});

test('winner is detected only after all configured gates pass', () => {
  const evaluation = evaluateExperimentData(experiment(), observations(100, 140), new Date('2026-08-15T00:00:00Z'));
  assert.equal(evaluation.status, 'winner_found');
  assert.equal(evaluation.winner.outcome.variant.key, 'founder');
  assert.ok(evaluation.winner.comparison.confidence >= 95);
});

test('ended experiment without significant evidence is inconclusive', () => {
  const evaluation = evaluateExperimentData(experiment(), observations(100, 102), new Date('2026-09-01T00:00:00Z'));
  assert.equal(evaluation.status, 'inconclusive');
  assert.equal(evaluation.winner, null);
  assert.match(evaluation.reason, /confidence threshold/);
});

test('metric integrity rejects impossible rates and supports continuous values', () => {
  assert.equal(rateComparison({ sampleSize: 10, successes: 11 }, { sampleSize: 10, successes: 2 }), null);
  const continuous = continuousComparison(
    { sampleSize: 100, sum: 1000, sumSquares: 11000 },
    { sampleSize: 100, sum: 1300, sumSquares: 17900 }
  );
  assert.equal(continuous.controlValue, 10);
  assert.equal(continuous.variantValue, 13);
  assert.ok(continuous.confidence > 95);
});

test('recommendation conversion creates a draft with one control and one variant', () => {
  const recommendation = {
    _id: new mongoose.Types.ObjectId(),
    projectId: new mongoose.Types.ObjectId(),
    title: 'Use a stronger founder-led hook',
    reason: 'Founder stories receive stronger qualified engagement.',
    actionType: 'content'
  };
  const payload = recommendationExperimentPayload({ recommendation, ownerId: new mongoose.Types.ObjectId() });
  assert.equal(payload.status, undefined);
  assert.equal(payload.type, 'messaging_angle');
  assert.equal(payload.variants.length, 2);
  assert.equal(payload.variants.filter((variant) => variant.isControl).length, 1);
  assert.equal(payload.measurementSource, 'social');
});

test('social and paid experiments require real source bindings before they start', () => {
  const variants = [
    { key: 'control', sourceRefs: sourceRefs('social', '64b64b64b64b64b64b64b641') },
    { key: 'variant', sourceRefs: sourceRefs('social', '') }
  ];
  assert.equal(hasMeasurementBindings({ measurementSource: 'social', variants }), false);
  variants[1].sourceRefs = sourceRefs('social', '64b64b64b64b64b64b64b642');
  assert.equal(hasMeasurementBindings({ measurementSource: 'social', variants }), true);
  assert.equal(hasMeasurementBindings({ measurementSource: 'tracking', variants: [] }), true);
});

test('historical learning payload retains measured evidence and decision', () => {
  const source = experiment();
  const evaluation = evaluateExperimentData(source, observations(100, 140), new Date('2026-08-15T00:00:00Z'));
  const payload = learningPayload(source, evaluation, 'Use founder-led messaging more often.');
  assert.equal(payload.winningVariantKey, 'founder');
  assert.equal(payload.decision, 'Use founder-led messaging more often.');
  assert.equal(payload.evidence.control.sampleSize, 1000);
  assert.equal(payload.evidence.winner.successes, 140);
  assert.ok(payload.confidence >= 95);
});

test('CRO alerts require observed traffic and identify form and CTA leakage', () => {
  const events = [];
  for (let index = 0; index < 120; index += 1) {
    events.push({ sessionId: `s${index}`, url: '/pricing', eventType: 'page_view', eventName: 'cta_view', deviceType: 'desktop' });
    if (index < 30) events.push({ sessionId: `s${index}`, url: '/pricing', eventType: 'custom', eventName: 'form_start', deviceType: 'desktop' });
    if (index < 5) events.push({ sessionId: `s${index}`, url: '/pricing', eventType: 'custom', eventName: 'form_submit', deviceType: 'desktop' });
  }
  const types = detectCroSignals(events).map((signal) => signal.type);
  assert.ok(types.includes('funnel_leak_detected'));
  assert.ok(types.includes('landing_page_underperforming'));
  assert.ok(types.includes('form_abandonment_spike'));
  assert.ok(types.includes('cta_underperformance'));
});

test('experiment records expose reusable indexes and constrained statuses', () => {
  const statusEnum = Experiment.schema.path('status').enumValues;
  assert.deepEqual(statusEnum, ['draft', 'running', 'paused', 'winner_found', 'inconclusive', 'stopped']);
  assert.ok(ExperimentObservation.schema.indexes().some(([fields]) => fields.experimentId && fields.variantKey));
  assert.equal(ExperimentLearning.schema.path('experimentId').options.unique, true);
});
