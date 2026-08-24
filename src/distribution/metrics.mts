import type {
  EngagementMetricName,
  EngagementMetricValues,
  EngagementMetricsResult
} from './types.mjs';

export const ENGAGEMENT_METRIC_NAMES: EngagementMetricName[] = [
  'impressions',
  'reach',
  'views',
  'likes',
  'reactions',
  'comments',
  'shares',
  'reposts',
  'quotes',
  'saves',
  'clicks',
  'linkClicks',
  'profileClicks',
  'videoViews',
  'watchTimeMs'
];

function count(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function engagementMetricsResult(
  values: EngagementMetricValues,
  providerData: Record<string, unknown> = {}
): EngagementMetricsResult {
  const metrics: EngagementMetricValues = {};
  const availableFields: EngagementMetricName[] = [];
  const unavailableFields: EngagementMetricName[] = [];

  for (const field of ENGAGEMENT_METRIC_NAMES) {
    const normalized = count(values[field]);
    if (normalized === null) {
      unavailableFields.push(field);
      continue;
    }
    metrics[field] = normalized;
    availableFields.push(field);
  }

  return {
    metrics,
    availableFields,
    unavailableFields,
    providerData,
    capturedAt: new Date()
  };
}

export function sandboxMetrics(accountMetadata: Record<string, unknown>): EngagementMetricValues {
  const configured = accountMetadata.sandboxMetrics;
  if (configured && typeof configured === 'object') return configured as EngagementMetricValues;
  return { views: 0, likes: 0, comments: 0, shares: 0 };
}
