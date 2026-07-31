const nodemailer = require('nodemailer');
const env = require('../config/env');

function smtpConfigured(target = env) {
  return Boolean(target.smtpHost && target.smtpUser && target.smtpPass && target.smtpFrom);
}

function createTransport(target = env) {
  if (!smtpConfigured(target)) {
    const error = new Error('SMTP email is not configured.');
    error.statusCode = 503;
    throw error;
  }

  return nodemailer.createTransport({
    host: target.smtpHost,
    port: target.smtpPort,
    secure: target.smtpSecure,
    auth: {
      user: target.smtpUser,
      pass: target.smtpPass
    }
  });
}

function textFromHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wrapEmail({ heading, intro, bodyHtml, ctaUrl = '', ctaLabel = '' }) {
  const cta = ctaUrl && ctaLabel
    ? `<p><a href="${ctaUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700;">${ctaLabel}</a></p>`
    : '';

  return `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.55;color:#111827;max-width:640px;margin:0 auto;padding:24px;">
      <p style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin:0 0 16px;">Moyi-CMO</p>
      <h1 style="font-size:24px;line-height:1.2;margin:0 0 12px;">${heading}</h1>
      ${intro ? `<p style="font-size:16px;color:#374151;margin:0 0 18px;">${intro}</p>` : ''}
      <div style="font-size:15px;color:#1f2937;">${bodyHtml}</div>
      ${cta}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">
      <p style="font-size:12px;color:#6b7280;">This email was sent by Moyi-CMO. If you did not request this, you can ignore it.</p>
    </div>
  `;
}

function createEmailService(deps = {}) {
  const transportFactory = deps.createTransport || createTransport;
  const targetEnv = deps.env || env;

  async function sendEmail({ to, subject, html, text, replyTo }) {
    if (!to) {
      const error = new Error('Email recipient is required.');
      error.statusCode = 422;
      throw error;
    }

    const transporter = transportFactory(targetEnv);
    return transporter.sendMail({
      from: targetEnv.smtpFrom,
      to,
      subject,
      html,
      text: text || textFromHtml(html),
      ...(replyTo ? { replyTo } : {})
    });
  }

  async function verifyEmailTransport() {
    const transporter = transportFactory(targetEnv);
    await transporter.verify();
    return { ok: true };
  }

  async function sendPasswordResetEmail({ user, resetUrl, resetPin, expiresInMinutes }) {
    const html = wrapEmail({
      heading: 'Reset your Moyi-CMO password',
      intro: `Hi ${user.name || 'there'}, use this secure link and PIN to reset your password.`,
      bodyHtml: `
        <p>Your password reset PIN is:</p>
        <p style="font-size:28px;font-weight:800;letter-spacing:.16em;margin:12px 0;">${resetPin}</p>
        <p>This PIN and link expire in ${expiresInMinutes} minutes.</p>
      `,
      ctaUrl: resetUrl,
      ctaLabel: 'Reset password'
    });

    return sendEmail({
      to: user.email,
      subject: 'Your Moyi-CMO password reset PIN',
      html
    });
  }

  async function sendCustomerEmail({ to, subject, heading, intro = '', bodyHtml, ctaUrl = '', ctaLabel = '', replyTo = '' }) {
    return sendEmail({
      to,
      subject,
      replyTo,
      html: wrapEmail({ heading, intro, bodyHtml, ctaUrl, ctaLabel })
    });
  }

  async function sendNewsletterEmail({ to, subject, heading, summary, sections = [] }) {
    const bodyHtml = [
      summary ? `<p>${summary}</p>` : '',
      ...sections.map((section) => `
        <h2 style="font-size:18px;margin:22px 0 8px;">${section.title}</h2>
        <p>${section.body}</p>
      `)
    ].join('');

    return sendCustomerEmail({
      to,
      subject,
      heading,
      bodyHtml
    });
  }

  return {
    sendCustomerEmail,
    sendEmail,
    sendNewsletterEmail,
    sendPasswordResetEmail,
    verifyEmailTransport
  };
}

module.exports = {
  createEmailService,
  sendCustomerEmail: createEmailService().sendCustomerEmail,
  sendEmail: createEmailService().sendEmail,
  sendNewsletterEmail: createEmailService().sendNewsletterEmail,
  sendPasswordResetEmail: createEmailService().sendPasswordResetEmail,
  smtpConfigured,
  textFromHtml,
  verifyEmailTransport: createEmailService().verifyEmailTransport,
  wrapEmail
};
