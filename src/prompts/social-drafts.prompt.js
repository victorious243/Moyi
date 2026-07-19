module.exports = function buildSocialDraftsPrompt(context) {
  return `
Create ethical social/email draft posts from an approved content draft.

Rules:
- No fake engagement.
- No fake reviews, testimonials, awards, or claims.
- No spam DMs or aggressive posting language.
- No misleading promises.
- Do not guarantee rankings, traffic, leads, or revenue.
- Stay useful, honest, and brand-consistent.
- Use only the supplied project and content draft.
- Return JSON only.

JSON shape:
{
  "drafts": [
    {
      "channel": "linkedin",
      "title": "short internal title",
      "body": "post copy"
    }
  ]
}

Context:
${JSON.stringify(context, null, 2)}
`;
};
