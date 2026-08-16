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
      { id: 'operations', title: 'Campaign operations', body: 'Use the content calendar to edit, schedule, approve, and publish campaign posts to connected social accounts.', bullets: ['Posts remain grouped under campaign objectives.', 'Only approved drafts can be published.', 'Each connected account receives its own visible job status.'] },
      { id: 'measurement', title: 'Measurement and reporting', body: 'Connect supported data sources, monitor search and social performance, and prepare recurring decision reports.', bullets: ['Social engagement snapshots from supported providers', 'Google Search Console and first-party conversion signals', 'Weekly and monthly evidence-based reporting'] }
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
    intro: 'A structured guide to Moyi. The sections follow the same order as the product flow: set up the workspace, collect evidence, decide what matters, create content, attach visuals, plan campaigns, connect channels, publish safely, measure results, manage billing, and troubleshoot when needed.',
    primaryAction: { label: 'Open Dashboard', href: '/dashboard' },
    secondaryAction: { label: 'Create Account', href: '/register' },
    sections: [
      {
        id: 'product-map',
        title: 'How the product fits together',
        body: 'Use Moyi in the same order every time so each feature receives the right inputs and produces the right output. The workflow below is the shortest path from a website URL to measured marketing work.',
        steps: [
          { title: '1. Set up the project', body: 'Create the workspace, add the website, and save the brand context.' },
          { title: '2. Collect evidence', body: 'Run scans and connect measurement sources so Moyi can work from facts.' },
          { title: '3. Decide the work', body: 'Review the AI CMO plan and accept only recommendations worth executing.' },
          { title: '4. Create the asset', body: 'Generate content, edit the copy, and attach a final visual.' },
          { title: '5. Distribute safely', body: 'Use the calendar, integrations, or API only after human approval.' },
          { title: '6. Measure and improve', body: 'Read social and search performance, then feed the results into the next plan.' }
        ],
        note: 'If a step is missing data, fix the missing source first. Moyi is designed to show incomplete evidence instead of guessing.'
      },
      {
        id: 'setup-tutorials',
        title: 'Configuration tutorials',
        body: 'Use these short guides when you only need to configure one part of the workspace. Each tutorial focuses on one setup task and points to the exact place to finish it.',
        tutorials: [
          {
            title: 'Connect Search Console',
            href: '/integrations',
            summary: 'Connect Google Search Console so Moyi can read real search evidence and surface CTR, query, and page opportunities.',
            steps: [
              'Open Integrations from the workspace.',
              'Sign in with the same Google account that owns or can view the property.',
              'Choose the verified Search Console property.',
              'Confirm the connection and refresh the workspace.'
            ]
          },
          {
            title: 'Set up social accounts',
            href: '/projects/new',
            summary: 'Connect the platforms you want to publish to, then reconnect any account that needs new scopes or expired access.',
            steps: [
              'Open Social Accounts from a project.',
              'Connect LinkedIn, X, Bluesky, Meta, Threads, TikTok, or YouTube.',
              'Grant the requested publishing and insights permissions.',
              'Return to the calendar and confirm the connected targets.'
            ]
          },
          {
            title: 'Enable tracking',
            href: '/integrations',
            summary: 'Install the tracking script and define conversion goals so Moyi can measure outcomes instead of guessing.',
            steps: [
              'Open Tracking setup inside the project.',
              'Copy the tracking snippet into the website.',
              'Create conversion goals for the events that matter.',
              'Check the dashboard until telemetry is healthy.'
            ]
          },
          {
            title: 'Review billing and limits',
            href: '/billing',
            summary: 'Check the current plan, usage, and monthly limits before handing the workspace to a customer or team.',
            steps: [
              'Open Billing from the main menu.',
              'Review the current plan and monthly usage counters.',
              'Upgrade only when the team is ready for more volume.',
              'Use the account page for API keys and data export if needed.'
            ]
          }
        ]
      },
      {
        id: 'first-run',
        title: 'Quick start: first useful result',
        body: 'Use this path when you want the first end-to-end run without reading every section first.',
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
        title: 'Project setup',
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
        title: 'Website evidence',
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
        title: 'Recommendations and planning',
        body: 'Recommendations are the decision queue. They explain what Moyi found, why it matters, which page or issue supports it, and what action can be taken.',
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
        title: 'Content workspace',
        body: 'Every generated asset moves through four steps: Write, Visual, Review, and Distribute. This keeps the work understandable instead of letting it become a loose prompt thread.',
        options: [
          { title: 'Write', body: 'Review the brief, keyword, title, business goal, persona, search intent, CTA, proof points, and draft body.' },
          { title: 'Visual', body: 'Generate or upload candidate images, preview them with the actual post, edit alt text/caption, and select one final image.' },
          { title: 'Review', body: 'Check claims, tone, formatting, image, CTA, and source recommendation. Approve, request changes, or reject.' },
          { title: 'Distribute', body: 'Copy, export, create CMS drafts, or publish an approved social draft now or on a schedule.' }
        ],
        steps: [
          { title: 'Open Execution Queue', body: 'Find generated assets for the project in the project workspace or Content section.' },
          { title: 'Edit before approval', body: 'AI output is a draft. Adjust anything that is inaccurate, weak, or off-brand.' },
          { title: 'Add the final visual', body: 'Use the project logo reference when you want branded content, or upload your own image as a candidate.' },
          { title: 'Approve only when ready', body: 'Approval unlocks distribution controls. A separate publish command or schedule is still required.' }
        ]
      },
      {
        id: 'content-types',
        title: 'Content templates',
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
        title: 'Images and logos',
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
        body: 'The campaign tools organize content work over time. Approved social drafts can be explicitly published now or scheduled; email campaigns are not sent automatically.',
        options: [
          { title: 'Single post', body: 'Creates one draft for a specific message or announcement.' },
          { title: 'Weekly plan', body: 'Creates five scheduled posts across a week.' },
          { title: 'Monthly plan', body: 'Creates twelve scheduled posts across about thirty days.' },
          { title: 'Create social drafts', body: 'Turns an approved content asset into channel-ready drafts.' },
          { title: 'Publish panel', body: 'Select connected accounts, media, platform options, and an immediate or scheduled publish time.' }
        ],
        steps: [
          { title: 'Create or choose a campaign', body: 'Give it a goal, audience, and date window.' },
          { title: 'Generate drafts', body: 'Use approved content or campaign planning to create posts.' },
          { title: 'Review each post', body: 'Edit the message, channel, date, status, and image link if available.' },
          { title: 'Publish after approval', body: 'Choose connected accounts and publish now or schedule the approved draft. Moyi shows each destination result independently.' }
        ]
      },
      {
        id: 'integrations',
        title: 'Integrations and publishing',
        body: 'Integrations are project-specific. Moyi publishes only after human approval and an explicit publish command or schedule, and reports each provider result.',
        options: [
          { title: 'Google Search Console', body: 'Connects readonly search performance so Moyi can identify CTR, page two, query, page, country, and device opportunities.' },
          { title: 'WordPress', body: 'Creates draft posts from approved article-style content.' },
          { title: 'Webflow', body: 'Creates draft or unpublished CMS items when the Webflow collection mapping is configured.' },
          { title: 'Shopify', body: 'Creates blog article drafts through the Shopify Admin API.' },
          { title: 'Outgoing webhook', body: 'Sends approved content to custom frontends such as Next.js, Framer, Ghost, or internal systems.' },
          { title: 'Native social accounts', body: 'Connect Bluesky, X, LinkedIn, Facebook, Instagram, Threads, TikTok, and YouTube for approved publishing and engagement pull-back.' }
        ],
        steps: [
          { title: 'Open Project Integrations', body: 'Connect only the platforms this business actually uses.' },
          { title: 'Save credentials', body: 'Tokens and passwords are stored server-side and should be configured securely.' },
          { title: 'Use test buttons', body: 'Test the connection before relying on publishing workflows.' },
          { title: 'Approve content first', body: 'Distribution options appear only when the draft status allows it.' }
        ]
      },
      {
        id: 'content-distribution-api',
        title: 'Publishing, recovery, and API',
        body: 'Moyi owns the social publishing queue, token storage, recovery state, and engagement data. Agency workspaces can publish approved drafts across separated client projects.',
        options: [
          { title: 'API root', body: 'Start with GET /api/v1 to inspect the key, allowed projects, and supported routes before wiring automation.' },
          { title: 'Social Performance', body: 'Shows available exposure, engagement, post links, account health, retries, and reconnect requirements for 7, 30, or 90 days.' },
          { title: 'Agency roles', body: 'Owners and admins manage accounts; publishers can publish approved drafts; analysts have read-only access.' },
          { title: 'Public API keys', body: 'Create a one-time project-scoped key in Account settings for connected accounts, approved publishing jobs, status, or analytics.' },
          { title: 'Recovery', body: 'Transient failures retry with platform-aware delays. Permanent or unknown-outcome jobs wait for operator review in dead-letter state.' }
        ],
        steps: [
          { title: 'Connect and approve', body: 'Connect social accounts in the client project and approve a draft before attempting publication.' },
          { title: 'Publish or schedule', body: 'Select one or more permitted destination accounts in the Calendar publish panel.' },
          { title: 'Watch status', body: 'Review queued, publishing, retry, published, reconnect, and dead-letter states for every account.' },
          { title: 'Close the loop', body: 'Use Social Performance and future Growth Brain recommendations after metrics have been collected.' }
        ],
        note: 'Provider metrics vary by platform and approved scopes. A missing metric is unavailable evidence, not a measured zero.'
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
        id: 'gdpr-and-security',
        title: 'GDPR, Privacy & Data Governance',
        body: 'Moyi is built from the ground up for transparent data protection, GDPR and CCPA/CPRA compliance, and human-supervised AI operations.',
        options: [
          { title: 'Read-Only GSC Integration', body: 'Google Search Console access is strictly read-only. Moyi never alters sitemaps, DNS records, or index settings on Google.' },
          { title: 'Zero AI Training Guarantee', body: 'Customer business data, prompts, and scans are never used to train foundation AI models without explicit consent.' },
          { title: 'AES-256 Encrypted Vault', body: 'OAuth tokens, API keys, and integration secrets are encrypted at rest using industry-standard cryptography.' },
          { title: '1-Click Data Export', body: 'Download your full account, project, content, and scan history at any time from Account Settings (/account/export).' },
          { title: 'Right to Erasure', body: 'Permanently delete your account and all associated projects in one click with hard-deletion confirmation (/account/delete).' },
          { title: 'Cookiebot Consent CMP', body: 'Integrated with Cookiebot CMP to guarantee automated consent collection, categorized cookie tables, and user revocation controls.' }
        ],
        steps: [
          { title: 'Review Sub-processors', body: 'Consult our Privacy Policy (/privacy) for full disclosure of trusted sub-processors (Stripe, OpenAI, Google, Cookiebot, MongoDB).' },
          { title: 'Configure Cookie Consent', body: 'Cookiebot banner operates automatically across all pages with full consent logging and prior blocking.' },
          { title: 'Export or Delete Data', body: 'Use Account Settings to exercise your GDPR Article 15-22 rights at any time without waiting for manual processing.' }
        ],
        note: 'For formal Data Processing Agreements (DPA) or privacy inquiries, submit a request via /contact selecting Privacy request.'
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
  'ai-cmo-software': {
    eyebrow: 'AI CMO software',
    title: 'AI CMO software for evidence-led SEO growth',
    seoTitle: 'AI CMO Software for SEO Growth and Content Distribution',
    seoDescription: 'Moyi-CMO is AI CMO software that turns website scans, Google Search Console data, approved drafts, social publishing, and engagement signals into a repeatable growth workflow.',
    schemaAbout: 'AI CMO software for SEO, content marketing, social publishing, and growth reporting',
    intro: 'Moyi-CMO helps teams move from scattered marketing ideas to a controlled operating system: discover evidence, decide priorities, create assets, approve work, distribute content, and learn from performance.',
    primaryAction: { label: 'Start Free', href: '/register' },
    secondaryAction: { label: 'See How It Works', href: '/how-it-works' },
    sections: [
      {
        id: 'what-it-does',
        title: 'What an AI CMO should actually do',
        body: 'A useful AI CMO should not only write copy. It should connect facts, priorities, execution, approvals, publishing, and measurement so the business can make better marketing decisions every week.',
        bullets: ['Scan the website and preserve crawl evidence.', 'Use Search Console data when the project connects it.', 'Rank SEO and content opportunities by impact and effort.', 'Generate drafts and social posts from approved business context.', 'Require human approval before external publishing.', 'Collect performance signals for the next recommendation cycle.']
      },
      {
        id: 'workflow',
        title: 'The Moyi operating loop',
        body: 'Moyi is structured around a closed loop rather than a one-off prompt. Each stage has a clear owner, state, and next action.',
        steps: [
          { title: 'Discover', body: 'Run website scans and connect readonly search data.' },
          { title: 'Decide', body: 'Review the AI CMO plan and accept only the work that matters.' },
          { title: 'Create', body: 'Generate website content, campaign posts, visuals, and execution briefs.' },
          { title: 'Approve', body: 'Keep a human review step before publishing or exporting anything.' },
          { title: 'Distribute', body: 'Publish approved social drafts to connected accounts or create CMS drafts.' },
          { title: 'Learn', body: 'Use search, social, and conversion signals to improve future recommendations.' }
        ]
      },
      {
        id: 'fit',
        title: 'Who Moyi is built for',
        body: 'Moyi is strongest for teams that need accountable marketing operations, not just more generated text.',
        bullets: ['SaaS founders who need clear growth priorities.', 'Marketing managers who need SEO and content execution in one place.', 'Agencies managing multiple client workspaces.', 'Operators who need weekly reports, campaign plans, and publishing status.']
      }
    ],
    faqs: [
      { question: 'Is Moyi-CMO only a content generator?', answer: 'No. Moyi generates content, but the core product connects website evidence, Search Console data, recommendations, approvals, publishing, metrics, and reports.' },
      { question: 'Does Moyi publish automatically?', answer: 'No. Publishing requires human approval and an explicit publish or schedule action.' },
      { question: 'Can Moyi replace a marketing team?', answer: 'Moyi is designed to support owners, marketers, and agencies by organizing evidence and execution. Human strategy, approval, and judgment remain part of the workflow.' }
    ],
    related: [
      { label: 'SEO Growth Software', href: '/seo-growth-software', body: 'See how Moyi turns website and search evidence into growth recommendations.' },
      { label: 'AI Content Marketing Platform', href: '/ai-content-marketing-platform', body: 'Create approved drafts, visuals, campaign posts, and content workflows.' },
      { label: 'Social Media Publishing Tool', href: '/social-media-publishing-tool', body: 'Publish approved drafts to connected social accounts.' }
    ]
  },
  'seo-growth-software': {
    eyebrow: 'SEO growth software',
    title: 'SEO growth software that turns evidence into action',
    seoTitle: 'SEO Growth Software for Website Scans and Search Console Insights',
    seoDescription: 'Moyi-CMO helps teams turn website scans, Search Console data, SEO issues, and content opportunities into prioritized recommendations and execution workflows.',
    schemaAbout: 'SEO growth software for website scans, recommendations, Search Console insights, and content execution',
    intro: 'Moyi gives SEO work a practical operating rhythm: scan the site, identify opportunities, accept the right priorities, create the assets, and measure whether visibility improves.',
    primaryAction: { label: 'Run Moyi', href: '/register' },
    secondaryAction: { label: 'Read Documentation', href: '/docs#scans' },
    sections: [
      { id: 'evidence', title: 'Start with crawlable evidence', body: 'Moyi scans public website pages and records observable page structure, metadata, headings, status, content depth, links, image-alt signals, and supported technical findings.', bullets: ['Page-level evidence stays traceable.', 'Recommendations are connected to recorded scans.', 'Missing data is shown instead of guessed.'] },
      { id: 'priorities', title: 'Prioritize the SEO work that matters', body: 'The AI CMO plan turns scan findings into ranked work so teams can avoid chasing every possible task at once.', bullets: ['Critical fixes and quick wins', 'Content expansion opportunities', 'Title, meta, heading, and internal link improvements', 'Evidence-backed next actions'] },
      { id: 'execution', title: 'Move from SEO issue to finished asset', body: 'Accepted recommendations can feed content briefs, articles, metadata drafts, campaign posts, visual workflows, and reports.', bullets: ['SEO strategist, copywriter, and editor stages', 'Human review before publishing', 'Weekly and monthly reporting'] }
    ],
    faqs: [
      { question: 'Does Moyi replace SEO tools like Ahrefs or Semrush?', answer: 'Moyi focuses on evidence-led workflow and execution. It can complement keyword and backlink tools by turning website and Search Console evidence into reviewed work.' },
      { question: 'Does Moyi use private competitor data?', answer: 'No. Competitor comparison uses public website evidence and should be treated as directional, not as market traffic or ranking proof.' }
    ],
    related: [
      { label: 'Search Console Reporting Tool', href: '/google-search-console-reporting-tool', body: 'Analyze clicks, impressions, CTR, average position, queries, and pages.' },
      { label: 'AI CMO Software', href: '/ai-cmo-software', body: 'Connect SEO recommendations with content and publishing.' }
    ]
  },
  'google-search-console-reporting-tool': {
    eyebrow: 'Search Console reporting',
    title: 'Google Search Console reporting tool for marketing action',
    seoTitle: 'Google Search Console Reporting Tool for SEO Recommendations',
    seoDescription: 'Moyi-CMO connects to Google Search Console with readonly access and turns queries, pages, CTR, clicks, impressions, and position into SEO recommendations and reports.',
    schemaAbout: 'Google Search Console reporting tool for SEO opportunities and marketing recommendations',
    intro: 'Search Console has valuable data, but most teams need help turning it into next actions. Moyi reads Search Console evidence and organizes it into opportunities, dashboards, and reports.',
    primaryAction: { label: 'Connect Search Console', href: '/register' },
    secondaryAction: { label: 'Read Setup Guide', href: '/docs#setup-tutorials' },
    sections: [
      { id: 'readonly', title: 'Readonly search evidence', body: 'Moyi requests readonly Search Console access so it can analyze the property without modifying it.', bullets: ['Queries and pages', 'Clicks and impressions', 'Average CTR and position', 'Countries and devices where available'] },
      { id: 'opportunities', title: 'Opportunities Moyi can surface', body: 'Search performance becomes useful when it points to a clear decision.', bullets: ['High impressions with low CTR', 'Page-two queries close to page one', 'Pages gaining or losing visibility', 'Queries that need stronger content coverage'] },
      { id: 'reports', title: 'Search data inside weekly reporting', body: 'Moyi uses Search Console data in performance views and recurring reports so teams can discuss what changed and what to do next.', bullets: ['Weekly review rhythm', 'Data-quality notes', 'Next recommended actions'] }
    ],
    faqs: [
      { question: 'Does Moyi need write access to Search Console?', answer: 'No. Moyi requests readonly access for Search Console analysis.' },
      { question: 'Why does Moyi say no property is connected if Google is connected?', answer: 'The Google account can be connected while no verified Search Console property is available for that project. The account must own or have view access to the property.' }
    ],
    related: [
      { label: 'SEO Growth Software', href: '/seo-growth-software', body: 'Turn search evidence into prioritized SEO execution.' },
      { label: 'Reports Guide', href: '/reports', body: 'Understand how Moyi uses evidence in recurring reports.' }
    ]
  },
  'ai-content-marketing-platform': {
    eyebrow: 'AI content marketing platform',
    title: 'AI content marketing platform with human approval',
    seoTitle: 'AI Content Marketing Platform for SEO Drafts and Campaign Posts',
    seoDescription: 'Moyi-CMO creates SEO content drafts, social posts, campaign plans, visuals, and publishing workflows from website evidence and approved business context.',
    schemaAbout: 'AI content marketing platform for SEO content, campaign planning, visuals, and social posts',
    intro: 'Moyi helps teams create marketing assets from real project context instead of isolated prompts. Drafts move through writing, visual review, approval, and distribution.',
    primaryAction: { label: 'Create Content', href: '/register' },
    secondaryAction: { label: 'View Features', href: '/features#content' },
    sections: [
      { id: 'drafts', title: 'Create drafts from evidence', body: 'Accepted recommendations and campaign objectives can become articles, landing page copy, metadata, FAQs, social posts, and execution briefs.', bullets: ['Blog articles and product-led guides', 'Vs and alternatives pages', 'FAQ and metadata drafts', 'Campaign social posts'] },
      { id: 'visuals', title: 'Review visuals before approval', body: 'Users can generate or upload candidate images, edit alt text, select a final image, and keep the official logo as a project asset.', bullets: ['Image candidates', 'Selected and rejected states', 'Brand logo reference', 'Accessible alt text'] },
      { id: 'approval', title: 'Human approval protects quality', body: 'Moyi keeps content as a draft until a person approves it. Approval unlocks publishing and export actions, but does not publish by itself.', bullets: ['Review copy and claims', 'Check image and CTA', 'Publish or schedule only when ready'] }
    ],
    faqs: [
      { question: 'Can Moyi create social posts from approved content?', answer: 'Yes. Approved content can be turned into channel-ready social drafts and scheduled in the content calendar.' },
      { question: 'Can users upload their own images?', answer: 'Yes. Users can upload image candidates and select the final image used with a draft.' }
    ],
    related: [
      { label: 'Social Media Publishing Tool', href: '/social-media-publishing-tool', body: 'Send approved drafts to connected channels.' },
      { label: 'AI CMO Software', href: '/ai-cmo-software', body: 'See the full evidence-to-execution workflow.' }
    ]
  },
  'social-media-publishing-tool': {
    eyebrow: 'Social media publishing',
    title: 'Social media publishing tool for approved marketing drafts',
    seoTitle: 'Social Media Publishing Tool for Approved AI Marketing Drafts',
    seoDescription: 'Moyi-CMO lets users connect social accounts, approve drafts, publish or schedule posts, attach media, track status, and collect engagement metrics.',
    schemaAbout: 'Social media publishing tool for approved drafts, scheduling, connected accounts, and engagement metrics',
    intro: 'Moyi owns the publishing layer so teams can move approved content into distribution without depending on a third-party scheduler.',
    primaryAction: { label: 'Connect Channels', href: '/register' },
    secondaryAction: { label: 'Read Publishing Docs', href: '/docs#content-distribution-api' },
    sections: [
      { id: 'channels', title: 'Connect publishing accounts', body: 'Moyi supports native social account connections for approved publishing workflows as platform access and app review allow.', bullets: ['LinkedIn, X, Bluesky, Facebook, Instagram, Threads, TikTok, and YouTube architecture', 'Encrypted token storage', 'Reconnect states and status visibility'] },
      { id: 'approval', title: 'Publish only reviewed work', body: 'A draft must be reviewed before it can be published. Users choose accounts and publish now or schedule a time.', bullets: ['One publish batch per approved action', 'One publish job per selected account', 'Queued, publishing, published, failed, and dead-letter states'] },
      { id: 'metrics', title: 'Close the loop with engagement', body: 'Published posts can receive engagement snapshots where platforms and scopes make metrics available.', bullets: ['Impressions where available', 'Likes, comments, shares, reposts, and clicks where available', 'Growth Brain-ready performance inputs'] }
    ],
    faqs: [
      { question: 'Does Moyi require a third-party scheduler API key?', answer: 'No. Moyi owns the publishing layer and stores provider connections directly.' },
      { question: 'Can posts be scheduled?', answer: 'Yes. Approved drafts can be published immediately or scheduled through the content calendar.' }
    ],
    related: [
      { label: 'AI Content Marketing Platform', href: '/ai-content-marketing-platform', body: 'Create the approved drafts that enter publishing.' },
      { label: 'AI CMO Software', href: '/ai-cmo-software', body: 'Connect publishing with evidence and analytics.' }
    ]
  },
  'agency-seo-reporting-software': {
    eyebrow: 'Agency SEO reporting',
    title: 'Agency SEO reporting software for client workspaces',
    seoTitle: 'Agency SEO Reporting Software for Client Workspaces',
    seoDescription: 'Moyi-CMO helps agencies manage client projects, SEO evidence, recommendations, approved content, publishing, usage, and reporting in separated workspaces.',
    schemaAbout: 'Agency SEO reporting software for client projects, roles, publishing, and growth reports',
    intro: 'Moyi gives agencies a controlled workspace for each client, with clear setup status, roles, connected accounts, recommendations, content, publishing, and reporting.',
    primaryAction: { label: 'Start Agency Workspace', href: '/register' },
    secondaryAction: { label: 'See Roadmap', href: '/roadmap' },
    sections: [
      { id: 'clients', title: 'Separate client projects', body: 'Each client can have its own website, scans, Search Console property, social accounts, campaigns, drafts, reports, and usage state.', bullets: ['Project-level evidence', 'Client-specific connected accounts', 'Clear setup status'] },
      { id: 'roles', title: 'Roles and approvals', body: 'Agency workflows need control. Moyi supports organization and project roles so the right people can manage, publish, analyze, or approve work.', bullets: ['Owner and admin management', 'Publisher roles for approved drafts', 'Analyst-style read access'] },
      { id: 'reporting', title: 'Reports clients can understand', body: 'Reports focus on evidence, what changed, and what needs review next instead of generic SEO scorecards.', bullets: ['Weekly and monthly reports', 'Search and social performance inputs', 'Data-quality notes and limitations'] }
    ],
    faqs: [
      { question: 'Can one agency user manage multiple clients?', answer: 'Yes. Moyi includes organization and project structures for managing multiple client workspaces.' },
      { question: 'Can the same draft publish to accounts from different clients?', answer: 'Moyi is structured to keep accounts separated by project or workspace, so cross-client publishing requires explicit permission and selected destinations.' }
    ],
    related: [
      { label: 'Search Console Reporting Tool', href: '/google-search-console-reporting-tool', body: 'Connect readonly search data for each client project.' },
      { label: 'Social Media Publishing Tool', href: '/social-media-publishing-tool', body: 'Publish approved client posts to connected accounts.' }
    ]
  },
  'marketing-automation-for-startups': {
    eyebrow: 'Startup marketing automation',
    title: 'Marketing automation for startups that need focus',
    seoTitle: 'Marketing Automation for Startups Using SEO and Content Evidence',
    seoDescription: 'Moyi-CMO helps startups prioritize SEO work, create content, schedule approved social posts, and report progress without building a full marketing team first.',
    schemaAbout: 'Marketing automation for startups, SEO recommendations, content planning, and social publishing',
    intro: 'Early teams do not need more disconnected marketing tasks. They need a simple loop that shows what to do next, creates usable drafts, and measures what happened.',
    primaryAction: { label: 'Try Moyi Free', href: '/register' },
    secondaryAction: { label: 'See Pricing', href: '/pricing' },
    sections: [
      { id: 'focus', title: 'Turn uncertainty into a short queue', body: 'Moyi uses website and search evidence to create a manageable list of growth actions instead of a long, vague backlog.', bullets: ['Website scan findings', 'Search Console opportunities', 'Accepted recommendations only'] },
      { id: 'content', title: 'Create enough content to learn', body: 'Startups can turn the best opportunities into pages, posts, visuals, and campaign drafts without losing human review.', bullets: ['SEO drafts', 'Social posts', 'Weekly plans', 'Approval before distribution'] },
      { id: 'measure', title: 'Learn before scaling spend', body: 'Moyi helps track search, publishing, and conversion signals so founders can see what deserves more investment.', bullets: ['Recurring reports', 'Engagement pull-back', 'Growth Brain inputs'] }
    ],
    faqs: [
      { question: 'Is there a free plan?', answer: 'Yes. Moyi includes a free entry point so teams can test the workflow before committing to a paid plan.' },
      { question: 'Why should a startup use Moyi instead of hiring immediately?', answer: 'Moyi helps founders organize evidence, priorities, content, publishing, and reports while they are still learning which channels work.' }
    ],
    related: [
      { label: 'AI CMO Software', href: '/ai-cmo-software', body: 'Understand the full AI CMO workflow.' },
      { label: 'SEO Growth Software', href: '/seo-growth-software', body: 'Start with organic growth evidence.' }
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
