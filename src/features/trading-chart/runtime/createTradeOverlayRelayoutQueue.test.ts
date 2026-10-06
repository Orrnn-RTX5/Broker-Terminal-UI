import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTradeOverlayRelayoutQueue } from './createTradeOverlayRelayoutQueue';
import { layoutRebuiltTradeOverlay } from './layoutRebuiltTradeOverlay';

let nextId: number, callbacks: Map<number, FrameRequestCallback>;
beforeEach(() => {
  nextId = 0; callbacks = new Map();
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { callbacks.set(++nextId, callback);return nextId; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => callbacks.delete(id)));
});
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const state = { current: true, interacting: false };
  const frameRef = { current: null as number | null }, project = vi.fn(() => false), post = vi.fn();
  const scheduler = createTradeOverlayRelayoutQueue({frameRef,isCurrent:()=>state.current,isInteracting:()=>state.interacting,requestPostInteraction:post,project});
  const flush = () => { const id = frameRef.current!;const callback = callbacks.get(id)!;callbacks.delete(id);callback(0); };
  return {state,frameRef,project,post,...scheduler,flush};
}
describe('owned structural overlay geometry queue', () => {
  it('coalesces structural updates into one projection of latest nodes and never resurrects synchronously removed controls', () => {
    const f = fixture();let nodes = ['old'];const placed: string[] = [];
    f.project.mockImplementation(() => {placed.push(...nodes);return false;});
    for (let index=0;index<50;index++){nodes=[String(index)];layoutRebuiltTradeOverlay(f.queue);}
    expect(callbacks.size).toBe(1);expect(f.project).not.toHaveBeenCalled();nodes=[];f.flush();
    expect(f.project).toHaveBeenCalledTimes(1);expect(placed).toEqual([]);expect(callbacks.size).toBe(0);
    nodes=['latest'];layoutRebuiltTradeOverlay(f.queue);f.flush();expect(placed).toEqual(['latest']);
  });
  it('retries unresolved structural geometry once, then waits for a real later invalidation', () => {
    const f=fixture();f.project.mockReturnValue(true);layoutRebuiltTradeOverlay(f.queue);f.flush();
    expect(callbacks.size).toBe(1);f.flush();expect(callbacks.size).toBe(0);expect(f.project).toHaveBeenCalledTimes(2);
    f.queue();f.flush();expect(f.project).toHaveBeenCalledTimes(3);expect(callbacks.size).toBe(0);
    f.project.mockReturnValue(false);f.queue();f.flush();expect(f.project).toHaveBeenCalledTimes(4);expect(callbacks.size).toBe(0);
  });
  it('does not retry successful or intentionally clipped geometry and never cancels independent queued work', () => {
    const f=fixture();f.queue();const original=f.frameRef.current;layoutRebuiltTradeOverlay(f.queue);
    expect(f.frameRef.current).toBe(original);expect(cancelAnimationFrame).not.toHaveBeenCalled();f.flush();
    expect(f.project).toHaveBeenCalledTimes(1);expect(callbacks.size).toBe(0);
  });
  it('preserves reentrant quote/range invalidation raised by the projection itself', () => {
    const f=fixture();f.project.mockImplementationOnce(()=>{f.queue();return false;});
    layoutRebuiltTradeOverlay(f.queue);f.flush();expect(callbacks.size).toBe(1);f.flush();
    expect(f.project).toHaveBeenCalledTimes(2);expect(callbacks.size).toBe(0);
  });
  it('hands interaction work to the existing settle coordinator without spinning frames', () => {
    const f=fixture();f.state.interacting=true;layoutRebuiltTradeOverlay(f.queue);
    expect(f.post).toHaveBeenCalledTimes(1);expect(callbacks.size).toBe(0);expect(f.project).not.toHaveBeenCalled();
    f.state.interacting=false;f.queue();f.state.interacting=true;f.flush();
    expect(f.post).toHaveBeenCalledTimes(2);expect(callbacks.size).toBe(0);expect(f.project).not.toHaveBeenCalled();
    f.state.interacting=false;f.queue();f.flush();expect(f.project).toHaveBeenCalledTimes(1);
  });
  it('retains one structural retry through the real post-interaction projection without gesture polling', () => {
    const f=fixture();f.state.interacting=true;f.project.mockReturnValue(true);layoutRebuiltTradeOverlay(f.queue);
    expect(callbacks.size).toBe(0);f.flushPostInteraction();expect(f.project).not.toHaveBeenCalled();
    f.state.interacting=false;f.flushPostInteraction();expect(f.project).toHaveBeenCalledTimes(1);expect(callbacks.size).toBe(1);
    f.flush();expect(f.project).toHaveBeenCalledTimes(2);expect(callbacks.size).toBe(0);
  });
  it('does not project after ownership changes and ignores requests from a stale runtime', () => {
    const f=fixture();layoutRebuiltTradeOverlay(f.queue);f.state.current=false;f.flush();
    expect(f.project).not.toHaveBeenCalled();layoutRebuiltTradeOverlay(f.queue);expect(callbacks.size).toBe(0);
  });
  it('a late old callback or cleanup cannot clear or cancel a replacement owner frame', () => {
    const f=fixture();f.queue();const oldId=f.frameRef.current!,late=callbacks.get(oldId)!;
    f.frameRef.current=999;late(0);f.dispose();
    expect(f.frameRef.current).toBe(999);expect(cancelAnimationFrame).not.toHaveBeenCalled();expect(f.project).not.toHaveBeenCalled();
  });
  it('cancels only its own pending frame on disposal, and ignores even an already dequeued callback', () => {
    const f=fixture();f.queue();const id=f.frameRef.current!,late=callbacks.get(id)!;f.dispose();late(0);
    expect(cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(id);expect(f.frameRef.current).toBeNull();expect(f.project).not.toHaveBeenCalled();
  });
  it('preserves a real replacement queue on the same ref after old cleanup and a late old callback', () => {
    const old=fixture();old.queue();const oldId=old.frameRef.current!,late=callbacks.get(oldId)!;old.dispose();
    const project=vi.fn(()=>false),replacement=createTradeOverlayRelayoutQueue({frameRef:old.frameRef,isCurrent:()=>true,isInteracting:()=>false,requestPostInteraction:vi.fn(),project});
    replacement.queue();const newId=old.frameRef.current!;late(0);old.dispose();
    expect(old.frameRef.current).toBe(newId);expect(callbacks.has(newId)).toBe(true);expect(cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(oldId);
    callbacks.get(newId)!(0);expect(project).toHaveBeenCalledTimes(1);expect(old.project).not.toHaveBeenCalled();
  });
});
