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
      utmSource: params.get('utm_source') || '',
      utmMedium: params.get('utm_medium') || '',
      utmCampaign: params.get('utm_campaign') || '',
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

  send({ eventType: 'page_view' });
  window.moyiTrack = (eventType = 'custom', eventName = '') => send({ eventType, eventName });
})();`);
});

router.post(
  '/api/track',
  cors(),
  trackRateLimit,
  [
    body('projectKey').trim().notEmpty().withMessage('Project key is required.'),
    body('eventType').optional({ checkFalsy: true }).isIn(['page_view', 'conversion', 'custom']).withMessage('Event type is invalid.'),
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
