/**
 * CommandBusContext
 * React Context Provider for the centralized command bus
 * Makes the command bus accessible to all components via useContext
 *
 * Usage:
 * 1. Wrap your App with CommandBusProvider
 * 2. Use useCommandBusContext() in any component to access the bus
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { commandBus } from '../services/commandBus';
import type {
  Command,
  CommandType,
  CommandHandler,
  CommandBus,
} from '../types/commands';

/**
 * Context for the command bus
 */
const CommandBusContext = createContext<CommandBus | null>(null);

/**
 * CommandBusProvider Props
 */
interface CommandBusProviderProps {
  children: ReactNode;
}

/**
 * CommandBusProvider
 * Wraps your application and provides the command bus to all children
 *
 * @example
 * export default function App() {
 *   return (
 *     <CommandBusProvider>
 *       <YourApp />
 *     </CommandBusProvider>
 *   );
 * }
 */
export function CommandBusProvider({ children }: CommandBusProviderProps) {
  return (
    <CommandBusContext.Provider value={commandBus}>
      {children}
    </CommandBusContext.Provider>
  );
}

/**
 * useCommandBusContext Hook
 * Get the command bus instance from context
 *
 * @throws Error if used outside of CommandBusProvider
 *
 * @example
 * const bus = useCommandBusContext();
 * bus.dispatch({ type: 'SET_CHART_TYPE', payload: { chartType: 'line' } });
 */
export function useCommandBusContext(): CommandBus {
  const context = useContext(CommandBusContext);

  if (!context) {
    throw new Error(
      'useCommandBusContext must be used within a CommandBusProvider'
    );
  }

  return context;
}

/**
 * withCommandBus HOC
 * Higher-order component to inject the command bus into a component
 *
 * @example
 * function MyComponent({ commandBus }: { commandBus: CommandBus }) {
 *   return <button onClick={() => commandBus.dispatch(...)}>Click</button>;
 * }
 *
 * export default withCommandBus(MyComponent);
 */
export function withCommandBus<P extends { commandBus: CommandBus }>(
  Component: React.ComponentType<P>
) {
  return function WrappedComponent(props: Omit<P, 'commandBus'>) {
    const bus = useCommandBusContext();
    return <Component {...(props as P)} commandBus={bus} />;
  };
}

/**
 * Export the context for advanced use cases
 */
export { CommandBusContext };
