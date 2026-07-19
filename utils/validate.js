const { validationResult } = require('express-validator');
const AppError = require('./appError');

function handleValidation(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return next(new AppError(errors.array().map((error) => error.msg).join(', '), 422));
  }

  next();
}

module.exports = handleValidation;
