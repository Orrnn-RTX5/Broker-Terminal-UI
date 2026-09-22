import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * Connection Status Indicator
 * Shows WebSocket connection health with MT5-style menu dropdown
 * Includes Login, Network Rescan, VPS Hosting, and Access Server options
 */

import { lazy, useState, useRef, useEffect } from 'react';
import { useWebSocketStore } from '../store/useWebSocketStore';
import { useAppStore } from '../store/useAppStore';
import { Wifi, RefreshCw, WifiOff, AlertTriangle, LogIn, Globe, Zap, Server } from 'lucide-react';
import { RetainedLazyFeature } from '../startup/RetainedLazyFeature';

const LoginDialog = lazy(() => import('./LoginDialog').then(module => ({ default: module.LoginDialog })));

interface ConnectionStatusProps {
  wsRef?: React.RefObject<WebSocket | null>;
  reconnectCallback?: () => void;
}

export function ConnectionStatus({ wsRef, reconnectCallback }: ConnectionStatusProps) {
    const tr = useUiTranslation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [now, setNow] = useState(Date.now);
  // Subscribe to primitives only so unrelated message counters never repaint the
  // indicator. `latencyMeasuredAt` is read so an aged sample can be hidden.
  const state = useWebSocketStore((snapshot) => snapshot.connectionState);
  const isStale = useWebSocketStore((snapshot) => snapshot.isStale);
  const lastLatency = useWebSocketStore((snapshot) => snapshot.fixConnectionState === 'connected'
    ? snapshot.fixMetrics.lastLatency
    : snapshot.legacyMetrics.lastLatency);
  const latencyMeasuredAt = useWebSocketStore((snapshot) => (snapshot.fixConnectionState === 'connected'
    ? snapshot.fixMetrics.latencyMeasuredAt
    : snapshot.legacyMetrics.latencyMeasuredAt) ?? null);
  // Read the latest diagnostics when opened without repainting a closed menu
  // whenever account polling changes its status or completion timestamp.
  const tradeWsConnected = useAppStore((snapshot) => showDropdown && snapshot.wsConnected);
  const tradeApiError = useAppStore((snapshot) => showDropdown ? snapshot.tradeApiStatus.error : null);
  const tradeApiLoading = useAppStore((snapshot) => showDropdown && snapshot.tradeApiStatus.loading);
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  // Listen for global login dialog event (from Navigator, context menus, etc.)
  useEffect(() => {
    const handleOpenLogin = () => setShowLoginDialog(true);
    window.addEventListener('rtx:openLoginDialog', handleOpenLogin);
    return () => window.removeEventListener('rtx:openLoginDialog', handleOpenLogin);
  }, []);

  const accountStreamConnected = tradeWsConnected || state === 'connected';

  // Determine display based on state
  const getStatusDisplay = () => {
    switch (state) {
      case 'connected':
        return { color: 'bg-green-500', text: 'Connected', icon: Wifi, iconColor: 'text-green-400 [.rtx-advanced-view_&]:text-green-600' };
      case 'connecting':
        return { color: 'bg-yellow-500', text: 'Connecting...', icon: RefreshCw, iconColor: 'text-yellow-400 [.rtx-advanced-view_&]:text-yellow-600 animate-spin' };
      case 'disconnected':
        return { color: 'bg-red-500', text: 'Disconnected', icon: WifiOff, iconColor: 'text-red-400 [.rtx-advanced-view_&]:text-red-600' };
      case 'offline':
        return { color: 'bg-gray-500', text: 'Offline', icon: WifiOff, iconColor: 'text-gray-400 [.rtx-advanced-view_&]:text-gray-600' };
      case 'reconnecting':
        return { color: 'bg-yellow-500', text: 'Connecting...', icon: RefreshCw, iconColor: 'text-yellow-400 [.rtx-advanced-view_&]:text-yellow-600 animate-spin' };
      case 'error':
        return { color: 'bg-red-600', text: 'Error', icon: AlertTriangle, iconColor: 'text-red-400 [.rtx-advanced-view_&]:text-red-700' };
      default:
        return { color: 'bg-gray-500', text: 'Unknown', icon: WifiOff, iconColor: 'text-gray-400 [.rtx-advanced-view_&]:text-gray-600' };
    }
  };

  const status = isStale
    ? { color: 'bg-orange-500', text: 'Stale Data', icon: AlertTriangle, iconColor: 'text-orange-400 [.rtx-advanced-view_&]:text-orange-600' }
    : getStatusDisplay();
  const StatusIcon = status.icon;

  const handleLogin = () => {
    setShowDropdown(false);
    setShowLoginDialog(true);
  };

  const handleNetworkRescan = () => {
    if (reconnectCallback) reconnectCallback();
    setShowDropdown(false);
  };

  // A latency figure is only trustworthy when it was actually measured, is recent,
  // and belongs to a live connection.
  const latencyMs = lastLatency > 0 && latencyMeasuredAt !== null && now - latencyMeasuredAt <= 60_000 && state === 'connected'
    ? lastLatency : null;
  const tradeApiLabel = tradeApiError ? 'REST error' : tradeApiLoading ? 'syncing' : 'ready';
  const tradeApiColor = tradeApiError
    ? 'text-red-400'
    : tradeApiLoading
      ? 'text-yellow-400'
      : 'text-green-400';

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Status Indicator (Clickable) */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="rtx-status-bar__connection flex items-center gap-1.5 px-2 py-0.5 rounded text-zinc-200 transition-colors hover:bg-white/5 hover:text-white [.rtx-advanced-view_&]:text-black [.rtx-advanced-view_&]:hover:bg-zinc-300/50"
        title={tr("Click for connection details")}
      >
        <div className={`w-2 h-2 rounded-full ${status.color} shadow-sm`} />
        <span className="rtx-status-bar__metric font-normal text-[13px] leading-[19.5px]">
          {state === 'connected' ? (latencyMs !== null ? `${tr('Connected')} ${latencyMs.toFixed(0)}ms` : tr('Connected')) : tr(status.text)}
        </span>
        {isStale && (
          <span className="text-orange-400 text-[12px] font-normal ml-1 [.rtx-advanced-view_&]:text-orange-600">{tr("(Stale)")}</span>
        )}
        <StatusIcon size={12} className={status.iconColor} />
      </button>

      {/* MT5-Style Dropdown Menu */}
      {showDropdown && (
        <div className="rtx-connection-dropdown absolute bottom-full right-0 mb-1 w-64 bg-[#1e222d] border border-[#3a3e4a] rounded shadow-2xl z-[100] text-[11px] text-zinc-200 overflow-hidden">

          {/* Menu Items */}
          <div className="border-b border-[#3a3e4a]">
            {/* Login */}
            <button
              onClick={handleLogin}
              className="w-full flex items-center gap-2.5 px-3 py-[7px] hover:bg-[#2a3040] transition-colors text-left"
            >
              <LogIn size={14} className="text-blue-400" />
              <span>{tr("Login")}</span>
            </button>

            {/* Network Rescan */}
            <button
              onClick={handleNetworkRescan}
              className="w-full flex items-center gap-2.5 px-3 py-[7px] hover:bg-[#2962FF] hover:text-white transition-colors text-left"
            >
              <Globe size={14} className="text-cyan-400" />
              <span>{tr("Network Rescan")}</span>
            </button>

            {/* VPS Hosting Speed Up */}
            <div className="flex items-center justify-between px-3 py-[7px] hover:bg-[#2a3040] transition-colors cursor-default">
              <div className="flex items-center gap-2.5">
                <Zap size={14} className="text-yellow-400" />
                <span>{tr("VPS Hosting Speed Up")}</span>
              </div>
              <span className="text-zinc-400 text-[10px]">Unavailable</span>
            </div>
          </div>

          {/* Access Servers */}
          <div className="border-b border-[#3a3e4a]">
            <div className="flex items-center justify-between px-3 py-[7px] hover:bg-[#2a3040] transition-colors cursor-default">
              <div className="flex items-center gap-2.5">
                <Server size={14} className="text-zinc-400" />
                <span>{tr("Trade API")}</span>
              </div>
              <span
                className={`text-[10px] font-mono ${tradeApiColor}`}
                title={tradeApiError ?? undefined}
              >
                {tr(tradeApiLabel)}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-[7px] hover:bg-[#2a3040] transition-colors cursor-default">
              <div className="flex items-center gap-2.5">
                <Server size={14} className="text-zinc-400" />
                <span>{tr("Account Stream")}</span>
              </div>
              <span className={`text-[10px] font-mono ${accountStreamConnected ? 'text-green-400' : 'text-yellow-400'}`}>
                {accountStreamConnected ? tr("live") : tr("polling")}
              </span>
            </div>
          </div>

          {/* Bottom: Current latency bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#161921]">
            <Server size={12} className="text-zinc-500" />
            <span className={`font-mono text-[10px] ${latencyMs && latencyMs < 200 ? 'text-green-400' : 'text-yellow-400'}`}>
              {latencyMs !== null ? `RTT ${latencyMs.toFixed(2)} ms` : 'RTT unavailable'}
            </span>
          </div>
        </div>
      )}

      {/* Login Dialog */}
      <RetainedLazyFeature active={showLoginDialog}>
      <LoginDialog
        isOpen={showLoginDialog}
        onClose={() => setShowLoginDialog(false)}
      />
      </RetainedLazyFeature>
    </div>
  );
}
