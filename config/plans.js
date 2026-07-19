const PLANS = {
  free: {
    name: 'Free',
    projectLimit: 1,
    scansPerMonth: 1,
    pagesPerScan: 5,
    aiReportsPerMonth: 1,
    contentDraftsPerMonth: 3,
    searchConsole: false,
    reports: false,
    competitors: false,
    wordpress: false,
    webflow: false,
    shopify: false
  },
  starter: {
    name: 'Starter',
    projectLimit: 3,
    scansPerMonth: 10,
    pagesPerScan: 50,
    aiReportsPerMonth: 10,
    contentDraftsPerMonth: 30,
    searchConsole: false,
    reports: true,
    competitors: false,
    wordpress: false,
    webflow: false,
    shopify: false
  },
  pro: {
    name: 'Pro',
    projectLimit: 10,
    scansPerMonth: 50,
    pagesPerScan: 200,
    aiReportsPerMonth: 50,
    contentDraftsPerMonth: 150,
    searchConsole: true,
    reports: true,
    competitors: true,
    wordpress: true,
    webflow: true,
    shopify: true
  },
  agency: {
    name: 'Agency',
    projectLimit: 30,
    scansPerMonth: 200,
    pagesPerScan: 500,
    aiReportsPerMonth: 200,
    contentDraftsPerMonth: 600,
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
