/**
 * OpenAccountDialog — Premium MT5-style "Open an Account" company picker
 * Dark glass-noir theme matching RTX Terminal aesthetics.
 */

import React, { useState } from 'react';
import { X, Search, ChevronRight, ExternalLink, Building2, Shield, Globe } from 'lucide-react';

interface Company {
    id: string;
    name: string;
    shortName: string;
    website: string;
    logoLetter: string;
    gradientFrom: string;
    gradientTo: string;
    registrationUrl: string;
    description: string;
    regulated: boolean;
    country: string;
}

const COMPANIES: Company[] = [
    {
        id: 'flexymarkets',
        name: 'Flexy Markets Limited',
        shortName: 'FlexyMarkets',
        website: 'flexymarkets.com',
        logoLetter: 'FM',
        gradientFrom: '#1d4ed8',
        gradientTo: '#0e7490',
        registrationUrl: 'https://www.flexymarkets.com/register',
        description: 'Multi-asset broker with MT5 platform',
        regulated: true,
        country: 'FSC Regulated',
    },
];

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export const OpenAccountDialog: React.FC<Props> = ({ isOpen, onClose }) => {
    const [selected, setSelected] = useState<string>(COMPANIES[0]?.id ?? '');
    const [searchQuery, setSearchQuery] = useState('');
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    if (!isOpen) return null;

    const filtered = COMPANIES.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.shortName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.website.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const selectedCompany = COMPANIES.find(c => c.id === selected);

    const handleNext = () => {
        if (selectedCompany) {
            if ((window as any).electron?.shell?.openExternal) {
                (window as any).electron.shell.openExternal(selectedCompany.registrationUrl);
            } else {
                window.open(selectedCompany.registrationUrl, '_blank', 'noopener,noreferrer');
            }
        }
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            {/* ── Dialog Shell ──────────────────────────────────────────── */}
            <div
                className="relative w-[580px] flex flex-col overflow-hidden"
                style={{
                    background: 'linear-gradient(145deg, #16181f 0%, #1c1e28 40%, #141620 100%)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '12px',
                    boxShadow: '0 40px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(180,180,190,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
                    maxHeight: '90vh',
                }}
            >
                {/* Subtle top glow */}
                <div
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-px opacity-60"
                    style={{ background: 'linear-gradient(90deg, transparent, #6366f1, transparent)' }}
                />

                {/* ── Title Bar ─────────────────────────────────────────── */}
                <div
                    className="flex items-center justify-between px-5 py-4"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                >
                    <div className="flex items-center gap-3">
                        <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{
                                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                                boxShadow: '0 4px 12px rgba(180,180,190,0.4)',
                            }}
                        >
                            <Building2 className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h2 className="text-[14px] font-semibold text-white tracking-tight">Open an Account</h2>
                            <p className="text-[10px] text-zinc-500 mt-0.5">Select a broker to get started</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all text-sm font-medium"
                            title="Help"
                        >?</button>
                        <button
                            onClick={onClose}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-white hover:bg-red-500/20 transition-all"
                            title="Close"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* ── Body ──────────────────────────────────────────────── */}
                <div className="flex-1 overflow-hidden flex flex-col gap-4 p-5">

                    {/* Search row */}
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search companies or enter address like 'company.com'"
                                className="w-full pl-9 pr-3 py-2 text-[11px] rounded-lg text-zinc-300 placeholder:text-zinc-600 focus:outline-none transition-all"
                                style={{
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}
                                onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(180,180,190,0.5)'}
                                onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                            />
                        </div>
                        <button
                            disabled
                            className="px-4 py-2 text-[11px] rounded-lg font-medium text-zinc-500 transition-all cursor-not-allowed"
                            style={{
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.06)',
                            }}
                        >
                            Find company
                        </button>
                    </div>

                    {/* Section label */}
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
                            Available Brokers
                        </span>
                        <div className="flex-1 h-px opacity-30" style={{ background: 'linear-gradient(90deg, rgba(180,180,190,0.3), transparent)' }} />
                        <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                            style={{ background: 'rgba(180,180,190,0.15)', color: '#818cf8' }}
                        >
                            {filtered.length}
                        </span>
                    </div>

                    {/* Company list */}
                    <div
                        className="overflow-y-auto rounded-xl flex flex-col gap-2"
                        style={{ maxHeight: '260px', minHeight: '80px' }}
                    >
                        {filtered.length === 0 ? (
                            <div className="py-10 text-center text-zinc-600 text-[12px]">
                                <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p>No companies found</p>
                            </div>
                        ) : (
                            filtered.map((company) => {
                                const isSelected = selected === company.id;
                                const isHovered = hoveredId === company.id;

                                return (
                                    <div
                                        key={company.id}
                                        onClick={() => setSelected(company.id)}
                                        onDoubleClick={handleNext}
                                        onMouseEnter={() => setHoveredId(company.id)}
                                        onMouseLeave={() => setHoveredId(null)}
                                        className="flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer transition-all duration-150 group select-none"
                                        style={{
                                            background: isSelected
                                                ? 'linear-gradient(135deg, rgba(180,180,190,0.2) 0%, rgba(79,70,229,0.15) 100%)'
                                                : isHovered
                                                    ? 'rgba(255,255,255,0.04)'
                                                    : 'rgba(255,255,255,0.02)',
                                            border: isSelected
                                                ? '1px solid rgba(180,180,190,0.4)'
                                                : isHovered
                                                    ? '1px solid rgba(255,255,255,0.08)'
                                                    : '1px solid rgba(255,255,255,0.04)',
                                            boxShadow: isSelected ? '0 4px 20px rgba(180,180,190,0.15), inset 0 1px 0 rgba(255,255,255,0.05)' : 'none',
                                        }}
                                    >
                                        {/* Logo badge */}
                                        <div
                                            className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-[13px] flex-shrink-0 tracking-tight"
                                            style={{
                                                background: `linear-gradient(135deg, ${company.gradientFrom} 0%, ${company.gradientTo} 100%)`,
                                                boxShadow: isSelected
                                                    ? `0 6px 20px rgba(29,78,216,0.5)`
                                                    : `0 4px 12px rgba(0,0,0,0.3)`,
                                            }}
                                        >
                                            {company.logoLetter}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[13px] font-semibold truncate ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                                                    {company.name}
                                                </span>
                                                {company.regulated && (
                                                    <div
                                                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full flex-shrink-0"
                                                        style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.2)' }}
                                                    >
                                                        <Shield className="w-2.5 h-2.5 text-emerald-400" />
                                                        <span className="text-[9px] font-medium text-emerald-400">Regulated</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 mt-0.5">
                                                <span className="text-[10px] text-zinc-500">{company.description}</span>
                                            </div>
                                            <div className="flex items-center gap-1 mt-1">
                                                <Globe className="w-2.5 h-2.5 text-zinc-600" />
                                                <span className="text-[10px] text-zinc-600">{company.website}</span>
                                                <span className="text-zinc-700 text-[10px] mx-1">·</span>
                                                <span className="text-[10px] text-zinc-600">{company.country}</span>
                                            </div>
                                        </div>

                                        {/* Right link */}
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <span className={`text-[11px] font-semibold transition-colors ${isSelected ? 'text-zinc-400' : 'text-zinc-600 group-hover:text-zinc-400'}`}>
                                                {company.shortName}
                                            </span>
                                            <ChevronRight className={`w-3.5 h-3.5 transition-colors ${isSelected ? 'text-zinc-400' : 'text-zinc-700 group-hover:text-zinc-400'}`} />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Selected company info strip */}
                    {selectedCompany && (
                        <div
                            className="flex items-center gap-2 px-3 py-2 rounded-lg"
                            style={{
                                background: 'rgba(180,180,190,0.06)',
                                border: '1px solid rgba(180,180,190,0.12)',
                            }}
                        >
                            <ExternalLink className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                            <p className="text-[10px] text-zinc-500">
                                Clicking <span className="text-zinc-400 font-semibold">Next</span> will open{' '}
                                <span className="text-zinc-300">{selectedCompany.name}</span>'s registration page in your browser
                            </p>
                        </div>
                    )}
                </div>

                {/* ── Footer ────────────────────────────────────────────── */}
                <div
                    className="flex items-center justify-between px-5 py-4"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                >
                    <div className="text-[10px] text-zinc-600">
                        Double-click to open immediately
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-5 py-2 text-[12px] font-medium text-zinc-400 hover:text-zinc-200 rounded-lg transition-all"
                            style={{
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.07)',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleNext}
                            disabled={!selected}
                            className="flex items-center gap-2 px-5 py-2 text-[12px] font-semibold text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                                boxShadow: '0 4px 20px rgba(180,180,190,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
                            }}
                            onMouseEnter={e => { if (selected) e.currentTarget.style.boxShadow = '0 6px 24px rgba(180,180,190,0.55), inset 0 1px 0 rgba(255,255,255,0.2)'; }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(180,180,190,0.4), inset 0 1px 0 rgba(255,255,255,0.15)'; }}
                        >
                            Next
                            <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OpenAccountDialog;
