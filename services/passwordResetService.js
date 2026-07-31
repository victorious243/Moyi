const crypto = require('crypto');
const env = require('../config/env');
const User = require('../models/User');
const { recordAuditEvent } = require('./auditLogService');
const { sendPasswordResetEmail } = require('./emailService');

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildResetUrl(token) {
  return `${env.appUrl.replace(/\/$/, '')}/reset-password/${encodeURIComponent(token)}`;
}

function createResetPin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function createPasswordResetService(deps = {}) {
  const userModel = deps.User || User;
  const deliver = deps.deliverPasswordReset || deliverPasswordReset;
  const audit = deps.recordAuditEvent || recordAuditEvent;

  async function requestPasswordReset({ email, req = null }) {
    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!normalizedEmail) return { delivered: false };

    const user = await userModel.findOne({ email: normalizedEmail }).select('+passwordResetTokenHash +passwordResetPinHash +passwordResetExpiresAt');
    if (!user) {
      await audit({ eventType: 'password_reset_requested_unknown_email', status: 'success', metadata: { email: normalizedEmail }, req });
      return { delivered: false };
    }

    const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const resetPin = createResetPin();
    user.passwordResetTokenHash = hashResetToken(token);
    user.passwordResetPinHash = hashResetToken(resetPin);
    user.passwordResetExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    user.passwordResetRequestedAt = new Date();
    await user.save();

    const resetUrl = buildResetUrl(token);
    await deliver({ user, resetUrl, resetPin, expiresInMinutes: Math.round(RESET_TOKEN_TTL_MS / 60000) });
    await audit({ user, eventType: 'password_reset_requested', status: 'success', req });

    return {
      delivered: true,
      resetUrl: env.isProduction ? '' : resetUrl,
      resetPin: env.isProduction ? '' : resetPin
    };
  }

  async function resetPassword({ token, pin, password, req = null }) {
    const tokenHash = hashResetToken(String(token || ''));
    const pinHash = hashResetToken(String(pin || ''));
    const user = await userModel.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetPinHash: pinHash,
      passwordResetExpiresAt: { $gt: new Date() }
    }).select('+passwordHash +passwordResetTokenHash +passwordResetPinHash +passwordResetExpiresAt');

    if (!user) {
      await audit({ eventType: 'password_reset_failed', status: 'failed', severity: 'warning', req });
      const error = new Error('Password reset link is invalid or expired.');
      error.statusCode = 400;
      throw error;
    }

    await user.setPassword(password);
    await user.save();
    await audit({ user, eventType: 'password_reset_completed', status: 'success', req });
    return user;
  }

  return {
    requestPasswordReset,
    resetPassword
  };
}

async function deliverPasswordReset({ user, resetUrl, resetPin, expiresInMinutes }) {
  try {
    await sendPasswordResetEmail({ user, resetUrl, resetPin, expiresInMinutes });
    return { delivered: true };
  } catch (smtpError) {
    if (env.isProduction) {
      throw smtpError;
    }

    if (!env.passwordResetDeliveryUrl) {
      console.warn(`Password reset link for ${user.email}: ${resetUrl}`);
      console.warn(`Password reset PIN for ${user.email}: ${resetPin}`);
      return { delivered: false };
    }

    const headers = { 'content-type': 'application/json' };
    if (env.passwordResetDeliverySecret) {
      headers['x-moyi-email-secret'] = env.passwordResetDeliverySecret;
    }

    const response = await fetch(env.passwordResetDeliveryUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'password_reset',
        to: user.email,
        name: user.name,
        resetUrl,
        resetPin,
        expiresInMinutes
      })
    });

    if (!response.ok) {
      throw new Error(`Password reset delivery failed with ${response.status}.`);
    }

    return { delivered: false };
  }
}

module.exports = {
  RESET_TOKEN_TTL_MS,
  buildResetUrl,
  createResetPin,
  createPasswordResetService,
  hashResetToken,
  requestPasswordReset: createPasswordResetService().requestPasswordReset,
  resetPassword: createPasswordResetService().resetPassword
};
