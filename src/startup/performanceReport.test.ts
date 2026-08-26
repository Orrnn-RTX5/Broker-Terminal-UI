import { describe, expect, it } from 'vitest';
import {
  StartupPerformanceCollector,
  buildStartupBenchmarkReport,
  clearDomStartupMetrics,
  readDomStartupMetrics,
  summarizeStartupMetric,
  toStartupMetricAttribute,
} from './performanceReport';

describe('startup performance reporting', () => {
  it('reads only finite non-negative DOM-exposed performance metrics', () => {
    const root = document.createElement('div');
    root.setAttribute('data-rtx-perf-login-feedback-ms', '18.4');
    root.setAttribute('data-rtx-perf-auth-network-ms', '452');
    root.setAttribute('data-rtx-perf-invalid-ms', 'NaN');
    root.setAttribute('data-rtx-perf-negative-ms', '-1');
    root.setAttribute('data-unrelated', '12');

    expect(readDomStartupMetrics(root)).toEqual({
      'login-feedback': 18.4,
      'auth-network': 452,
    });
  });

  it('collects independent metric arrays across repeated DOM snapshots', () => {
    const collector = new StartupPerformanceCollector();
    const root = document.createElement('div');

    root.setAttribute(toStartupMetricAttribute('login feedback'), '20');
    root.setAttribute(toStartupMetricAttribute('auth-network'), '410');
    collector.capture(root);

    root.setAttribute(toStartupMetricAttribute('login feedback'), '35');
    root.setAttribute(toStartupMetricAttribute('auth-network'), '520');
    collector.capture(root);

    expect(collector.getSamples()).toEqual({
      'login-feedback': [20, 35],
      'auth-network': [410, 520],
    });
  });

  it('calculates min, nearest-rank percentiles, and max without reordering samples', () => {
    expect(summarizeStartupMetric([90, 10, 70, 30, 50])).toEqual({
      samples: [90, 10, 70, 30, 50],
      count: 5,
      min: 10,
      p50: 50,
      p75: 70,
      p95: 90,
      max: 90,
    });
  });

  it('enforces the instant maximum while reporting slow auth separately', () => {
    const report = buildStartupBenchmarkReport({
      'login-feedback': [22, 31, 48],
      'auth-shell': [54, 72, 99.9],
      'auth-network': [320, 410, 680],
    }, {
      instantMetricNames: ['login-feedback', 'auth-shell'],
      authNetworkMetricNames: ['auth-network'],
      minimumSamples: 3,
    });

    expect(report.instantBudget).toEqual({
      passed: true,
      budgetMs: 100,
      minimumSamples: 3,
      failures: [],
    });
    expect(report.authNetwork['auth-network'].p95).toBe(680);
  });

  it('fails over-budget or incomplete instant samples without budgeting auth', () => {
    const report = buildStartupBenchmarkReport({
      'login-feedback': [40, 101],
      'auth-shell': [55],
      'auth-network': [900, 1200],
    }, {
      instantMetricNames: ['login-feedback', 'auth-shell'],
      authNetworkMetricNames: ['auth-network'],
      minimumSamples: 2,
    });

    expect(report.instantBudget.passed).toBe(false);
    expect(report.instantBudget.failures).toEqual([
      { metric: 'login-feedback', reason: 'over-budget', actual: 101, required: 100 },
      { metric: 'auth-shell', reason: 'insufficient-samples', actual: 1, required: 2 },
    ]);
    expect(report.instantBudget.failures).not.toContainEqual(expect.objectContaining({ metric: 'auth-network' }));
  });

  it('clears prior DOM values so stale metrics cannot be counted as a new cycle', () => {
    const root = document.createElement('div');
    root.setAttribute(toStartupMetricAttribute('login-feedback'), '15');
    root.setAttribute(toStartupMetricAttribute('auth-network'), '500');
    root.setAttribute('data-keep', 'true');

    clearDomStartupMetrics(root, ['login-feedback']);
    expect(readDomStartupMetrics(root)).toEqual({ 'auth-network': 500 });

    clearDomStartupMetrics(root);
    expect(readDomStartupMetrics(root)).toEqual({});
    expect(root.getAttribute('data-keep')).toBe('true');
  });
});
