const crypto = require('crypto');
const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const env = require('../config/env');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');
const { authCookieOptions, clearAuthCookie, setAuthCookie, signToken } = require('../middleware/auth');
const createRateLimit = require('../middleware/rateLimit');
const {
  buildGoogleLoginUrl,
  exchangeCodeForLoginTokens,
  fetchGoogleProfile,
  findOrCreateGoogleUser
} = require('../services/googleAuthService');
const { requestPasswordReset, resetPassword } = require('../services/passwordResetService');
const { sendWelcomeEmail } = require('../services/emailService');
const {
  findUnverifiedUserByEmail,
  requestEmailVerification,
  verifyEmailPin
} = require('../services/emailVerificationService');
const { recordAuditEvent } = require('../services/auditLogService');

const router = express.Router();
const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Please try again in a few minutes.'
});

function oauthCookieOptions() {
  const options = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: env.isProduction,
    maxAge: 10 * 60 * 1000
  };

  if (env.cookieDomain) {
    options.domain = env.cookieDomain;
  }

  return options;
}

function clearGoogleAuthCookies(res) {
  res.clearCookie('google_auth_state', oauthCookieOptions());
}

function renderVerifyEmail(res, { email = '', errorMessage = '', successMessage = '' } = {}, statusCode = 200) {
  return res.status(statusCode).render('auth/verify-email', {
    title: 'Verify email',
    robotsMeta: 'noindex, nofollow',
    email,
    errorMessage,
    successMessage
  });
}

function handleVerifyEmailValidation(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  return renderVerifyEmail(res, {
    email: req.body.email || '',
    errorMessage: errors.array().map((error) => error.msg).join(', ')
  }, 422);
}

router.get('/register', (req, res) => {
  res.render('auth/register', {
    title: 'Create Account & Growth Workspace',
    seoDescription: 'Create your Moyi-CMO account. Start your free website scan, SEO opportunity audit, and AI CMO marketing operating system in under 60 seconds.',
    errorMessage: req.query.error || ''
  });
});

router.post(
  '/register',
  authRateLimit,
  [
    body('name').trim().notEmpty().withMessage('Name is required.'),
    body('email').isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    handleValidation
  ],
  asyncHandler(async (req, res, next) => {
    const existing = await User.findOne({ email: req.body.email });
    if (existing) {
      if (!existing.emailVerifiedAt) {
        await requestEmailVerification({ user: existing, req });
        return renderVerifyEmail(res, {
          email: existing.email,
          successMessage: 'That account is not verified yet, so we sent a fresh PIN.'
        });
      }
      return next(new AppError('An account already exists for that email.', 409));
    }

    const user = await User.createWithPassword(req.body);
    await recordAuditEvent({ user, eventType: 'account_registered', req });
    await requestEmailVerification({ user, req });
    renderVerifyEmail(res, {
      email: user.email,
      successMessage: 'Your verification PIN has been sent.'
    });
  })
);

router.get('/verify-email', (req, res) => {
  renderVerifyEmail(res, {
    email: req.query.email || '',
    errorMessage: req.query.error || '',
    successMessage: req.query.message || ''
  });
});

router.post(
  '/verify-email',
  authRateLimit,
  [
    body('email').isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('pin').trim().matches(/^\d{6}$/).withMessage('Enter the 6-digit verification PIN from your email.'),
    handleVerifyEmailValidation
  ],
  asyncHandler(async (req, res) => {
    try {
      const user = await verifyEmailPin({ email: req.body.email, pin: req.body.pin, req });
      await recordAuditEvent({ user, eventType: 'login_after_email_verification', req });
      try {
        await sendWelcomeEmail({ user });
        await recordAuditEvent({ user, eventType: 'welcome_email_sent', req });
      } catch (emailError) {
        await recordAuditEvent({
          user,
          eventType: 'welcome_email_failed',
          status: 'failed',
          severity: 'warning',
          metadata: { errorMessage: emailError.message },
          req
        });
      }
      setAuthCookie(res, signToken(user));
      res.redirect('/dashboard');
    } catch (error) {
      renderVerifyEmail(res, {
        email: req.body.email,
        errorMessage: error.message
      }, error.statusCode || 400);
    }
  })
);

router.post(
  '/verify-email/resend',
  authRateLimit,
  [
    body('email').isEmail().withMessage('Valid email is required.').normalizeEmail(),
    handleVerifyEmailValidation
  ],
  asyncHandler(async (req, res) => {
    const user = await findUnverifiedUserByEmail(req.body.email);
    if (!user) {
      return renderVerifyEmail(res, {
        email: req.body.email,
        errorMessage: 'We could not find an unverified account for that email.'
      }, 404);
    }

    if (user.emailVerifiedAt) {
      return res.redirect('/login?error=' + encodeURIComponent('That email is already verified. Please sign in.'));
    }

    await requestEmailVerification({ user, req });
    renderVerifyEmail(res, {
      email: user.email,
      successMessage: 'A fresh verification PIN has been sent.'
    });
  })
);

router.get('/login', (req, res) => {
  res.render('auth/login', {
    title: 'Sign In to Your Workspace',
    seoDescription: 'Sign in to your Moyi-CMO workspace to manage autonomous SEO growth, content studio drafts, and social publishing.',
    errorMessage: req.query.error || ''
  });
});

router.get('/google', (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie('google_auth_state', state, oauthCookieOptions());

  try {
    res.redirect(buildGoogleLoginUrl({ state }));
  } catch (error) {
    clearGoogleAuthCookies(res);
    res.redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
});

router.get('/google/callback', asyncHandler(async (req, res) => {
  const expectedState = req.cookies.google_auth_state;
  clearGoogleAuthCookies(res);

  if (req.query.error) {
    return res.redirect(`/login?error=${encodeURIComponent(`Google sign-in failed: ${req.query.error}`)}`);
  }

  if (!expectedState || req.query.state !== expectedState) {
    console.warn('Google sign-in state verification failed.', {
      hasExpectedState: Boolean(expectedState),
      hasReturnedState: Boolean(req.query.state),
      cookieDomain: env.cookieDomain || '(host-only)',
      secureCookies: env.isProduction
    });
    return res.redirect(`/login?error=${encodeURIComponent('Google sign-in could not be verified. Please try again.')}`);
  }

  if (!req.query.code) {
    return res.redirect(`/login?error=${encodeURIComponent('Google did not return an authorization code.')}`);
  }

  try {
    const tokenPayload = await exchangeCodeForLoginTokens(req.query.code);
    const profile = await fetchGoogleProfile(tokenPayload.access_token);
    const user = await findOrCreateGoogleUser(profile);
    await recordAuditEvent({ user, eventType: 'login_google', req });
    setAuthCookie(res, signToken(user));
    res.redirect('/dashboard');
  } catch (error) {
    res.redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
}));

router.post(
  '/login',
  authRateLimit,
  [
    body('email').isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.'),
    handleValidation
  ],
  asyncHandler(async (req, res, next) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user || !(await user.verifyPassword(req.body.password))) {
      await recordAuditEvent({
        eventType: 'login_failed',
        status: 'failed',
        severity: 'warning',
        metadata: { email: req.body.email },
        req
      });
      return res.status(401).render('auth/login', {
        title: 'Sign in',
        errorMessage: 'Email or password is incorrect.'
      });
    }

    await recordAuditEvent({ user, eventType: 'login_password', req });
    if (!user.emailVerifiedAt) {
      await requestEmailVerification({ user, req });
      return renderVerifyEmail(res, {
        email: user.email,
        successMessage: 'Verify your email before entering the workspace. We sent a fresh PIN.'
      });
    }

    setAuthCookie(res, signToken(user));
    res.redirect('/dashboard');
  })
);

router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Reset password',
    robotsMeta: 'noindex, nofollow',
    errorMessage: '',
    resetUrl: ''
  });
});

router.post(
  '/forgot-password',
  authRateLimit,
  [
    body('email').isEmail().withMessage('Valid email is required.').normalizeEmail(),
    handleValidation
  ],
  asyncHandler(async (req, res, next) => {
    try {
      const result = await requestPasswordReset({ email: req.body.email, req });
      res.render('auth/password-reset-requested', {
        title: 'Check your email',
        robotsMeta: 'noindex, nofollow',
        resetUrl: result.resetUrl || '',
        resetPin: result.resetPin || ''
      });
    } catch (error) {
      next(error);
    }
  })
);

router.get('/reset-password/:token', (req, res) => {
  res.render('auth/reset-password', {
    title: 'Choose a new password',
    robotsMeta: 'noindex, nofollow',
    token: req.params.token,
    errorMessage: req.query.error || ''
  });
});

router.post(
  '/reset-password/:token',
  authRateLimit,
  [
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('pin').trim().matches(/^\d{6}$/).withMessage('Enter the 6-digit reset PIN from your email.'),
    body('confirmPassword').custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords must match.');
      }
      return true;
    }),
    handleValidation
  ],
  asyncHandler(async (req, res) => {
    const user = await resetPassword({
      token: req.params.token,
      pin: req.body.pin,
      password: req.body.password,
      req
    });
    setAuthCookie(res, signToken(user));
    res.redirect('/dashboard');
  })
);

router.post('/logout', (req, res) => {
  recordAuditEvent({ user: req.user, eventType: 'logout', req });
  clearAuthCookie(res);
  res.redirect('/');
});

module.exports = router;
