module.exports = function buildCampaignPlannerPrompt(context) {
  return `
Create a campaign content plan using only the supplied business facts.

Rules:
- Return exactly ${context.schedule.length} posts, one for each supplied schedule item.
- Use each schedule item's channel and scheduledFor exactly as supplied.
- Do not invent statistics, customer results, testimonials, prices, awards, product capabilities, or guarantees.
- If a useful claim is not present in the project context, do not make it.
- Keep each post specific to the campaign goal, audience, offer, and brand tone.
- Make posts meaningfully different rather than repeating one message.
- When socialPerformance contains observed results, use it only to guide format, topic emphasis, and channel prioritization. Never state the metrics in the post unless explicitly requested.
- Do not treat a missing provider metric as zero or infer causation from engagement.
- Include a clear but honest next step where appropriate.
- Return JSON only.

JSON shape:
{
  "drafts": [
    {
      "channel": "linkedin",
      "scheduledFor": "ISO date copied from the schedule",
      "title": "short internal title",
      "body": "complete post copy"
    }
  ]
}

Context:
${JSON.stringify(context, null, 2)}
`;
};
