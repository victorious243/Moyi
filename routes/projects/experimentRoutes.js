const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const Experiment = require('../../models/Experiment');
const ExperimentObservation = require('../../models/ExperimentObservation');
const Recommendation = require('../../models/Recommendation');
const GrowthAlert = require('../../models/GrowthAlert');
const { evaluateProjectCro } = require('../../services/experiments/croIntelligenceService');
const { createFromRecommendation, dashboard, evaluateExperiment, slugKey } = require('../../services/experiments/experimentService');

const TYPES = ['social_caption', 'cta', 'hook', 'creative', 'posting_time', 'email_subject', 'landing_page', 'campaign_audience', 'paid_creative', 'offer', 'messaging_angle', 'custom'];
const SOURCES = ['tracking', 'social', 'paid'];
const METRIC_KINDS = ['rate', 'continuous'];

function sourceRefs(source, value) {
  const identifiers = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (source === 'social') return { publishJobIds: identifiers };
  if (source === 'paid') return { externalEntityIds: identifiers };
  return {};
}

function hasMeasurementBindings(experiment) {
  if (experiment.measurementSource === 'tracking') return true;
  const field = experiment.measurementSource === 'social' ? 'publishJobIds' : 'externalEntityIds';
  return experiment.variants.every((variant) => (
    Array.isArray(variant.sourceRefs && variant.sourceRefs[field])
      && variant.sourceRefs[field].length > 0
  ));
}

function experimentRedirect(projectId, experimentId, kind, message) {
  return `/projects/${projectId}/experiments/${experimentId}?${kind}=${encodeURIComponent(message)}`;
}

async function startedAlert(experiment) {
  const dedupeKey = `experiment:${experiment._id}:started`;
  return GrowthAlert.findOneAndUpdate(
    { projectId: experiment.projectId, dedupeKey },
    { $set: {
      type: 'experiment_started',
      severity: 'info',
      category: 'experimentation',
      urgency: 'normal',
      confidence: null,
      title: `${experiment.name} started`,
      summary: `Moyi is collecting ${experiment.primaryMetric} evidence without declaring a winner before the configured gates are met.`,
      businessImpact: experiment.hypothesis,
      evidenceData: { experimentId: experiment._id, minimumSamplePerVariant: experiment.minimumSamplePerVariant, minimumDurationDays: experiment.minimumDurationDays },
      recommendedAction: 'Keep variant allocation stable while the experiment gathers evidence.',
      ctaUrl: `/projects/${experiment.projectId}/experiments/${experiment._id}`,
      ctaLabel: 'Open experiment',
      channels: ['in_app'],
      deliveryPolicy: 'in_app_only',
      deliveryStatus: 'sent',
      dedupeKey
    } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

function registerExperimentRoutes(router, context) {
  router.get('/:id/experiments', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const [experimentDashboard, croSignals] = await Promise.all([
      dashboard(req.project._id),
      evaluateProjectCro(req.project._id, new Date(), false)
    ]);
    res.render('projects/experiments', {
      title: `${req.project.name} experiments`,
      experimentDashboard,
      croSignals,
      experiment: null,
      observations: [],
      successMessage: req.query.success || '',
      errorMessage: req.query.error || ''
    });
  }));

  router.get('/:id/experiments/:experimentId', [
    param('id').isMongoId(),
    param('experimentId').isMongoId(),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const [experimentDashboard, experiment] = await Promise.all([
      dashboard(req.project._id),
      Experiment.findOne({ _id: req.params.experimentId, projectId: req.project._id }).populate('ownerId', 'name email').lean()
    ]);
    if (!experiment) return res.redirect(`/projects/${req.project._id}/experiments?error=${encodeURIComponent('Experiment not found.')}`);
    const observations = await ExperimentObservation.find({ experimentId: experiment._id }).sort({ observedTo: -1 }).lean();
    res.render('projects/experiments', {
      title: `${experiment.name} experiment`,
      experimentDashboard,
      croSignals: [],
      experiment,
      observations,
      successMessage: req.query.success || '',
      errorMessage: req.query.error || ''
    });
  }));

  router.post('/:id/experiments', [
    param('id').isMongoId(),
    body('name').trim().isLength({ min: 3, max: 160 }),
    body('hypothesis').trim().isLength({ min: 10, max: 1000 }),
    body('type').isIn(TYPES),
    body('measurementSource').isIn(SOURCES),
    body('metricKind').isIn(METRIC_KINDS),
    body('primaryMetric').trim().isLength({ min: 2, max: 80 }),
    body('minimumSamplePerVariant').isInt({ min: 2, max: 10000000 }),
    body('minimumDurationDays').isInt({ min: 1, max: 180 }),
    body('requiredConfidence').isFloat({ min: 80, max: 99.9 }),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const source = req.body.measurementSource;
    const experiment = await Experiment.create({
      projectId: req.project._id,
      ownerId: req.user._id,
      name: req.body.name,
      hypothesis: req.body.hypothesis,
      type: req.body.type,
      primaryMetric: req.body.primaryMetric,
      secondaryMetrics: String(req.body.secondaryMetrics || '').split(',').map((item) => item.trim()).filter(Boolean),
      metricKind: req.body.metricKind,
      measurementSource: source,
      measurementConfig: {
        successEventName: String(req.body.successEventName || '').trim(),
        denominatorEventName: String(req.body.denominatorEventName || '').trim(),
        targetUrl: String(req.body.targetUrl || '').trim()
      },
      startDate: req.body.startDate || null,
      endDate: req.body.endDate || null,
      minimumDurationDays: Number(req.body.minimumDurationDays),
      minimumSamplePerVariant: Number(req.body.minimumSamplePerVariant),
      requiredConfidence: Number(req.body.requiredConfidence),
      audience: req.body.audience || '',
      channel: req.body.channel || '',
      variants: [
        { key: 'control', name: req.body.controlName || 'Control', description: req.body.controlDescription || '', isControl: true, allocationPercent: 50, sourceRefs: sourceRefs(source, req.body.controlSourceRefs) },
        { key: slugKey(req.body.variantName, 'variant_b'), name: req.body.variantName || 'Variant B', description: req.body.variantDescription || '', isControl: false, allocationPercent: 50, sourceRefs: sourceRefs(source, req.body.variantSourceRefs) }
      ]
    });
    res.redirect(`/projects/${req.project._id}/experiments/${experiment._id}?success=${encodeURIComponent('Experiment draft created. Review its measurement bindings before starting.')}`);
  }));

  router.post('/:id/experiments/from-recommendation/:recommendationId', [
    param('id').isMongoId(),
    param('recommendationId').isMongoId(),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const recommendation = await Recommendation.findOne({ _id: req.params.recommendationId, projectId: req.project._id });
    if (!recommendation) return res.redirect(`/projects/${req.project._id}/recommendations?error=${encodeURIComponent('Recommendation not found.')}`);
    const experiment = await createFromRecommendation({ recommendation, ownerId: req.user._id });
    res.redirect(`/projects/${req.project._id}/experiments/${experiment._id}?success=${encodeURIComponent('Recommendation converted into an experiment draft. Configure its real measurement source before starting.')}`);
  }));

  router.post('/:id/experiments/:experimentId/status', [
    param('id').isMongoId(),
    param('experimentId').isMongoId(),
    body('action').isIn(['start', 'pause', 'resume', 'stop']),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const experiment = await Experiment.findOne({ _id: req.params.experimentId, projectId: req.project._id });
    if (!experiment) return res.redirect(`/projects/${req.project._id}/experiments?error=${encodeURIComponent('Experiment not found.')}`);
    const action = req.body.action;
    const allowedFrom = {
      start: ['draft'],
      pause: ['running'],
      resume: ['paused'],
      stop: ['draft', 'running', 'paused']
    };
    if (!allowedFrom[action].includes(experiment.status)) {
      return res.redirect(experimentRedirect(req.project._id, experiment._id, 'error', `A ${experiment.status.replace(/_/g, ' ')} experiment cannot be ${action}ed.`));
    }
    if (action === 'start' && !hasMeasurementBindings(experiment)) {
      return res.redirect(experimentRedirect(req.project._id, experiment._id, 'error', 'Bind at least one real source record to every variant before starting this experiment.'));
    }
    if (action === 'start') {
      experiment.status = 'running';
      experiment.startDate = experiment.startDate || new Date();
      await startedAlert(experiment);
    } else if (action === 'resume') experiment.status = 'running';
    else if (action === 'pause') experiment.status = 'paused';
    else {
      experiment.status = 'stopped';
      experiment.completedAt = new Date();
    }
    await experiment.save();
    const messages = { start: 'Experiment started.', pause: 'Experiment paused.', resume: 'Experiment resumed.', stop: 'Experiment stopped.' };
    res.redirect(experimentRedirect(req.project._id, experiment._id, 'success', messages[action]));
  }));

  router.post('/:id/experiments/:experimentId/configuration', [
    param('id').isMongoId(),
    param('experimentId').isMongoId(),
    body('measurementSource').isIn(SOURCES),
    body('metricKind').isIn(METRIC_KINDS),
    body('primaryMetric').trim().isLength({ min: 2, max: 80 }),
    body('minimumSamplePerVariant').isInt({ min: 2, max: 10000000 }),
    body('minimumDurationDays').isInt({ min: 1, max: 180 }),
    body('requiredConfidence').isFloat({ min: 80, max: 99.9 }),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const experiment = await Experiment.findOne({ _id: req.params.experimentId, projectId: req.project._id });
    if (!experiment) return res.redirect(`/projects/${req.project._id}/experiments?error=${encodeURIComponent('Experiment not found.')}`);
    if (!['draft', 'paused'].includes(experiment.status)) {
      return res.redirect(experimentRedirect(req.project._id, experiment._id, 'error', 'Pause a running experiment before changing its measurement configuration.'));
    }

    const source = req.body.measurementSource;
    experiment.measurementSource = source;
    experiment.metricKind = req.body.metricKind;
    experiment.primaryMetric = req.body.primaryMetric;
    experiment.minimumSamplePerVariant = Number(req.body.minimumSamplePerVariant);
    experiment.minimumDurationDays = Number(req.body.minimumDurationDays);
    experiment.requiredConfidence = Number(req.body.requiredConfidence);
    experiment.endDate = req.body.endDate || null;
    experiment.channel = String(req.body.channel || '').trim();
    experiment.audience = String(req.body.audience || '').trim();
    const currentConfig = experiment.measurementConfig && typeof experiment.measurementConfig.toObject === 'function'
      ? experiment.measurementConfig.toObject()
      : { ...(experiment.measurementConfig || {}) };
    experiment.measurementConfig = {
      ...currentConfig,
      successEventName: String(req.body.successEventName || '').trim(),
      denominatorEventName: String(req.body.denominatorEventName || '').trim(),
      targetUrl: String(req.body.targetUrl || '').trim()
    };
    experiment.variants[0].sourceRefs = sourceRefs(source, req.body.controlSourceRefs);
    experiment.variants[1].sourceRefs = sourceRefs(source, req.body.variantSourceRefs);
    experiment.variants.forEach((variant) => {
      variant.outcome.sampleSize = 0;
      variant.outcome.successes = null;
      variant.outcome.metricValue = null;
      variant.outcome.upliftVsControl = null;
      variant.outcome.confidenceVsControl = null;
    });
    experiment.confidence = null;
    experiment.result = '';
    experiment.winningVariantKey = '';
    experiment.lastEvaluatedAt = null;
    await experiment.save();
    await ExperimentObservation.deleteMany({ experimentId: experiment._id });
    res.redirect(experimentRedirect(req.project._id, experiment._id, 'success', 'Measurement configuration saved. Existing observations were cleared because the evidence bindings changed.'));
  }));

  router.post('/:id/experiments/:experimentId/evaluate', [
    param('id').isMongoId(),
    param('experimentId').isMongoId(),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const experiment = await Experiment.findOne({ _id: req.params.experimentId, projectId: req.project._id });
    if (!experiment) return res.redirect(`/projects/${req.project._id}/experiments?error=${encodeURIComponent('Experiment not found.')}`);
    await evaluateExperiment(experiment._id);
    await evaluateProjectCro(req.project._id, new Date(), true);
    res.redirect(`/projects/${req.project._id}/experiments/${experiment._id}?success=${encodeURIComponent('Experiment refreshed from current source records and evaluated.')}`);
  }));
}

module.exports = { hasMeasurementBindings, registerExperimentRoutes, sourceRefs };
