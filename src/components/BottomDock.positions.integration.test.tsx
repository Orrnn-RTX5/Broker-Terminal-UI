// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomDock } from './BottomDock';
import { useAppStore } from '../store/useAppStore';
import { normalizePosition, readPositionStreamBatch, reconcilePositionStreamBatch } from '../services/positionStream';
import { AccountSocketManager } from '../services/accountSocketManager';

describe('Trade table across symbol updates', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('rtx_saved_username', '200001');
    useAppStore.setState({ isAuthenticated: true, accountId: '200001', authToken: 'test-token', positions: [
      normalizePosition({ ticket: 20165, symbol: 'XAUUSD', side: 'buy', volume: 0.01, price_open: 4291.06, price_current: 4329.06, profit: 38 }),
      normalizePosition({ ticket: 20166, symbol: 'BTCUSD', side: 'sell', volume: 0.02, price_open: 110000, price_current: 109900, profit: 2 }),
    ] });
  });
  afterEach(() => {
    cleanup();
    useAppStore.setState({ isAuthenticated: false, accountId: null, authToken: null, positions: [] });
    localStorage.clear();
  });

  it('keeps both symbols visible in the real Trade tab as each symbol changes', () => {
    render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(screen.getByText('20165')).toBeInTheDocument();
    expect(screen.getByText('20166')).toBeInTheDocument();
    for (const [ticket, symbol] of [[20165, 'XAUUSD'], [20166, 'BTCUSD']] as const) {
      act(() => {
        const batch = readPositionStreamBatch({ channel: 'positions.200001', data: { type: 'pnl_update', symbol, positions: [{ ticket, price_current: 4350, profit: 12 }] } })!;
        useAppStore.getState().setPositions(reconcilePositionStreamBatch(useAppStore.getState().positions, batch).positions);
      });
      expect(screen.getByText('20165')).toBeInTheDocument();
      expect(screen.getByText('20166')).toBeInTheDocument();
      expect(screen.getByText('XAUUSD')).toBeInTheDocument();
      expect(screen.getByText('BTCUSD')).toBeInTheDocument();
    }
  });

  // The shared EnhancedWebSocketService no longer writes trade state; the
  // account socket consumer owns positions, so drive its real frame handler.
  it.each([false,true])('removes Manager closes through the account socket consumer and BottomDock, legacy wrapper=%s',async(legacy)=>{
    render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    const service=new AccountSocketManager();
    (service as any).login=200001;
    const handle=(service as any).handleMessage.bind(service);
    try {
      for(const ticket of [20165,20166]) {
        await act(async()=>handle({...(legacy?{type:'channel_message'}:{}),channel:'positions.200001',data:{
          type:'position_closed',data:{ticket,account_login:200001,status:'closed',volume:0.01,state_version:1,state_version_text:'1'},
        }}));
        await waitFor(()=>expect(screen.queryByText(String(ticket))).toBeNull());
      }
      expect(useAppStore.getState().positions).toEqual([]);
      // A delayed full REST row and price patch must not recreate either trade.
      await act(async()=>{
        useAppStore.getState().setPositions([normalizePosition({ticket:20166,symbol:'BTCUSD',side:'sell',volume:0.02,price_open:110000,state_version:'0'})]);
        handle({channel:'positions.200001',data:{type:'position_update',data:[{ticket:20166,update_kind:'pnl',state_version:'0',profit:99,price_time_msc:1800000000000}]}});
      });
      expect(screen.queryByText('20166')).toBeNull();
    } finally {service.destroy();}
  });
});
