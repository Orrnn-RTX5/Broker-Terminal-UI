/**
 * React Hook for Web Worker Management
 * - Easy-to-use interface for Web Workers
 * - Promise-based API
 * - Automatic cleanup
 * - Error handling
 */

import { useEffect, useRef, useCallback } from 'react';

interface WorkerResponse<T> {
  type: 'success' | 'error';
  requestId: string;
  result?: T;
  error?: string;
}

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export function useWebWorker<T = unknown>(workerPath: string, timeout = 30000) {
  const workerRef = useRef<Worker | null>(null);
  const pendingRequests = useRef<Map<string, PendingRequest<T>>>(new Map());
  const requestIdCounter = useRef(0);

  // Initialize worker
  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL(workerPath, import.meta.url), {
        type: 'module',
      });

      workerRef.current.onmessage = (event: MessageEvent<WorkerResponse<T>>) => {
        const { type, requestId, result, error } = event.data;

        const pending = pendingRequests.current.get(requestId);
        if (!pending) return;

        clearTimeout(pending.timeout);
        pendingRequests.current.delete(requestId);

        if (type === 'success' && result !== undefined) {
          pending.resolve(result);
        } else if (type === 'error') {
          pending.reject(new Error(error || 'Worker error'));
        }
      };

      workerRef.current.onerror = (error) => {
        console.error('[Worker] Error:', error);
        // Reject all pending requests
        pendingRequests.current.forEach((pending) => {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Worker crashed'));
        });
        pendingRequests.current.clear();
      };
    } catch (error) {
      console.error('[Worker] Failed to create worker:', error);
    }

    // Cleanup on unmount
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }

      // Clear all pending requests
      pendingRequests.current.forEach((pending) => {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Component unmounted'));
      });
      pendingRequests.current.clear();
    };
  }, [workerPath]);

  // Post message to worker
  const postMessage = useCallback(
    (type: string, data: unknown): Promise<T> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Worker not initialized'));
          return;
        }

        const requestId = `req_${++requestIdCounter.current}`;

        // Set timeout
        const timeoutId = setTimeout(() => {
          pendingRequests.current.delete(requestId);
          reject(new Error('Worker request timeout'));
        }, timeout);

        // Store pending request
        pendingRequests.current.set(requestId, {
          resolve,
          reject,
          timeout: timeoutId,
        });

        // Send message
        workerRef.current.postMessage({
          type,
          data,
          requestId,
        });
      });
    },
    [timeout]
  );

  return { postMessage };
}
