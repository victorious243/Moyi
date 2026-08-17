const compression = require('compression');
const createError = require('http-errors');
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const env = require('./config/env');
const { PLANS } = require('./config/plans');
const { attachUser } = require('./middleware/auth');
const csrfProtection = require('./middleware/csrf');
const { recordAppLog, requestIdMiddleware } = require('./services/appLogger');

const healthRouter = require('./routes/health');
const socialOAuthPublicRouter = require('./routes/socialOAuthPublic');
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
const adminRouter = require('./routes/admin');
const organizationsRouter = require('./routes/organizations');
const publicApiRouter = require('./routes/publicApi');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.trustProxyHops);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.locals.appName = env.appName;
app.locals.publicPlans = PLANS;
app.use(requestIdMiddleware);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://consent.cookiebot.com',
        'https://consentcdn.cookiebot.com',
        'https://*.cookiebot.com'
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
        'https://consent.cookiebot.com',
        'https://consentcdn.cookiebot.com'
      ],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: [
        "'self'",
        'data:',
        'https://consent.cookiebot.com',
        'https://consentcdn.cookiebot.com',
        'https://imgs.cookiebot.com',
        'https://*.cookiebot.com'
      ],
      connectSrc: [
        "'self'",
        'https://consent.cookiebot.com',
        'https://consentcdn.cookiebot.com',
        'https://*.cookiebot.com'
      ],
      frameSrc: [
        "'self'",
        'https://consent.cookiebot.com',
        'https://consentcdn.cookiebot.com'
      ],
      upgradeInsecureRequests: [],
    }
  }
}));
app.use(compression());
app.use(logger('dev', {
  skip: (req) => (
    Boolean(req.query && req.query._csrf) ||
    req.path.startsWith('/social-media/public/') ||
    /^\/integrations\/(?:google|social\/[^/]+)\/callback\/?$/.test(req.path)
  )
}));
app.use(healthRouter);
app.use(socialOAuthPublicRouter);
app.use(stripeWebhookRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/api/v1', publicApiRouter);
app.use(cookieParser());
app.use(attachUser);
app.use(csrfProtection);
app.use((req, res, next) => {
  const publicBase = String(env.appUrl || 'https://moyi-cmo.com').replace(/\/$/, '');
  const pathname = (req.originalUrl || req.url || '/').split('?')[0] || '/';
  const canonicalPath = pathname === '/' ? '' : pathname.replace(/\/$/, '');
  res.locals.canonicalUrl = `${publicBase}${canonicalPath}`;
  res.locals.seoDescription = res.locals.seoDescription || 'Evidence-led AI CMO platform that turns website audits and Search Console queries into automated SEO content, paid ads, and campaign calendars.';
  res.locals.ogImageUrl = `${publicBase}/images/brand/moyi-mark-512.png`;
  res.locals.organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Moyi-CMO',
    url: publicBase,
    logo: `${publicBase}/images/brand/moyi-mark-512.png`,
    description: res.locals.seoDescription,
    sameAs: [
      'https://www.linkedin.com/company/moyi-cmo',
      'https://x.com/moyi_cmo',
      'https://github.com/victorious243/Moyi'
    ],
    contactPoint: env.supportEmail ? [{
      '@type': 'ContactPoint',
      email: env.supportEmail,
      contactType: 'customer support'
    }] : []
  };
  res.locals.softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Moyi-CMO',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: publicBase,
    description: res.locals.seoDescription,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
      category: 'Free trial'
    }
  };
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: env.isProduction ? '1h' : 0,
  setHeaders(res, filePath) {
    if (!env.isProduction) return;
    if (/\.(?:png|jpg|jpeg|gif|webp|avif|ico|svg|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
  }
}));
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
app.use('/admin', adminRouter);
app.use('/organizations', organizationsRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  const status = err.statusCode || err.status || 500;
  recordAppLog({
    level: status >= 500 ? 'error' : 'warning',
    message: err.message,
    req,
    statusCode: status,
    metadata: {
      stack: req.app.get('env') === 'development' ? err.stack : ''
    }
  });

  if (req.accepts('json') && !req.accepts('html')) {
    return res.status(status).json({
      error: {
        message: err.message,
        status
      }
    });
  }

  if (status === 401 && req.accepts('html')) {
    return res.redirect(`/login?error=${encodeURIComponent(err.message || 'Please sign in to continue.')}`);
  }

  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(status);
  res.render('error');
});

module.exports = app;
