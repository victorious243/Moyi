module.exports = {
  features: {
    eyebrow: 'Product capabilities',
    title: 'One system for evidence-led marketing work',
    intro: 'Moyi connects website intelligence, prioritization, content production, campaign operations, and measurement inside one accountable project workspace.',
    primaryAction: { label: 'Start Free', href: '/register' },
    secondaryAction: { label: 'See How It Works', href: '/how-it-works' },
    sections: [
      { id: 'intelligence', title: 'Website intelligence', body: 'Crawl authorized websites and record page structure, metadata, headings, content signals, internal links, supported technical findings, and failed-page evidence.', bullets: ['Scan-specific evidence remains traceable.', 'Public quick scans expose a limited factual preview.', 'Full scans feed project recommendations and planning.'] },
      { id: 'strategy', title: 'AI CMO planning', body: 'Turn recorded project evidence into ranked opportunities, business risks, quick wins, and a practical weekly operating plan.', bullets: ['Recommendations include reasons, impact, effort, and target pages.', 'Accept, reject, restore, and completion states keep the queue controlled.', 'Missing evidence is reported instead of replaced with guesses.'] },
      { id: 'content', title: 'Content Studio', body: 'Generate website assets, articles, and campaign posts using the project’s audience, offer, goal, brand tone, and available evidence.', bullets: ['SEO strategist, copywriter, and editor stages for long-form drafts', 'Comparison, alternatives, and product-led templates', 'Single-post, weekly, and monthly campaign planning'] },
      { id: 'visuals', title: 'Visual review', body: 'Generate or upload post images, compare candidates with the actual copy, edit accessibility details, and select the final image before approval.', bullets: ['Machine or object-storage files instead of image binaries in MongoDB', 'Candidate, selected, rejected, and restored states', 'Combined image and post preview'] },
      { id: 'operations', title: 'Campaign operations', body: 'Use the content calendar to edit, schedule, approve, copy, remove, and record publication of campaign posts.', bullets: ['Posts remain grouped under campaign objectives.', 'Nothing is automatically posted.', 'CMS connections create drafts or unpublished items only.'] },
      { id: 'measurement', title: 'Measurement and reporting', body: 'Connect supported data sources, monitor search opportunities and conversions, and prepare recurring decision reports.', bullets: ['Google Search Console query and page opportunities', 'First-party event and conversion-goal tracking', 'Weekly and monthly evidence-based reporting'] }
    ]
  },
  'how-it-works': {
    eyebrow: 'Operating workflow',
    title: 'From website evidence to reviewed execution',
    intro: 'Moyi follows a controlled cycle so every recommendation, draft, campaign, and report has a clear place in the business workflow.',
    primaryAction: { label: 'View Product Demo', href: '/demo' },
    secondaryAction: { label: 'Read Documentation', href: '/docs' },
    sections: [
      { id: 'step-1', title: '1. Discover the current position', body: 'Create a project, scan the authorized website, and review the discovered business context. Add competitors and measurement sources when available.', bullets: ['Website crawl evidence', 'Business calibration', 'Competitor and measurement context'] },
      { id: 'step-2', title: '2. Decide what matters', body: 'Generate the AI CMO plan. Moyi ranks supported opportunities and separates urgent work, quick wins, strategic work, and measurement gaps.', bullets: ['Evidence-linked recommendation queue', 'Expected impact and effort', 'Human acceptance or rejection'] },
      { id: 'step-3', title: '3. Create the work', body: 'Accepted opportunities enter the execution pipeline. Content Studio also creates standalone campaign posts, weekly plans, and monthly plans from a specific campaign objective.', bullets: ['Editable copy and execution briefs', 'Image generation and upload', 'Campaign drafts scheduled into the calendar'] },
      { id: 'step-4', title: '4. Review before action', body: 'A person checks the message, claims, image, links, formatting, schedule, and call to action. Approval unlocks distribution controls but does not publish automatically.', bullets: ['Write, Visual, Review, Distribute workflow', 'Revision and rejection controls', 'Human-controlled CMS drafts and exports'] },
      { id: 'step-5', title: '5. Measure and repeat', body: 'Use search performance, conversion events, campaign history, and recurring reports to determine what changed and what should happen next.', bullets: ['Measured facts remain separate from recommendations.', 'Data-quality gaps stay visible.', 'New evidence informs the next planning cycle.'] }
    ]
  },
  docs: {
    eyebrow: 'Product documentation',
    title: 'Use Moyi from evidence to execution',
    intro: 'A practical tutorial for using Moyi as an AI CMO workspace: create a project, scan the website, approve evidence-backed recommendations, generate content, create visuals, plan campaigns, publish safely, and measure the results.',
    primaryAction: { label: 'Open Dashboard', href: '/dashboard' },
    secondaryAction: { label: 'Create Account', href: '/register' },
    sections: [
      {
        id: 'first-run',
        title: 'Quick start: first useful result',
        body: 'Use this path when you want to understand Moyi quickly and get from a website URL to a real action queue.',
        steps: [
          { title: 'Create an account', body: 'Register, sign in, and open the dashboard.' },
          { title: 'Run a quick scan or create a project', body: 'Use the homepage terminal for a public preview, or go to Projects and scan your business website.' },
          { title: 'Review calibration', body: 'Check the discovered brand name, positioning, audience, value props, and competitors before activating the workspace.' },
          { title: 'Upload the official logo', body: 'Add a transparent PNG logo in project settings. Moyi uses that exact file when generated visuals need the brand mark.' },
          { title: 'Generate the AI CMO plan', body: 'Open the project and click Generate AI CMO Plan after a completed scan exists.' },
          { title: 'Accept one recommendation', body: 'Accepted recommendations move into the execution queue where you can generate content or pipeline assets.' },
          { title: 'Review, approve, and distribute', body: 'Edit the draft, choose or upload an image, approve the final asset, then export or create a CMS draft.' }
        ],
        note: 'Moyi is evidence-led. If a scan, integration, or metric is missing, the product should say so instead of pretending it has the data.'
      },
      {
        id: 'project-setup',
        title: 'Project setup options',
        body: 'A project is the business workspace. It stores the website URL, brand profile, recommendations, content drafts, campaigns, integrations, reports, and measurement configuration.',
        options: [
          { title: 'Scan and prefill', body: 'Best for a new customer. Moyi crawls the website, discovers visible brand context, and opens calibration before activation.' },
          { title: 'Manual business profile', body: 'Best when you already know the positioning. You enter the audience, offer, country, goal, brand tone, competitors, and upload the logo.' },
          { title: 'Brand logo', body: 'Transparent PNG only. This prevents Moyi from inventing a fake logo when a user asks for branded images.' },
          { title: 'Webhook URL', body: 'Optional. Sends approved content to a custom frontend or external system with an HMAC signature.' }
        ],
        steps: [
          { title: 'Use a website you own or manage', body: 'Do not scan private or unauthorized properties.' },
          { title: 'Keep the offer specific', body: 'Use the real product, service, promotion, or primary value proposition.' },
          { title: 'Set the brand tone', body: 'Examples: premium and calm, direct and technical, friendly and local, bold and commercial.' },
          { title: 'Add competitors carefully', body: 'One competitor per line is enough. Moyi uses public website facts, not private competitor data.' }
        ]
      },
      {
        id: 'scans',
        title: 'Gather website evidence',
        body: 'A scan collects factual page data from the project website. It powers recommendations, AI CMO plans, reports, and content briefs.',
        options: [
          { title: 'Run Again', body: 'Starts a fresh scan. Use it after website changes, new pages, fixes, or campaign launches.' },
          { title: 'Scan History', body: 'Shows older scans so you can compare evidence over time instead of overwriting history.' },
          { title: 'Issue Snapshot', body: 'Shows technical/content findings tied to the selected scan.' },
          { title: 'Pages Scanned', body: 'Lists crawled pages with metadata, headings, word count, status, and image-alt signals.' }
        ],
        steps: [
          { title: 'Open a project', body: 'Go to Projects, choose the business, then open Website Scan or Scan History.' },
          { title: 'Run the scan', body: 'Wait until the status changes from pending/running to completed. Production uses Redis and a worker so scans continue in the background.' },
          { title: 'Review facts first', body: 'Check pages found, failed pages, critical issues, warnings, and opportunities before generating strategy.' },
          { title: 'Regenerate recommendations', body: 'Recommendations should be based on the latest completed scan evidence.' }
        ],
        note: 'If a scan stays pending, the web app is working but the background worker or Redis connection needs attention.'
      },
      {
        id: 'recommendations',
        title: 'Recommendations and AI CMO plan',
        body: 'Recommendations are the decision queue. They should explain what Moyi found, why it matters, which page or issue supports it, and what action can be taken.',
        options: [
          { title: 'Accept', body: 'Moves a recommendation into the active execution workflow.' },
          { title: 'Reject', body: 'Removes it from the active queue without deleting the history. Use this when the action is irrelevant or not worth doing.' },
          { title: 'Restore', body: 'Brings a rejected recommendation back if the business changes its mind.' },
          { title: 'Generate Full Pipeline', body: 'Creates multiple execution assets from an accepted recommendation, such as copy, campaign posts, or implementation guidance.' }
        ],
        steps: [
          { title: 'Generate after a completed scan', body: 'The AI CMO plan needs real scan results to create grounded recommendations.' },
          { title: 'Read the evidence', body: 'Check the target page, reason, issue category, priority, and expected impact.' },
          { title: 'Accept only work you want to execute', body: 'Accepted work appears in the workspace and content queue.' },
          { title: 'Use rejection as control', body: 'Reject recommendations that are not useful right now. This keeps the active queue clean.' }
        ]
      },
      {
        id: 'content-workspace',
        title: 'Content workspace tutorial',
        body: 'Every generated asset moves through four steps: Write, Visual, Review, and Distribute. This makes Moyi easier to operate than a loose chat prompt.',
        options: [
          { title: 'Write', body: 'Review the brief, keyword, title, business goal, persona, search intent, CTA, proof points, and draft body.' },
          { title: 'Visual', body: 'Generate or upload candidate images, preview them with the actual post, edit alt text/caption, and select one final image.' },
          { title: 'Review', body: 'Check claims, tone, formatting, image, CTA, and source recommendation. Approve, request changes, or reject.' },
          { title: 'Distribute', body: 'Copy, export, create CMS drafts, create social drafts, plan campaigns, or record manual publication.' }
        ],
        steps: [
          { title: 'Open Execution Queue', body: 'Find generated assets for the project in the project workspace or Content section.' },
          { title: 'Edit before approval', body: 'AI output is a draft. Adjust anything that is inaccurate, weak, or off-brand.' },
          { title: 'Add the final visual', body: 'Use the project logo reference when you want branded content, or upload your own image as a candidate.' },
          { title: 'Approve only when ready', body: 'Approval unlocks distribution controls. It does not publish live by itself.' }
        ]
      },
      {
        id: 'content-types',
        title: 'Content templates and when to use them',
        body: 'Choose the draft style based on the business goal. Moyi should help create assets that convert, not generic articles.',
        options: [
          { title: 'Blog article', body: 'Use for educational SEO pages and informational search demand.' },
          { title: 'Vs comparison', body: 'Use when prospects compare your SaaS, service, or offer against a named competitor.' },
          { title: 'Alternatives list', body: 'Use when users search for alternatives to a market leader and you want to position your product as a modern option.' },
          { title: 'Product-led guide', body: 'Use when you want useful education that naturally shows how the product solves each step.' },
          { title: 'FAQ section', body: 'Use when pages need better answer coverage, objection handling, and schema-ready content.' },
          { title: 'Metadata and H1 drafts', body: 'Use for low CTR, unclear page positioning, or weak search result snippets.' }
        ]
      },
      {
        id: 'images',
        title: 'Images, logos, and brand control',
        body: 'Moyi supports generated images and user uploads. Images are stored as private files, while MongoDB stores only metadata and workflow state.',
        options: [
          { title: 'Project logo', body: 'Transparent PNG with no background. Stored once at project level and used as the official brand reference.' },
          { title: 'Upload image', body: 'Upload JPG, PNG, or WebP candidates for a specific content draft.' },
          { title: 'Generate image', body: 'Creates a content-matched candidate using the draft, offer, audience, proof points, and art direction.' },
          { title: 'Reference image', body: 'Use an existing candidate to guide the next generated image.' },
          { title: 'Select', body: 'Marks one image as final for the post. Rejected images are not used.' }
        ],
        steps: [
          { title: 'Upload the logo in Project Settings', body: 'Use a transparent PNG. If the logo has a white box or colored background, fix the file first.' },
          { title: 'Ask for the logo explicitly', body: 'In art direction, write something like: include our logo in the top left using the official brand mark.' },
          { title: 'Review the output', body: 'If the logo is distorted, reject the candidate, refine the prompt, or use an uploaded image instead.' },
          { title: 'Save alt text', body: 'Write accessible alt text before selecting the final image.' }
        ],
        note: 'Logo fidelity is never guaranteed by prompt text alone. The safest method is storing the real logo and passing it as an image reference.'
      },
      {
        id: 'campaigns',
        title: 'Campaigns and calendar',
        body: 'The campaign tools organize content work over time. They do not auto-post to social platforms or send email campaigns.',
        options: [
          { title: 'Single post', body: 'Creates one draft for a specific message or announcement.' },
          { title: 'Weekly plan', body: 'Creates five scheduled posts across a week.' },
          { title: 'Monthly plan', body: 'Creates twelve scheduled posts across about thirty days.' },
          { title: 'Create social drafts', body: 'Turns an approved content asset into channel-ready drafts.' },
          { title: 'Mark as published', body: 'Records that the work was manually published somewhere else.' }
        ],
        steps: [
          { title: 'Create or choose a campaign', body: 'Give it a goal, audience, and date window.' },
          { title: 'Generate drafts', body: 'Use approved content or campaign planning to create posts.' },
          { title: 'Review each post', body: 'Edit the message, channel, date, status, and image link if available.' },
          { title: 'Publish manually', body: 'Copy/export the post or use a connected CMS draft. Then mark it as published in Moyi.' }
        ]
      },
      {
        id: 'integrations',
        title: 'Integrations and publishing',
        body: 'Integrations are project-specific. Moyi is intentionally conservative: it creates drafts or sends approved payloads, but does not silently publish live content.',
        options: [
          { title: 'Google Search Console', body: 'Connects readonly search performance so Moyi can identify CTR, page two, query, page, country, and device opportunities.' },
          { title: 'WordPress', body: 'Creates draft posts from approved article-style content.' },
          { title: 'Webflow', body: 'Creates draft or unpublished CMS items when the Webflow collection mapping is configured.' },
          { title: 'Shopify', body: 'Creates blog article drafts through the Shopify Admin API.' },
          { title: 'Outgoing webhook', body: 'Sends approved content to custom frontends such as Next.js, Framer, Ghost, or internal systems.' }
        ],
        steps: [
          { title: 'Open Project Integrations', body: 'Connect only the platforms this business actually uses.' },
          { title: 'Save credentials', body: 'Tokens and passwords are stored server-side and should be configured securely.' },
          { title: 'Use test buttons', body: 'Test the connection before relying on publishing workflows.' },
          { title: 'Approve content first', body: 'Distribution options appear only when the draft status allows it.' }
        ]
      },
      {
        id: 'measurement',
        title: 'Measurement and reports',
        body: 'Reports close the loop by explaining what changed, what is missing, and what action should happen next.',
        options: [
          { title: 'Search Console performance', body: 'Shows queries, pages, CTR, impressions, clicks, position, and GSC opportunities.' },
          { title: 'Boost CTR opportunity', body: 'Page-one queries with CTR below the project average. Usually points to title/meta improvements.' },
          { title: 'Push to page one', body: 'Page-two queries with meaningful impressions. Usually points to content expansion, FAQs, headings, or internal links.' },
          { title: 'Weekly report', body: 'Best for operating rhythm and near-term priorities.' },
          { title: 'Monthly report', body: 'Best for owner/executive review and strategic decisions.' }
        ],
        steps: [
          { title: 'Connect data sources', body: 'Use Search Console and first-party tracking where available.' },
          { title: 'Define conversion goals', body: 'Tell Moyi which events matter to the business.' },
          { title: 'Generate reports after activity exists', body: 'Reports become stronger after scans, recommendations, drafts, campaigns, and tracking data accumulate.' },
          { title: 'Read limitations', body: 'If a report says data is missing, fix the data source instead of treating the report as complete.' }
        ]
      },
      {
        id: 'account-billing',
        title: 'Account, billing, and limits',
        body: 'Moyi uses plan limits to control cost and keep the platform stable. Usage is measured monthly.',
        options: [
          { title: 'Free', body: 'Best for trying the workflow and seeing whether the product fits.' },
          { title: 'Starter', body: 'Best for one small business that needs regular scans and content work.' },
          { title: 'Pro', body: 'Best for a growing business or active marketer managing more work.' },
          { title: 'Agency', body: 'Best for managing multiple clients or heavier execution volume.' },
          { title: 'Yearly billing', body: 'Gives a discount compared with monthly billing and helps teams commit to a full growth cycle.' }
        ],
        steps: [
          { title: 'Open Billing', body: 'Review plan, usage, and upgrade options.' },
          { title: 'Choose monthly or yearly', body: 'Yearly is cheaper over the year. Monthly is more flexible.' },
          { title: 'Use Stripe checkout', body: 'Moyi sends payment and subscription management to Stripe.' },
          { title: 'Manage subscription', body: 'Use the billing portal for updates, cancellations, and payment method changes.' }
        ]
      },
      {
        id: 'troubleshooting',
        title: 'Troubleshooting',
        body: 'Most issues fall into a few categories: missing environment variables, background worker not running, third-party credentials not ready, or missing data.',
        options: [
          { title: 'Scan stuck pending', body: 'Check Redis, BullMQ worker, DISABLE_QUEUE, and worker logs.' },
          { title: 'AI plan gives weak output', body: 'Run a completed scan first, add business context, and make sure OPENAI_API_KEY is configured.' },
          { title: 'No recommendations', body: 'Confirm the latest scan completed and stored issues/pages. Recommendations should come from actual scan evidence.' },
          { title: 'Email not sending', body: 'Check SMTP credentials, sender verification, domain authentication, and provider delivery logs.' },
          { title: 'Image/logo issue', body: 'Use a transparent PNG logo, clear art direction, and reject distorted candidates.' }
        ],
        note: 'In production, /readyz is the first place to check. It reports MongoDB, queue state, and configuration problems.'
      }
    ]
  },
  demo: {
    eyebrow: 'Product walkthrough',
    title: 'See how work moves through Moyi',
    intro: 'The demo path follows the same operating sequence used inside a real project, from public evidence to reviewed execution.',
    primaryAction: { label: 'Explore Features', href: '/features' },
    secondaryAction: { label: 'Create Free Account', href: '/register' },
    sections: [
      { id: 'discover', title: 'Discover', body: 'Start with a public website scan. The preview shows only findings Moyi can observe from crawlable pages and deliberately limits the result before account creation.', bullets: ['Page and metadata checks', 'Visible issue sample', 'Public signal score'] },
      { id: 'decide', title: 'Decide', body: 'Inside a project, calibrate the business context and generate an AI CMO plan. The result is a ranked queue, not an unstructured chat response.', bullets: ['Evidence-linked recommendations', 'Priority and effort', 'Accept, reject, and restore controls'] },
      { id: 'create', title: 'Create', body: 'Generate supported assets from recommendations or plan campaign posts directly in Content Studio. Article work includes copy, image candidates, final review, and distribution controls.', bullets: ['Human-editable drafts', 'Generated or uploaded visuals', 'Single, weekly, and monthly campaign planning'] },
      { id: 'measure', title: 'Measure', body: 'Review search performance, conversions, attribution readiness, and recurring reports. Moyi reports absent data honestly and keeps publishing under human control.', bullets: ['Search Console opportunities', 'Weekly and monthly reporting', 'No automatic live publishing'] }
    ]
  },
  reports: {
    eyebrow: 'Measurement resources',
    title: 'Reports built around recorded evidence',
    intro: 'Moyi’s reports explain what changed, what remains uncertain, and what the team should review next.',
    primaryAction: { label: 'Open Workspace', href: '/workspace' },
    secondaryAction: { label: 'Read Documentation', href: '/docs#measurement' },
    sections: [
      { id: 'weekly', title: 'Weekly CMO report', body: 'The weekly report covers the latest seven-day period against the preceding period. It summarizes available search, conversion, execution, and campaign signals for operational review.', bullets: ['Current and prior-period metrics', 'Completed and outstanding work', 'Evidence-based next actions', 'Explicit data-quality notes'] },
      { id: 'monthly', title: 'Monthly executive report', body: 'The monthly report uses a thirty-day window and focuses on direction, business implications, campaign progress, and decisions that need owner approval.', bullets: ['Trend and period comparison', 'Strategic risks and opportunities', 'Campaign and content progress', 'Recommended priorities for the next month'] },
      { id: 'sources', title: 'Data sources', body: 'A report can use only information available to the project at generation time. Depending on setup, that can include website scans, Google Search Console, first-party tracking events, conversion goals, campaigns, drafts, and recommendation history.', bullets: ['Disconnected sources are identified as gaps.', 'Moyi does not manufacture missing traffic or conversion values.', 'External platform credentials remain project-specific.'] },
      { id: 'interpretation', title: 'How to interpret a report', body: 'Treat a report as a decision document, not proof of causation. Confirm the measurement window, source health, sample size, and business context before changing spend or publishing strategy.', bullets: ['Measured facts and recommendations serve different purposes.', 'Correlation does not prove that one marketing action caused an outcome.', 'Human approval remains required for consequential actions.'] }
    ]
  },
  roadmap: {
    eyebrow: 'Product direction',
    title: 'What Moyi supports and what comes next',
    intro: 'This roadmap communicates direction without fixed delivery dates. Priorities can change as reliability, security, and customer evidence develop.',
    primaryAction: { label: 'Use Available Features', href: '/register' },
    secondaryAction: { label: 'Send Feedback', href: '/contact' },
    sections: [
      { id: 'available', title: 'Available now', body: 'The current product covers the operating foundation of an evidence-led AI CMO.', bullets: ['Website scanning and scan-specific recommendations', 'AI CMO plans and execution queues', 'Multi-agent content drafts and image review', 'Single, weekly, and monthly campaign planning', 'Content calendar and human approval', 'Search Console opportunities and recurring reports'] },
      { id: 'next', title: 'Current product focus', body: 'Near-term work is centered on making existing capabilities more reliable, easier to operate, and clearer for teams.', bullets: ['Stronger campaign editing and reusable briefs', 'Clearer onboarding and in-product documentation', 'Improved report comparisons and decision tracking', 'Operational monitoring and recovery tooling'] },
      { id: 'later', title: 'Exploration', body: 'These areas are being evaluated and are not commitments.', bullets: ['Video asset workflows', 'Additional publishing destinations', 'Deeper campaign performance feedback', 'More collaboration and approval roles'] }
    ]
  },
  about: {
    eyebrow: 'About Moyi',
    title: 'An AI CMO that shows its work',
    intro: 'Moyi is built for businesses that need marketing decisions connected to evidence, execution, review, and measurement.',
    primaryAction: { label: 'Start Free', href: '/register' },
    secondaryAction: { label: 'Contact Moyi', href: '/contact' },
    sections: [
      { id: 'purpose', title: 'Why Moyi exists', body: 'Marketing tools often stop at dashboards or generic generation. Moyi connects discovery, prioritization, content operations, campaign planning, and reporting in one project workspace.', bullets: ['Evidence before recommendations', 'Structured work instead of endless chat', 'Human approval before external action'] },
      { id: 'principles', title: 'Operating principles', body: 'The product is designed to be useful without pretending certainty.', bullets: ['Do not invent findings, results, or customer proof.', 'Keep scan and recommendation evidence traceable.', 'Make data gaps visible.', 'Give users control over edits, approvals, publishing, and integrations.'] },
      { id: 'businesses', title: 'Who it is for', body: 'Moyi supports business owners, marketers, and small teams that need a repeatable way to turn website and search evidence into organized marketing work.', bullets: ['SaaS and service businesses', 'Teams managing content and organic growth', 'Operators who need one accountable workflow'] }
    ]
  }
};
