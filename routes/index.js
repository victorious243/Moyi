const express = require('express');
const asyncHandler = require('express-async-handler');
const Project = require('../models/Project');
const Scan = require('../models/Scan');
const Report = require('../models/Report');
const { requireAuth } = require('../middleware/auth');
const { planFor } = require('../config/plans');
const { getCurrentUsage } = require('../services/usageService');

const router = express.Router();

router.get('/', function(req, res) {
  if (req.user) return res.redirect('/dashboard');
  res.render('index', { title: 'AI CMO platform' });
});

router.get('/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const projects = await Project.find({ owner: req.user._id }).sort({ updatedAt: -1 }).limit(6);
  const allProjects = await Project.find({ owner: req.user._id }).select('name').sort({ updatedAt: -1 });
  const projectCount = allProjects.length;
  const projectIds = allProjects.map((project) => project._id);
  const recentScans = await Scan.find({ projectId: { $in: projectIds } }).sort({ createdAt: -1 }).limit(8);
  const recentReports = await Report.find({ projectId: { $in: projectIds } }).sort({ createdAt: -1 }).limit(5);
  const scanProjectMap = new Map(allProjects.map((project) => [project._id.toString(), project]));
  const usage = await getCurrentUsage(req.user._id);
  const plan = planFor(req.user);

  res.render('dashboard', {
    title: 'Dashboard',
    projects,
    projectCount,
    recentScans,
    recentReports,
    scanProjectMap,
    usage,
    plan
  });
}));

router.get('/account', requireAuth, asyncHandler(async (req, res) => {
  res.render('account', {
    title: 'Account Settings',
    plan: planFor(req.user)
  });
}));

router.get('/terms', (req, res) => {
  res.render('legal', {
    title: 'Terms',
    heading: 'Terms of Service',
    body: `
      <p>Welcome to Moyi ("we," "our," "us"). By accessing or using our website, services, and AI CMO planning tools (collectively, the "Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.</p>
      
      <h2>1. Description of Service</h2>
      <p>Moyi provides an Express/Mongo/EJS software-as-a-service (SaaS) platform that performs website crawls, audits SEO factors, generates evidence-based marketing plans, content drafts, connects to Google Search Console/WordPress/Stripe, and tracks first-party user analytics.</p>
      
      <h2>2. Accounts and Subscriptions</h2>
      <p>To access certain features, you must register for an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. Subscriptions are billed through Stripe and governed by our pricing plans. You can manage or cancel your subscription at any time via the Stripe Customer Portal accessible in your Account Settings.</p>
      
      <h2>3. Acceptable Use</h2>
      <p>You agree not to use the Service for any unlawful or unauthorized purposes. You must not attempt to compromise the security of the Service, run automated scripts to scrape our application, or bypass any rate limits. The website crawler provided is intended to analyze domains you own or have explicit permission to audit.</p>
      
      <h2>4. Intellectual Property & Content Ownership</h2>
      <p>You retain all intellectual property rights to the websites you scan and the content drafts you edit and publish. Moyi owns all rights, titles, and interests in the underlying technology, AI templates, and codebase.</p>
      
      <h2>5. Disclaimers & Limitation of Liability</h2>
      <p>The Service, including the AI-generated CMO plans and recommendations, is provided "as is" without warranty of any kind. While we strive to provide factual, evidence-led marketing strategies, we do not guarantee specific search engine ranking improvements, traffic increases, or revenue results. We are not liable for any indirect, incidental, or consequential damages resulting from your use of the Service.</p>
    `
  });
});

router.get('/privacy', (req, res) => {
  res.render('legal', {
    title: 'Privacy',
    heading: 'Privacy Policy',
    body: `
      <p>At Moyi, we take your privacy seriously. This Privacy Policy describes how we collect, use, and protect your personal information when you use our Service or when our tracking script is embedded on your website.</p>
      
      <h2>1. Information We Collect</h2>
      <ul>
        <li><strong>Account Data:</strong> When you register, we collect your name, email address, password hash, and subscription details.</li>
        <li><strong>Project & Integration Data:</strong> We store details about your projects, including URLs, brand profiles, competitor sites, encrypted Google Search Console OAuth tokens, and WordPress credentials.</li>
        <li><strong>First-Party Analytics Data:</strong> When you embed our tracker on your website, we securely record visitor page views, referrers, UTM parameters, device/browser details, and conversion goals. IP addresses are processed securely using salted cryptographic hashes to protect user privacy.</li>
      </ul>
      
      <h2>2. How We Use Information</h2>
      <p>We use your information to operate and improve the Service, generate personalized marketing recommendations, export approved drafts to your CMS, track user-driven conversions for attribution metrics, and process billing via Stripe.</p>
      
      <h2>3. Data Protection and AI Providers</h2>
      <p>When generating SEO reports and content drafts, website audit issues and page context are analyzed using artificial intelligence. We share only contextually relevant, non-personally identifiable site data with OpenAI API endpoints under strict privacy terms. Your data is never sold or used for training external models without consent.</p>
      
      <h2>4. Cookies & Security</h2>
      <p>We use secure cookie tokens to manage session authentication (e.g. <code>moyi_token</code>) and protect forms against cross-site request forgery (<code>csrf_token</code>). We implement production security policies including Helmet content security policies (CSP) and CORS origin constraints to protect your data from unauthorized access.</p>
    `
  });
});

router.get('/cookies', (req, res) => {
  res.render('legal', {
    title: 'Cookies',
    heading: 'Cookie Notice',
    body: `
      <p>This Cookie Notice explains how Moyi uses cookies and similar technologies to recognize you when you visit our platform. It explains what these technologies are and why we use them, as well as your rights to control our use of them.</p>
      
      <h2>1. What are cookies?</h2>
      <p>Cookies are small data files that are placed on your computer or mobile device when you visit a website. Cookies are widely used by website owners in order to make their websites work, or to work more efficiently, as well as to provide reporting information.</p>
      
      <h2>2. Cookies We Use</h2>
      <table>
        <thead>
          <tr>
            <th>Cookie Name</th>
            <th>Type</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>moyi_token</code></td>
            <td>Essential (HTTPOnly, SameSite=Lax)</td>
            <td>Maintains your authenticated secure user session. Preserved for 7 days.</td>
          </tr>
          <tr>
            <td><code>csrf_token</code></td>
            <td>Essential (HTTPOnly, SameSite=Lax)</td>
            <td>Protects our form submissions against Cross-Site Request Forgery (CSRF) attacks.</td>
          </tr>
          <tr>
            <td><code>moyi_session_id</code></td>
            <td>Analytics (LocalStorage)</td>
            <td>Used in the first-party analytics tracker to identify unique visitor sessions over time.</td>
          </tr>
          <tr>
            <td>Stripe Cookies</td>
            <td>Functional Third-Party</td>
            <td>Used securely by Stripe to coordinate billing, fraud prevention, and session portals.</td>
          </tr>
        </tbody>
      </table>
      
      <h2>3. Controlling Cookies</h2>
      <p>You have the right to decide whether to accept or reject cookies. You can set or amend your web browser controls to accept or refuse cookies. If you choose to reject cookies, you may still use our website though your access to some functionality and secure areas of our website may be restricted.</p>
    `
  });
});

module.exports = router;
