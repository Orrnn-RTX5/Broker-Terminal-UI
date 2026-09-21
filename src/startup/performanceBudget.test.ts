import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginLoginPerformanceMeasurement,
  INSTANT_RESPONSE_BUDGET_MS,
  isWithinInstantResponseBudget,
  markAuthenticationAccepted,
  markAuthenticationRequestStarted,
  markPostAuthenticationPhase,
  nearestRankPercentile,
  scheduleAuthenticatedShellPaintMeasurement,
  waitForLoginFeedbackPaint,
} from './performanceBudget';

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__RTX_STARTUP_PERFORMANCE__;
  document.documentElement.removeAttribute('data-rtx-perf-auth-network-ms');
  document.documentElement.removeAttribute('data-rtx-perf-login-auth-ms');
  document.documentElement.removeAttribute('data-rtx-perf-login-feedback-ms');
  document.documentElement.removeAttribute('data-rtx-perf-auth-shell-ms');
  document.documentElement.removeAttribute('data-rtx-perf-auth-store-commit-ms');
  document.body.replaceChildren();
});

describe('100 ms startup performance budget', () => {
  it('accepts only finite measurements at or below 100 ms', () => {
    expect(INSTANT_RESPONSE_BUDGET_MS).toBe(100);
    expect(isWithinInstantResponseBudget(99.9)).toBe(true);
    expect(isWithinInstantResponseBudget(100)).toBe(true);
    expect(isWithinInstantResponseBudget(100.1)).toBe(false);
    expect(isWithinInstantResponseBudget(Number.NaN)).toBe(false);
  });

  it('uses the nearest-rank percentile required by the benchmark report', () => {
    const samples = [8, 12, 20, 25, 31, 44, 55, 61, 72, 94, 110];
    expect(nearestRankPercentile(samples, 0.5)).toBe(44);
    expect(nearestRankPercentile(samples, 0.95)).toBe(110);
  });

  it('includes the native interaction start and isolates request duration', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(500).mockReturnValueOnce(520).mockReturnValueOnce(600);
    window.__RTX_STARTUP_PERFORMANCE__ = {
      beginInteraction: () => 450,
      publish: vi.fn(),
    };

    beginLoginPerformanceMeasurement();
    markAuthenticationRequestStarted();
    markAuthenticationAccepted();

    expect(document.documentElement.getAttribute('data-rtx-perf-login-auth-ms')).toBe('150.0');
    expect(document.documentElement.getAttribute('data-rtx-perf-auth-network-ms')).toBe('80.0');
  });

  it('publishes cumulative post-authentication phase timing', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(100).mockReturnValueOnce(120).mockReturnValueOnce(200).mockReturnValueOnce(235);

    beginLoginPerformanceMeasurement();
    markAuthenticationRequestStarted();
    markAuthenticationAccepted();
    markPostAuthenticationPhase('auth-store-commit');

    expect(document.documentElement.getAttribute('data-rtx-perf-auth-store-commit-ms')).toBe('35.0');
  });

  it('records feedback only after the disabled submit state and feedback marker exist', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => (
      window.setTimeout(() => callback(performance.now()), 0)
    ));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => window.clearTimeout(id));

    const form = document.createElement('form');
    form.setAttribute('data-rtx-login-form', '');
    form.setAttribute('data-login-submit-pending', 'false');
    const submit = document.createElement('button');
    submit.setAttribute('data-rtx-login-submit', '');
    form.append(submit);
    document.body.append(form);

    beginLoginPerformanceMeasurement();
    const painted = waitForLoginFeedbackPaint();
    await Promise.resolve();
    expect(document.documentElement.hasAttribute('data-rtx-perf-login-feedback-ms')).toBe(false);

    form.setAttribute('data-login-submit-pending', 'true');
    submit.disabled = true;
    submit.setAttribute('data-rtx-login-feedback', 'true');

    await painted;
    expect(Number(document.documentElement.getAttribute('data-rtx-perf-login-feedback-ms'))).toBeGreaterThanOrEqual(0);
  });

  it('publishes auth-shell only after the real authenticated root paints', async () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    beginLoginPerformanceMeasurement();
    markAuthenticationRequestStarted();
    markAuthenticationAccepted();

    const fallback = document.createElement('div');
    fallback.setAttribute('data-terminal-module-loading', 'true');
    document.body.append(fallback);
    const cancelMeasurement = scheduleAuthenticatedShellPaintMeasurement();

    try {
      await Promise.resolve();
      expect(requestFrame).not.toHaveBeenCalled();
      expect(document.documentElement.hasAttribute('data-rtx-perf-auth-shell-ms')).toBe(false);

      const terminal = document.createElement('div');
      terminal.setAttribute('data-rtx-authenticated-shell', 'true');
      const viewport = document.createElement('div');
      viewport.setAttribute('data-rtx-authenticated-viewport', 'true');
      terminal.appendChild(viewport);
      document.body.append(terminal);

      await vi.waitFor(() => expect(requestFrame).toHaveBeenCalledTimes(1));
      expect(document.documentElement.hasAttribute('data-rtx-perf-auth-shell-ms')).toBe(false);
      frames.shift()!(performance.now());
      await vi.waitFor(() => {
        expect(document.documentElement.hasAttribute('data-rtx-perf-auth-shell-ms')).toBe(true);
      });
      expect(Number(document.documentElement.getAttribute('data-rtx-perf-auth-shell-ms'))).toBeGreaterThanOrEqual(0);
    } finally {
      cancelMeasurement();
    }
  });

  it('waits for the mounted workspace to be revealed before publishing auth-shell', async () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    beginLoginPerformanceMeasurement();
    markAuthenticationRequestStarted();
    markAuthenticationAccepted();

    const boundary = document.createElement('div');
    boundary.setAttribute('data-terminal-startup', 'pending');
    const terminal = document.createElement('div');
    terminal.setAttribute('data-rtx-authenticated-shell', 'true');
    const viewport = document.createElement('div');
    viewport.setAttribute('data-rtx-authenticated-viewport', 'true');
    terminal.append(viewport);
    boundary.append(terminal);
    document.body.append(boundary);
    const cancelMeasurement = scheduleAuthenticatedShellPaintMeasurement();

    try {
      await Promise.resolve();
      expect(requestFrame).not.toHaveBeenCalled();
      expect(document.documentElement.hasAttribute('data-rtx-perf-auth-shell-ms')).toBe(false);

      boundary.setAttribute('data-terminal-startup', 'ready');

      await vi.waitFor(() => expect(requestFrame).toHaveBeenCalledTimes(1));
      expect(document.documentElement.hasAttribute('data-rtx-perf-auth-shell-ms')).toBe(false);
      frames.shift()!(performance.now());
      await vi.waitFor(() => {
        expect(document.documentElement.hasAttribute('data-rtx-perf-auth-shell-ms')).toBe(true);
      });
      expect(requestFrame).toHaveBeenCalledTimes(1);
      expect(Number(document.documentElement.getAttribute('data-rtx-perf-auth-shell-ms'))).toBeGreaterThanOrEqual(0);
    } finally {
      cancelMeasurement();
    }
  });
});
