const env = require('../config/env');
const User = require('../models/User');

const PRICE_TO_PLAN = {};
if (env.stripeStarterPriceId) PRICE_TO_PLAN[env.stripeStarterPriceId] = 'starter';
if (env.stripeProPriceId) PRICE_TO_PLAN[env.stripeProPriceId] = 'pro';
if (env.stripeAgencyPriceId) PRICE_TO_PLAN[env.stripeAgencyPriceId] = 'agency';
if (env.stripeStarterAnnualPriceId) PRICE_TO_PLAN[env.stripeStarterAnnualPriceId] = 'starter';
if (env.stripeProAnnualPriceId) PRICE_TO_PLAN[env.stripeProAnnualPriceId] = 'pro';
if (env.stripeAgencyAnnualPriceId) PRICE_TO_PLAN[env.stripeAgencyAnnualPriceId] = 'agency';

function getStripe() {
  if (!env.stripeSecretKey) {
    const error = new Error('Stripe is not configured. Add STRIPE_SECRET_KEY and price IDs.');
    error.statusCode = 503;
    throw error;
  }

  try {
    const Stripe = require('stripe');
    return new Stripe(env.stripeSecretKey);
  } catch (error) {
    const missing = new Error('Stripe package is not installed. Run npm install after adding Stripe.');
    missing.statusCode = 503;
    throw missing;
  }
}

function planFromPrice(priceId) {
  return PRICE_TO_PLAN[priceId] || 'free';
}

function priceIdForPlan(plan, billingInterval = 'monthly') {
  const maps = {
    monthly: {
      starter: env.stripeStarterPriceId,
      pro: env.stripeProPriceId,
      agency: env.stripeAgencyPriceId
    },
    annual: {
      starter: env.stripeStarterAnnualPriceId,
      pro: env.stripeProAnnualPriceId,
      agency: env.stripeAgencyAnnualPriceId
    }
  };
  return (maps[billingInterval] && maps[billingInterval][plan]) || '';
}

async function ensureCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: {
      userId: user._id.toString()
    }
  });

  user.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
}

function hasActiveSubscription(user) {
  return Boolean(
    user.stripeSubscriptionId
    && ['active', 'trialing', 'past_due'].includes(user.subscriptionStatus)
  );
}

async function createSubscriptionChangeSession({ user, priceId, plan, billingInterval }) {
  if (user.plan === plan && user.billingInterval === billingInterval) {
    const error = new Error(`This account is already on ${plan} ${billingInterval} billing.`);
    error.statusCode = 422;
    throw error;
  }

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  if (!item) {
    const error = new Error('The current Stripe subscription has no updatable plan item.');
    error.statusCode = 422;
    throw error;
  }

  return stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${env.appUrl}/billing`,
    flow_data: {
      type: 'subscription_update_confirm',
      after_completion: {
        type: 'redirect',
        redirect: { return_url: `${env.appUrl}/billing?success=1` }
      },
      subscription_update_confirm: {
        subscription: subscription.id,
        items: [{ id: item.id, price: priceId, quantity: 1 }]
      }
    }
  });
}

async function createCheckoutSession({ user, plan, billingInterval = 'monthly' }) {
  const priceId = priceIdForPlan(plan, billingInterval);
  if (!priceId) {
    const error = new Error('Selected plan is not configured in Stripe.');
    error.statusCode = 422;
    throw error;
  }

  if (hasActiveSubscription(user)) {
    return createSubscriptionChangeSession({ user, priceId, plan, billingInterval });
  }

  const stripe = getStripe();
  const customerId = await ensureCustomer(user);
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.appUrl}/billing?success=1`,
    cancel_url: `${env.appUrl}/pricing?canceled=1`,
    metadata: {
      userId: user._id.toString(),
      plan,
      billingInterval
    },
    subscription_data: {
      metadata: {
        userId: user._id.toString(),
        plan,
        billingInterval
      }
    }
  });
}

async function createPortalSession(user) {
  if (!user.stripeCustomerId) {
    const error = new Error('No Stripe customer exists for this account yet.');
    error.statusCode = 422;
    throw error;
  }

  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${env.appUrl}/billing`
  });
}

function subscriptionPriceId(subscription) {
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  return item && item.price ? item.price.id : '';
}

function subscriptionBillingInterval(subscription) {
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  const interval = item && item.price && item.price.recurring && item.price.recurring.interval;
  return interval === 'year' ? 'annual' : 'monthly';
}

async function updateUserFromSubscription(subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const priceId = subscriptionPriceId(subscription);
  const status = subscription.status || 'inactive';
  const active = ['active', 'trialing', 'past_due'].includes(status);
  const plan = active ? planFromPrice(priceId) : 'free';
  const billingInterval = subscriptionBillingInterval(subscription);
  const currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : undefined;

  await User.findOneAndUpdate(
    { stripeCustomerId: customerId },
    {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: status,
      plan,
      billingInterval,
      currentPeriodEnd
    }
  );
}

async function handleCheckoutCompleted(session) {
  const user = await User.findById(session.metadata && session.metadata.userId);
  if (!user) return;

  user.stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer.id;
  if (session.subscription) {
    user.stripeSubscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
  }
  if (session.metadata && ['monthly', 'annual'].includes(session.metadata.billingInterval)) {
    user.billingInterval = session.metadata.billingInterval;
  }
  await user.save();
}

async function handleStripeEvent(event) {
  if (event.type === 'checkout.session.completed') {
    await handleCheckoutCompleted(event.data.object);
  }

  if ([
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted'
  ].includes(event.type)) {
    await updateUserFromSubscription(event.data.object);
  }
}

function constructWebhookEvent({ body, signature }) {
  const stripe = getStripe();
  if (!env.stripeWebhookSecret) {
    const error = new Error('Stripe webhook secret is not configured.');
    error.statusCode = 503;
    throw error;
  }

  return stripe.webhooks.constructEvent(body, signature, env.stripeWebhookSecret);
}

module.exports = {
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
  handleStripeEvent,
  priceIdForPlan
};
