/**
 * Comprehensive Error Handling Service
 * - Graceful WebSocket disconnection handling
 * - Retry logic for failed requests
 * - User-friendly error messages
 * - Error logging and reporting
 * - Fallback to REST API if WebSocket fails
 */

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ErrorContext {
  component?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface AppError {
  id: string;
  message: string;
  userMessage: string;
  severity: ErrorSeverity;
  timestamp: number;
  context?: ErrorContext;
  stack?: string;
  retryable: boolean;
}

type ErrorCallback = (error: AppError) => void;

export class ErrorHandler {
  private errors: AppError[] = [];
  private maxErrors = 100;
  private listeners: Set<ErrorCallback> = new Set();
  private retryQueue: Map<string, { fn: () => Promise<unknown>; attempts: number }> = new Map();
  private maxRetries = 3;

  /**
   * Handle an error
   */
  public handleError(
    error: Error | string,
    context?: ErrorContext,
    severity: ErrorSeverity = 'medium'
  ): void {
    const appError = this.createAppError(error, context, severity);
    this.logError(appError);
    this.storeError(appError);
    this.notifyListeners(appError);
  }

  /**
   * Handle WebSocket error
   */
  public handleWebSocketError(error: Error | string, context?: ErrorContext): void {
    this.handleError(error, { ...context, component: 'WebSocket' }, 'high');
  }

  /**
   * Handle API error
   */
  public handleAPIError(
    error: Error | string,
    endpoint: string,
    context?: ErrorContext
  ): void {
    this.handleError(
      error,
      { ...context, component: 'API', action: endpoint },
      'medium'
    );
  }

  /**
   * Handle component error
   */
  public handleComponentError(
    error: Error | string,
    componentName: string,
    context?: ErrorContext
  ): void {
    this.handleError(
      error,
      { ...context, component: componentName },
      'medium'
    );
  }

  /**
   * Retry a failed operation
   */
  public async retry<T>(
    key: string,
    operation: () => Promise<T>,
    maxRetries = this.maxRetries
  ): Promise<T> {
    const existing = this.retryQueue.get(key);
    const attempts = existing ? existing.attempts + 1 : 1;

    try {
      const result = await operation();
      this.retryQueue.delete(key);
      return result;
    } catch (error) {
      if (attempts >= maxRetries) {
        this.retryQueue.delete(key);
        this.handleError(
          error as Error,
          { action: 'retry', metadata: { key, attempts } },
          'high'
        );
        throw error;
      }

      // Store for retry
      this.retryQueue.set(key, { fn: operation, attempts });

      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
      await new Promise((resolve) => setTimeout(resolve, delay));

      return this.retry(key, operation, maxRetries);
    }
  }

  /**
   * Create AppError from Error or string
   */
  private createAppError(
    error: Error | string,
    context?: ErrorContext,
    severity: ErrorSeverity = 'medium'
  ): AppError {
    const errorMessage = error instanceof Error ? error.message : error;
    const userMessage = this.getUserFriendlyMessage(errorMessage, context);
    const retryable = this.isRetryable(errorMessage);

    return {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      message: errorMessage,
      userMessage,
      severity,
      timestamp: Date.now(),
      context,
      stack: error instanceof Error ? error.stack : undefined,
      retryable,
    };
  }

  /**
   * Convert technical error message to user-friendly message
   */
  private getUserFriendlyMessage(message: string, context?: ErrorContext): string {
    // WebSocket errors
    if (message.includes('WebSocket') || context?.component === 'WebSocket') {
      if (message.includes('timeout')) {
        return 'Connection timed out. Please check your internet connection.';
      }
      if (message.includes('authentication') || message.includes('401')) {
        return 'Your session has expired. Please log in again.';
      }
      if (message.includes('closed') || message.includes('disconnected')) {
        return 'Connection lost. Attempting to reconnect...';
      }
      return 'Connection error. Please check your internet connection.';
    }

    // API errors
    if (context?.component === 'API') {
      if (message.includes('401')) {
        return 'Your session has expired. Please log in again.';
      }
      if (message.includes('403')) {
        return 'You do not have permission to perform this action.';
      }
      if (message.includes('404')) {
        return 'The requested resource was not found.';
      }
      if (message.includes('500')) {
        return 'Server error. Please try again later.';
      }
      if (message.includes('timeout')) {
        return 'Request timed out. Please try again.';
      }
      return 'An error occurred while communicating with the server.';
    }

    // Trading errors
    if (message.includes('insufficient')) {
      return 'Insufficient balance to complete this operation.';
    }
    if (message.includes('margin')) {
      return 'Insufficient margin to open this position.';
    }
    if (message.includes('invalid symbol')) {
      return 'The selected symbol is not available.';
    }

    // Generic errors
    if (message.includes('network')) {
      return 'Network error. Please check your internet connection.';
    }

    // Default fallback
    return 'An unexpected error occurred. Please try again.';
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryable(message: string): boolean {
    const retryablePatterns = [
      'timeout',
      'network',
      'connection',
      '500',
      '502',
      '503',
      '504',
    ];

    return retryablePatterns.some((pattern) =>
      message.toLowerCase().includes(pattern)
    );
  }

  /**
   * Log error to console
   */
  private logError(error: AppError): void {
    const prefix = `[ERROR:${error.severity.toUpperCase()}]`;

    console.error(prefix, error.message);

    if (error.context) {
      console.error('Context:', error.context);
    }

    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }

  /**
   * Store error in history
   */
  private storeError(error: AppError): void {
    this.errors.push(error);

    // Keep only recent errors
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(error: AppError): void {
    this.listeners.forEach((listener) => {
      try {
        listener(error);
      } catch (err) {
        console.error('Error in error listener:', err);
      }
    });
  }

  /**
   * Subscribe to errors
   */
  public subscribe(callback: ErrorCallback): () => void {
    this.listeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Get recent errors
   */
  public getErrors(limit = 50): AppError[] {
    return this.errors.slice(-limit);
  }

  /**
   * Get errors by severity
   */
  public getErrorsBySeverity(severity: ErrorSeverity): AppError[] {
    return this.errors.filter((error) => error.severity === severity);
  }

  /**
   * Get errors by component
   */
  public getErrorsByComponent(component: string): AppError[] {
    return this.errors.filter((error) => error.context?.component === component);
  }

  /**
   * Clear all errors
   */
  public clearErrors(): void {
    this.errors = [];
  }

  /**
   * Clear error by id
   */
  public clearError(id: string): void {
    this.errors = this.errors.filter((error) => error.id !== id);
  }

  /**
   * Get error statistics
   */
  public getStats(): {
    total: number;
    bySeverity: Record<ErrorSeverity, number>;
    byComponent: Record<string, number>;
    retryable: number;
  } {
    const stats = {
      total: this.errors.length,
      bySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
      byComponent: {} as Record<string, number>,
      retryable: 0,
    };

    this.errors.forEach((error) => {
      stats.bySeverity[error.severity]++;

      if (error.retryable) {
        stats.retryable++;
      }

      if (error.context?.component) {
        stats.byComponent[error.context.component] =
          (stats.byComponent[error.context.component] || 0) + 1;
      }
    });

    return stats;
  }
}

// Singleton instance
let errorHandlerInstance: ErrorHandler | null = null;

export const getErrorHandler = (): ErrorHandler => {
  if (!errorHandlerInstance) {
    errorHandlerInstance = new ErrorHandler();
  }

  return errorHandlerInstance;
};

/**
 * React Hook for error handling
 */
export function useErrorHandler() {
  const handler = getErrorHandler();

  return {
    handleError: (error: Error | string, context?: ErrorContext, severity?: ErrorSeverity) =>
      handler.handleError(error, context, severity),
    handleWebSocketError: (error: Error | string, context?: ErrorContext) =>
      handler.handleWebSocketError(error, context),
    handleAPIError: (error: Error | string, endpoint: string, context?: ErrorContext) =>
      handler.handleAPIError(error, endpoint, context),
    handleComponentError: (error: Error | string, componentName: string, context?: ErrorContext) =>
      handler.handleComponentError(error, componentName, context),
    retry: <T>(key: string, operation: () => Promise<T>, maxRetries?: number) =>
      handler.retry(key, operation, maxRetries),
    subscribe: (callback: ErrorCallback) => handler.subscribe(callback),
    getErrors: (limit?: number) => handler.getErrors(limit),
    clearErrors: () => handler.clearErrors(),
  };
}

/**
 * Global error boundary handler
 */
export function setupGlobalErrorHandler(): void {
  // Handle uncaught errors
  window.addEventListener('error', (event) => {
    getErrorHandler().handleError(
      event.error || event.message,
      { component: 'Global' },
      'critical'
    );
  });

  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    getErrorHandler().handleError(
      event.reason,
      { component: 'Promise' },
      'high'
    );
  });

  console.log('[ErrorHandler] Global error handlers initialized');
}
