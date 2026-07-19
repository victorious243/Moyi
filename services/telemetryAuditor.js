// AI-CMO SPEC COMPLIANCE: Subsystem B - telemetry audit score gates autonomous
// posting and budget actions until measurement quality is trustworthy.
const ProjectSearchProperty = require('../models/ProjectSearchProperty');
const TrackingEvent = require('../models/TrackingEvent');

function scoreChecks(checks) {
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0) || 1;
  const earned = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  return Math.round((earned / totalWeight) * 100);
}

function check(name, passed, weight, message) {
  return {
    name,
    passed: Boolean(passed),
    weight,
    message
  };
}

async function auditTelemetry(project, options = {}) {
  const lookbackDate = new Date(Date.now() - Number(options.lookbackDays || 30) * 24 * 60 * 60 * 1000);
  const [searchProperty, recentEvents, utmEvents, conversions] = await Promise.all([
    ProjectSearchProperty.findOne({ projectId: project._id }),
    TrackingEvent.countDocuments({ projectId: project._id, createdAt: { $gte: lookbackDate } }),
    TrackingEvent.countDocuments({
      projectId: project._id,
      createdAt: { $gte: lookbackDate },
      $or: [{ utmSource: { $ne: '' } }, { utmMedium: { $ne: '' } }, { utmCampaign: { $ne: '' } }]
    }),
    TrackingEvent.find({ projectId: project._id, eventType: 'conversion', createdAt: { $gte: lookbackDate } }).limit(500)
  ]);

  const sessions = new Set(conversions.map((event) => event.sessionId).filter(Boolean));
  const duplicateConversions = conversions.length - sessions.size;
  const checks = [
    check('Search Console connected', Boolean(searchProperty), 20, searchProperty ? 'Verified Search Console property is connected.' : 'Connect a verified Search Console property.'),
    check('First-party analytics receiving events', recentEvents > 0, 25, recentEvents ? `${recentEvents} recent tracking events received.` : 'Install the Moyi tracking script and confirm page views.'),
    check('UTM capture detected', utmEvents > 0, 20, utmEvents ? `${utmEvents} recent UTM-tagged events detected.` : 'Visit a landing page with utm_source, utm_medium, and utm_campaign.'),
    check('Conversion tracking sane', conversions.length === 0 || duplicateConversions / Math.max(conversions.length, 1) < 0.2, 20, duplicateConversions ? `${duplicateConversions} possible duplicate conversion events found.` : 'No duplicate conversion anomaly detected.'),
    check('Project approved for execution', project.status === 'approved', 15, project.status === 'approved' ? 'Brand calibration is approved.' : 'Approve the discovered brand profile before autonomous execution.')
  ];

  return {
    score: scoreChecks(checks),
    checks,
    autonomousActionsBlocked: scoreChecks(checks) < 85,
    auditedAt: new Date()
  };
}

module.exports = {
  auditTelemetry,
  scoreChecks
};
