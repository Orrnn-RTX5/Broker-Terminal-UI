/**
 * MT5 Trade Service — Axios-based direct trade execution
 * 
 * Connects to MT5 Sync C++ backend on port 8088.
 * No authentication required. All trades execute directly on MT5.
 */

import axios, { AxiosError } from 'axios';
import { useSystemJournalStore } from '../store/useSystemJournalStore';
import { tradeSoundService } from './tradeSoundService';

// MT5 Sync backend base URL — always call the real backend directly
const MT5_SYNC_BASE = import.meta.env.VITE_MT5_SYNC_URL || 'https://rtxbackend.tradecopier.org';

// ─── Request / Response Types ────────────────────────────────────────────────
export interface ExecuteTradeRequest {
    account_login: number;
    symbol: string;
    side: 'buy' | 'sell';
    volume_lots: number;
    price: number;          // 0 = market price
    stop_loss?: number;
    take_profit?: number;
    comment: string;
    client_request_id: string;
}

export interface ExecuteTradeResponse {
    success: boolean;
    retcode: number;
    retcode_text: string;
    result_order: number;
    result_deal: number;
    result_price: number;
}

export interface CloseTradeRequest {
    account_login: number;
    ticket: number;
    volume_lots?: number;   // 0 or omitted = close full position
}

export interface CloseTradeResponse {
    success: boolean;
    retcode: number;
    retcode_text: string;
    result_order?: number;
    result_deal?: number;
}

export interface ModifyTradeResponse {
    success: boolean;
    retcode: number;
    retcode_text: string;
    message?: string;
}

// ─── Axios Instance ──────────────────────────────────────────────────────────

const mt5Axios = axios.create({
    baseURL: MT5_SYNC_BASE,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
});

// Attach auth token to every request (required by gateway)
mt5Axios.interceptors.request.use((config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ─── Helper: Generate unique request ID ──────────────────────────────────────

export const generateRequestId = (): string => {
    return `rtx-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
};

// ─── Trade Service ───────────────────────────────────────────────────────────

export const mt5TradeService = {
    /**
     * Execute a trade (BUY or SELL) on MT5 via port 8088
     */
    async executeTrade(params: {
        accountLogin: number;
        symbol: string;
        side: 'buy' | 'sell';
        volumeLots: number;
        price?: number;
        sl?: number;
        tp?: number;
        comment?: string;
    }): Promise<ExecuteTradeResponse> {
        const requestBody: ExecuteTradeRequest = {
            account_login: params.accountLogin,
            symbol: params.symbol,
            side: params.side,
            volume_lots: params.volumeLots,
            price: params.price ?? 0,
            stop_loss: params.sl,
            take_profit: params.tp,
            comment: params.comment || 'RTX sync trade',
            client_request_id: generateRequestId(),
        };

        const MAX_RETRIES = 2;
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[MT5 Trade] Retry #${attempt} for executeTrade ${params.symbol}`);
                    await new Promise(r => setTimeout(r, 500 * attempt));
                }
                console.log('[MT5 Trade] Sending to:', MT5_SYNC_BASE + '/api/v1/trades/execute');
                console.log('[MT5 Trade] Request body:', JSON.stringify(requestBody, null, 2));

                const { data } = await mt5Axios.post<ExecuteTradeResponse>(
                    '/api/v1/trades/execute',
                    requestBody
                );

                console.log('[MT5 Trade] Execute response:', data);

                if (!data.success) {
                    useSystemJournalStore.getState().addLog('Trade', `Failed to execute ${params.side} ${params.volumeLots} ${params.symbol} at ${params.price || 'market'} (retcode: ${data.retcode})`);
                    // MT5 retcode 10019 = TRADE_RETCODE_NO_MONEY (insufficient margin)
                    if (data.retcode === 10019) {
                        tradeSoundService.onMarginError();
                    } else {
                        tradeSoundService.onOrderRejected();
                    }
                    throw new MT5TradeError(
                        data.retcode,
                        data.retcode_text || `Trade failed (retcode: ${data.retcode})`,
                        data
                    );
                }

                // ✅ Trade executed successfully
                tradeSoundService.onOrderExecuted();
                useSystemJournalStore.getState().addLog('Trade', `Executed ${params.side} ${params.volumeLots} ${params.symbol} at ${data.result_price}`);

                // --- FALLBACK: MT5 backend execute endpoint drops SL/TP ---
                // If SL or TP were provided, we must modify the position immediately after execution
                if (params.sl || params.tp) {
                    const ticket = data.result_order || data.result_deal;
                    if (ticket) {
                        try {
                            console.log(`[MT5 Trade] Applying SL/TP fallback to ticket #${ticket}`);
                            await mt5TradeService.modifyTrade({
                                ticket,
                                stopLoss: params.sl || 0,
                                takeProfit: params.tp || 0,
                                comment: params.comment || 'SL/TP auto-apply'
                            });
                            useSystemJournalStore.getState().addLog('Trade', `Set SL: ${params.sl || 0}, TP: ${params.tp || 0} for ticket #${ticket}`);
                        } catch (modifyErr) {
                            console.error('[MT5 Trade] Failed to apply SL/TP fallback:', modifyErr);
                            useSystemJournalStore.getState().addLog('Error', `Failed to set SL/TP for ticket #${ticket}`);
                        }
                    }
                }

                return data;
            } catch (error) {
                if (error instanceof MT5TradeError) throw error;
                lastError = error;
                // Only retry on network/CORS/502 errors
                if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    const isRetryable = error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || status === 502 || status === 503;
                    if (!isRetryable || attempt === MAX_RETRIES) {
                        throw handleAxiosError(error, 'executeTrade');
                    }
                } else if (attempt === MAX_RETRIES) {
                    throw handleAxiosError(error, 'executeTrade');
                }
            }
        }
        throw handleAxiosError(lastError, 'executeTrade');
    },

    /**
     * Close a position on MT5 via port 8088
     */
    async closeTrade(params: {
        accountLogin?: number; // kept for backwards compat but not sent
        ticket: number;
        volumeLots?: number;
    }): Promise<CloseTradeResponse> {
        const requestBody: any = {
            ticket: params.ticket,
            volume_lots: params.volumeLots,
            comment: "close from RTX frontend",
            client_request_id: `close-${Date.now()}`
        };

        const MAX_RETRIES = 2;
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[MT5 Trade] Retry #${attempt} for closeTrade ticket=${params.ticket}`);
                    await new Promise(r => setTimeout(r, 500 * attempt)); // 500ms, 1000ms
                }
                console.log('[MT5 Trade] Sending Close Position:', requestBody);
                const { data } = await mt5Axios.post<CloseTradeResponse>(
                    '/api/v1/trades/close',
                    requestBody
                );

                console.log('[MT5 Trade] Close response:', data);

                if (!data.success) {
                    useSystemJournalStore.getState().addLog('Trade', `Failed to close position #${params.ticket} (retcode: ${data.retcode})`);
                    // MT5 retcode 10019 = TRADE_RETCODE_NO_MONEY (insufficient margin)
                    if (data.retcode === 10019) {
                        tradeSoundService.onMarginError();
                    } else {
                        tradeSoundService.onOrderRejected();
                    }
                    throw new MT5TradeError(
                        data.retcode,
                        data.retcode_text || `Close failed (retcode: ${data.retcode})`,
                        data
                    );
                }

                // ✅ Position closed successfully
                tradeSoundService.onOrderClosed();
                useSystemJournalStore.getState().addLog('Trade', `Closed position #${params.ticket}${params.volumeLots ? ` (lots: ${params.volumeLots})` : ''}`);
                return data;
            } catch (error) {
                if (error instanceof MT5TradeError) throw error;
                lastError = error;
                // Only retry on network/CORS/502 errors
                if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    const isRetryable = error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || status === 502 || status === 503;
                    if (!isRetryable || attempt === MAX_RETRIES) {
                        throw handleAxiosError(error, 'closeTrade');
                    }
                } else if (attempt === MAX_RETRIES) {
                    throw handleAxiosError(error, 'closeTrade');
                }
            }
        }
        throw handleAxiosError(lastError, 'closeTrade');
    },

    /**
     * Get order history from MT5 via port 8088
     * GET /api/v1/orders/history?login={login}&from={from}&to={to}
     */
    async getOrderHistory(params: {
        login: number;
        from?: number;   // Unix timestamp, default 30 days ago
        to?: number;     // Unix timestamp, default now
    }): Promise<OrderHistoryResponse> {
        try {
            const queryParams: Record<string, number> = {
                login: params.login,
            };
            if (params.from) queryParams.from = params.from;
            if (params.to) queryParams.to = params.to;

            const { data } = await mt5Axios.get<OrderHistoryResponse>(
                '/api/v1/orders/history',
                { params: queryParams }
            );

            console.log('[MT5 Trade] Order history:', data.count, 'orders');
            return data;
        } catch (error) {
            if (error instanceof MT5TradeError) throw error;
            throw handleAxiosError(error, 'getOrderHistory');
        }
    },

    /**
     * Modify a position's SL/TP on MT5
     * POST /api/v1/trades/modify
     */
    async modifyTrade(params: {
        ticket: number;
        stopLoss: number;
        takeProfit: number;
        deviationPoints?: number;
        comment?: string;
    }): Promise<ModifyTradeResponse> {
        const requestBody = {
            ticket: params.ticket,
            stop_loss: params.stopLoss,
            take_profit: params.takeProfit,
            deviation_points: params.deviationPoints ?? 10,
            comment: params.comment || 'Modified via RTX Terminal',
        };

        const MAX_RETRIES = 2;
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[MT5 Trade] Retry #${attempt} for modifyTrade ticket=${params.ticket}`);
                    await new Promise(r => setTimeout(r, 500 * attempt));
                }
                console.log('[MT5 Trade] Sending Modify Position:', requestBody);
                const { data } = await mt5Axios.post<ModifyTradeResponse>(
                    '/api/v1/trades/modify',
                    requestBody
                );

                console.log('[MT5 Trade] Modify response:', data);

                if (!data.success) {
                    throw new MT5TradeError(
                        data.retcode,
                        data.retcode_text || `Modify failed (retcode: ${data.retcode})`,
                        data
                    );
                }

                return data;
            } catch (error) {
                if (error instanceof MT5TradeError) throw error;
                lastError = error;
                // Only retry on network/CORS/502 errors
                if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    const isRetryable = error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || status === 502 || status === 503;
                    if (!isRetryable || attempt === MAX_RETRIES) {
                        throw handleAxiosError(error, 'modifyTrade');
                    }
                } else if (attempt === MAX_RETRIES) {
                    throw handleAxiosError(error, 'modifyTrade');
                }
            }
        }
        throw handleAxiosError(lastError, 'modifyTrade');
    },
};

// ─── Order History Types ─────────────────────────────────────────────────────

export interface MT5HistoryOrder {
    order: number;
    login: number;
    symbol: string;
    type: number;
    type_text: string;        // "buy", "sell", "buy_limit", "sell_limit", etc.
    state: number;
    state_text: string;       // "started", "placed", "canceled", "filled", "expired"
    volume_initial_lots: number;
    volume_current_lots: number;
    price_order: number;
    price_current: number;
    price_sl: number;
    price_tp: number;
    time_setup: number;       // Unix timestamp
    time_done: number;        // Unix timestamp
    comment: string;
    reason: number;
    position_id: number;
}

export interface OrderHistoryResponse {
    success: boolean;
    count: number;
    orders: MT5HistoryOrder[];
}

// ─── Error Handling ──────────────────────────────────────────────────────────

export class MT5TradeError extends Error {
    constructor(
        public retcode: number,
        message: string,
        public response?: any
    ) {
        super(message);
        this.name = 'MT5TradeError';
    }
}

function handleAxiosError(error: unknown, context: string): MT5TradeError {
    if (axios.isAxiosError(error)) {
        const axiosErr = error as AxiosError<any>;

        console.error(`[MT5 Trade] Axios error in ${context}:`, {
            status: axiosErr.response?.status,
            data: axiosErr.response?.data,
            code: axiosErr.code,
            message: axiosErr.message,
        });

        if (axiosErr.response) {
            // Server responded with error status
            const data = axiosErr.response.data;
            const status = axiosErr.response.status;

            // Empty 500 response — backend crashed or internal error
            if (status === 500 && (!data || (typeof data === 'string' && data.trim() === ''))) {
                return new MT5TradeError(
                    status,
                    'MT5 backend internal error (500). The server may be restarting — try again in a few seconds.',
                );
            }

            return new MT5TradeError(
                data?.retcode || status,
                data?.retcode_text || data?.message || `Server error: ${status}`,
                data
            );
        }

        if (axiosErr.code === 'ECONNREFUSED' || axiosErr.code === 'ERR_NETWORK') {
            // CORS error on 502 shows as ERR_NETWORK in the browser
            return new MT5TradeError(
                -1,
                'Backend gateway unavailable (CORS/502). The server may be temporarily down — please try again in a few seconds.',
            );
        }

        if (axiosErr.code === 'ECONNABORTED') {
            return new MT5TradeError(-2, 'Trade request timed out. Try again.');
        }

        return new MT5TradeError(-3, `Network error: ${axiosErr.message}`);
    }

    return new MT5TradeError(-99, `Unexpected error in ${context}: ${String(error)}`);
}

export default mt5TradeService;
