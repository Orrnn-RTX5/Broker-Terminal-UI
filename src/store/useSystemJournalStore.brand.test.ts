import { afterEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({ playSystemSound: vi.fn() }));
vi.mock('../utils/audio', () => audio);

import {
  JOURNAL_WELCOME_MESSAGE,
  formatJournalLoginMessage,
  useSystemJournalStore,
} from './useSystemJournalStore';

afterEach(() => {
  vi.useRealTimers();
  audio.playSystemSound.mockReset();
});

describe('system journal neutral messages', () => {
  it('starts with a neutral welcome entry', () => {
    const [first] = useSystemJournalStore.getState().logs;
    expect(first.message).toBe('Welcome to the terminal');
    expect(first.message).toBe(JOURNAL_WELCOME_MESSAGE);
    expect(first.message).not.toMatch(/rtx/i);
  });

  it('logs a neutral login message and still plays the login sound', () => {
    vi.useFakeTimers();
    const message = formatJournalLoginMessage(4242);
    expect(message).toBe('Login as account 4242');
    useSystemJournalStore.getState().addLog('System', message);
    vi.runAllTimers();
    expect(useSystemJournalStore.getState().logs[0].message).toBe('Login as account 4242');
    expect(audio.playSystemSound).toHaveBeenCalledWith('login');
  });

  it('plays the welcome sound only for the exact welcome message', () => {
    vi.useFakeTimers();
    useSystemJournalStore.getState().addLog('System', JOURNAL_WELCOME_MESSAGE);
    useSystemJournalStore.getState().addLog('System', 'Account login settings changed');
    vi.runAllTimers();
    expect(audio.playSystemSound.mock.calls).toEqual([['welcome']]);
  });
});
