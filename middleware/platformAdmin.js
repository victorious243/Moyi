const AppError = require('../utils/appError');

function requirePlatformAdmin(req, res, next) {
  if (!req.user) {
    return next(new AppError('Please sign in to continue.', 401));
  }

  if (req.user.role !== 'admin') {
    return next(new AppError('Page not found.', 404));
  }

  next();
}

module.exports = {
  requirePlatformAdmin
};
