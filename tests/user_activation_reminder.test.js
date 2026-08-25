const test = require("node:test");
const assert = require("node:assert/strict");
const { createEmailService } = require("../services/emailService");
const {
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MIN_AGE_MS,
  MAX_REMINDER_COUNT,
  REMINDER_COOLDOWN_MS
} = require("../services/userActivationReminderService");

test("sendUnverifiedAccountReminderEmail formats the email with exact copy and verification link", async () => {
  let dispatched = null;
  const mockTransport = () => ({
    sendMail: async (options) => {
      dispatched = options;
      return { messageId: "test-msg-id" };
    }
  });

  const emailService = createEmailService({
    createTransport: mockTransport,
    env: {
      smtpHost: "smtp.test.com",
      smtpUser: "test",
      smtpPass: "pass",
      smtpFrom: "Moyi-CMO <no_reply@moyi-cmo.com>",
      appUrl: "https://moyi-cmo.com"
    }
  });

  const user = {
    name: "Alex",
    email: "alex@example.com"
  };

  await emailService.sendUnverifiedAccountReminderEmail({ user });

  assert.ok(dispatched);
  assert.equal(dispatched.to, "alex@example.com");
  assert.equal(dispatched.subject, "Action Needed: Complete your Moyi-CMO registration");
  assert.match(dispatched.html, /Hi Alex,/);
  assert.match(dispatched.html, /Thanks for signing up for Moyi-CMO!/);
  assert.match(dispatched.html, /We noticed that your account hasn’t been verified yet/);
  assert.match(dispatched.html, /Please check your inbox for the verification email/);
  assert.match(dispatched.html, /Verify Account/);
  assert.match(dispatched.html, /The Moyi-CMO Team/);
  assert.match(dispatched.html, /Your Chief Marketing Officer/);
  assert.match(dispatched.html, /https:\/\/moyi-cmo\.com\/verify-email\?email=alex%40example\.com/);
});

test("activation reminder service enforces sensible default constants", () => {
  assert.equal(DEFAULT_MIN_AGE_MS, 24 * 60 * 60 * 1000);
  assert.equal(DEFAULT_MAX_AGE_MS, 14 * 24 * 60 * 60 * 1000);
  assert.equal(REMINDER_COOLDOWN_MS, 48 * 60 * 60 * 1000);
  assert.equal(MAX_REMINDER_COUNT, 2);
});
