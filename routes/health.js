const express = require('express');
const { livenessPayload, readinessPayload } = require('../services/runtimeHealthService');

function buildHealthRouter(deps = {}) {
  const router = express.Router();
  const health = {
    livenessPayload,
    readinessPayload,
    ...deps
  };

  router.get('/healthz', (req, res) => {
    res.json(health.livenessPayload());
  });

  router.get('/readyz', async (req, res, next) => {
    try {
      const payload = await health.readinessPayload();
      res.status(payload.status === 'ready' ? 200 : 503).json(payload);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = buildHealthRouter();
module.exports.buildHealthRouter = buildHealthRouter;
