const express = require('express');
const asyncHandler = require('express-async-handler');
const { body } = require('express-validator');
const cors = require('cors');
const createRateLimit = require('../middleware/rateLimit');
const handleValidation = require('../utils/validate');
const { recordTrackingEvent } = require('../services/trackingService');

const router = express.Router();
const trackRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: 240,
  message: 'Too many tracking requests.'
});

router.get('/tracker.js', cors(), (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(`(() => {
  const script = document.currentScript;
  const projectKey = script && script.dataset ? script.dataset.project : '';
  if (!projectKey) return;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  const endpoint = new URL('/api/track', script.src).toString();
  const storageKey = 'moyi_session_id';
  const sessionId = (() => {
    try {
      const existing = localStorage.getItem(storageKey);
      if (existing) return existing;
      const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      localStorage.setItem(storageKey, id);
      return id;
    } catch (error) {
      return String(Date.now()) + Math.random().toString(16).slice(2);
    }
  })();

  const params = new URLSearchParams(location.search);
  const attributionKey = 'moyi_paid_attribution';
  const landingAttribution = {
    utmSource: params.get('utm_source') || '',
    utmMedium: params.get('utm_medium') || '',
    utmCampaign: params.get('utm_campaign') || '',
    utmId: params.get('utm_id') || '',
    utmTerm: params.get('utm_term') || '',
    utmContent: params.get('utm_content') || '',
    gclid: params.get('gclid') || '',
    gbraid: params.get('gbraid') || '',
    wbraid: params.get('wbraid') || '',
    fbclid: params.get('fbclid') || '',
    liFatId: params.get('li_fat_id') || '',
    ttclid: params.get('ttclid') || ''
  };
  const attribution = (() => {
    try {
      const hasPaidSignal = Object.values(landingAttribution).some(Boolean);
      if (hasPaidSignal) {
        localStorage.setItem(attributionKey, JSON.stringify(landingAttribution));
        return landingAttribution;
      }
      return JSON.parse(localStorage.getItem(attributionKey) || '{}');
    } catch (error) {
      return landingAttribution;
    }
  })();
  const experimentKey = 'moyi_experiment_assignment';
  const landingExperiment = {
    experimentId: params.get('moyi_experiment') || '',
    experimentVariant: params.get('moyi_variant') || ''
  };
  const experimentAssignment = (() => {
    try {
      if (landingExperiment.experimentId && landingExperiment.experimentVariant) {
        localStorage.setItem(experimentKey, JSON.stringify(landingExperiment));
        return landingExperiment;
      }
      return JSON.parse(localStorage.getItem(experimentKey) || '{}');
    } catch (error) {
      return landingExperiment;
    }
  })();
  const deviceType = /mobile|iphone|android/i.test(navigator.userAgent) ? 'mobile' : (/ipad|tablet/i.test(navigator.userAgent) ? 'tablet' : 'desktop');
  const browser = (() => {
    const ua = navigator.userAgent;
    if (/Edg\\//.test(ua)) return 'Edge';
    if (/Chrome\\//.test(ua)) return 'Chrome';
    if (/Firefox\\//.test(ua)) return 'Firefox';
    if (/Safari\\//.test(ua) && !/Chrome\\//.test(ua)) return 'Safari';
    return 'Other';
  })();

  const send = (payload) => {
    const body = JSON.stringify({
      projectKey,
      sessionId,
      url: location.href,
      referrer: document.referrer || '',
      ...attribution,
      ...experimentAssignment,
      deviceType,
      browser,
      ...payload
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      return;
    }

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {});
  };

  send({ eventType: 'page_view', funnelStage: 'visit' });
  window.moyiTrack = (eventType = 'custom', eventName = '', properties = {}) => send({
    eventType,
    eventName,
    ...(properties && typeof properties === 'object' ? properties : {})
  });
})();`);
});

router.post(
  '/api/track',
  cors(),
  trackRateLimit,
  [
    body('projectKey').trim().notEmpty().withMessage('Project key is required.'),
    body('eventType').optional({ checkFalsy: true }).isIn(['page_view', 'conversion', 'custom']).withMessage('Event type is invalid.'),
    body('funnelStage').optional({ checkFalsy: true }).isIn(['visit', 'lead', 'qualified_lead', 'signup', 'purchase', 'revenue']).withMessage('Funnel stage is invalid.'),
    body('experimentId').optional({ checkFalsy: true }).isMongoId().withMessage('Experiment identifier is invalid.'),
    body('experimentVariant').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Experiment variant is invalid.'),
    body('value').optional().isFloat({ min: 0 }).withMessage('Event value cannot be negative.'),
    body('sessionId').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).withMessage('Session is too long.'),
    body('url').trim().notEmpty().isLength({ max: 1000 }).withMessage('URL is required.'),
    handleValidation
  ],
  asyncHandler(async (req, res) => {
    await recordTrackingEvent(req);
    res.status(204).send();
  })
);

module.exports = router;
