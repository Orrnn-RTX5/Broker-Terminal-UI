/**
 * Market Sessions Panel
 * Visual timeline showing forex trading sessions (Sydney, Tokyo, London, New York)
 * Real-time clock, session indicators, overlap highlighting, volatility display
 */

import { Icon } from './ui/Icon';
import { useState, useEffect } from 'react';
interface Session {
    name: string;
    city: string;
    startUTC: number; // Hour in UTC (0-23)
    endUTC: number;   // Hour in UTC (0-23)
    color: string;
    lightColor: string;
}

const SESSIONS: Session[] = [
    { name: 'Sydney', city: 'Sydney', startUTC: 22, endUTC: 7, color: '#8a8a8f', lightColor: 'rgba(59, 130, 246, 0.3)' },
    { name: 'Tokyo', city: 'Tokyo', startUTC: 0, endUTC: 9, color: '#EF4444', lightColor: 'rgba(239, 68, 68, 0.3)' },
    { name: 'London', city: 'London', startUTC: 8, endUTC: 17, color: '#10B981', lightColor: 'rgba(16, 185, 129, 0.3)' },
    { name: 'New York', city: 'New York', startUTC: 13, endUTC: 22, color: '#F59E0B', lightColor: 'rgba(245, 158, 11, 0.3)' }
];

interface Overlap {
    name: string;
    sessions: string[];
    startUTC: number;
    endUTC: number;
}

const OVERLAPS: Overlap[] = [
    { name: 'Sydney-Tokyo', sessions: ['Sydney', 'Tokyo'], startUTC: 0, endUTC: 7 },
    { name: 'Tokyo-London', sessions: ['Tokyo', 'London'], startUTC: 8, endUTC: 9 },
    { name: 'London-New York', sessions: ['London', 'New York'], startUTC: 13, endUTC: 17 } // Busiest period
];

export function MarketSessions() {
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const utcHour = currentTime.getUTCHours();
    const utcMinute = currentTime.getUTCMinutes();
    const utcSecond = currentTime.getUTCSeconds();

    // Check if a session is currently active
    const isSessionActive = (session: Session): boolean => {
        if (session.startUTC < session.endUTC) {
            // Normal case: session within same day
            return utcHour >= session.startUTC && utcHour < session.endUTC;
        } else {
            // Session spans midnight (like Sydney: 22:00-07:00)
            return utcHour >= session.startUTC || utcHour < session.endUTC;
        }
    };

    const activeSessions = SESSIONS.filter(isSessionActive);
    const volatility = activeSessions.length === 0 ? 'Low' :
        activeSessions.length === 1 ? 'Medium' :
            activeSessions.length >= 2 ? 'High' : 'Medium';

    // Calculate time until next event (session open/close)
    const getNextEvent = () => {
        const events: { time: number; message: string }[] = [];

        SESSIONS.forEach(session => {
            const isActive = isSessionActive(session);
            if (isActive) {
                // Calculate time until session closes
                let closeHour = session.endUTC;
                if (closeHour <= utcHour && session.startUTC > session.endUTC) {
                    closeHour += 24; // Next day
                }
                const minutesToClose = (closeHour - utcHour) * 60 - utcMinute;
                events.push({ time: minutesToClose, message: `${session.name} closes in` });
            } else {
                // Calculate time until session opens
                let openHour = session.startUTC;
                if (openHour <= utcHour) {
                    openHour += 24; // Next day
                }
                const minutesToOpen = (openHour - utcHour) * 60 - utcMinute;
                events.push({ time: minutesToOpen, message: `${session.name} opens in` });
            }
        });

        // Find the closest event
        events.sort((a, b) => a.time - b.time);
        const nextEvent = events[0];

        if (nextEvent) {
            const hours = Math.floor(nextEvent.time / 60);
            const minutes = nextEvent.time % 60;
            return `${nextEvent.message} ${hours}h ${minutes}m`;
        }

        return '';
    };

    const nextEventText = getNextEvent();

    // Calculate position of current time on 24h timeline (0-100%)
    const currentTimePercent = ((utcHour + utcMinute / 60) / 24) * 100;

    // Calculate session bar position and width
    const getSessionBarStyle = (session: Session) => {
        const start = session.startUTC;
        const end = session.endUTC;

        if (start < end) {
            // Normal case
            const left = (start / 24) * 100;
            const width = ((end - start) / 24) * 100;
            return { left: `${left}%`, width: `${width}%` };
        } else {
            // Spans midnight - render as two separate bars
            return null; // Handle separately
        }
    };

    return (
        <div className="h-full flex flex-col bg-[#131316] text-zinc-300 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
            {/* Header */}
            <div className="bg-[#191a1e] border-b border-zinc-700 px-4 py-2 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Icon name="clock" size="sm" className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-semibold text-zinc-100">Market Sessions</span>
                </div>
                <div className="flex items-center gap-6 text-xs font-mono tabular-nums">
                    <div className="flex items-center gap-2">
                        <span className="text-zinc-500">UTC:</span>
                        <span className="text-white font-bold">
                            {currentTime.toUTCString().split(' ')[4]}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-zinc-500">Local:</span>
                        <span className="text-white font-bold">
                            {currentTime.toLocaleTimeString('en-US', { hour12: false })}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex-1 p-4 space-y-6 overflow-y-auto">
                {/* Session Timeline */}
                <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">24-Hour Timeline</h3>
                    <div className="space-y-2">
                        {/* Timeline container */}
                        <div className="relative h-32 bg-zinc-900 rounded border border-zinc-800 p-2">
                            {/* Hour markers */}
                            <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 text-[9px] text-zinc-600 font-mono">
                                {[0, 3, 6, 9, 12, 15, 18, 21].map(hour => (
                                    <span key={hour} className="w-8 text-center">{hour.toString().padStart(2, '0')}</span>
                                ))}
                            </div>

                            {/* Session bars */}
                            <div className="relative h-20 space-y-1">
                                {SESSIONS.map((session, idx) => {
                                    const style = getSessionBarStyle(session);
                                    const isActive = isSessionActive(session);

                                    if (session.startUTC < session.endUTC) {
                                        // Normal case - single bar
                                        return (
                                            <div key={session.name} className="relative h-4">
                                                <div
                                                    className="absolute h-full rounded transition-all duration-300"
                                                    style={{
                                                        left: style?.left,
                                                        width: style?.width,
                                                        backgroundColor: isActive ? session.color : session.lightColor,
                                                        opacity: isActive ? 1 : 0.4
                                                    }}
                                                >
                                                    <span className="absolute left-2 top-0.5 text-[9px] font-bold text-white drop-shadow-lg">
                                                        {session.name}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    } else {
                                        // Spans midnight - render two bars
                                        const leftPart = { left: `${(session.startUTC / 24) * 100}%`, width: `${((24 - session.startUTC) / 24) * 100}%` };
                                        const rightPart = { left: '0%', width: `${(session.endUTC / 24) * 100}%` };

                                        return (
                                            <div key={session.name} className="relative h-4">
                                                {/* Left part (start to midnight) */}
                                                <div
                                                    className="absolute h-full rounded-l transition-all duration-300"
                                                    style={{
                                                        left: leftPart.left,
                                                        width: leftPart.width,
                                                        backgroundColor: isActive ? session.color : session.lightColor,
                                                        opacity: isActive ? 1 : 0.4
                                                    }}
                                                >
                                                    <span className="absolute left-2 top-0.5 text-[9px] font-bold text-white drop-shadow-lg">
                                                        {session.name}
                                                    </span>
                                                </div>
                                                {/* Right part (midnight to end) */}
                                                <div
                                                    className="absolute h-full rounded-r transition-all duration-300"
                                                    style={{
                                                        left: rightPart.left,
                                                        width: rightPart.width,
                                                        backgroundColor: isActive ? session.color : session.lightColor,
                                                        opacity: isActive ? 1 : 0.4
                                                    }}
                                                />
                                            </div>
                                        );
                                    }
                                })}
                            </div>

                            {/* Current time indicator (vertical line) */}
                            <div
                                className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none z-10"
                                style={{
                                    left: `${currentTimePercent}%`,
                                    boxShadow: '0 0 8px rgba(255,255,255,0.8)'
                                }}
                            >
                                <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-white rounded-full shadow-lg" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Active Sessions Panel */}
                <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Active Sessions</h3>
                    <div className="grid grid-cols-2 gap-2">
                        {SESSIONS.map(session => {
                            const isActive = isSessionActive(session);
                            return (
                                <div
                                    key={session.name}
                                    className={`flex items-center gap-2 p-2 rounded border ${isActive
                                        ? 'bg-zinc-800 border-zinc-700'
                                        : 'bg-zinc-900 border-zinc-800'
                                        }`}
                                >
                                    <div
                                        className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'}`}
                                    />
                                    <span className={`text-xs font-medium ${isActive ? 'text-zinc-100' : 'text-zinc-500'}`}>
                                        {session.name}
                                    </span>
                                    <span className="ml-auto text-[10px] text-zinc-500 font-mono">
                                        {session.startUTC.toString().padStart(2, '0')}:00-{session.endUTC.toString().padStart(2, '0')}:00
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    {nextEventText && (
                        <div className="bg-zinc-700/20 border border-zinc-600/30 rounded p-2 text-xs text-zinc-300 font-medium">
                            ⏱️ {nextEventText}
                        </div>
                    )}
                </div>

                {/* Volatility Indicator */}
                <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-2">
                        <Icon name="trending-up" size="sm" className="w-3 h-3" />
                        Market Volatility
                    </h3>
                    <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-zinc-400">Current Level:</span>
                            <span className={`text-sm font-bold ${volatility === 'High' ? 'text-red-400' :
                                volatility === 'Medium' ? 'text-yellow-400' :
                                    'text-green-400'
                                }`}>
                                {volatility}
                            </span>
                        </div>
                        <div className="flex gap-1 h-2">
                            <div className={`flex-1 rounded ${volatility === 'Low' || volatility === 'Medium' || volatility === 'High' ? 'bg-green-500' : 'bg-zinc-700'}`} />
                            <div className={`flex-1 rounded ${volatility === 'Medium' || volatility === 'High' ? 'bg-yellow-500' : 'bg-zinc-700'}`} />
                            <div className={`flex-1 rounded ${volatility === 'High' ? 'bg-red-500' : 'bg-zinc-700'}`} />
                        </div>
                        <p className="text-[10px] text-zinc-500 mt-2">
                            {activeSessions.length === 0 && 'No active sessions - Low liquidity expected'}
                            {activeSessions.length === 1 && `${activeSessions[0].name} session active - Normal liquidity`}
                            {activeSessions.length >= 2 && `${activeSessions.length} overlapping sessions - High liquidity and volatility`}
                        </p>
                    </div>
                </div>

                {/* Key Overlaps */}
                <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Key Overlaps</h3>
                    <div className="space-y-2">
                        {OVERLAPS.map(overlap => {
                            // Check if overlap is currently active
                            const isOverlapActive = overlap.sessions.every(sessionName => {
                                const session = SESSIONS.find(s => s.name === sessionName);
                                return session ? isSessionActive(session) : false;
                            });

                            return (
                                <div
                                    key={overlap.name}
                                    className={`p-2 rounded border ${isOverlapActive
                                        ? 'bg-amber-500/10 border-amber-500/30'
                                        : 'bg-zinc-900 border-zinc-800'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={`text-xs font-medium ${isOverlapActive ? 'text-amber-300' : 'text-zinc-400'}`}>
                                            {overlap.name}
                                        </span>
                                        {isOverlapActive && (
                                            <span className="text-[9px] bg-amber-500 text-zinc-900 px-1.5 py-0.5 rounded font-bold">
                                                ACTIVE
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-zinc-500 font-mono">
                                        {overlap.startUTC.toString().padStart(2, '0')}:00 - {overlap.endUTC.toString().padStart(2, '0')}:00 UTC
                                    </div>
                                    {overlap.name === 'London-New York' && (
                                        <div className="text-[9px] text-amber-400 mt-1 font-medium">
                                            🔥 Busiest trading period
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
