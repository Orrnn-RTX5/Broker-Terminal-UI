import { describe, expect, it } from 'vitest';
import { DrawingDocumentStore } from './DrawingDocumentStore';

describe('DrawingDocumentStore', () => {
  it('keeps documents and histories isolated by context key', () => {
    const store = new DrawingDocumentStore();
    const first = store.get('account-a|EURUSD|M1');
    const second = store.get('account-b|EURUSD|M1');

    first.push({ id: 'first', type: 'hline', points: [{ time: 1, price: 10 }] });
    store.undoStack('account-a|EURUSD|M1').push({ action: 'add', drawing: first[0] });

    expect(store.get('account-a|EURUSD|M1')).toHaveLength(1);
    expect(second).toEqual([]);
    expect(store.undoStack('account-b|EURUSD|M1')).toEqual([]);
  });

  it('marks each context for loading only once', () => {
    const store = new DrawingDocumentStore();

    expect(store.markLoaded('first')).toBe(true);
    expect(store.markLoaded('first')).toBe(false);
    expect(store.markLoaded('second')).toBe(true);
  });

  it('replaces a document and clears only its redo history', () => {
    const store = new DrawingDocumentStore();
    store.redoStack('first').push({ action: 'delete' });
    store.redoStack('second').push({ action: 'modify' });

    store.replace('first', [{ id: 'replacement', type: 'vline', points: [] }]);
    store.clearRedo('first');

    expect(store.peek('first')?.[0].id).toBe('replacement');
    expect(store.redoStack('first')).toEqual([]);
    expect(store.redoStack('second')).toHaveLength(1);
  });
});
