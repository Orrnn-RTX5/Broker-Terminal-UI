/**
 * Risk Exposure Panel
 * Real-time risk exposure visualization for trader's portfolio
 */

import { Icon } from './ui/Icon';
import { useMemo } from 'react';
import { useRiskExposureStore } from '../store/useRiskExposureStore';

interface Position {
  id: number;
  symbol: string;
  type: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl: number;
  unrealizedPnL: number;
  group: 'Forex' | 'Metals' | 'Crypto' | 'Indices';
}

const ACCOUNT_BALANCE = 100000;
const ACCOUNT_EQUITY = 102450;
const LEVERAGE = 100;

export function RiskExposurePanel() {
  const { showCorrelationWarnings, marginWarningThreshold } = useRiskExposureStore();

  // TODO: Replace mock data with the swagger v2 positions helper.
  const positions = useMemo(() => generateMockPositions(), []);

  // Calculate portfolio metrics
  const portfolioMetrics = useMemo(() => {
    const totalPositions = positions.length;
    const totalUnrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
    const totalExposure = positions.reduce((sum, p) => sum + (p.volume * 100000), 0);
    const totalMarginUsed = totalExposure / LEVERAGE;
    const marginUsedPercent = (totalMarginUsed / ACCOUNT_BALANCE) * 100;
    const freeMargin = ACCOUNT_EQUITY - totalMarginUsed;

    return {
      totalPositions,
      totalExposure,
      totalUnrealizedPnL,
      marginUsedPercent,
      freeMargin,
      totalMarginUsed,
    };
  }, [positions]);

  // Calculate currency exposure
  const currencyExposure = useMemo(() => {
    const exposureMap = new Map<string, number>();

    positions.forEach(pos => {
      // Extract base and quote currencies
      const base = pos.symbol.substring(0, 3);
      const quote = pos.symbol.substring(3, 6);

      const positionValue = pos.volume * 100000;

      if (pos.type === 'BUY') {
        // Long base, short quote
        exposureMap.set(base, (exposureMap.get(base) || 0) + positionValue);
        exposureMap.set(quote, (exposureMap.get(quote) || 0) - positionValue);
      } else {
        // Short base, long quote
        exposureMap.set(base, (exposureMap.get(base) || 0) - positionValue);
        exposureMap.set(quote, (exposureMap.get(quote) || 0) + positionValue);
      }
    });

    return Array.from(exposureMap.entries())
      .map(([currency, exposure]) => ({ currency, exposure }))
      .sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure));
  }, [positions]);

  // Detect correlated positions
  const correlationWarnings = useMemo(() => {
    if (!showCorrelationWarnings) return [];

    const warnings: { pair1: string; pair2: string; reason: string }[] = [];

    // Check for concentrated EUR exposure
    const eurPositions = positions.filter(p => p.symbol.includes('EUR'));
    if (eurPositions.length >= 3) {
      const allSameDirection = eurPositions.every(p => p.type === eurPositions[0].type);
      if (allSameDirection) {
        warnings.push({
          pair1: eurPositions[0].symbol,
          pair2: eurPositions[1].symbol,
          reason: `${eurPositions.length} EUR positions (${eurPositions[0].type}) - concentrated risk`,
        });
      }
    }

    // Check for highly correlated pairs (EURUSD + GBPUSD, AUDUSD + NZDUSD)
    const eurusd = positions.find(p => p.symbol === 'EURUSD');
    const gbpusd = positions.find(p => p.symbol === 'GBPUSD');
    if (eurusd && gbpusd && eurusd.type === gbpusd.type) {
      warnings.push({
        pair1: 'EURUSD',
        pair2: 'GBPUSD',
        reason: 'Highly correlated pairs - same direction doubles exposure',
      });
    }

    const audusd = positions.find(p => p.symbol === 'AUDUSD');
    const nzdusd = positions.find(p => p.symbol === 'NZDUSD');
    if (audusd && nzdusd && audusd.type === nzdusd.type) {
      warnings.push({
        pair1: 'AUDUSD',
        pair2: 'NZDUSD',
        reason: 'Highly correlated pairs - concentrated Oceania risk',
      });
    }

    return warnings;
  }, [positions, showCorrelationWarnings]);

  // Calculate drawdown
  const drawdown = useMemo(() => {
    const peakBalance = 105000; // Simulated peak
    const currentDrawdown = ((ACCOUNT_EQUITY - peakBalance) / peakBalance) * 100;
    const maxDrawdown = -8.5; // Simulated max drawdown

    return { currentDrawdown, maxDrawdown, peakBalance };
  }, []);

  // Calculate risk score (1-10)
  const riskScore = useMemo(() => {
    let score = 0;

    // Margin usage component (0-3 points)
    if (portfolioMetrics.marginUsedPercent > 80) score += 3;
    else if (portfolioMetrics.marginUsedPercent > 50) score += 2;
    else if (portfolioMetrics.marginUsedPercent > 30) score += 1;

    // Concentration component (0-3 points)
    const maxCurrencyExposure = Math.max(...currencyExposure.map(c => Math.abs(c.exposure)));
    const concentrationRatio = maxCurrencyExposure / portfolioMetrics.totalExposure;
    if (concentrationRatio > 0.5) score += 3;
    else if (concentrationRatio > 0.3) score += 2;
    else if (concentrationRatio > 0.2) score += 1;

    // Drawdown component (0-2 points)
    if (Math.abs(drawdown.currentDrawdown) > 5) score += 2;
    else if (Math.abs(drawdown.currentDrawdown) > 3) score += 1;

    // Correlation component (0-2 points)
    if (correlationWarnings.length >= 2) score += 2;
    else if (correlationWarnings.length >= 1) score += 1;

    return Math.min(10, score);
  }, [portfolioMetrics, currencyExposure, drawdown, correlationWarnings]);

  // Group exposure
  const groupExposure = useMemo(() => {
    const groups = positions.reduce((acc, pos) => {
      const value = pos.volume * 100000;
      acc[pos.group] = (acc[pos.group] || 0) + value;
      return acc;
    }, {} as Record<string, number>);

    const total = Object.values(groups).reduce((sum, val) => sum + val, 0);

    return Object.entries(groups).map(([group, value]) => ({
      group,
      value,
      percentage: (value / total) * 100,
    }));
  }, [positions]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-300 overflow-auto">
      {/* Header */}
      <div className="bg-zinc-800 border-b border-zinc-700 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="shield" size="lg" className="text-red-400" />
          <h2 className="text-sm font-semibold text-white">Risk Exposure Analysis</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">Risk Score:</span>
          <div
            className={`px-3 py-1 rounded font-bold text-sm ${
              riskScore >= 7
                ? 'bg-red-900/50 text-red-400'
                : riskScore >= 4
                ? 'bg-yellow-900/50 text-yellow-400'
                : 'bg-green-900/50 text-green-400'
            }`}
          >
            {riskScore}/10
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Portfolio Summary Cards */}
        <div className="grid grid-cols-5 gap-3">
          <SummaryCard
            icon={<Icon name="activity" size="md" />}
            label="Total Positions"
            value={portfolioMetrics.totalPositions.toString()}
            color="text-blue-400"
          />
          <SummaryCard
            icon={<Icon name="trending-up" size="md" />}
            label="Total Exposure"
            value={`$${(portfolioMetrics.totalExposure / 1000000).toFixed(2)}M`}
            color="text-purple-400"
          />
          <SummaryCard
            icon={<Icon name="credit-card" size="md" />}
            label="Unrealized P&L"
            value={`$${portfolioMetrics.totalUnrealizedPnL.toFixed(2)}`}
            color={portfolioMetrics.totalUnrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <SummaryCard
            icon={<Icon name="activity" size="md" />}
            label="Used Margin"
            value={`${portfolioMetrics.marginUsedPercent.toFixed(1)}%`}
            color={
              portfolioMetrics.marginUsedPercent > 80
                ? 'text-red-400'
                : portfolioMetrics.marginUsedPercent > 50
                ? 'text-yellow-400'
                : 'text-green-400'
            }
          />
          <SummaryCard
            icon={<Icon name="credit-card" size="md" />}
            label="Free Margin"
            value={`$${portfolioMetrics.freeMargin.toFixed(0)}`}
            color="text-green-400"
          />
        </div>

        {/* Correlation Warnings */}
        {correlationWarnings.length > 0 && (
          <div className="bg-yellow-900/20 border border-yellow-700/50 rounded p-3">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="alert-triangle" size="md" className="text-yellow-400" />
              <span className="text-xs font-semibold text-yellow-400">Correlation Warnings</span>
            </div>
            <div className="space-y-1">
              {correlationWarnings.map((warning, idx) => (
                <div key={idx} className="text-xs text-yellow-300">
                  <span className="font-medium">{warning.pair1}</span> + <span className="font-medium">{warning.pair2}</span>: {warning.reason}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Exposure by Currency */}
          <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
            <h3 className="text-xs font-semibold mb-3">Currency Exposure</h3>
            <CurrencyExposureChart exposures={currencyExposure} totalExposure={portfolioMetrics.totalExposure} />
          </div>

          {/* Margin Usage Gauge */}
          <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
            <h3 className="text-xs font-semibold mb-3">Margin Usage</h3>
            <MarginGauge
              usedPercent={portfolioMetrics.marginUsedPercent}
              usedAmount={portfolioMetrics.totalMarginUsed}
              freeAmount={portfolioMetrics.freeMargin}
              warningThreshold={marginWarningThreshold}
            />
          </div>
        </div>

        {/* Drawdown Tracker */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-xs font-semibold mb-3">Drawdown Tracker</h3>
          <DrawdownTracker
            currentDrawdown={drawdown.currentDrawdown}
            maxDrawdown={drawdown.maxDrawdown}
            peakBalance={drawdown.peakBalance}
            currentEquity={ACCOUNT_EQUITY}
          />
        </div>

        {/* Symbol Group Exposure */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-xs font-semibold mb-3">Exposure by Asset Group</h3>
          <GroupExposurePieChart groups={groupExposure} />
        </div>

        {/* Risk Per Trade Table */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-xs font-semibold mb-3">Risk Per Trade</h3>
          <RiskPerTradeTable positions={positions} accountBalance={ACCOUNT_BALANCE} />
        </div>
      </div>
    </div>
  );
}

// --- SUMMARY CARD ---
function SummaryCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={color}>{icon}</div>
        <span className="text-[10px] text-zinc-400 uppercase">{label}</span>
      </div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}

// --- CURRENCY EXPOSURE CHART ---
function CurrencyExposureChart({ exposures, totalExposure }: { exposures: { currency: string; exposure: number }[]; totalExposure: number }) {
  const maxAbsExposure = Math.max(...exposures.map(e => Math.abs(e.exposure)));

  return (
    <div className="space-y-2">
      {exposures.slice(0, 8).map(({ currency, exposure }) => {
        const isLong = exposure > 0;
        const barWidth = (Math.abs(exposure) / maxAbsExposure) * 100;

        return (
          <div key={currency} className="flex items-center gap-2 text-xs">
            <div className="w-8 text-right font-medium text-zinc-300">{currency}</div>
            <div className="flex-1 flex items-center">
              {/* Center line */}
              <div className="flex-1 flex items-center justify-end">
                {!isLong && (
                  <div
                    className="h-5 bg-red-500 rounded-l"
                    style={{ width: `${barWidth}%` }}
                  />
                )}
              </div>
              <div className="w-0.5 h-6 bg-zinc-600" />
              <div className="flex-1 flex items-center justify-start">
                {isLong && (
                  <div
                    className="h-5 bg-green-500 rounded-r"
                    style={{ width: `${barWidth}%` }}
                  />
                )}
              </div>
            </div>
            <div className={`w-20 text-right ${isLong ? 'text-green-400' : 'text-red-400'}`}>
              {isLong ? '+' : ''}{(exposure / 1000).toFixed(0)}K
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-zinc-500">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-500 rounded" />
          <span>Short</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-500 rounded" />
          <span>Long</span>
        </div>
      </div>
    </div>
  );
}

// --- MARGIN GAUGE ---
function MarginGauge({ usedPercent, usedAmount, freeAmount, warningThreshold }: { usedPercent: number; usedAmount: number; freeAmount: number; warningThreshold: number }) {
  const radius = 60;
  const strokeWidth = 12;
  const normalizedRadius = radius - strokeWidth / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (usedPercent / 100) * circumference;

  const getColor = () => {
    if (usedPercent > 80) return '#ef4444'; // red
    if (usedPercent > 50) return '#eab308'; // yellow
    return '#22c55e'; // green
  };

  return (
    <div className="flex flex-col items-center">
      <svg width={radius * 2} height={radius * 2} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={radius}
          cy={radius}
          r={normalizedRadius}
          stroke="#222226"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress circle */}
        <circle
          cx={radius}
          cy={radius}
          r={normalizedRadius}
          stroke={getColor()}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </svg>
      <div className="text-center -mt-20">
        <div className="text-2xl font-bold text-white">{usedPercent.toFixed(1)}%</div>
        <div className="text-[10px] text-zinc-400">Margin Used</div>
      </div>

      <div className="mt-16 grid grid-cols-2 gap-4 text-xs w-full">
        <div className="text-center">
          <div className="text-zinc-400 text-[10px] mb-1">Used</div>
          <div className="font-medium">${usedAmount.toFixed(0)}</div>
        </div>
        <div className="text-center">
          <div className="text-zinc-400 text-[10px] mb-1">Free</div>
          <div className="font-medium text-green-400">${freeAmount.toFixed(0)}</div>
        </div>
      </div>
    </div>
  );
}

// --- DRAWDOWN TRACKER ---
function DrawdownTracker({ currentDrawdown, maxDrawdown, peakBalance, currentEquity }: { currentDrawdown: number; maxDrawdown: number; peakBalance: number; currentEquity: number }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-4 text-xs">
        <div className="bg-zinc-900 border border-zinc-700 rounded p-2">
          <div className="text-zinc-400 text-[10px] mb-1">Current Drawdown</div>
          <div className={`text-sm font-bold ${currentDrawdown >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {currentDrawdown.toFixed(2)}%
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-700 rounded p-2">
          <div className="text-zinc-400 text-[10px] mb-1">Max Drawdown</div>
          <div className="text-sm font-bold text-red-400">{maxDrawdown.toFixed(2)}%</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-700 rounded p-2">
          <div className="text-zinc-400 text-[10px] mb-1">Peak Balance</div>
          <div className="text-sm font-bold text-blue-400">${peakBalance.toFixed(0)}</div>
        </div>
      </div>

      {/* Drawdown visualization */}
      <svg width="100%" height="80">
        <defs>
          <linearGradient id="ddGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Peak line */}
        <line x1="0" y1="20" x2="100%" y2="20" stroke="#8a8a8f" strokeWidth="2" strokeDasharray="4 2" />
        <text x="5" y="15" fill="#8a8a8f" fontSize="10">Peak: ${peakBalance.toFixed(0)}</text>

        {/* Current equity line */}
        <line x1="0" y1="50" x2="100%" y2="50" stroke="#22c55e" strokeWidth="2" />
        <text x="5" y="45" fill="#22c55e" fontSize="10">Current: ${currentEquity.toFixed(0)}</text>

        {/* Drawdown area */}
        <polygon
          points="0,20 100%,20 100%,50 0,50"
          fill="url(#ddGradient)"
        />

        {/* Max drawdown line */}
        <line x1="0" y1="65" x2="100%" y2="65" stroke="#ef4444" strokeWidth="1" strokeDasharray="2 2" />
        <text x="5" y="75" fill="#ef4444" fontSize="9">Max DD: {maxDrawdown.toFixed(2)}%</text>
      </svg>
    </div>
  );
}

// --- GROUP EXPOSURE PIE CHART ---
function GroupExposurePieChart({ groups }: { groups: { group: string; value: number; percentage: number }[] }) {
  const colors: Record<string, string> = {
    Forex: '#8a8a8f',
    Metals: '#eab308',
    Crypto: '#a855f7',
    Indices: '#22c55e',
  };

  let currentAngle = 0;

  return (
    <div className="flex items-center gap-8">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <g transform="translate(80, 80)">
          {groups.map(group => {
            const angle = (group.percentage / 100) * 360;
            const startAngle = currentAngle;
            const endAngle = currentAngle + angle;
            currentAngle = endAngle;

            const startRad = (startAngle - 90) * (Math.PI / 180);
            const endRad = (endAngle - 90) * (Math.PI / 180);

            const x1 = 60 * Math.cos(startRad);
            const y1 = 60 * Math.sin(startRad);
            const x2 = 60 * Math.cos(endRad);
            const y2 = 60 * Math.sin(endRad);

            const largeArc = angle > 180 ? 1 : 0;

            return (
              <path
                key={group.group}
                d={`M 0 0 L ${x1} ${y1} A 60 60 0 ${largeArc} 1 ${x2} ${y2} Z`}
                fill={colors[group.group] || '#52525b'}
                stroke="#131316"
                strokeWidth="2"
              />
            );
          })}
        </g>
      </svg>

      <div className="flex-1 space-y-2">
        {groups.map(group => (
          <div key={group.group} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded"
                style={{ backgroundColor: colors[group.group] || '#52525b' }}
              />
              <span>{group.group}</span>
            </div>
            <span className="font-medium">{group.percentage.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- RISK PER TRADE TABLE ---
function RiskPerTradeTable({ positions, accountBalance }: { positions: Position[]; accountBalance: number }) {
  return (
    <div className="overflow-auto max-h-64">
      <table className="w-full text-xs">
        <thead className="bg-zinc-900 sticky top-0">
          <tr className="border-b border-zinc-700">
            <th className="px-3 py-2 text-left font-medium text-zinc-400">Symbol</th>
            <th className="px-3 py-2 text-left font-medium text-zinc-400">Dir</th>
            <th className="px-3 py-2 text-right font-medium text-zinc-400">Lots</th>
            <th className="px-3 py-2 text-right font-medium text-zinc-400">P&L</th>
            <th className="px-3 py-2 text-right font-medium text-zinc-400">% Risk</th>
            <th className="px-3 py-2 text-right font-medium text-zinc-400">SL Distance</th>
          </tr>
        </thead>
        <tbody>
          {positions.map(pos => {
            const riskPercent = (Math.abs(pos.unrealizedPnL) / accountBalance) * 100;
            const slDistance = Math.abs(pos.currentPrice - pos.sl);
            const pips = pos.symbol.includes('JPY') ? slDistance * 100 : slDistance * 10000;

            return (
              <tr key={pos.id} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                <td className="px-3 py-2 font-medium">{pos.symbol}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${pos.type === 'BUY' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                    {pos.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{pos.volume.toFixed(2)}</td>
                <td className={`px-3 py-2 text-right font-medium ${pos.unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${pos.unrealizedPnL.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right">{riskPercent.toFixed(2)}%</td>
                <td className="px-3 py-2 text-right">{pips.toFixed(1)} pips</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// TODO: Replace mock data with the swagger v2 positions helper.
function generateMockPositions(): Position[] {
  // Placeholder: Returns empty array until backend API is implemented
  return [];
}
