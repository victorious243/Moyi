const crypto = require('crypto');
const express = require('express');
const asyncHandler = require('express-async-handler');
const { body } = require('express-validator');
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
  res.clearCookie('google_auth_state', authCookieOptions());
}

router.get('/register', (req, res) => {
  res.render('auth/register', { title: 'Create account', errorMessage: req.query.error || '' });
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
    if (existing) return next(new AppError('An account already exists for that email.', 409));

    const user = await User.createWithPassword(req.body);
    await recordAuditEvent({ user, eventType: 'account_registered', req });
    setAuthCookie(res, signToken(user));
    res.redirect('/dashboard');
  })
);

router.get('/login', (req, res) => {
  res.render('auth/login', { title: 'Sign in', errorMessage: req.query.error || '' });
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
      return next(new AppError('Email or password is incorrect.', 401));
    }

    await recordAuditEvent({ user, eventType: 'login_password', req });
    setAuthCookie(res, signToken(user));
    res.redirect('/dashboard');
  })
);

router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Reset password',
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
