module.exports = function buildMarketingProjectManagementPrompt({
  brandName = 'Moyi-CMO',
  initiativeName = 'Q4 Organic Search Expansion & Multi-Channel Repurposing',
  acceptedPriorities = ['Fix 404 broken redirect chains', 'Publish 6 BOFU comparison guides', 'Connect LinkedIn social queue'],
  targetSprintDays = 14,
  teamCapacity = '1 Growth Lead, 1 Content Writer, 1 SEO Specialist'
}) {
  return `You are a Principal Marketing Project Manager / Marketing Operations (MOPs) Lead. Create an agile sprint plan and pre-flight QA governance checklist for "${initiativeName}".

INITIATIVE PARAMETERS:
- Workspace: ${brandName}
- Campaign / Milestone: ${initiativeName}
- Accepted Backlog Tasks: ${acceptedPriorities.join(', ')}
- Sprint Duration: ${targetSprintDays} Days
- Team Capacity: ${teamCapacity}

TASK:
Produce an actionable agile sprint plan and quality assurance checklist in JSON format with the following exact keys:
{
  "sprintOverview": {
    "sprintGoal": "Clear, measurable 14-day outcome statement",
    "totalStoryPoints": 34,
    "velocityTarget": "Deliver 100% of accepted high-impact recommendations"
  },
  "sprintWorkBreakdown": [
    {
      "ticketId": "MKTG-101",
      "taskName": "e.g. Technical Redirect Audit & Fix",
      "assigneeRole": "SEO Specialist",
      "raciRole": "Accountable: SEO Specialist | Consulted: Lead Dev | Informed: CMO",
      "storyPoints": 5,
      "definitionOfDone": "All 404 links resolved with 301 mappings verified in GSC"
    },
    {
      "ticketId": "MKTG-102",
      "taskName": "e.g. High-Intent Comparison Articles",
      "assigneeRole": "Content Writer",
      "raciRole": "Accountable: Writer | Responsible: Designer | Consulted: Product Lead",
      "storyPoints": 8,
      "definitionOfDone": "Articles written, reviewed in Content Studio, logo visuals attached, and scheduled"
    }
  ],
  "preFlightCampaignQaChecklist": [
    { "category": "Tracking & Analytics", "checkItem": "Ensure all outgoing links have canonical UTM parameters (utm_source, utm_medium, utm_campaign)" },
    { "category": "Visuals & Brand", "checkItem": "Verify logo transparency and 100% mobile responsive image preview" },
    { "category": "SEO & Indexing", "checkItem": "Confirm robots meta tag is 'index, follow' on newly published landing pages" },
    { "category": "Human Sign-off", "checkItem": "Ensure 4-stage governance (Write -> Visual -> Review -> Distribute) approval is signed" }
  ],
  "riskAndBlockerMitigation": [
    { "risk": "Review bottlenecks delaying distribution", "mitigation": "Set 24-hour SLA for editorial approval in Content Studio" }
  ]
}`;
};
