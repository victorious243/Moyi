const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const env = require('../config/env');

const BRAND_LOGO_CID = 'moyi-logo';
const BRAND_LOGO_PATH = path.join(__dirname, '../public/images/brand/moyi-mark-192.png');

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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function brandLogoUrl(target = env) {
  return `${String(target.appUrl || '').replace(/\/$/, '')}/images/brand/moyi-mark-512.png`;
}

function brandLogoAttachment() {
  if (!fs.existsSync(BRAND_LOGO_PATH)) return null;
  return {
    filename: 'moyi-mark.png',
    path: BRAND_LOGO_PATH,
    cid: BRAND_LOGO_CID
  };
}

function emailButton({ url = '', label = '', tone = 'primary' }) {
  if (!url || !label) return '';
  const background = tone === 'success' ? '#12c99b' : '#5b4dff';
  const color = tone === 'success' ? '#04110e' : '#ffffff';
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 4px;">
      <tr>
        <td style="border-radius:8px;background:${background};box-shadow:0 14px 34px rgba(91,77,255,.22);">
          <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 20px;color:${color};font-size:14px;font-weight:800;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>
  `;
}

function infoCard({ title, body, tone = 'neutral' }) {
  const border = tone === 'danger' ? '#ff6f7e' : (tone === 'success' ? '#12c99b' : '#5b4dff');
  return `
    <div style="margin:18px 0;padding:16px 18px;border:1px solid #e7e9f2;border-left:4px solid ${border};border-radius:8px;background:#fbfbff;">
      <p style="margin:0 0 6px;color:#111827;font-size:14px;font-weight:800;">${escapeHtml(title)}</p>
      <div style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">${body}</div>
    </div>
  `;
}

function pinBlock(pin) {
  return `
    <div style="margin:24px 0;padding:24px;border:1px solid #262d3a;border-radius:10px;background:#05070b;text-align:center;">
      <p style="margin:0 0 10px;color:#8eeadd;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;">Secure verification PIN</p>
      <p style="margin:0;color:#ffffff;font-size:40px;font-weight:900;letter-spacing:.2em;line-height:1;">${escapeHtml(pin)}</p>
    </div>
  `;
}

function wrapEmail({ heading, intro, bodyHtml, ctaUrl = '', ctaLabel = '', preheader = '', footerNote = '', targetEnv = env }) {
  const cta = ctaUrl && ctaLabel
    ? emailButton({ url: ctaUrl, label: ctaLabel })
    : '';
  const safeHeading = escapeHtml(heading);
  const safeIntro = escapeHtml(intro);
  const safePreheader = escapeHtml(preheader || intro || heading);

  return `
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;opacity:0;">${safePreheader}</div>
    <div style="margin:0;padding:0;background:#f4f6fb;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb;">
        <tr>
          <td align="center" style="padding:34px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #e8ebf3;border-radius:12px;overflow:hidden;box-shadow:0 24px 70px rgba(17,24,39,.08);">
              <tr>
                <td style="padding:22px 28px;background:#ffffff;border-bottom:1px solid #edf0f6;">
                  <table role="presentation" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="padding:0 12px 0 0;vertical-align:middle;">
                        <img src="cid:${BRAND_LOGO_CID}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border:0;object-fit:contain;">
                      </td>
                      <td style="vertical-align:middle;color:#111827;font-family:Inter,Arial,sans-serif;font-size:21px;font-weight:900;line-height:1;white-space:nowrap;">MOYI-CMO</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:34px 28px 28px;font-family:Inter,Arial,sans-serif;color:#111827;">
                  <p style="margin:0 0 10px;color:#5b4dff;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;">Moyi-CMO</p>
                  <h1 style="margin:0 0 12px;color:#111827;font-size:30px;line-height:1.08;font-weight:900;">${safeHeading}</h1>
                  ${intro ? `<p style="margin:0 0 22px;color:#4b5563;font-size:16px;line-height:1.65;">${safeIntro}</p>` : ''}
                  <div style="color:#1f2937;font-size:15px;line-height:1.7;">${bodyHtml}</div>
                  ${cta}
                </td>
              </tr>
              <tr>
                <td style="padding:22px 28px;background:#fbfcff;border-top:1px solid #edf0f6;font-family:Inter,Arial,sans-serif;">
                  <p style="margin:0 0 8px;color:#111827;font-size:13px;font-weight:800;">Moyi-CMO</p>
                  <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6;">${escapeHtml(footerNote || 'This email was sent by Moyi-CMO. If you did not request this, you can ignore it safely.')}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function listItems(items = []) {
  return `
    <ul style="margin:14px 0 0;padding:0;list-style:none;">
      ${items.map((item) => `
        <li style="margin:0 0 10px;padding-left:18px;position:relative;color:#374151;">
          <span style="color:#12c99b;font-weight:900;">&#10003;</span>
          <span>${escapeHtml(item)}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

function moneyLine({ amount = '', plan = '', date = '' }) {
  return infoCard({
    title: 'Billing summary',
    body: `
      ${plan ? `<p style="margin:0 0 4px;"><strong>Plan:</strong> ${escapeHtml(plan)}</p>` : ''}
      ${amount ? `<p style="margin:0 0 4px;"><strong>Amount:</strong> ${escapeHtml(amount)}</p>` : ''}
      ${date ? `<p style="margin:0;"><strong>Date:</strong> ${escapeHtml(date)}</p>` : ''}
    `,
    tone: 'success'
  });
}
function createEmailService(deps = {}) {
  const transportFactory = deps.createTransport || createTransport;
  const targetEnv = deps.env || env;

  async function sendEmail({ to, subject, html, text, replyTo, attachments = [] }) {
    if (!to) {
      const error = new Error('Email recipient is required.');
      error.statusCode = 422;
      throw error;
    }

    const transporter = transportFactory(targetEnv);
    const logo = brandLogoAttachment();
    return transporter.sendMail({
      from: targetEnv.smtpFrom,
      to,
      subject,
      html,
      text: text || textFromHtml(html),
      attachments: [
        ...(logo ? [logo] : []),
        ...attachments
      ],
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
        ${pinBlock(resetPin)}
        ${infoCard({
          title: 'This reset expires soon',
          body: `<p style="margin:0;">This PIN and link expire in ${escapeHtml(expiresInMinutes)} minutes. If you did not request it, keep your account secure by ignoring this email.</p>`
        })}
      `,
      ctaUrl: resetUrl,
      ctaLabel: 'Reset password',
      targetEnv
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
      html: wrapEmail({ heading, intro, bodyHtml, ctaUrl, ctaLabel, targetEnv })
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

  async function sendMfaPinEmail({ user, pin, expiresInMinutes = 10 }) {
    return sendEmail({
      to: user.email,
      subject: 'Your Moyi-CMO verification PIN',
      html: wrapEmail({
        heading: 'Confirm it is you',
        intro: `Hi ${user.name || 'there'}, use this PIN to finish signing in to Moyi-CMO.`,
        bodyHtml: `
          ${pinBlock(pin)}
          <p style="margin:0;color:#4b5563;">The PIN expires in ${escapeHtml(expiresInMinutes)} minutes. Moyi-CMO will never ask for this code by phone, chat, or social media.</p>
        `,
        targetEnv
      })
    });
  }

  async function sendEmailVerificationPinEmail({ user, pin, expiresInMinutes = 30 }) {
    return sendEmail({
      to: user.email,
      subject: 'Confirm your Moyi-CMO account',
      html: wrapEmail({
        heading: 'Verify your email',
        intro: `Hi ${user.name || 'there'}, enter this PIN to activate your Moyi-CMO account.`,
        bodyHtml: `
          ${pinBlock(pin)}
          <p style="margin:0;color:#4b5563;">This PIN expires in ${escapeHtml(expiresInMinutes)} minutes. We verify every email before opening a workspace so Moyi-CMO stays clean, secure, and useful for real businesses.</p>
        `,
        targetEnv
      })
    });
  }

  async function sendWelcomeEmail({ user, dashboardUrl = `${targetEnv.appUrl}/dashboard` }) {
    return sendEmail({
      to: user.email,
      subject: 'Welcome to Moyi-CMO',
      html: wrapEmail({
        heading: 'Welcome to your AI CMO workspace',
        intro: `Hi ${user.name || 'there'}, your Moyi-CMO workspace is ready to turn website evidence into weekly growth execution.`,
        bodyHtml: `
          ${infoCard({
            title: 'Start with the first useful signal',
            body: `<p style="margin:0;">Create a project, run a scan, review evidence-backed recommendations, then generate content and campaign assets from what Moyi actually found.</p>`,
            tone: 'success'
          })}
          ${listItems([
            'Audit your website and discover SEO opportunities',
            'Generate an AI CMO plan from scan evidence',
            'Create articles, social posts, and campaign assets',
            'Track recommendations, approvals, and publishing progress'
          ])}
        `,
        ctaUrl: dashboardUrl,
        ctaLabel: 'Open workspace',
        footerNote: 'You are receiving this because a Moyi-CMO account was created with this email.',
        targetEnv
      })
    });
  }

  async function sendGoodbyeEmail({ user, reason = '', feedbackUrl = `${targetEnv.appUrl}/contact` }) {
    return sendEmail({
      to: user.email,
      subject: 'Your Moyi-CMO workspace has been closed',
      html: wrapEmail({
        heading: 'Your workspace is closed',
        intro: `Hi ${user.name || 'there'}, this confirms your Moyi-CMO account or subscription has been closed.`,
        bodyHtml: `
          <p style="margin:0 0 14px;">Thank you for trying Moyi-CMO. We built it to help serious businesses make marketing decisions from real evidence, and we are grateful you spent time with it.</p>
          ${reason ? infoCard({ title: 'Closure note', body: `<p style="margin:0;">${escapeHtml(reason)}</p>` }) : ''}
          <p style="margin:0;color:#4b5563;">If this was not intended, contact support and we will help you review the account status.</p>
        `,
        ctaUrl: feedbackUrl,
        ctaLabel: 'Contact Moyi-CMO',
        targetEnv
      })
    });
  }

  async function sendOfferEmail({ to, name = '', offerTitle, offerSummary, ctaUrl, ctaLabel = 'Claim offer', expiresAt = '' }) {
    return sendEmail({
      to,
      subject: offerTitle,
      html: wrapEmail({
        heading: offerTitle,
        intro: name ? `${name}, this offer is available for your Moyi-CMO workspace.` : 'This offer is available for your Moyi-CMO workspace.',
        bodyHtml: `
          ${infoCard({
            title: 'Offer details',
            body: `<p style="margin:0;">${escapeHtml(offerSummary)}</p>`,
            tone: 'success'
          })}
          ${expiresAt ? `<p style="margin:0;color:#6b7280;font-size:13px;">Offer expires: ${escapeHtml(expiresAt)}</p>` : ''}
        `,
        ctaUrl,
        ctaLabel,
        footerNote: 'You are receiving this because you signed up for Moyi-CMO updates or have a Moyi-CMO account.',
        targetEnv
      })
    });
  }

  async function sendPaymentSuccessEmail({ user, plan, amount, invoiceUrl = '', date = new Date().toLocaleDateString() }) {
    return sendEmail({
      to: user.email,
      subject: 'Moyi-CMO payment received',
      html: wrapEmail({
        heading: 'Payment received',
        intro: `Hi ${user.name || 'there'}, your Moyi-CMO payment was successful.`,
        bodyHtml: `
          ${moneyLine({ plan, amount, date })}
          <p style="margin:0;color:#4b5563;">Your workspace access and usage limits have been updated automatically.</p>
        `,
        ctaUrl: invoiceUrl || `${targetEnv.appUrl}/billing`,
        ctaLabel: invoiceUrl ? 'View invoice' : 'Open billing',
        targetEnv
      })
    });
  }

  async function sendPaymentFailedEmail({ user, plan, amount, billingUrl = `${targetEnv.appUrl}/billing` }) {
    return sendEmail({
      to: user.email,
      subject: 'Action needed: Moyi-CMO payment failed',
      html: wrapEmail({
        heading: 'Payment needs attention',
        intro: `Hi ${user.name || 'there'}, Stripe could not complete your latest Moyi-CMO payment.`,
        bodyHtml: `
          ${moneyLine({ plan, amount })}
          ${infoCard({
            title: 'Keep your workspace active',
            body: '<p style="margin:0;">Update your payment method to avoid interruption to scans, AI CMO plans, content generation, and reports.</p>',
            tone: 'danger'
          })}
        `,
        ctaUrl: billingUrl,
        ctaLabel: 'Update payment method',
        targetEnv
      })
    });
  }

  async function sendSubscriptionUpdatedEmail({ user, plan, billingInterval, billingUrl = `${targetEnv.appUrl}/billing` }) {
    return sendEmail({
      to: user.email,
      subject: 'Your Moyi-CMO subscription was updated',
      html: wrapEmail({
        heading: 'Subscription updated',
        intro: `Hi ${user.name || 'there'}, your Moyi-CMO subscription has been updated.`,
        bodyHtml: infoCard({
          title: 'Current plan',
          body: `<p style="margin:0;"><strong>${escapeHtml(plan)}</strong> on ${escapeHtml(billingInterval)} billing.</p>`,
          tone: 'success'
        }),
        ctaUrl: billingUrl,
        ctaLabel: 'Review billing',
        targetEnv
      })
    });
  }

  async function sendSubscriptionCancelledEmail({ user, activeUntil = '', billingUrl = `${targetEnv.appUrl}/billing` }) {
    return sendEmail({
      to: user.email,
      subject: 'Moyi-CMO subscription cancellation confirmed',
      html: wrapEmail({
        heading: 'Cancellation confirmed',
        intro: `Hi ${user.name || 'there'}, your Moyi-CMO subscription cancellation has been recorded.`,
        bodyHtml: `
          <p style="margin:0 0 14px;color:#4b5563;">${activeUntil ? `Your paid access remains active until ${escapeHtml(activeUntil)}.` : 'Your workspace has been moved toward the free plan.'}</p>
          ${infoCard({
            title: 'Before you go',
            body: '<p style="margin:0;">You can still export your data and review your previous recommendations from the account area.</p>'
          })}
        `,
        ctaUrl: billingUrl,
        ctaLabel: 'Open billing',
        targetEnv
      })
    });
  }

  async function sendTrialEndingEmail({ user, plan, endsAt, billingUrl = `${targetEnv.appUrl}/billing` }) {
    return sendEmail({
      to: user.email,
      subject: 'Your Moyi-CMO trial is ending soon',
      html: wrapEmail({
        heading: 'Your trial is almost finished',
        intro: `Hi ${user.name || 'there'}, your ${plan || 'Moyi-CMO'} trial ends on ${endsAt}.`,
        bodyHtml: `
          <p style="margin:0 0 14px;color:#4b5563;">Add or confirm your payment method to keep your growth workspace running without interruption.</p>
          ${listItems(['Website scans continue', 'AI CMO plans stay available', 'Content and image generation keep working', 'Reports and recommendations remain organized'])}
        `,
        ctaUrl: billingUrl,
        ctaLabel: 'Review subscription',
        targetEnv
      })
    });
  }

  async function sendUsageLimitEmail({ user, feature, plan, upgradeUrl = `${targetEnv.appUrl}/pricing` }) {
    return sendEmail({
      to: user.email,
      subject: `Moyi-CMO ${feature} limit reached`,
      html: wrapEmail({
        heading: 'You reached a plan limit',
        intro: `Hi ${user.name || 'there'}, your ${plan || 'current'} plan reached its ${feature} limit.`,
        bodyHtml: infoCard({
          title: 'What this means',
          body: '<p style="margin:0;">Your existing work is safe. Upgrade when you need more scans, reports, drafts, image generations, or connected marketing workflows.</p>'
        }),
        ctaUrl: upgradeUrl,
        ctaLabel: 'View upgrade options',
        targetEnv
      })
    });
  }

  async function sendReportReadyEmail({ user, projectName, reportUrl }) {
    return sendEmail({
      to: user.email,
      subject: `${projectName} report is ready in Moyi-CMO`,
      html: wrapEmail({
        heading: 'Your marketing report is ready',
        intro: `Hi ${user.name || 'there'}, Moyi-CMO finished the latest report for ${projectName}.`,
        bodyHtml: `
          ${infoCard({
            title: 'Inside the report',
            body: '<p style="margin:0;">Review current priorities, evidence-backed recommendations, scan coverage, and the next actions your workspace should focus on.</p>',
            tone: 'success'
          })}
        `,
        ctaUrl: reportUrl,
        ctaLabel: 'Open report',
        targetEnv
      })
    });
  }

  async function sendTeamInviteEmail({ to, inviterName, projectName, inviteUrl }) {
    return sendEmail({
      to,
      subject: `You were invited to ${projectName} on Moyi-CMO`,
      html: wrapEmail({
        heading: 'You have a workspace invite',
        intro: `${inviterName || 'A teammate'} invited you to collaborate on ${projectName} in Moyi-CMO.`,
        bodyHtml: `
          <p style="margin:0;color:#4b5563;">Join the workspace to review recommendations, content drafts, reports, and campaign actions.</p>
        `,
        ctaUrl: inviteUrl,
        ctaLabel: 'Accept invite',
        footerNote: 'This invite was sent by a Moyi-CMO workspace member.',
        targetEnv
      })
    });
  }

  return {
    sendCustomerEmail,
    sendEmail,
    sendEmailVerificationPinEmail,
    sendGoodbyeEmail,
    sendMfaPinEmail,
    sendNewsletterEmail,
    sendOfferEmail,
    sendPaymentFailedEmail,
    sendPaymentSuccessEmail,
    sendPasswordResetEmail,
    sendReportReadyEmail,
    sendSubscriptionCancelledEmail,
    sendSubscriptionUpdatedEmail,
    sendTeamInviteEmail,
    sendTrialEndingEmail,
    sendUsageLimitEmail,
    sendWelcomeEmail,
    verifyEmailTransport
  };
}

module.exports = {
  brandLogoUrl,
  createEmailService,
  emailButton,
  escapeHtml,
  infoCard,
  pinBlock,
  sendCustomerEmail: createEmailService().sendCustomerEmail,
  sendEmail: createEmailService().sendEmail,
  sendEmailVerificationPinEmail: createEmailService().sendEmailVerificationPinEmail,
  sendGoodbyeEmail: createEmailService().sendGoodbyeEmail,
  sendMfaPinEmail: createEmailService().sendMfaPinEmail,
  sendNewsletterEmail: createEmailService().sendNewsletterEmail,
  sendOfferEmail: createEmailService().sendOfferEmail,
  sendPaymentFailedEmail: createEmailService().sendPaymentFailedEmail,
  sendPaymentSuccessEmail: createEmailService().sendPaymentSuccessEmail,
  sendPasswordResetEmail: createEmailService().sendPasswordResetEmail,
  sendReportReadyEmail: createEmailService().sendReportReadyEmail,
  sendSubscriptionCancelledEmail: createEmailService().sendSubscriptionCancelledEmail,
  sendSubscriptionUpdatedEmail: createEmailService().sendSubscriptionUpdatedEmail,
  sendTeamInviteEmail: createEmailService().sendTeamInviteEmail,
  sendTrialEndingEmail: createEmailService().sendTrialEndingEmail,
  sendUsageLimitEmail: createEmailService().sendUsageLimitEmail,
  sendWelcomeEmail: createEmailService().sendWelcomeEmail,
  listItems,
  moneyLine,
  smtpConfigured,
  textFromHtml,
  verifyEmailTransport: createEmailService().verifyEmailTransport,
  wrapEmail
};
