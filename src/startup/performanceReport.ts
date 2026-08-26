import {
  INSTANT_RESPONSE_BUDGET_MS,
  nearestRankPercentile,
} from './performanceBudget';

const PERFORMANCE_ATTRIBUTE_PREFIX = 'data-rtx-perf-';
const PERFORMANCE_ATTRIBUTE_SUFFIX = '-ms';

export const DEFAULT_INSTANT_METRIC_NAMES = [
  'fcp',
  'login-feedback',
  'login-interaction',
  'auth-shell',
] as const;

/**
 * Authentication is reported beside the instant-response metrics, but is not
 * subjected to the frontend's 100 ms paint/feedback budget. The current
 * `login-auth` mark is an end-to-end application timing; the other names are
 * available to a browser harness that records the network phases separately.
 */
export const DEFAULT_AUTH_NETWORK_METRIC_NAMES = [
  'login-auth',
  'auth-network',
  'auth-ttfb',
] as const;

export type StartupMetricSamples = Record<string, number[]>;

export interface StartupMetricSummary {
  samples: number[];
  count: number;
  min: number;
  p50: number;
  p75: number;
  p95: number;
  max: number;
}

export interface StartupBudgetFailure {
  metric: string;
  reason: 'insufficient-samples' | 'over-budget';
  actual: number;
  required: number;
}

export interface StartupInstantBudgetResult {
  passed: boolean;
  budgetMs: number;
  minimumSamples: number;
  failures: StartupBudgetFailure[];
}

export interface StartupBenchmarkReport {
  instant: Record<string, StartupMetricSummary>;
  authNetwork: Record<string, StartupMetricSummary>;
  other: Record<string, StartupMetricSummary>;
  instantBudget: StartupInstantBudgetResult;
}

export interface StartupBenchmarkReportOptions {
  instantMetricNames?: readonly string[];
  authNetworkMetricNames?: readonly string[];
  budgetMs?: number;
  minimumSamples?: number;
}

type MetricAttributeRoot = Pick<Element, 'getAttribute' | 'getAttributeNames' | 'removeAttribute'>;

const normalizeMetricName = (name: string): string => (
  String(name)
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
);

export const toStartupMetricAttribute = (name: string): string => (
  `${PERFORMANCE_ATTRIBUTE_PREFIX}${normalizeMetricName(name)}${PERFORMANCE_ATTRIBUTE_SUFFIX}`
);

const metricNameFromAttribute = (attribute: string): string | null => {
  const normalizedAttribute = attribute.toLowerCase();
  if (
    !normalizedAttribute.startsWith(PERFORMANCE_ATTRIBUTE_PREFIX)
    || !normalizedAttribute.endsWith(PERFORMANCE_ATTRIBUTE_SUFFIX)
  ) {
    return null;
  }

  const name = normalizedAttribute.slice(
    PERFORMANCE_ATTRIBUTE_PREFIX.length,
    -PERFORMANCE_ATTRIBUTE_SUFFIX.length,
  );
  return name || null;
};

const parseMetricValue = (value: string | null): number | null => {
  if (value === null || value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

/** Read one immutable snapshot of every numeric metric exposed on an element. */
export const readDomStartupMetrics = (root: MetricAttributeRoot): Record<string, number> => {
  const snapshot: Record<string, number> = {};

  root.getAttributeNames().forEach((attribute) => {
    const name = metricNameFromAttribute(attribute);
    if (!name) return;
    const value = parseMetricValue(root.getAttribute(attribute));
    if (value !== null) snapshot[name] = value;
  });

  return snapshot;
};

/**
 * Remove prior values before a new measured cycle. This prevents a metric that
 * was not republished in the current cycle from being counted again as a fresh
 * sample.
 */
export const clearDomStartupMetrics = (
  root: MetricAttributeRoot,
  metricNames?: readonly string[],
): void => {
  if (metricNames) {
    metricNames.forEach((name) => root.removeAttribute(toStartupMetricAttribute(name)));
    return;
  }

  root.getAttributeNames().forEach((attribute) => {
    if (metricNameFromAttribute(attribute)) root.removeAttribute(attribute);
  });
};

const sanitizeSamples = (samples: readonly number[]): number[] => (
  samples.filter((sample) => Number.isFinite(sample) && sample >= 0)
);

export const summarizeStartupMetric = (
  samples: readonly number[],
): StartupMetricSummary | null => {
  const retained = sanitizeSamples(samples);
  if (retained.length === 0) return null;
  const sorted = [...retained].sort((left, right) => left - right);

  return {
    samples: [...retained],
    count: retained.length,
    min: sorted[0],
    p50: nearestRankPercentile(sorted, 0.50),
    p75: nearestRankPercentile(sorted, 0.75),
    p95: nearestRankPercentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
};

const uniqueMetricNames = (names: readonly string[]): string[] => (
  [...new Set(names.map(normalizeMetricName).filter(Boolean))]
);

const summarizeNamedMetrics = (
  samples: StartupMetricSamples,
  names: readonly string[],
): Record<string, StartupMetricSummary> => {
  const result: Record<string, StartupMetricSummary> = {};
  uniqueMetricNames(names).forEach((name) => {
    const summary = summarizeStartupMetric(samples[name] ?? []);
    if (summary) result[name] = summary;
  });
  return result;
};

export const buildStartupBenchmarkReport = (
  samples: StartupMetricSamples,
  options: StartupBenchmarkReportOptions = {},
): StartupBenchmarkReport => {
  const instantMetricNames = uniqueMetricNames(
    options.instantMetricNames ?? DEFAULT_INSTANT_METRIC_NAMES,
  );
  const authNetworkMetricNames = uniqueMetricNames(
    options.authNetworkMetricNames ?? DEFAULT_AUTH_NETWORK_METRIC_NAMES,
  );
  const budgetMs = Number.isFinite(options.budgetMs)
    ? Math.max(0, Number(options.budgetMs))
    : INSTANT_RESPONSE_BUDGET_MS;
  const minimumSamples = Number.isFinite(options.minimumSamples)
    ? Math.max(1, Math.floor(Number(options.minimumSamples)))
    : 1;

  const instant = summarizeNamedMetrics(samples, instantMetricNames);
  const authNetwork = summarizeNamedMetrics(samples, authNetworkMetricNames);
  const categorized = new Set([...instantMetricNames, ...authNetworkMetricNames]);
  const otherNames = Object.keys(samples).filter((name) => !categorized.has(normalizeMetricName(name)));
  const other = summarizeNamedMetrics(samples, otherNames);
  const failures: StartupBudgetFailure[] = [];

  instantMetricNames.forEach((metric) => {
    const summary = instant[metric];
    const sampleCount = summary?.count ?? 0;
    if (sampleCount < minimumSamples) {
      failures.push({
        metric,
        reason: 'insufficient-samples',
        actual: sampleCount,
        required: minimumSamples,
      });
      return;
    }

    // The stated contract is "not more than 100 ms", so max is authoritative.
    // Percentiles remain in the report for trend and stability analysis.
    if (summary.max > budgetMs) {
      failures.push({
        metric,
        reason: 'over-budget',
        actual: summary.max,
        required: budgetMs,
      });
    }
  });

  return {
    instant,
    authNetwork,
    other,
    instantBudget: {
      passed: failures.length === 0,
      budgetMs,
      minimumSamples,
      failures,
    },
  };
};

export class StartupPerformanceCollector {
  private readonly retained: StartupMetricSamples = {};

  addSnapshot(snapshot: Readonly<Record<string, number>>): void {
    Object.entries(snapshot).forEach(([rawName, value]) => {
      const name = normalizeMetricName(rawName);
      if (!name || !Number.isFinite(value) || value < 0) return;
      (this.retained[name] ??= []).push(value);
    });
  }

  capture(root: MetricAttributeRoot): Record<string, number> {
    const snapshot = readDomStartupMetrics(root);
    this.addSnapshot(snapshot);
    return snapshot;
  }

  getSamples(): StartupMetricSamples {
    return Object.fromEntries(
      Object.entries(this.retained).map(([name, values]) => [name, [...values]]),
    );
  }

  buildReport(options?: StartupBenchmarkReportOptions): StartupBenchmarkReport {
    return buildStartupBenchmarkReport(this.retained, options);
  }

  reset(): void {
    Object.keys(this.retained).forEach((name) => delete this.retained[name]);
  }
}
