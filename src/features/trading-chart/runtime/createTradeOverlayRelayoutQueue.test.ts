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
  const frameRef = { current: null as number | null }, project = vi.fn((_refreshMetrics?: boolean) => false), post = vi.fn();
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
    expect(f.project).not.toHaveBeenCalled();expect(f.frameRef.current).toBeNull();
    layoutRebuiltTradeOverlay(f.queue);expect(callbacks.size).toBe(0);
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
  it('lets committed projection fulfil its exact pending model request including metrics, without a second queued pass', () => {
    const f=fixture();f.queue();const id=f.frameRef.current!,late=callbacks.get(id)!;
    f.projectCommittedGeometry();expect(f.project).toHaveBeenCalledExactlyOnceWith();
    expect(cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(id);expect(callbacks.size).toBe(0);
    late(0);expect(f.project).toHaveBeenCalledTimes(1);expect(f.frameRef.current).toBeNull();
    f.projectCommittedGeometry();expect(f.project).toHaveBeenLastCalledWith(false);
    expect(f.project).toHaveBeenCalledTimes(2);
  });
  it('always projects a later committed transform even if the queued model pass ran first', () => {
    const f=fixture();f.queue();f.flush();f.projectCommittedGeometry();
    expect(f.project.mock.calls).toEqual([[],[false]]);
  });
  it('preserves new structural work raised during committed projection and its own bounded retry', () => {
    const f=fixture();f.queue();const old=f.frameRef.current!,late=callbacks.get(old)!;
    f.project.mockImplementationOnce(()=>{f.queue({retryOnce:true});return true;}).mockReturnValue(true);
    f.projectCommittedGeometry();const next=f.frameRef.current;
    expect(next).not.toBe(old);late(0);expect(f.frameRef.current).toBe(next);
    f.flush();expect(callbacks.size).toBe(1);f.flush();expect(callbacks.size).toBe(0);
    expect(f.project).toHaveBeenCalledTimes(3);
  });
  it('consumes one structural coordinate retry and does not add retries for ordinary committed requests', () => {
    const f=fixture();f.project.mockReturnValue(true);f.queue({retryOnce:true});
    f.projectCommittedGeometry();expect(callbacks.size).toBe(1);f.flush();expect(callbacks.size).toBe(0);
    f.queue();f.projectCommittedGeometry();expect(callbacks.size).toBe(0);
  });
  it('projects gesture geometry without consuming deferred metrics or the structural retry', () => {
    const f=fixture();f.state.interacting=true;f.queue({retryOnce:true});f.project.mockReturnValue(true);
    f.projectCommittedGeometry();expect(f.project).toHaveBeenCalledExactlyOnceWith(false);expect(callbacks.size).toBe(0);
    f.state.interacting=false;f.flushPostInteraction();expect(f.project).toHaveBeenLastCalledWith();
    expect(callbacks.size).toBe(1);f.flush();expect(callbacks.size).toBe(0);
  });
  it('cannot consume an externally replaced frame, or project after ownership changes/disposal', () => {
    const f=fixture();f.queue();f.frameRef.current=999;f.projectCommittedGeometry();
    expect(f.project).toHaveBeenCalledExactlyOnceWith(false);expect(f.frameRef.current).toBe(999);
    expect(cancelAnimationFrame).not.toHaveBeenCalled();f.state.current=false;f.projectCommittedGeometry();
    f.dispose();f.projectCommittedGeometry();expect(f.project).toHaveBeenCalledTimes(1);expect(f.frameRef.current).toBe(999);
  });
  it('preserves real work queued during a thrown committed projection without inventing exception retries', () => {
    const f=fixture();f.queue();
    f.project.mockImplementationOnce(()=>{f.queue({retryOnce:true});throw Error('interrupted');}).mockReturnValue(true);
    expect(()=>f.projectCommittedGeometry()).toThrow('interrupted');expect(callbacks.size).toBe(1);
    f.flush();expect(callbacks.size).toBe(1);f.flush();expect(callbacks.size).toBe(0);
    f.queue();f.project.mockImplementation(()=>{throw Error('repeat');});
    expect(()=>f.projectCommittedGeometry()).toThrow('repeat');expect(callbacks.size).toBe(0);
    f.queue();expect(()=>f.flush()).toThrow('repeat');expect(callbacks.size).toBe(0);
  });
  it('does not resurrect an old owner request when metrics replace the owner then throw', () => {
    const f=fixture();f.queue();const replacement=999;
    f.project.mockImplementationOnce(()=>{f.state.current=false;f.frameRef.current=replacement;throw Error('replacement');});
    expect(()=>f.projectCommittedGeometry()).toThrow('replacement');f.dispose();
    expect(f.frameRef.current).toBe(replacement);expect(callbacks.size).toBe(0);
  });
  it('distinguishes reentrant requests even when the browser reuses the cancelled RAF ID', () => {
    const f=fixture();f.queue();const id=f.frameRef.current!,late=callbacks.get(id)!;
    f.project.mockImplementationOnce(()=>{nextId=id-1;f.queue();return false;});
    f.projectCommittedGeometry();expect(f.frameRef.current).toBe(id);
    const replacement=callbacks.get(id)!;expect(replacement).not.toBe(late);
    late(0);expect(f.project).toHaveBeenCalledTimes(1);expect(f.frameRef.current).toBe(id);
    expect(callbacks.get(id)).toBe(replacement);f.flush();expect(f.project).toHaveBeenCalledTimes(2);
  });
  it('does not cancel a replacement owner using the old numeric RAF ID during old cleanup', () => {
    const old=fixture();old.queue();const id=old.frameRef.current!,late=callbacks.get(id)!;
    // External visual cleanup retires the old frame before the new owner binds.
    callbacks.delete(id);old.frameRef.current=null;nextId=id-1;
    const project=vi.fn(()=>false),replacement=createTradeOverlayRelayoutQueue({frameRef:old.frameRef,isCurrent:()=>true,
      isInteracting:()=>false,requestPostInteraction:vi.fn(),project});
    replacement.queue();expect(old.frameRef.current).toBe(id);const next=callbacks.get(id)!;
    late(0);old.dispose();expect(old.frameRef.current).toBe(id);expect(callbacks.get(id)).toBe(next);
    expect(cancelAnimationFrame).not.toHaveBeenCalled();next(0);expect(project).toHaveBeenCalledTimes(1);
  });
  it('repeatedly throwing committed draws never add retry requests', () => {
    const f=fixture();f.queue();f.project.mockImplementation(()=>{throw Error('persistent');});
    expect(()=>f.projectCommittedGeometry()).toThrow('persistent');
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    for(let i=0;i<5;i++)expect(()=>f.projectCommittedGeometry()).toThrow('persistent');
    expect(f.frameRef.current).toBeNull();expect(callbacks.size).toBe(0);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
  });
});
