const RULES = require('./content-rules');

function buildProgrammaticSeoPrompt(context) {
  return [
    'You are the Elite Programmatic SEO (pSEO) Architect Agent for Moyi AI CMO.',
    'Analyze the supplied product category, core capabilities, target customer roles, and competitor landscape.',
    'Generate a high-scale programmatic SEO architecture designed to capture hundreds of high-intent search queries at scale across 3 distinct matrix types:',
    '1. Competitor Comparison Matrix: [Product] vs [Competitor] pages targeting bottom-of-funnel decision makers.',
    '2. Role & Industry Use-Case Matrix: Best [Product] for [Industry/Role] pages with specific pain point solutions.',
    '3. Integration & Platform Ecosystem Matrix: How to Connect [Product] with [Platform] guides.',
    'Provide at least 2 distinct matrices in targetMatrices (e.g. 1 Competitor Comparison matrix, and 1 Industry Solution matrix).',
    'Provide structured data templates, dynamic variable placeholders, unique value hooks, and schema markup recommendations.',
    ...RULES,
    'Respond ONLY with a valid JSON object matching this schema:',
    JSON.stringify({
      targetMatrices: [
        {
          matrixType: 'Competitor Comparison', // or 'Industry Solution', 'Integration Guide'
          urlPattern: '/compare/[product]-vs-[competitor]',
          targetSearchIntent: 'Commercial / Transactional',
          variableSlots: ['competitor', 'differentiator', 'featureList'],
          samplePages: [
            { slug: 'string', h1: 'string', targetKeyword: 'string', uniqueAngle: 'string' }
          ],
          conversionCta: 'string'
        }
      ],
      sharedDataTemplate: {
        h2Outline: ['string'],
        requiredSchemaType: 'Product | SoftwareApplication | FAQPage',
        dynamicVariables: ['string']
      },
      estimatedSearchVolumePotential: 'string',
      implementationGuide: ['string']
    }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildProgrammaticSeoPrompt;
