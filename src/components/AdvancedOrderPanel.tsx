import { useState, useEffect } from 'react';
import { API_BASE_URL, buildApiUrl } from '../config/api';

interface OrderType {
    value: string;
    label: string;
}

interface OrderPanelProps {
    symbol: string;
    currentPrice?: { bid: number; ask: number };
    onOrderPlaced?: (order: any) => void;
}

const orderTypes: OrderType[] = [
    { value: 'MARKET', label: 'Market' },
    { value: 'LIMIT', label: 'Limit' },
    { value: 'STOP', label: 'Stop' },
    { value: 'STOP_LIMIT', label: 'Stop Limit' },
];

const slTpModes = ['Price', 'Pips', 'Money'] as const;
type SLTPMode = typeof slTpModes[number];

export function AdvancedOrderPanel({ symbol, currentPrice, onOrderPlaced }: OrderPanelProps) {
    const [orderType, setOrderType] = useState('MARKET');
    const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
    const [volume, setVolume] = useState('0.01');
    const [price, setPrice] = useState('');
    const [triggerPrice, setTriggerPrice] = useState('');
    const [sl, setSL] = useState('');
    const [tp, setTP] = useState('');
    const [slTpMode, setSlTpMode] = useState<SLTPMode>('Price');
    const [riskPercent, setRiskPercent] = useState('1');
    const [useRiskCalc, setUseRiskCalc] = useState(false);
    const [calculatedLot, setCalculatedLot] = useState<number | null>(null);
    const [marginPreview, setMarginPreview] = useState<any>(null);
    const [oneClick, setOneClick] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [loading, setLoading] = useState(false);

    // Set default price when price changes
    useEffect(() => {
        if (currentPrice && !price) {
            const defaultPrice = side === 'BUY' ? currentPrice.ask : currentPrice.bid;
            setPrice(defaultPrice.toFixed(5));
        }
    }, [currentPrice, side]);

    // Calculate lot from risk
    useEffect(() => {
        if (!useRiskCalc || !sl || !riskPercent) {
            setCalculatedLot(null);
            return;
        }

        const slPips = parseFloat(sl);
        if (slPips <= 0) return;

        // Must explicitly import to avoid async component level loading issues
        import('../api/client').then(({ apiClient }) => {
            apiClient.get<any>(`${API_BASE_URL}/risk/calculate-lot?symbol=${symbol}&riskPercent=${riskPercent}&slPips=${slPips}`)
                .then(data => {
                    if (data?.lotSize) {
                        setCalculatedLot(data.lotSize);
                        setVolume(data.lotSize.toFixed(2));
                    }
                })
                .catch(() => { });
        });
    }, [useRiskCalc, sl, riskPercent, symbol]);

    // Preview margin
    useEffect(() => {
        if (!volume || parseFloat(volume) <= 0) {
            setMarginPreview(null);
            return;
        }

        import('../api/client').then(({ apiClient }) => {
            apiClient.get<any>(`${API_BASE_URL}/risk/margin-preview?symbol=${symbol}&volume=${volume}&side=${side}`)
                .then(data => setMarginPreview(data))
                .catch(() => setMarginPreview(null));
        });
    }, [volume, symbol, side]);

    const handleSubmit = async () => {
        if (!oneClick) {
            setShowConfirmation(true);
            return;
        }
        await executeOrder();
    };

    const executeOrder = async () => {
        setLoading(true);
        setShowConfirmation(false);

        try {
            let endpoint = '/order';
            const body: any = {
                symbol,
                side,
                volume: parseFloat(volume),
            };

            switch (orderType) {
                case 'LIMIT':
                    endpoint = '/order/limit';
                    body.price = parseFloat(price);
                    break;
                case 'STOP':
                    endpoint = '/order/stop';
                    body.triggerPrice = parseFloat(triggerPrice || price);
                    break;
                case 'STOP_LIMIT':
                    endpoint = '/order/stop-limit';
                    body.triggerPrice = parseFloat(triggerPrice);
                    body.limitPrice = parseFloat(price);
                    break;
            }

            if (sl) body.sl = parseFloat(sl);
            if (tp) body.tp = parseFloat(tp);

            const { apiClient } = await import('../api/client');
            const data = await apiClient.post<any>(`${API_BASE_URL}${endpoint}`, body);
            if (onOrderPlaced) onOrderPlaced(data);
        } catch (err) {
            console.error('Order failed:', err);
        } finally {
            setLoading(false);
        }
    };

    const currentAsk = currentPrice?.ask.toFixed(5) || '---';
    const currentBid = currentPrice?.bid.toFixed(5) || '---';

    return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 w-80">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-zinc-200">{symbol}</h3>
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                    <input
                        type="checkbox"
                        checked={oneClick}
                        onChange={(e) => setOneClick(e.target.checked)}
                        className="rounded bg-zinc-800 border-zinc-600"
                    />
                    One-Click
                </label>
            </div>

            {/* Order Type Selector */}
            <div className="flex gap-1 mb-4">
                {orderTypes.map((type) => (
                    <button
                        key={type.value}
                        onClick={() => setOrderType(type.value)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${orderType === type.value
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                            }`}
                    >
                        {type.label}
                    </button>
                ))}
            </div>

            {/* Volume */}
            <div className="mb-3">
                <label className="text-xs text-zinc-500 mb-1 block">Volume (Lots)</label>
                <div className="flex gap-2">
                    <input
                        type="number"
                        value={volume}
                        onChange={(e) => setVolume(e.target.value)}
                        step="0.01"
                        min="0.01"
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                    />
                    <div className="flex gap-1">
                        {[0.01, 0.1, 1].map((v) => (
                            <button
                                key={v}
                                onClick={() => setVolume(v.toString())}
                                className="px-2 py-1 text-xs bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700"
                            >
                                {v}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Price Fields (for non-market orders) */}
            {orderType !== 'MARKET' && (
                <div className="mb-3 grid grid-cols-2 gap-2">
                    {(orderType === 'STOP' || orderType === 'STOP_LIMIT') && (
                        <div>
                            <label className="text-xs text-zinc-500 mb-1 block">Trigger Price</label>
                            <input
                                type="number"
                                value={triggerPrice}
                                onChange={(e) => setTriggerPrice(e.target.value)}
                                placeholder="Trigger"
                                step="0.00001"
                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                            />
                        </div>
                    )}
                    <div className={orderType === 'STOP' ? 'hidden' : ''}>
                        <label className="text-xs text-zinc-500 mb-1 block">
                            {orderType === 'STOP_LIMIT' ? 'Limit Price' : 'Price'}
                        </label>
                        <input
                            type="number"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            step="0.00001"
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                        />
                    </div>
                </div>
            )}

            {/* SL/TP Mode Toggle */}
            <div className="flex gap-1 mb-2">
                {slTpModes.map((mode) => (
                    <button
                        key={mode}
                        onClick={() => setSlTpMode(mode)}
                        className={`flex-1 py-1 text-[10px] rounded ${slTpMode === mode
                            ? 'bg-zinc-700 text-zinc-200'
                            : 'bg-zinc-800/50 text-zinc-500 hover:text-zinc-400'
                            }`}
                    >
                        {mode}
                    </button>
                ))}
            </div>

            {/* SL/TP Inputs */}
            <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Stop Loss ({slTpMode})</label>
                    <input
                        type="number"
                        value={sl}
                        onChange={(e) => setSL(e.target.value)}
                        placeholder={slTpMode === 'Pips' ? 'e.g. 20' : ''}
                        step={slTpMode === 'Pips' ? '1' : '0.00001'}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                    />
                </div>
                <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Take Profit ({slTpMode})</label>
                    <input
                        type="number"
                        value={tp}
                        onChange={(e) => setTP(e.target.value)}
                        step={slTpMode === 'Pips' ? '1' : '0.00001'}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                    />
                </div>
            </div>

            {/* Risk Calculator */}
            <div className="mb-4 p-3 bg-zinc-800/50 rounded">
                <label className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
                    <input
                        type="checkbox"
                        checked={useRiskCalc}
                        onChange={(e) => setUseRiskCalc(e.target.checked)}
                        className="rounded bg-zinc-800 border-zinc-600"
                    />
                    Calculate lot from risk %
                </label>
                {useRiskCalc && (
                    <div className="flex gap-2 items-center">
                        <input
                            type="number"
                            value={riskPercent}
                            onChange={(e) => setRiskPercent(e.target.value)}
                            min="0.1"
                            max="10"
                            step="0.1"
                            className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-200"
                        />
                        <span className="text-xs text-zinc-500">% risk</span>
                        {calculatedLot !== null && (
                            <span className="text-xs text-emerald-400 ml-2">
                                = {calculatedLot.toFixed(2)} lots
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Margin Preview */}
            {marginPreview && (
                <div className="mb-4 p-3 bg-zinc-800/30 rounded text-xs">
                    <div className="flex justify-between text-zinc-400">
                        <span>Required Margin:</span>
                        <span className="text-zinc-200">${marginPreview.requiredMargin?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-400">
                        <span>Free Margin After:</span>
                        <span className={marginPreview.canTrade ? 'text-emerald-400' : 'text-red-400'}>
                            ${marginPreview.freeMarginAfter?.toFixed(2)}
                        </span>
                    </div>
                </div>
            )}

            {/* Buy/Sell Buttons */}
            <div className="grid grid-cols-2 gap-2">
                <button
                    onClick={() => {
                        setSide('SELL');
                        handleSubmit();
                    }}
                    disabled={loading}
                    className="py-3 rounded-lg bg-red-500/20 text-red-400 font-semibold hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                    <div className="text-lg">SELL</div>
                    <div className="text-xs opacity-70">{currentBid}</div>
                </button>
                <button
                    onClick={() => {
                        setSide('BUY');
                        handleSubmit();
                    }}
                    disabled={loading}
                    className="py-3 rounded-lg bg-emerald-500/20 text-emerald-400 font-semibold hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                >
                    <div className="text-lg">BUY</div>
                    <div className="text-xs opacity-70">{currentAsk}</div>
                </button>
            </div>

            {/* Confirmation Modal */}
            {showConfirmation && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-sm">
                        <h4 className="text-lg font-semibold text-zinc-200 mb-4">Confirm Order</h4>
                        <div className="text-sm text-zinc-400 mb-4 space-y-1">
                            <div>{orderType} {side} {symbol}</div>
                            <div>Volume: {volume} lots</div>
                            {price && <div>Price: {price}</div>}
                            {sl && <div>SL: {sl}</div>}
                            {tp && <div>TP: {tp}</div>}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowConfirmation(false)}
                                className="flex-1 py-2 bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeOrder}
                                className={`flex-1 py-2 rounded font-semibold ${side === 'BUY'
                                    ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                                    : 'bg-red-500 text-white hover:bg-red-600'
                                    }`}
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
