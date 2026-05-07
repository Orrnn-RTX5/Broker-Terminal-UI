/**
 * useCommandBus Hook
 * React integration for the centralized command bus
 * Provides dispatch and subscription methods with proper cleanup
 */

import { useCallback, useEffect } from 'react';
import { commandBus } from '../services/commandBus';
import type {
  Command,
  CommandType,
  CommandHandler,
  Unsubscribe,
  PayloadFor,
} from '../types/commands';

/**
 * useCommandBus Hook
 * Provides access to the centralized command bus
 *
 * @example
 * const { dispatch, useCommandSubscription } = useCommandBus();
 *
 * // Dispatch a command
 * dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'line' } });
 *
 * // Subscribe to commands
 * useCommandSubscription('OPEN_ORDER_PANEL', (payload) => {
 *   console.log('Order panel opened for', payload.symbol);
 * });
 */
export function useCommandBus() {
  /**
   * Dispatch a command
   * Memoized to ensure stable reference
   */
  const dispatch = useCallback((command: Command): void => {
    commandBus.dispatch(command);
  }, []);

  /**
   * Subscribe to a specific command type
   * Handles cleanup automatically
   *
   * @param type - The command type to listen for
   * @param handler - Function to call when command is dispatched
   *
   * @example
   * useCommandSubscription('SET_CHART_TYPE', (payload) => {
   *   console.log('Chart type changed to:', payload.chartType);
   * });
   */
  const useCommandSubscription = useCallback(
    <T extends CommandType>(
      type: T,
      handler: CommandHandler<T>
    ): void => {
      useEffect(() => {
        // Subscribe to the command type
        const unsubscribe = commandBus.subscribe(type, handler);

        // Clean up on unmount
        return unsubscribe;
      }, [type, handler]);
    },
    []
  );

  /**
   * Get command history
   * Useful for debugging
   */
  const getHistory = useCallback((): Command[] => {
    return commandBus.getHistory();
  }, []);

  /**
   * Replay commands
   * Useful for testing
   */
  const replay = useCallback(
    async (commands: Command[]): Promise<void> => {
      return commandBus.replay(commands);
    },
    []
  );

  /**
   * Subscribe to commands
   * Direct subscription method (not a hook)
   * Returns unsubscribe function
   */
  const subscribe = useCallback(
    (handler: (cmd: Command) => void): Unsubscribe => {
      return commandBus.subscribe('*' as CommandType, handler as any);
    },
    []
  );

  return {
    dispatch,
    subscribe,
    useCommandSubscription,
    getHistory,
    replay,
  };
}

/**
 * useCommandDispatch Hook
 * Simple hook to get only the dispatch function
 * Use when you only need to dispatch commands
 *
 * @example
 * const dispatch = useCommandDispatch();
 * dispatch({ type: 'ZOOM_IN', payload: {} });
 */
export function useCommandDispatch() {
  const dispatch = useCallback((command: Command): void => {
    commandBus.dispatch(command);
  }, []);

  return dispatch;
}

/**
 * useCommandListener Hook
 * Simple hook to listen for a specific command type
 * Automatically handles cleanup
 *
 * @param type - The command type to listen for
 * @param handler - Function to call when command is dispatched
 *
 * @example
 * useCommandListener('SET_CHART_TYPE', (payload) => {
 *   console.log('Chart type:', payload.chartType);
 * });
 */
export function useCommandListener<T extends CommandType>(
  type: T,
  handler: CommandHandler<T>
): void {
  useEffect(() => {
    const unsubscribe = commandBus.subscribe(type, handler);
    return unsubscribe;
  }, [type, handler]);
}

/**
 * useCommandHistory Hook
 * Get access to command history and controls
 *
 * @example
 * const { history, clear, replay } = useCommandHistory();
 * console.log('Last 5 commands:', history.slice(-5));
 */
export function useCommandHistory() {
  const getHistory = useCallback((): Command[] => {
    return commandBus.getHistory();
  }, []);

  const clear = useCallback((): void => {
    commandBus.clearHistory();
  }, []);

  const replay = useCallback(
    async (commands?: Command[]): Promise<void> => {
      const toReplay = commands || getHistory();
      return commandBus.replay(toReplay);
    },
    []
  );

  return {
    getHistory,
    clear,
    replay,
  };
}
