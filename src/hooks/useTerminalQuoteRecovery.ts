import { useEffect } from 'react';
import { startTerminalQuoteRecovery } from '../services/terminalQuoteRecovery';

export function useTerminalQuoteRecovery(): void {
  useEffect(startTerminalQuoteRecovery, []);
}
