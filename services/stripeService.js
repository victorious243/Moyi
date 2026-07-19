const env = require('../config/env');
const User = require('../models/User');

const PRICE_TO_PLAN = {};
if (env.stripeStarterPriceId) PRICE_TO_PLAN[env.stripeStarterPriceId] = 'starter';
if (env.stripeProPriceId) PRICE_TO_PLAN[env.stripeProPriceId] = 'pro';
if (env.stripeAgencyPriceId) PRICE_TO_PLAN[env.stripeAgencyPriceId] = 'agency';

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

function priceIdForPlan(plan) {
  const map = {
    starter: env.stripeStarterPriceId,
    pro: env.stripeProPriceId,
    agency: env.stripeAgencyPriceId
  };
  return map[plan] || '';
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

async function createCheckoutSession({ user, plan }) {
  const priceId = priceIdForPlan(plan);
  if (!priceId) {
    const error = new Error('Selected plan is not configured in Stripe.');
    error.statusCode = 422;
    throw error;
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
      plan
    },
    subscription_data: {
      metadata: {
        userId: user._id.toString(),
        plan
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

async function updateUserFromSubscription(subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const priceId = subscriptionPriceId(subscription);
  const status = subscription.status || 'inactive';
  const active = ['active', 'trialing', 'past_due'].includes(status);
  const plan = active ? planFromPrice(priceId) : 'free';
  const currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : undefined;

  await User.findOneAndUpdate(
    { stripeCustomerId: customerId },
    {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: status,
      plan,
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
