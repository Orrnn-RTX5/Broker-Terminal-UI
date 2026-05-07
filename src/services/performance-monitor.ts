import React, { useRef, useEffect } from 'react';

/**
 * Performance Monitoring Service
 * - Track FPS
 * - Monitor memory usage
 * - Measure component render times
 * - WebSocket metrics
 * - API call latency
 */

interface PerformanceMetrics {
  fps: number;
  memoryUsage: number;
  componentRenders: Record<string, number>;
  wsLatency: number;
  apiLatency: number;
  ticksPerSecond: number;
  droppedFrames: number;
}

interface RenderMetric {
  componentName: string;
  renderTime: number;
  timestamp: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    fps: 60,
    memoryUsage: 0,
    componentRenders: {},
    wsLatency: 0,
    apiLatency: 0,
    ticksPerSecond: 0,
    droppedFrames: 0,
  };

  private frameCount = 0;
  private lastFrameTime = performance.now();
  private fpsInterval: ReturnType<typeof setInterval> | null = null;
  private renderMetrics: RenderMetric[] = [];
  private maxRenderMetrics = 1000;

  private tickCount = 0;
  private tickCountInterval: ReturnType<typeof setInterval> | null = null;

  private listeners: Set<(metrics: PerformanceMetrics) => void> = new Set();

  constructor() {
    this.startFPSMonitoring();
    this.startMemoryMonitoring();
    this.startTickMonitoring();
  }

  /**
   * Start FPS monitoring
   */
  private startFPSMonitoring(): void {
    const measureFPS = () => {
      this.frameCount++;

      const currentTime = performance.now();
      const elapsed = currentTime - this.lastFrameTime;

      // Update FPS every second
      if (elapsed >= 1000) {
        this.metrics.fps = Math.round((this.frameCount * 1000) / elapsed);

        // Detect dropped frames (assuming 60 FPS target)
        const expectedFrames = Math.floor(elapsed / (1000 / 60));
        this.metrics.droppedFrames += Math.max(0, expectedFrames - this.frameCount);

        this.frameCount = 0;
        this.lastFrameTime = currentTime;
        this.notifyListeners();
      }

      requestAnimationFrame(measureFPS);
    };

    requestAnimationFrame(measureFPS);
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    this.fpsInterval = setInterval(() => {
      if ('memory' in performance) {
        const memory = (performance as Performance & { memory: { usedJSHeapSize: number } })
          .memory;
        this.metrics.memoryUsage = Math.round(memory.usedJSHeapSize / 1024 / 1024); // MB
        this.notifyListeners();
      }
    }, 1000);
  }

  /**
   * Start tick rate monitoring
   */
  private startTickMonitoring(): void {
    this.tickCountInterval = setInterval(() => {
      this.metrics.ticksPerSecond = this.tickCount;
      this.tickCount = 0;
      this.notifyListeners();
    }, 1000);
  }

  /**
   * Record a tick received
   */
  public recordTick(): void {
    this.tickCount++;
  }

  /**
   * Record component render
   */
  public recordRender(componentName: string, renderTime: number): void {
    this.metrics.componentRenders[componentName] =
      (this.metrics.componentRenders[componentName] || 0) + 1;

    this.renderMetrics.push({
      componentName,
      renderTime,
      timestamp: Date.now(),
    });

    // Keep only recent metrics
    if (this.renderMetrics.length > this.maxRenderMetrics) {
      this.renderMetrics.shift();
    }

    this.notifyListeners();
  }

  /**
   * Record WebSocket latency
   */
  public recordWSLatency(latency: number): void {
    this.metrics.wsLatency = latency;
    this.notifyListeners();
  }

  /**
   * Record API latency
   */
  public recordAPILatency(latency: number): void {
    this.metrics.apiLatency = latency;
    this.notifyListeners();
  }

  /**
   * Get current metrics
   */
  public getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Get render metrics for a component
   */
  public getComponentRenderMetrics(componentName: string): RenderMetric[] {
    return this.renderMetrics.filter((m) => m.componentName === componentName);
  }

  /**
   * Get average render time for a component
   */
  public getAverageRenderTime(componentName: string): number {
    const metrics = this.getComponentRenderMetrics(componentName);
    if (metrics.length === 0) return 0;

    const total = metrics.reduce((sum, m) => sum + m.renderTime, 0);
    return total / metrics.length;
  }

  /**
   * Get slowest components
   */
  public getSlowestComponents(limit = 10): Array<{ name: string; avgTime: number }> {
    const components = Object.keys(this.metrics.componentRenders);
    const results = components.map((name) => ({
      name,
      avgTime: this.getAverageRenderTime(name),
    }));

    return results.sort((a, b) => b.avgTime - a.avgTime).slice(0, limit);
  }

  /**
   * Subscribe to metrics updates
   */
  public subscribe(callback: (metrics: PerformanceMetrics) => void): () => void {
    this.listeners.add(callback);

    // Immediately call with current metrics
    callback(this.metrics);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.metrics));
  }

  /**
   * Reset metrics
   */
  public reset(): void {
    this.metrics = {
      fps: 60,
      memoryUsage: 0,
      componentRenders: {},
      wsLatency: 0,
      apiLatency: 0,
      ticksPerSecond: 0,
      droppedFrames: 0,
    };
    this.renderMetrics = [];
    this.notifyListeners();
  }

  /**
   * Check if performance is degraded
   */
  public isPerformanceDegraded(): {
    degraded: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];

    if (this.metrics.fps < 30) {
      reasons.push(`Low FPS: ${this.metrics.fps}`);
    }

    if (this.metrics.memoryUsage > 500) {
      reasons.push(`High memory usage: ${this.metrics.memoryUsage}MB`);
    }

    if (this.metrics.wsLatency > 1000) {
      reasons.push(`High WebSocket latency: ${this.metrics.wsLatency}ms`);
    }

    if (this.metrics.droppedFrames > 100) {
      reasons.push(`Dropped frames: ${this.metrics.droppedFrames}`);
    }

    return {
      degraded: reasons.length > 0,
      reasons,
    };
  }

  /**
   * Generate performance report
   */
  public generateReport(): string {
    const slowest = this.getSlowestComponents(5);
    const degradation = this.isPerformanceDegraded();

    let report = '=== Performance Report ===\n\n';
    report += `FPS: ${this.metrics.fps}\n`;
    report += `Memory Usage: ${this.metrics.memoryUsage}MB\n`;
    report += `WebSocket Latency: ${this.metrics.wsLatency}ms\n`;
    report += `API Latency: ${this.metrics.apiLatency}ms\n`;
    report += `Ticks/Second: ${this.metrics.ticksPerSecond}\n`;
    report += `Dropped Frames: ${this.metrics.droppedFrames}\n\n`;

    report += 'Slowest Components:\n';
    slowest.forEach((comp, i) => {
      report += `${i + 1}. ${comp.name}: ${comp.avgTime.toFixed(2)}ms\n`;
    });

    if (degradation.degraded) {
      report += '\nPerformance Issues:\n';
      degradation.reasons.forEach((reason) => {
        report += `- ${reason}\n`;
      });
    } else {
      report += '\nPerformance: OK\n';
    }

    return report;
  }

  /**
   * Cleanup
   */
  public destroy(): void {
    if (this.fpsInterval) {
      clearInterval(this.fpsInterval);
      this.fpsInterval = null;
    }

    if (this.tickCountInterval) {
      clearInterval(this.tickCountInterval);
      this.tickCountInterval = null;
    }

    this.listeners.clear();
  }
}

// Singleton instance
let monitorInstance: PerformanceMonitor | null = null;

export const getPerformanceMonitor = (): PerformanceMonitor => {
  if (!monitorInstance) {
    monitorInstance = new PerformanceMonitor();
  }

  return monitorInstance;
};

/**
 * React Hook for performance monitoring
 */
export function usePerformanceMonitor() {
  const monitor = getPerformanceMonitor();

  return {
    recordRender: (componentName: string, renderTime: number) =>
      monitor.recordRender(componentName, renderTime),
    recordTick: () => monitor.recordTick(),
    getMetrics: () => monitor.getMetrics(),
    subscribe: (callback: (metrics: PerformanceMetrics) => void) =>
      monitor.subscribe(callback),
  };
}

/**
 * HOC for automatic render time tracking
 */
export function withPerformanceTracking<P extends object>(
  Component: React.ComponentType<P>,
  componentName: string
): React.ComponentType<P> {
  return (props: P) => {
    const startTime = useRef(performance.now());

    useEffect(() => {
      const endTime = performance.now();
      const renderTime = endTime - startTime.current;
      getPerformanceMonitor().recordRender(componentName, renderTime);
    });

    return React.createElement(Component, props);
  };
}
