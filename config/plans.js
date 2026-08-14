const PLANS = {
  free: {
    name: 'Free',
    monthlyPrice: 0,
    annualPrice: 0,
    annualMonthlyEquivalent: 0,
    annualSavings: 0,
    currency: 'EUR',
    priceLabel: 'Free forever',
    description: 'Validate one website and see how Moyi works.',
    projectLimit: 1,
    scansPerMonth: 1,
    pagesPerScan: 5,
    aiReportsPerMonth: 1,
    contentDraftsPerMonth: 3,
    imageGenerationsPerMonth: 2,
    socialPostsPerMonth: 5,
    searchConsole: false,
    reports: false,
    competitors: false,
    wordpress: false,
    webflow: false,
    shopify: false
  },
  starter: {
    name: 'Starter',
    monthlyPrice: 49,
    annualPrice: 490,
    annualMonthlyEquivalent: 41,
    annualSavings: 98,
    currency: 'EUR',
    priceLabel: 'EUR 49 / month',
    description: 'For small businesses building a consistent growth rhythm.',
    projectLimit: 3,
    scansPerMonth: 10,
    pagesPerScan: 50,
    aiReportsPerMonth: 10,
    contentDraftsPerMonth: 30,
    imageGenerationsPerMonth: 30,
    socialPostsPerMonth: 50,
    searchConsole: false,
    reports: true,
    competitors: false,
    wordpress: false,
    webflow: false,
    shopify: false
  },
  pro: {
    name: 'Pro',
    monthlyPrice: 129,
    annualPrice: 1290,
    annualMonthlyEquivalent: 108,
    annualSavings: 258,
    currency: 'EUR',
    priceLabel: 'EUR 129 / month',
    description: 'For growing teams turning search evidence into execution.',
    projectLimit: 10,
    scansPerMonth: 50,
    pagesPerScan: 200,
    aiReportsPerMonth: 50,
    contentDraftsPerMonth: 150,
    imageGenerationsPerMonth: 150,
    socialPostsPerMonth: 200,
    searchConsole: true,
    reports: true,
    competitors: true,
    wordpress: true,
    webflow: true,
    shopify: true
  },
  agency: {
    name: 'Agency',
    monthlyPrice: 299,
    annualPrice: 2990,
    annualMonthlyEquivalent: 249,
    annualSavings: 598,
    currency: 'EUR',
    priceLabel: 'EUR 299 / month',
    description: 'For agencies and operators managing a client portfolio.',
    projectLimit: 30,
    scansPerMonth: 200,
    pagesPerScan: 500,
    aiReportsPerMonth: 200,
    contentDraftsPerMonth: 600,
    imageGenerationsPerMonth: 600,
    socialPostsPerMonth: 1000,
    searchConsole: true,
    reports: true,
    competitors: true,
    wordpress: true,
    webflow: true,
    shopify: true
  }
};

function planFor(user) {
  const plan = user && user.plan && PLANS[user.plan] ? user.plan : 'free';
  return {
    key: plan,
    ...PLANS[plan]
  };
}

module.exports = {
  PLANS,
  planFor
};
