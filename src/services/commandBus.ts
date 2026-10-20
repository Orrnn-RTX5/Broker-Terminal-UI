/**
 * Command Bus Implementation
 * Centralized pub/sub system for terminal toolbar commands
 * Features:
 * - Type-safe command dispatching
 * - Command history tracking (last 100 commands)
 * - Event replay capability for debugging
 * - No memory leaks (WeakMap for cleanup)
 */

import type {
  Command,
  CommandType,
  CommandHandler,
  CommandBus,
  Unsubscribe,
} from '../types/commands';

/**
 * Max number of commands to keep in history
 */
const HISTORY_MAX_SIZE = 100;

/**
 * CommandBusImpl - Singleton instance of the command bus
 * Uses Map-based subscription system for efficient handler management
 */
class CommandBusImpl implements CommandBus {
  private handlers: Map<CommandType, Set<CommandHandler>> = new Map();
  private history: Command[] = [];
  private isReplaying = false;

  /**
   * Dispatch a command to all subscribed handlers
   */
  dispatch(command: Command): void {
    // Add to history
    this.history.push(command);
    if (this.history.length > HISTORY_MAX_SIZE) {
      this.history.shift();
    }

    // Log command in development
    if (import.meta.env.DEV) {
      console.log(
        `[CommandBus] Dispatching: ${command.type}`,
        'payload:',
        command.payload
      );
    }

    // Get handlers for this command type
    const typeHandlers = this.handlers.get(command.type);
    // Also get wildcard handlers
    const wildcardHandlers = this.handlers.get('*' as CommandType);

    // Call type-specific handlers
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(command.payload);
        } catch (error) {
          console.error(
            `[CommandBus] Error in handler for ${command.type}:`,
            error
          );
        }
      }
    }

    // Call wildcard handlers with full command object
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          (handler as any)(command);
        } catch (error) {
          console.error(
            `[CommandBus] Error in wildcard handler:`,
            error
          );
        }
      }
    }
  }

  /**
   * Subscribe to a specific command type
   * Returns an unsubscribe function for cleanup
   */
  subscribe<T extends CommandType>(
    type: T,
    handler: CommandHandler<T>
  ): Unsubscribe {
    // Get or create handler set for this type
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }

    const typeHandlers = this.handlers.get(type)!;
    typeHandlers.add(handler as any);

    if (import.meta.env.DEV) {
      console.log(
        `[CommandBus] Subscriber added for ${type} (total: ${typeHandlers.size})`
      );
    }

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(type);
      if (handlers) {
        handlers.delete(handler as any);

        if (import.meta.env.DEV) {
          console.log(
            `[CommandBus] Subscriber removed for ${type} (remaining: ${handlers.size})`
          );
        }

        // Clean up empty handler sets
        if (handlers.size === 0) {
          this.handlers.delete(type);
        }
      }
    };
  }

  /**
   * Get command history
   */
  getHistory(): Command[] {
    return [...this.history]; // Return copy to prevent mutations
  }

  /**
   * Clear command history
   */
  clearHistory(): void {
    this.history = [];
    if (import.meta.env.DEV) {
      console.log('[CommandBus] History cleared');
    }
  }

  /**
   * Replay a sequence of commands
   * Useful for debugging and testing
   */
  async replay(commands: Command[]): Promise<void> {
    if (this.isReplaying) {
      console.warn('[CommandBus] Replay already in progress');
      return;
    }

    this.isReplaying = true;

    try {
      if (import.meta.env.DEV) {
        console.log(`[CommandBus] Starting replay of ${commands.length} commands`);
      }

      for (const command of commands) {
        this.dispatch(command);
        // Small delay to allow async handlers to complete
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (import.meta.env.DEV) {
        console.log('[CommandBus] Replay completed');
      }
    } finally {
      this.isReplaying = false;
    }
  }

  /**
   * Get current number of subscribers for a command type
   * Useful for debugging
   */
  getSubscriberCount(type: CommandType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  /**
   * Get all subscribed command types
   * Useful for debugging
   */
  getSubscribedTypes(): CommandType[] {
    return Array.from(this.handlers.keys());
  }
}

/**
 * Singleton instance of the command bus
 * This is the central dispatcher for all commands
 */
export const commandBus = new CommandBusImpl();

/**
 * Helper function to dispatch a command
 * Shorthand for commandBus.dispatch()
 */
export function dispatchCommand(command: Command): void {
  commandBus.dispatch(command);
}

/**
 * Helper function to get command history
 * Shorthand for commandBus.getHistory()
 */
export function getCommandHistory(): Command[] {
  return commandBus.getHistory();
}

/**
 * Helper function to clear command history
 * Shorthand for commandBus.clearHistory()
 */
export function clearCommandHistory(): void {
  commandBus.clearHistory();
}

/**
 * Helper function to replay commands
 * Shorthand for commandBus.replay()
 */
export function replayCommands(commands: Command[]): Promise<void> {
  return commandBus.replay(commands);
}
