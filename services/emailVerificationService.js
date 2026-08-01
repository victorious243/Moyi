const crypto = require('crypto');
const User = require('../models/User');
const { recordAuditEvent } = require('./auditLogService');
const { sendEmailVerificationPinEmail } = require('./emailService');
const { hashResetToken } = require('./passwordResetService');

const EMAIL_VERIFICATION_TTL_MS = 30 * 60 * 1000;

function createVerificationPin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function isEmailVerified(user) {
  return Boolean(user && user.emailVerifiedAt);
}

function createEmailVerificationService(deps = {}) {
  const userModel = deps.User || User;
  const deliver = deps.deliverEmailVerification || deliverEmailVerification;
  const audit = deps.recordAuditEvent || recordAuditEvent;

  async function requestEmailVerification({ user, req = null }) {
    if (!user || !user.email) {
      const error = new Error('A valid user is required for email verification.');
      error.statusCode = 422;
      throw error;
    }

    if (isEmailVerified(user)) {
      return { delivered: false, alreadyVerified: true };
    }

    const pin = createVerificationPin();
    user.emailVerificationPinHash = hashResetToken(pin);
    user.emailVerificationExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
    user.emailVerificationRequestedAt = new Date();
    await user.save();

    await deliver({
      user,
      pin,
      expiresInMinutes: Math.round(EMAIL_VERIFICATION_TTL_MS / 60000)
    });
    await audit({ user, eventType: 'email_verification_pin_sent', status: 'success', req });

    return { delivered: true };
  }

  async function verifyEmailPin({ email, pin, req = null }) {
    const normalizedEmail = String(email || '').toLowerCase().trim();
    const cleanPin = String(pin || '').trim();

    if (!normalizedEmail || !/^\d{6}$/.test(cleanPin)) {
      const error = new Error('Enter the 6-digit verification PIN from your email.');
      error.statusCode = 400;
      throw error;
    }

    const user = await userModel
      .findOne({ email: normalizedEmail })
      .select('+emailVerificationPinHash +emailVerificationExpiresAt +passwordHash');

    if (!user) {
      await audit({
        eventType: 'email_verification_failed_unknown_email',
        status: 'failed',
        severity: 'warning',
        metadata: { email: normalizedEmail },
        req
      });
      const error = new Error('Verification failed. Check the email address and PIN.');
      error.statusCode = 400;
      throw error;
    }

    if (isEmailVerified(user)) {
      return user;
    }

    const pinHash = hashResetToken(cleanPin);
    if (
      !user.emailVerificationPinHash ||
      user.emailVerificationPinHash !== pinHash ||
      !user.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt <= new Date()
    ) {
      await audit({ user, eventType: 'email_verification_failed', status: 'failed', severity: 'warning', req });
      const error = new Error('Verification failed. The PIN is invalid or expired.');
      error.statusCode = 400;
      throw error;
    }

    user.emailVerifiedAt = new Date();
    user.emailVerificationPinHash = '';
    user.emailVerificationExpiresAt = null;
    await user.save();
    await audit({ user, eventType: 'email_verified', status: 'success', req });
    return user;
  }

  async function findUnverifiedUserByEmail(email) {
    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!normalizedEmail) return null;
    return userModel
      .findOne({ email: normalizedEmail })
      .select('+emailVerificationPinHash +emailVerificationExpiresAt');
  }

  return {
    findUnverifiedUserByEmail,
    isEmailVerified,
    requestEmailVerification,
    verifyEmailPin
  };
}

async function deliverEmailVerification({ user, pin, expiresInMinutes }) {
  await sendEmailVerificationPinEmail({ user, pin, expiresInMinutes });
  return { delivered: true };
}

module.exports = {
  EMAIL_VERIFICATION_TTL_MS,
  createEmailVerificationService,
  createVerificationPin,
  isEmailVerified,
  requestEmailVerification: createEmailVerificationService().requestEmailVerification,
  verifyEmailPin: createEmailVerificationService().verifyEmailPin,
  findUnverifiedUserByEmail: createEmailVerificationService().findUnverifiedUserByEmail
};
