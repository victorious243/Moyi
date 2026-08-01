const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordResetService, hashResetToken } = require('../services/passwordResetService');
const { createEmailVerificationService } = require('../services/emailVerificationService');
const { redactIntegration } = require('../services/accountDataService');
const { createProjectTaskService } = require('../services/projectTaskService');
const { createEmailService, smtpConfigured } = require('../services/emailService');
const { buildAccessibleProjectFilter } = require('../services/projectAccessService');

test('password reset stores a hashed expiring token and never returns raw token in production', async () => {
  const env = require('../config/env');
  const previousProduction = env.isProduction;
  env.isProduction = true;

  let deliveredUrl = '';
  let deliveredPin = '';
  const user = {
    _id: 'user_1',
    email: 'founder@example.com',
    name: 'Founder',
    passwordResetTokenHash: '',
    passwordResetPinHash: '',
    passwordResetExpiresAt: null,
    passwordResetRequestedAt: null,
    async save() {
      return this;
    }
  };

  const service = createPasswordResetService({
    User: {
      findOne() {
        return {
          select: async () => user
        };
      }
    },
    deliverPasswordReset: async ({ resetUrl, resetPin }) => {
      deliveredUrl = resetUrl;
      deliveredPin = resetPin;
    },
    recordAuditEvent: async () => null
  });

  try {
    const result = await service.requestPasswordReset({ email: 'Founder@Example.com' });
    assert.equal(result.delivered, true);
    assert.equal(result.resetUrl, '');
    assert.ok(deliveredUrl.includes('/reset-password/'));
    const rawToken = deliveredUrl.split('/reset-password/')[1];
    assert.notEqual(user.passwordResetTokenHash, rawToken);
    assert.equal(user.passwordResetTokenHash, hashResetToken(rawToken));
    assert.match(deliveredPin, /^\d{6}$/);
    assert.equal(user.passwordResetPinHash, hashResetToken(deliveredPin));
    assert.ok(user.passwordResetExpiresAt > new Date());
  } finally {
    env.isProduction = previousProduction;
  }
});

test('password reset consumes valid token and clears reset fields', async () => {
  const rawToken = 'valid-token';
  const rawPin = '123456';
  const user = {
    _id: 'user_1',
    email: 'founder@example.com',
    passwordResetTokenHash: hashResetToken(rawToken),
    passwordResetPinHash: hashResetToken(rawPin),
    passwordResetExpiresAt: new Date(Date.now() + 60000),
    passwordHash: 'old',
    async setPassword(password) {
      this.passwordHash = `hashed:${password}`;
      this.passwordResetTokenHash = '';
      this.passwordResetPinHash = '';
      this.passwordResetExpiresAt = null;
    },
    async save() {
      return this;
    }
  };

  const service = createPasswordResetService({
    User: {
      findOne(query) {
        assert.equal(query.passwordResetTokenHash, hashResetToken(rawToken));
        assert.equal(query.passwordResetPinHash, hashResetToken(rawPin));
        return {
          select: async () => user
        };
      }
    },
    recordAuditEvent: async () => null
  });

  await service.resetPassword({ token: rawToken, pin: rawPin, password: 'new-password' });
  assert.equal(user.passwordHash, 'hashed:new-password');
  assert.equal(user.passwordResetTokenHash, '');
  assert.equal(user.passwordResetPinHash, '');
  assert.equal(user.passwordResetExpiresAt, null);
});

test('email verification sends a hashed expiring PIN and unlocks the user', async () => {
  let deliveredPin = '';
  const user = {
    _id: 'user_1',
    email: 'founder@example.com',
    name: 'Founder',
    emailVerifiedAt: null,
    emailVerificationPinHash: '',
    emailVerificationExpiresAt: null,
    emailVerificationRequestedAt: null,
    async save() {
      return this;
    }
  };

  const service = createEmailVerificationService({
    User: {
      findOne(query) {
        assert.equal(query.email, 'founder@example.com');
        return {
          select: async () => user
        };
      }
    },
    deliverEmailVerification: async ({ pin }) => {
      deliveredPin = pin;
    },
    recordAuditEvent: async () => null
  });

  await service.requestEmailVerification({ user });
  assert.match(deliveredPin, /^\d{6}$/);
  assert.equal(user.emailVerificationPinHash, hashResetToken(deliveredPin));
  assert.ok(user.emailVerificationExpiresAt > new Date());
  assert.equal(user.emailVerifiedAt, null);

  const verified = await service.verifyEmailPin({ email: 'Founder@Example.com', pin: deliveredPin });
  assert.equal(verified.emailVerifiedAt instanceof Date, true);
  assert.equal(verified.emailVerificationPinHash, '');
  assert.equal(verified.emailVerificationExpiresAt, null);
});

test('email verification rejects an invalid PIN without unlocking the user', async () => {
  const user = {
    _id: 'user_1',
    email: 'founder@example.com',
    emailVerifiedAt: null,
    emailVerificationPinHash: hashResetToken('123456'),
    emailVerificationExpiresAt: new Date(Date.now() + 60000),
    async save() {
      return this;
    }
  };

  const service = createEmailVerificationService({
    User: {
      findOne() {
        return {
          select: async () => user
        };
      }
    },
    recordAuditEvent: async () => null
  });

  await assert.rejects(
    () => service.verifyEmailPin({ email: 'founder@example.com', pin: '000000' }),
    /invalid or expired/
  );
  assert.equal(user.emailVerifiedAt, null);
});

test('email service builds SMTP messages from configured env', async () => {
  const sent = [];
  const service = createEmailService({
    env: {
      smtpHost: 'smtp-relay.brevo.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'user',
      smtpPass: 'pass',
      smtpFrom: 'Moyi-CMO <no_reply@moyi-cmo.com>'
    },
    createTransport: () => ({
      sendMail: async (payload) => {
        sent.push(payload);
        return { messageId: 'message_1' };
      },
      verify: async () => true
    })
  });

  await service.sendPasswordResetEmail({
    user: { email: 'customer@example.com', name: 'Customer' },
    resetUrl: 'https://moyi-cmo.com/reset-password/token',
    resetPin: '123456',
    expiresInMinutes: 60
  });

  assert.equal(sent[0].from, 'Moyi-CMO <no_reply@moyi-cmo.com>');
  assert.equal(sent[0].to, 'customer@example.com');
  assert.match(sent[0].subject, /password reset PIN/i);
  assert.match(sent[0].html, /123456/);
  assert.match(sent[0].html, /cid:moyi-logo/);
  assert.equal(sent[0].attachments[0].cid, 'moyi-logo');
});

test('email service includes branded SaaS lifecycle templates', async () => {
  const sent = [];
  const service = createEmailService({
    env: {
      smtpHost: 'smtp-relay.brevo.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'user',
      smtpPass: 'pass',
      smtpFrom: 'Moyi-CMO <no_reply@moyi-cmo.com>',
      appUrl: 'https://moyi-cmo.com'
    },
    createTransport: () => ({
      sendMail: async (payload) => {
        sent.push(payload);
        return { messageId: `message_${sent.length}` };
      },
      verify: async () => true
    })
  });

  await service.sendWelcomeEmail({
    user: { email: 'founder@example.com', name: 'Founder' }
  });
  await service.sendMfaPinEmail({
    user: { email: 'founder@example.com', name: 'Founder' },
    pin: '654321'
  });
  await service.sendPaymentFailedEmail({
    user: { email: 'founder@example.com', name: 'Founder' },
    plan: 'Pro',
    amount: 'EUR 129'
  });
  await service.sendGoodbyeEmail({
    user: { email: 'founder@example.com', name: 'Founder' },
    reason: 'Account deleted by request.'
  });

  assert.equal(sent.length, 4);
  assert.match(sent[0].subject, /Welcome/);
  assert.match(sent[0].html, /Create a project/);
  assert.match(sent[0].html, /run a scan/);
  assert.match(sent[0].html, /cid:moyi-logo/);
  assert.match(sent[1].html, /654321/);
  assert.match(sent[1].html, /background:#05070b/);
  assert.match(sent[2].subject, /payment failed/i);
  assert.match(sent[2].html, /Update payment method/);
  assert.match(sent[3].subject, /closed/);
  assert.match(sent[3].html, /Account deleted by request\./);
});

test('smtpConfigured requires SMTP host, user, password, and from address', () => {
  assert.equal(smtpConfigured({
    smtpHost: 'smtp-relay.brevo.com',
    smtpUser: 'user',
    smtpPass: 'pass',
    smtpFrom: 'Moyi-CMO <no_reply@moyi-cmo.com>'
  }), true);
  assert.equal(smtpConfigured({ smtpHost: 'smtp-relay.brevo.com' }), false);
});

test('accessible project filter uses concrete member ids, not a mongoose query object', () => {
  const filter = buildAccessibleProjectFilter({
    userId: 'user_1',
    memberProjectIds: ['project_2'],
    query: { status: 'approved' }
  });

  assert.deepEqual(filter, {
    status: 'approved',
    $or: [
      { owner: 'user_1' },
      { _id: { $in: ['project_2'] } }
    ]
  });
});

test('account export redacts saved publishing credentials', () => {
  const redacted = redactIntegration({
    appPassword: 'wp-secret',
    apiToken: 'webflow-secret',
    accessToken: 'shopify-secret',
    siteUrl: 'https://example.com'
  });

  assert.equal(redacted.appPassword, '[encrypted credential redacted]');
  assert.equal(redacted.apiToken, '[encrypted credential redacted]');
  assert.equal(redacted.accessToken, '[encrypted credential redacted]');
  assert.equal(redacted.siteUrl, 'https://example.com');
});

test('failed project jobs can be retried as a fresh queued job', async () => {
  const failedJob = {
    _id: 'failed_1',
    projectId: 'project_1',
    userId: 'user_1',
    type: 'measurement_report',
    status: 'failed',
    payload: { type: 'weekly' }
  };

  const createdJobs = [];
  const service = createProjectTaskService({
    ProjectJob: {
      findOne(query) {
        if (query._id === 'failed_1') return Promise.resolve(failedJob);
        return { sort: async () => null };
      },
      create: async (payload) => {
        createdJobs.push(payload);
        return {
          _id: 'new_1',
          ...payload,
          async save() {
            return this;
          }
        };
      }
    },
    enqueueProjectTask: async () => ({ id: 'queue_1' })
  });

  const retry = await service.retryFailedJob({
    jobId: 'failed_1',
    projectId: 'project_1',
    userId: 'user_1'
  });

  assert.equal(retry._id, 'new_1');
  assert.equal(createdJobs[0].type, 'measurement_report');
  assert.deepEqual(createdJobs[0].payload, { type: 'weekly' });
});
