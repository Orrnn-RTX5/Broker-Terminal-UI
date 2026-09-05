/**
 * Command Bus Type Definitions
 * Centralized type-safe command dispatcher for RTX Terminal toolbar
 * Supports full event replay capability and type-safe payloads
 */

/**
 * Union type of all possible commands in the terminal
 * Each command has a unique type and strongly-typed payload
 */
export type Command =
  // Order Management Commands
  | {
    type: 'OPEN_ORDER_PANEL';
    payload: { symbol: string; price: { bid: number; ask: number } };
  }
  // Chart Type Commands
  | {
    type: 'SET_CHART_TYPE';
    payload: {
      chartType: 'candlestick' | 'bar' | 'line' | 'area';
      /** Route chart-menu/shortcut commands to the chart the user is operating. */
      targetContextId?: string;
    };
  }
  // Indicator Commands
  | {
    type: 'OPEN_INDICATOR_NAVIGATOR';
    payload: Record<string, never>;
  }
  // Chart Tool Commands
  | {
    type: 'TOGGLE_CROSSHAIR';
    payload: { targetContextId?: string };
  }
  | {
    type: 'ZOOM_IN';
    payload: { targetContextId?: string };
  }
  | {
    type: 'ZOOM_OUT';
    payload: { targetContextId?: string };
  }
  | {
    type: 'SCROLL_TO_REALTIME';
    payload: Record<string, never>;
  }
  | {
    type: 'JUMP_TO_LATEST_CANDLE';
    payload: Record<string, never>;
  }
  | {
    type: 'RESET_CHART_VIEWPORT';
    payload: Record<string, never>;
  }
  // Window Management Commands
  | {
    type: 'TILE_WINDOWS';
    payload: { mode: 'horizontal' | 'vertical' | 'grid' };
  }
  // Drawing Tool Commands
  | {
    type: 'SELECT_TOOL';
    payload: {
      tool: 'cursor' | 'trendline' | 'hline' | 'vline' | 'text' | 'channel' | 'fibonacci' | 'fib_extension' | 'measure' | 'freehand' | 'callout' | 'shapes' | 'rectangle' | 'ellipse' | 'stamp';
      subtype?: string;
      /** Explicit chart owner for commands coming from the web drawing rail. */
      targetContextId?: string;
    };
  }
  // Timeframe Commands
  | {
    type: 'SET_TIMEFRAME';
    payload: {
      timeframe: string;
      targetContextId?: string;
      panelId?: string;
    };
  }
  // Indicator Management
  | {
    type: 'ADD_INDICATOR';
    payload: {
      id?: string;
      name: string;
      indicatorType?: string;
      params: Record<string, any>;
      targetContextId?: string;
      symbol?: string;
    };
  }
  // Drawing Persistence
  | {
    type: 'SAVE_DRAWING';
    payload: { type: string; points: Array<{ x: number; y: number }> };
  }
  | {
    type: 'DELETE_DRAWING';
    payload: { id: string };
  }
  | {
    type: 'FIT_CONTENT';
    payload: Record<string, never>;
  }
  | {
    type: 'SELECT_TRENDLINE';
    payload: Record<string, never>;
  }
  | {
    type: 'SELECT_HLINE';
    payload: Record<string, never>;
  }
  | {
    type: 'SELECT_VLINE';
    payload: Record<string, never>;
  }
  | {
    type: 'SELECT_TEXT';
    payload: Record<string, never>;
  }
  | {
    type: 'TOGGLE_ALGO_TRADING';
    payload: Record<string, never>;
  }
  | {
    type: 'OPEN_DRAWING_TOOLS_MENU';
    payload: Record<string, never>;
  }
  | {
    type: 'OPEN_SHAPES_MENU';
    payload: Record<string, never>;
  }
  | {
    type: 'UNDO';
    payload: { targetContextId?: string };
  }
  | {
    type: 'REDO';
    payload: { targetContextId?: string };
  }
  | {
    type: 'DELETE_SELECTED_DRAWING';
    payload: { targetContextId?: string };
  }
  | {
    type: 'SELECT_ALL_DRAWINGS';
    payload: Record<string, never>;
  }
  | {
    type: 'SET_AUTO_SCROLL';
    payload: { enabled: boolean; targetContextId?: string };
  }
  | {
    type: 'SET_CHART_SHIFT';
    payload: { enabled: boolean; targetContextId?: string };
  }
  | {
    type: 'TOGGLE_MAGNET';
    payload: Record<string, never>;
  }
  | {
    type: 'EXPORT_CHART';
    payload: Record<string, never>;
  }
  | {
    type: 'TOGGLE_NAVIGATOR';
    payload: Record<string, never>;
  }
  | {
    type: 'TOGGLE_MARKET_WATCH';
    payload: Record<string, never>;
  }
  | {
    type: 'TOGGLE_DATA_WINDOW';
    payload: Record<string, never>;
  }
  | {
    type: 'TOGGLE_STRATEGY_TESTER';
    payload: Record<string, never>;
  }
  | {
    type: 'NEW_CHART';
    payload: Record<string, never>;
  }
  | {
    type: 'CASCADE_WINDOWS';
    payload: Record<string, never>;
  }
  | {
    type: 'OPEN_INDICATOR_LIST';
    payload: {
      category?: string;
      targetContextId?: string;
      symbol?: string;
    };
  };

/**
 * Extract the type from a command
 * Useful for type-safe command handling
 */
export type CommandType = Command['type'];

/**
 * Extract the payload type for a specific command type
 * @example PayloadFor<'SET_CHART_TYPE'> => { chartType: 'candlestick' | 'bar' | 'line' | 'area' }
 */
export type PayloadFor<T extends CommandType> = Extract<
  Command,
  { type: T }
>['payload'];

/**
 * Command handler type for a specific command type
 */
export type CommandHandler<T extends CommandType = CommandType> = (
  payload: PayloadFor<T>
) => void | Promise<void>;

/**
 * Unsubscribe function returned by subscribe
 */
export type Unsubscribe = () => void;

/**
 * Command Bus Interface
 * Implements the pub/sub pattern for centralized command dispatching
 */
export interface CommandBus {
  /**
   * Dispatch a command to all subscribed handlers
   * @param command - The command to dispatch
   */
  dispatch(command: Command): void;

  /**
   * Subscribe to a specific command type
   * @param type - The command type to listen for
   * @param handler - Function to call when command is dispatched
   * @returns Unsubscribe function to remove the listener
   */
  subscribe<T extends CommandType>(
    type: T,
    handler: CommandHandler<T>
  ): Unsubscribe;

  /**
   * Get the command history (last 100 commands)
   * Useful for debugging and replay
   */
  getHistory(): Command[];

  /**
   * Clear the command history
   */
  clearHistory(): void;

  /**
   * Replay a sequence of commands
   * Useful for testing and debugging
   * @param commands - Array of commands to replay
   */
  replay(commands: Command[]): Promise<void>;
}
