const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const AppError = require('../utils/appError');

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtSecret, { expiresIn: '7d' });
}

function authCookieOptions(maxAge) {
  const options = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: env.isProduction
  };

  if (env.cookieDomain) {
    options.domain = env.cookieDomain;
  }

  if (maxAge) {
    options.maxAge = maxAge;
  }

  return options;
}

function setAuthCookie(res, token) {
  res.cookie('moyi_token', token, authCookieOptions(7 * 24 * 60 * 60 * 1000));
}

function clearAuthCookie(res) {
  res.clearCookie('moyi_token', authCookieOptions());
}

async function attachUser(req, res, next) {
  const token = req.cookies.moyi_token || '';
  res.locals.currentUser = null;

  if (!token) return next();

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.sub).select('-passwordHash');
    req.user = user || null;
    res.locals.currentUser = req.user;
  } catch (error) {
    clearAuthCookie(res);
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return next(new AppError('Please sign in to continue.', 401));
  }

  if (!req.user.emailVerifiedAt) {
    clearAuthCookie(res);
    return res.redirect(`/verify-email?email=${encodeURIComponent(req.user.email)}&error=${encodeURIComponent('Verify your email before entering the workspace. Use Send a new PIN if you need one.')}`);
  }

  next();
}

module.exports = {
  attachUser,
  clearAuthCookie,
  requireAuth,
  authCookieOptions,
  setAuthCookie,
  signToken
};
