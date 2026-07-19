const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const AppError = require('../utils/appError');

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtSecret, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
  res.cookie('moyi_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.nodeEnv === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
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
    res.clearCookie('moyi_token');
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return next(new AppError('Please sign in to continue.', 401));
  }

  next();
}

module.exports = {
  attachUser,
  requireAuth,
  setAuthCookie,
  signToken
};
