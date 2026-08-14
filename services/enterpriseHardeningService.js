const env = require('../config/env');
const { AGENCY_ROLE_CAPABILITIES } = require('./organizationService');

function statusFromCheck(check, { required = false } = {}) {
  if (!check) return required ? 'outage' : 'degraded';
  if (check.status === 'ready' || check.status === 'ok') return 'operational';
  if (check.status === 'disabled' && !check.required && !required) return 'maintenance';
  if (check.status === 'failed' && (check.required || required)) return 'outage';
  return 'degraded';
}

function publicStatusFromReadiness(readiness = {}) {
  const database = readiness.checks && readiness.checks.database;
  const queue = readiness.checks && readiness.checks.queue;
  if (statusFromCheck(database, { required: true }) === 'outage') return 'incident';
  if (statusFromCheck(queue, { required: Boolean(queue && queue.required) }) === 'outage') return 'degraded';
  return readiness.status === 'ready' ? 'operational' : 'degraded';
}

function statusPagePayload(readiness = {}) {
  const checks = readiness.checks || {};
  const integrations = checks.integrations || {};
  const integrationStatuses = Object.values(integrations).map((check) => statusFromCheck(check));
  const integrationsStatus = integrationStatuses.includes('degraded') ? 'degraded' : 'operational';

  return {
    checkedAt: readiness.checkedAt || new Date().toISOString(),
    releaseSha: readiness.releaseSha || '',
    status: publicStatusFromReadiness(readiness),
    version: readiness.version || process.env.npm_package_version || '0.0.0',
    components: [
      {
        key: 'web',
        label: 'Moyi-CMO web application',
        status: readiness.status === 'ready' || readiness.status === 'not_ready' ? 'operational' : 'degraded'
      },
      {
        key: 'database',
        label: 'Database',
        status: statusFromCheck(checks.database, { required: true })
      },
      {
        key: 'background_jobs',
        label: 'Background jobs',
        status: statusFromCheck(checks.queue, { required: Boolean(checks.queue && checks.queue.required) })
      },
      {
        key: 'integrations',
        label: 'OAuth and billing integrations',
        status: integrationsStatus
      },
      {
        key: 'social_publishing',
        label: 'Social publishing and media processing',
        status: statusFromCheck(checks.queue, { required: Boolean(checks.queue && checks.queue.required) })
      }
    ]
  };
}

function implemented(key, title, detail) {
  return { key, title, detail, status: 'implemented' };
}

function needsReview(key, title, detail) {
  return { key, title, detail, status: 'needs_review' };
}

function deferred(key, title, detail) {
  return { key, title, detail, status: 'deferred' };
}

function buildSecurityReview(config = env) {
  const tokenSecret = String(config.tokenEncryptionSecret || '');
  const strongTokenSecret = tokenSecret.length >= 32 && !/change-me/i.test(tokenSecret);
  const items = [
    implemented('audit_logs', 'Audit logs', 'Account, admin, publishing, billing, and data-control actions write audit events.'),
    implemented('app_logs', 'Application logs', 'Request IDs and sanitized error logs are available for operator review.'),
    strongTokenSecret
      ? implemented('token_encryption', 'Token encryption', 'OAuth credentials use a production-grade encryption secret.')
      : needsReview('token_encryption', 'Token encryption', 'Set TOKEN_ENCRYPTION_SECRET to a unique 32+ character value before onboarding customers.'),
    implemented('csrf_and_headers', 'CSRF and security headers', 'Authenticated web forms use CSRF protection and Helmet security headers.'),
    implemented('rate_limits', 'Rate limits', 'Authentication, tracking, and machine API surfaces are rate limited and rate-limit blocks are logged.'),
    implemented('data_controls', 'Data export/delete', 'Account export and delete workflows are available from the account area.'),
    implemented('team_policies', 'Team access policies', 'Agency roles define owner, admin, publisher, and analyst capability boundaries.'),
    deferred('public_api', 'Public API', 'External API access is intentionally deferred until customer demand justifies the surface area.')
  ];

  return {
    items,
    needsReviewCount: items.filter((item) => item.status === 'needs_review').length,
    implementedCount: items.filter((item) => item.status === 'implemented').length,
    roleCapabilities: AGENCY_ROLE_CAPABILITIES
  };
}

function buildBackupAndMonitoringPlan(config = env) {
  const backupPolicy = process.env.MOYI_BACKUP_POLICY_URL || process.env.BACKUP_POLICY_URL || '';
  const restoreTestedAt = process.env.MOYI_LAST_RESTORE_TESTED_AT || process.env.BACKUP_LAST_RESTORE_TESTED_AT || '';
  const monitoringUrl = process.env.MOYI_MONITORING_URL || process.env.MONITORING_DASHBOARD_URL || '';
  const alertEmail = config.supportEmail || process.env.ALERT_EMAIL || '';
  const persistentMedia = config.mediaStorageProvider === 's3' || Boolean(config.mediaStoragePath);

  const items = [
    {
      key: 'database_backups',
      title: 'Database backups',
      status: backupPolicy ? 'documented' : 'needs_setup',
      detail: backupPolicy ? 'Backup policy URL is configured.' : 'Document the MongoDB backup schedule and retention policy.'
    },
    {
      key: 'restore_drills',
      title: 'Restore drills',
      status: restoreTestedAt ? 'documented' : 'needs_setup',
      detail: restoreTestedAt ? `Last restore drill: ${restoreTestedAt}.` : 'Run and record a restore test before enterprise pilots.'
    },
    {
      key: 'media_storage',
      title: 'Persistent media storage',
      status: persistentMedia ? 'configured' : 'needs_setup',
      detail: config.mediaStorageProvider === 's3'
        ? 'S3/R2 media storage is selected.'
        : 'Machine media storage is selected; confirm the path is a backed-up persistent volume.'
    },
    {
      key: 'monitoring',
      title: 'Monitoring',
      status: monitoringUrl ? 'documented' : 'needs_setup',
      detail: monitoringUrl ? 'Monitoring dashboard URL is configured.' : 'Add uptime, worker, database, Redis, and error-rate monitoring.'
    },
    {
      key: 'alerts',
      title: 'Incident alerts',
      status: alertEmail ? 'configured' : 'needs_setup',
      detail: alertEmail ? `Alerts can route through ${alertEmail}.` : 'Configure an operations email or alert destination.'
    }
  ];

  return {
    items,
    needsSetupCount: items.filter((item) => item.status === 'needs_setup').length
  };
}

function buildIncidentSummary({
  health = {},
  failedJobs = [],
  failedPublishJobs = [],
  failedWebhookDeliveries = [],
  reconnectAccounts = [],
  recentAppLogs = []
} = {}) {
  const recentErrors = recentAppLogs.filter((log) => log.level === 'error' || Number(log.statusCode || 0) >= 500);
  const openItems = [
    ...((health.blockingChecks || []).map((check) => ({ type: 'blocking_check', label: check }))),
    ...failedJobs.map((job) => ({ type: 'background_job', label: job.type || 'job' })),
    ...failedPublishJobs.map((job) => ({ type: 'publish_job', label: job.platform || 'social' })),
    ...failedWebhookDeliveries.map(() => ({ type: 'webhook', label: 'delivery' })),
    ...reconnectAccounts.map((account) => ({ type: 'reconnect', label: account.platform || 'social account' })),
    ...recentErrors.map((log) => ({ type: 'app_error', label: log.path || log.message || 'application error' }))
  ];

  return {
    severity: health.status === 'ready' && openItems.length === 0 ? 'normal' : (health.status === 'ready' ? 'watch' : 'incident'),
    openItemCount: openItems.length,
    blockingChecks: health.blockingChecks || [],
    recentErrorCount: recentErrors.length,
    openItems: openItems.slice(0, 12)
  };
}

function buildEnterpriseHardeningSummary({ config = env, health = {} } = {}) {
  return {
    backupMonitoring: buildBackupAndMonitoringPlan(config),
    securityReview: buildSecurityReview(config),
    statusPage: statusPagePayload(health)
  };
}

module.exports = {
  buildBackupAndMonitoringPlan,
  buildEnterpriseHardeningSummary,
  buildIncidentSummary,
  buildSecurityReview,
  publicStatusFromReadiness,
  statusPagePayload
};
