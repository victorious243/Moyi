const User = require("../models/User");
const { sendUnverifiedAccountReminderEmail } = require("./emailService");
const { recordAppLog } = require("./appLogger");
const env = require("../config/env");

const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours after signup
const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // Up to 14 days
const REMINDER_COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48 hours between reminders
const MAX_REMINDER_COUNT = 2; // Maximum 2 reminders per unverified user

/**
 * Identify unverified users eligible for an activation reminder and dispatch emails
 */
async function triggerUnverifiedAccountReminders(options = {}) {
  const now = options.now || new Date();
  const minAgeMs = options.minAgeMs || DEFAULT_MIN_AGE_MS;
  const maxAgeMs = options.maxAgeMs || DEFAULT_MAX_AGE_MS;
  const maxReminders = options.maxReminders || MAX_REMINDER_COUNT;
  const cooldownMs = options.cooldownMs || REMINDER_COOLDOWN_MS;

  const minCreatedAt = new Date(now.getTime() - maxAgeMs);
  const maxCreatedAt = new Date(now.getTime() - minAgeMs);
  const cooldownThreshold = new Date(now.getTime() - cooldownMs);

  const query = {
    emailVerifiedAt: null,
    createdAt: { $gte: minCreatedAt, $lte: maxCreatedAt },
    verificationReminderCount: { $lt: maxReminders },
    $or: [
      { verificationReminderSentAt: null },
      { verificationReminderSentAt: { $lte: cooldownThreshold } }
    ]
  };

  const users = await User.find(query).limit(50);
  const results = {
    checked: users.length,
    sent: 0,
    failed: 0,
    errors: []
  };

  for (const user of users) {
    try {
      await sendUnverifiedAccountReminderEmail({ user });
      user.verificationReminderSentAt = now;
      user.verificationReminderCount = (user.verificationReminderCount || 0) + 1;
      await user.save();
      results.sent += 1;
      await recordAppLog({
        level: "info",
        module: "auth_lifecycle",
        message: "Sent unverified account reminder email to " + user.email,
        metadata: { userId: user._id, email: user.email, reminderCount: user.verificationReminderCount }
      }).catch(() => null);
    } catch (error) {
      results.failed += 1;
      results.errors.push({ email: user.email, error: error.message });
      console.error("[Activation Reminder] Failed to send reminder to " + user.email + ":", error.message);
    }
  }

  return results;
}

/**
 * Send a sample unverified account reminder email to a test recipient
 */
async function sendTestUnverifiedAccountReminderEmail(recipientEmail) {
  const targetEmail = recipientEmail || env.adminEmail || "admin@moyi.ie";
  const dummyUser = {
    name: "Moyi Administrator",
    email: targetEmail
  };

  return sendUnverifiedAccountReminderEmail({
    user: dummyUser,
    verifyUrl: String(env.appUrl || "http://localhost:3000").replace(/\/$/, "") + "/verify-email?email=" + encodeURIComponent(targetEmail)
  });
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MIN_AGE_MS,
  MAX_REMINDER_COUNT,
  REMINDER_COOLDOWN_MS,
  sendTestUnverifiedAccountReminderEmail,
  triggerUnverifiedAccountReminders
};
