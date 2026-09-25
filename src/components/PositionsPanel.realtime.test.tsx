// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionsPanel } from './PositionsPanel';
import { reconcilePanelPositions, reconcilePanelSnapshot } from '../services/positionsPanelStream';

vi.mock('../services/brokerSession', async (original) => ({ ...await original<typeof import('../services/brokerSession')>(), buildBrokerWsV2Uri: () => 'ws://example.test/ws/v2' }));
vi.mock('./ModifyPositionDialog', () => ({ ModifyPositionDialog: () => null }));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen: null | (() => void) = null;
  onclose: null | (() => void) = null;
  onerror = null;
  onmessage: null | ((event: { data: string }) => void) = null;
  send = vi.fn();
  constructor() { Socket.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
const row = { ticket:112269, account_login:200001, symbol:'BTCUSD', side:'buy', volume:0.01, price_open:60000, price_current:60100, profit:1, swap:0, price_sl:59000, price_tp:0, time_create:1800000000, state_version:'0' };
const close = { channel:'positions.200001', data:{ type:'position_closed', data:{ ticket:112269, position_ticket:112269, account_login:200001, status:'closed', state_version:1, state_version_text:'1', volume:0.01 } } };
const response = (data: unknown) => ({ ok:true, json:async()=>data }) as Response;

beforeEach(() => {
 Socket.instances=[];
 vi.stubGlobal('WebSocket',Socket);
 vi.stubGlobal('fetch',vi.fn(async (url:unknown)=>response(String(url).includes('/positions/')?[row]:[])));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});

describe('actual Trade tab realtime position lifecycle',()=>{
 it('removes the final Manager-closed row immediately and rejects delayed REST and PnL resurrection',async()=>{
  render(<PositionsPanel accountId="200001" />);
  await screen.findByText('112269');
  act(()=>Socket.instances[0].onopen?.());
  let resolve!: (value:Response)=>void;
  vi.mocked(fetch).mockImplementationOnce(()=>new Promise<Response>(done=>{resolve=done;}));
  act(()=>window.dispatchEvent(new Event('rtx:force-refresh-positions')));
  act(()=>Socket.instances[0].message(close));
  expect(screen.queryByText('112269')).toBeNull();
  await act(async()=>resolve(response([row])));
  act(()=>Socket.instances[0].message({channel:'positions.200001',data:{type:'position_update',data:[{...row,update_kind:'pnl',price_time_msc:1800000001000,profit:50}]}}));
  expect(screen.queryByText('112269')).toBeNull();
 });

 it('refreshes positions after reconnect when a close happened offline',async()=>{
  render(<PositionsPanel accountId="200001" />);
  await screen.findByText('112269');
  act(()=>Socket.instances[0].onopen?.());
  vi.mocked(fetch).mockImplementation(async()=>response([]));
  vi.useFakeTimers();
  act(()=>Socket.instances[0].close());
  act(()=>vi.advanceTimersByTime(3000));
  await act(async()=>Socket.instances[1].onopen?.());
  vi.useRealTimers();
  await waitFor(()=>expect(screen.queryByText('112269')).toBeNull());
 });

 it('handles full/partial snapshots, explicit protection clears, ordered PnL and account scope',()=>{
  const closed=new Set<number>();
  const msg=(data:any)=>({channel:'positions.200001',data:{type:'position_modified',data}});
  let rows=reconcilePanelPositions([],msg({...row,update_kind:'snapshot'}),200001,closed);
  rows=reconcilePanelPositions(rows,msg({...row,volume:0.005,state_version:'1',price_sl:null,update_kind:'snapshot',pnl_available:false}),200001,closed);
  expect(rows[0]).toMatchObject({volume:0.005,price_sl:0,state_version:'1',side:'buy'});
  rows=reconcilePanelPositions(rows,{data:{type:'position_update',data:[{ticket:112269,state_version:'1',update_kind:'pnl',price_time_msc:20,profit:3,price_current:60200}]}},200001,closed);
  expect(rows[0]).toMatchObject({profit:3,price_current:60200,volume:0.005});
  rows=reconcilePanelPositions(rows,{data:{type:'position_update',data:[{ticket:112269,state_version:'1',update_kind:'pnl',price_time_msc:19,profit:999}]}},200001,closed);
  expect(rows[0].profit).toBe(3);
  expect(reconcilePanelPositions(rows,msg({...row,account_login:999,status:'closed',state_version:'2'}),200001,closed)).toHaveLength(1);
  expect(reconcilePanelSnapshot(rows,[row],200001,closed,true)[0].volume).toBe(0.005);
 });

 it('rejects a delayed previous-session REST response after A to B to A account switching',async()=>{
  const requests: Array<(value:Response)=>void>=[];
  vi.mocked(fetch).mockImplementation(async(url)=>String(url).includes('/positions/')
    ? new Promise<Response>(done=>requests.push(done)) : response([]));
  const view=render(<PositionsPanel accountId="200001" />);
  view.rerender(<PositionsPanel accountId="200002" />);
  view.rerender(<PositionsPanel accountId="200001" />);
  await act(async()=>requests[2](response([{...row,ticket:112999}])));
  expect(screen.getByText('112999')).toBeTruthy();
  await act(async()=>requests[0](response([row])));
  expect(screen.queryByText('112269')).toBeNull();
  expect(screen.getByText('112999')).toBeTruthy();
 });
});
