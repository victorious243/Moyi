const compression = require('compression');
const createError = require('http-errors');
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const env = require('./config/env');
const { attachUser } = require('./middleware/auth');
const csrfProtection = require('./middleware/csrf');

const indexRouter = require('./routes/index');
const authRouter = require('./routes/auth');
const projectsRouter = require('./routes/projects');
const recommendationsRouter = require('./routes/recommendations');
const contentRouter = require('./routes/content');
const integrationsRouter = require('./routes/integrations');
const billingRouter = require('./routes/billing');
const stripeWebhookRouter = require('./routes/stripeWebhook');
const trackingRouter = require('./routes/tracking');
const socialDraftsRouter = require('./routes/socialDrafts');

const app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.locals.appName = env.appName;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: [],
    }
  }
}));
app.use(compression());
app.use(logger('dev'));
app.use(stripeWebhookRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(attachUser);
app.use(csrfProtection);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', trackingRouter);

app.use('/', authRouter);
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/projects', projectsRouter);
app.use('/recommendations', recommendationsRouter);
app.use('/content', contentRouter);
app.use('/integrations', integrationsRouter);
app.use('/', billingRouter);
app.use('/social-drafts', socialDraftsRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  const status = err.statusCode || err.status || 500;

  if (status === 401 && req.accepts('html')) {
    return res.redirect('/login');
  }

  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(status);
  res.render('error');
});

module.exports = app;
