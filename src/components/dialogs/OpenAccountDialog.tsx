import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, ChevronRight, ExternalLink, Building2, Shield, Globe, CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { tradeApi, brokerV2Api } from '../../api/trade';
import type { BrokerServer } from '../../types/api';

// Palette cycling for broker avatar gradients
const GRADIENTS = [
    { from: '#1d4ed8', to: '#0e7490' },
    { from: '#059669', to: '#0d9488' },
    { from: '#7c3aed', to: '#4f46e5' },
    { from: '#d97706', to: '#b45309' },
    { from: '#dc2626', to: '#9f1239' },
    { from: '#0891b2', to: '#0369a1' },
    { from: '#6d28d9', to: '#7c3aed' },
    { from: '#065f46', to: '#047857' },
];

const initials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

import { RTX5_API_URL } from '../../config/api';

const getLogoUrl = (url?: string) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
        return url;
    }
    const base = (RTX5_API_URL || '').replace(/\/$/, '');
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${base}${path}`;
};

const BrokerAvatar: React.FC<{ broker: BrokerServer; index: number; isSelected: boolean }> = ({ broker, index, isSelected }) => {
    const [hasError, setHasError] = useState(false);
    const grad = GRADIENTS[index % GRADIENTS.length];
    
    if (broker.logo_url && !hasError) {
        return (
            <div
                className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden bg-white flex-shrink-0"
                style={{
                    border: isSelected ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.08)',
                    boxShadow: isSelected ? '0 0 12px rgba(99,102,241,0.35)' : '0 4px 12px rgba(0,0,0,0.2)',
                }}
            >
                <img
                    src={getLogoUrl(broker.logo_url)}
                    alt={broker.broker_name}
                    className="w-full h-full object-contain p-1.5"
                    onError={() => setHasError(true)}
                />
            </div>
        );
    }
    
    return (
        <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-[12px] flex-shrink-0"
            style={{
                background: `linear-gradient(135deg, ${grad.from} 0%, ${grad.to} 100%)`,
                boxShadow: isSelected ? `0 6px 20px ${grad.from}55` : '0 4px 12px rgba(0,0,0,0.3)',
            }}
        >
            {initials(broker.broker_name)}
        </div>
    );
};

const DropdownBrokerLogo: React.FC<{ broker: BrokerServer; index: number }> = ({ broker, index }) => {
    const [hasError, setHasError] = useState(false);
    const grad = GRADIENTS[index % GRADIENTS.length];
    
    if (broker.logo_url && !hasError) {
        return (
            <div className="w-5 h-5 rounded bg-white flex items-center justify-center overflow-hidden flex-shrink-0 border border-white/10">
                <img
                    src={getLogoUrl(broker.logo_url)}
                    alt={broker.broker_name}
                    className="w-full h-full object-contain p-0.5"
                    onError={() => setHasError(true)}
                />
            </div>
        );
    }
    
    return (
        <div
            className="w-5 h-5 rounded flex items-center justify-center text-white font-bold text-[8px] flex-shrink-0"
            style={{
                background: `linear-gradient(135deg, ${grad.from} 0%, ${grad.to} 100%)`,
            }}
        >
            {initials(broker.broker_name)}
        </div>
    );
};

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export const OpenAccountDialog: React.FC<Props> = ({ isOpen, onClose }) => {
    const [step, setStep] = useState(0);
    const [brokers, setBrokers] = useState<BrokerServer[]>([]);
    const [loadingBrokers, setLoadingBrokers] = useState(false);
    const [selected, setSelected] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [accountType, setAccountType] = useState<'demo' | 'real' | 'existing'>('demo');

    // "Connect existing" sub-form state
    const [existingLogin, setExistingLogin] = useState('');
    const [existingPassword, setExistingPassword] = useState('');
    const [existingServerSearch, setExistingServerSearch] = useState('');
    const [existingServerDropOpen, setExistingServerDropOpen] = useState(false);
    const [existingBroker, setExistingBroker] = useState<BrokerServer | null>(null);

    const [formData, setFormData] = useState({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'trader@example.com',
        phone: '+1-555-0100',
        country: 'US',
        group: 'orrnn/demo-std',
        currency: 'USD',
        leverage: '100',
        deposit: '10000',
        masterPass: 'Strong-Pass-123',
        investorPass: 'Read-Only-Pass',
        comment: 'Public demo account',
    });
    const [createdAccount, setCreatedAccount] = useState<any>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState('');

    // Fetch brokers on open
    useEffect(() => {
        if (!isOpen) return;
        setLoadingBrokers(true);
        Promise.all([
            brokerV2Api.getServers(),
            brokerV2Api.getBrokers().catch(err => {
                console.warn('[OpenAccountDialog] Could not load broker details for logo lookup:', err);
                return { brokers: [], count: 0 };
            })
        ])
            .then(([servers, brokersData]) => {
                const brokersList = brokersData?.brokers || [];
                const logoMap = new Map(brokersList.map(b => [b.broker_id, b.logo_url]));
                const enabled = servers
                    .filter(s => s.enabled !== false)
                    .map(s => ({
                        ...s,
                        logo_url: logoMap.get(s.broker_id) || s.logo_url
                    }));
                setBrokers(enabled);
                if (!selected && enabled.length > 0) setSelected(String(enabled[0].id));
            })
            .catch(err => console.warn('[OpenAccountDialog] Could not load brokers:', err))
            .finally(() => setLoadingBrokers(false));
    }, [isOpen]);

    if (!isOpen) return null;

    const filteredBrokers = searchQuery.trim()
        ? brokers.filter(b =>
            b.broker_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            b.server.toLowerCase().includes(searchQuery.toLowerCase()) ||
            b.broker_id.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : brokers;

    const existingFilteredBrokers = existingServerSearch.trim()
        ? brokers.filter(b =>
            b.broker_name.toLowerCase().includes(existingServerSearch.toLowerCase()) ||
            b.server.toLowerCase().includes(existingServerSearch.toLowerCase())
        )
        : brokers;

    const selectedBroker = brokers.find(b => String(b.id) === selected);

    const handleNext = async () => {
        if (step < 3) {
            setStep(step + 1);
        } else if (step === 3) {
            try {
                setIsCreating(true);
                setCreateError('');
                const response = await tradeApi.account.create({
                    name: `${formData.firstName} ${formData.lastName}`.trim(),
                    currency: formData.currency,
                    leverage: parseInt(formData.leverage, 10),
                    group: formData.group,
                    // @ts-ignore
                    balance: parseFloat(formData.deposit),
                    // @ts-ignore
                    master_pass: formData.masterPass,
                    // @ts-ignore
                    investor_pass: formData.investorPass,
                });
                setCreatedAccount(response);
                setStep(4);
            } catch (err: any) {
                setCreateError(err.message || 'Failed to create account');
            } finally {
                setIsCreating(false);
            }
        } else {
            onClose();
            setTimeout(() => { setStep(0); setCreatedAccount(null); }, 300);
        }
    };

    const handleBack = () => { if (step > 0) setStep(step - 1); };

    // ─── Step 0: Broker Selection ───────────────────────────────────────────────
    const renderStep0 = () => (
        <div className="flex-1 overflow-hidden flex flex-col gap-4 p-5">
            {/* Search bar */}
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search broker name or server address…"
                        className="w-full pl-9 pr-3 py-2 text-[11px] rounded-lg text-zinc-300 placeholder:text-zinc-600 focus:outline-none transition-all"
                        style={{
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                        }}
                        onFocus={e => (e.currentTarget.style.borderColor = 'rgba(180,180,190,0.5)')}
                        onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
                    />
                </div>
            </div>

            {/* Section header */}
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
                    Available Brokers
                </span>
                <div className="flex-1 h-px opacity-30" style={{ background: 'linear-gradient(90deg, rgba(180,180,190,0.3), transparent)' }} />
                <span
                    className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                    style={{ background: 'rgba(180,180,190,0.15)', color: '#818cf8' }}
                >
                    {loadingBrokers ? '…' : filteredBrokers.length}
                </span>
            </div>

            {/* Broker list */}
            <div className="overflow-y-auto rounded-xl flex flex-col gap-2" style={{ maxHeight: '280px', minHeight: '80px' }}>
                {loadingBrokers ? (
                    <div className="py-10 flex flex-col items-center gap-2 text-zinc-600 text-[12px]">
                        <Loader2 className="w-6 h-6 animate-spin opacity-50" />
                        <p>Loading brokers…</p>
                    </div>
                ) : filteredBrokers.length === 0 ? (
                    <div className="py-10 text-center text-zinc-600 text-[12px]">
                        <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p>No brokers found</p>
                    </div>
                ) : (
                    filteredBrokers.map((broker, i) => {
                        const isSelected = selected === String(broker.id);
                        const isHovered = hoveredId === String(broker.id);
                        const grad = GRADIENTS[i % GRADIENTS.length];
                        return (
                            <div
                                key={broker.id}
                                onClick={() => setSelected(String(broker.id))}
                                onDoubleClick={handleNext}
                                onMouseEnter={() => setHoveredId(String(broker.id))}
                                onMouseLeave={() => setHoveredId(null)}
                                className={`flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer transition-all duration-150 select-none`}
                                style={{
                                    background: isSelected
                                        ? 'linear-gradient(135deg, rgba(180,180,190,0.2) 0%, rgba(79,70,229,0.15) 100%)'
                                        : isHovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                                    border: isSelected
                                        ? '1px solid rgba(180,180,190,0.4)'
                                        : isHovered ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.04)',
                                    boxShadow: isSelected ? '0 4px 20px rgba(180,180,190,0.15), inset 0 1px 0 rgba(255,255,255,0.05)' : 'none',
                                }}
                            >
                                {/* Avatar */}
                                <BrokerAvatar broker={broker} index={i} isSelected={isSelected} />

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[14px] font-semibold truncate ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                                            {broker.broker_name}
                                        </span>
                                        {broker.region && (
                                            <span
                                                className="px-1.5 py-0.5 rounded-full text-[9px] font-medium flex-shrink-0"
                                                style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
                                            >
                                                {broker.region}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[11.5px] text-zinc-400 font-mono truncate">{broker.server}</span>
                                    </div>
                                </div>

                                <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 transition-colors ${isSelected ? 'text-zinc-400' : 'text-zinc-700'}`} />
                            </div>
                        );
                    })
                )}
            </div>

            {selectedBroker && (
                <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(180,180,190,0.06)', border: '1px solid rgba(180,180,190,0.12)' }}
                >
                    <ExternalLink className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                    <p className="text-[10px] text-zinc-500">
                        Clicking <span className="text-zinc-400 font-semibold">Next</span> will proceed with{' '}
                        <span className="text-zinc-300">{selectedBroker.broker_name}</span>
                        <span className="text-zinc-600 font-mono ml-1">({selectedBroker.server})</span>
                    </p>
                </div>
            )}
        </div>
    );

    // ─── Step 1: Account Type ───────────────────────────────────────────────────
    const renderStep1 = () => (
        <div className="flex-1 overflow-hidden flex flex-col p-5">
            <div className="flex flex-col gap-6 pt-2">
                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="flex items-center h-5">
                        <input type="radio" checked={accountType === 'demo'} onChange={() => setAccountType('demo')} className="w-4 h-4 accent-indigo-500" />
                    </div>
                    <div>
                        <div className="text-[12px] font-medium text-zinc-200 group-hover:text-white transition-colors">Open a demo account to trade virtual money without risk</div>
                        <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed">A demo account allows you to learn trading on stock exchanges and test your strategies without risking real money.</div>
                    </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="flex items-center h-5">
                        <input type="radio" checked={accountType === 'real'} onChange={() => setAccountType('real')} className="w-4 h-4 accent-indigo-500" />
                    </div>
                    <div>
                        <div className="text-[12px] font-medium text-zinc-200 group-hover:text-white transition-colors">Open a real account for live trading</div>
                        <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed">A real account requires additional proof of identity. You will need to provide copies of identification documents.</div>
                    </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="flex items-center h-5">
                        <input type="radio" checked={accountType === 'existing'} onChange={() => setAccountType('existing')} className="w-4 h-4 accent-indigo-500" />
                    </div>
                    <div className="w-full">
                        <div className="text-[12px] font-medium text-zinc-200 group-hover:text-white transition-colors">Connect with an existing trade account</div>
                        {accountType === 'existing' && (
                            <div className="mt-3 flex flex-col gap-2">
                                <div className="flex items-center gap-3">
                                    <span className="text-[11px] text-zinc-400 w-16 text-right flex-shrink-0">Login:</span>
                                    <input
                                        type="text"
                                        value={existingLogin}
                                        onChange={e => setExistingLogin(e.target.value)}
                                        className="flex-1 bg-transparent border border-zinc-700 rounded px-2 py-1 text-[11px] text-white focus:border-indigo-500 outline-none"
                                        placeholder="Account ID"
                                    />
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-[11px] text-zinc-400 w-16 text-right flex-shrink-0">Password:</span>
                                    <input
                                        type="password"
                                        value={existingPassword}
                                        onChange={e => setExistingPassword(e.target.value)}
                                        className="flex-1 bg-transparent border border-zinc-700 rounded px-2 py-1 text-[11px] text-white focus:border-indigo-500 outline-none"
                                        placeholder="Password"
                                    />
                                </div>
                                {/* Server dropdown with search */}
                                <div className="flex items-start gap-3">
                                    <span className="text-[11px] text-zinc-400 w-16 text-right flex-shrink-0 mt-1.5">Server:</span>
                                    <div className="flex-1 relative">
                                        <button
                                            type="button"
                                            onClick={() => setExistingServerDropOpen(o => !o)}
                                            className="w-full h-[32px] bg-[#1a1c23] border border-zinc-700 rounded px-2 text-[11px] text-left flex items-center justify-between gap-2 focus:border-indigo-500 outline-none"
                                        >
                                            <div className="flex items-center gap-2 truncate flex-1">
                                                {existingBroker ? (
                                                    <>
                                                        <DropdownBrokerLogo broker={existingBroker} index={0} />
                                                        <span className="truncate text-zinc-300">
                                                            {existingBroker.broker_name} <span className="text-zinc-600 font-mono text-[10px]">({existingBroker.server})</span>
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span className="text-zinc-600">Select server…</span>
                                                )}
                                            </div>
                                            <ChevronRight className={`w-3 h-3 text-zinc-500 flex-shrink-0 transition-transform ${existingServerDropOpen ? 'rotate-90' : ''}`} />
                                        </button>
                                        {existingServerDropOpen && (
                                            <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-[#1e2030] border border-zinc-600/60 rounded shadow-xl max-h-[200px] flex flex-col">
                                                <div className="px-2 pt-2 pb-1 border-b border-zinc-700/50">
                                                    <input
                                                        autoFocus
                                                        type="text"
                                                        value={existingServerSearch}
                                                        onChange={e => setExistingServerSearch(e.target.value)}
                                                        placeholder="Search broker or server…"
                                                        className="w-full h-[24px] px-2 bg-[#131520] border border-zinc-600/40 rounded text-[10px] text-zinc-200 placeholder:text-zinc-600 outline-none"
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                </div>
                                                <div className="overflow-y-auto flex-1">
                                                    {existingFilteredBrokers.map((b, idx) => (
                                                        <button
                                                            key={b.id}
                                                            type="button"
                                                            onClick={() => { setExistingBroker(b); setExistingServerDropOpen(false); setExistingServerSearch(''); }}
                                                            className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-zinc-700/60 transition-colors flex items-center gap-2 ${existingBroker?.id === b.id ? 'bg-zinc-700/40 text-white' : 'text-zinc-300'}`}
                                                        >
                                                            <DropdownBrokerLogo broker={b} index={idx} />
                                                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                                                <span className="font-medium truncate">{b.broker_name}</span>
                                                                <span className="text-zinc-500 text-[9px] font-mono truncate">{b.server}</span>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </label>
            </div>
        </div>
    );

    // ─── Step 2: Personal Details ───────────────────────────────────────────────
    const renderStep2 = () => (
        <div className="flex-1 overflow-hidden flex flex-col p-5">
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">First name:</span>
                    <input type="text" value={formData.firstName} onChange={e => setFormData(s => ({ ...s, firstName: e.target.value }))} className="flex-1 bg-transparent border border-indigo-500 rounded px-2 py-1.5 text-[11px] text-white outline-none" />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">Last name:</span>
                    <input type="text" value={formData.lastName} onChange={e => setFormData(s => ({ ...s, lastName: e.target.value }))} className="flex-1 bg-transparent border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-white focus:border-indigo-500 outline-none" />
                </div>
                <div className="h-2" />
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">Email:</span>
                    <input type="email" value={formData.email} onChange={e => setFormData(s => ({ ...s, email: e.target.value }))} className="flex-1 bg-transparent border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-white focus:border-indigo-500 outline-none" />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">Mobile Phone:</span>
                    <input type="text" value={formData.phone} onChange={e => setFormData(s => ({ ...s, phone: e.target.value }))} className="flex-1 bg-transparent border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-white focus:border-indigo-500 outline-none" />
                </div>
                <div className="h-2" />
                <div className="flex items-center gap-2 w-1/2 pr-2 mt-2">
                    <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">Country:</span>
                    <select value={formData.country} onChange={e => setFormData(s => ({ ...s, country: e.target.value }))} className="flex-1 bg-[#1a1c23] border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-300 outline-none">
                        <option value="US">United States (US)</option>
                        <option value="IN">India (IN)</option>
                    </select>
                </div>
                <div className="flex items-center gap-2 w-1/2 pr-2">
                    <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">Account group:</span>
                    <select value={formData.group} onChange={e => setFormData(s => ({ ...s, group: e.target.value }))} className="flex-1 bg-[#1a1c23] border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-300 outline-none">
                        <option value="orrnn/demo-std">orrnn/demo-std</option>
                    </select>
                </div>
                <div className="pl-[104px] pt-4">
                    <p className="text-[10px] text-zinc-500 leading-tight">
                        Personal details are used for opening a trade account and are not passed to any third parties.<br />
                        The information is handled securely and confidentially.
                    </p>
                </div>
            </div>
        </div>
    );

    // ─── Step 3: Account Settings ───────────────────────────────────────────────
    const renderStep3 = () => (
        <div className="flex-1 overflow-hidden flex flex-col p-5">
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 flex-1">
                        <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">Currency:</span>
                        <select value={formData.currency} onChange={e => setFormData(s => ({ ...s, currency: e.target.value }))} className="flex-1 bg-[#1a1c23] border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-300 outline-none">
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2 flex-1">
                        <span className="text-[11px] text-zinc-400 w-16 text-right flex-shrink-0">Leverage:</span>
                        <select value={formData.leverage} onChange={e => setFormData(s => ({ ...s, leverage: e.target.value }))} className="flex-1 bg-[#1a1c23] border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-300 outline-none">
                            <option value="100">1:100</option>
                            <option value="200">1:200</option>
                            <option value="500">1:500</option>
                        </select>
                    </div>
                </div>
                <div className="flex items-center gap-2 w-1/2 pr-2">
                    <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">Deposit:</span>
                    <input type="number" value={formData.deposit} onChange={e => setFormData(s => ({ ...s, deposit: e.target.value }))} className="flex-1 bg-transparent border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-white focus:border-indigo-500 outline-none" />
                </div>
                <div className="h-2" />
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">Master password:</span>
                    <input type="text" value={formData.masterPass} onChange={e => setFormData(s => ({ ...s, masterPass: e.target.value }))} className="flex-1 bg-transparent border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-white focus:border-indigo-500 outline-none" />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">Investor password:</span>
                    <input type="text" value={formData.investorPass} onChange={e => setFormData(s => ({ ...s, investorPass: e.target.value }))} className="flex-1 bg-transparent border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-white focus:border-indigo-500 outline-none" />
                </div>
                <div className="h-2" />
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 w-24 text-right flex-shrink-0">Comment:</span>
                    <input type="text" value={formData.comment} onChange={e => setFormData(s => ({ ...s, comment: e.target.value }))} className="flex-1 bg-transparent border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-white focus:border-indigo-500 outline-none" />
                </div>
                <div className="h-4" />
                <div className="flex items-start gap-2 pl-[104px]">
                    <input type="checkbox" className="mt-0.5 accent-indigo-500 w-3 h-3" defaultChecked />
                    <div>
                        <span className="text-[11px] text-zinc-300 block">I agree with the terms and conditions for opening an account and the data protection policy</span>
                        <a href="#" className="text-[11px] text-indigo-400 hover:text-indigo-300 mt-1 block">www.exness.eu</a>
                    </div>
                </div>
                {createError && (
                    <div className="pl-[104px] mt-2 text-[11px] text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20">
                        {createError}
                    </div>
                )}
            </div>
        </div>
    );

    // ─── Step 4: Success ────────────────────────────────────────────────────────
    const renderStep4 = () => {
        if (!createdAccount) return null;
        return (
            <div className="flex-1 overflow-y-auto flex flex-col p-6 items-center">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4 border border-emerald-500/20">
                    <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
                <h3 className="text-white font-semibold text-[16px] mb-1">Registration Complete</h3>
                <p className="text-zinc-400 text-[12px] mb-6 text-center">Your new account has been successfully created.<br />Please save these credentials.</p>
                <div className="w-full bg-[#1a1c23] border border-zinc-700/50 rounded-xl p-5 flex flex-col gap-3">
                    {[
                        { label: 'Login (Account)', value: createdAccount.login, mono: true, color: 'text-emerald-400', size: 'text-[16px]' },
                        { label: 'Master Password', value: formData.masterPass, mono: true },
                        { label: 'Investor Password', value: formData.investorPass, mono: true },
                        createdAccount.api_key && { label: 'API Key', value: createdAccount.api_key, mono: true, small: true },
                        { label: 'Broker / Server', value: selectedBroker?.broker_name || createdAccount.broker_id || 'Broker' },
                        { label: 'Group', value: createdAccount.group },
                        { label: 'Balance', value: `${createdAccount.balance || formData.deposit} ${createdAccount.currency || formData.currency}`, color: 'text-emerald-400' },
                        { label: 'Leverage', value: `1:${createdAccount.leverage || formData.leverage}` },
                    ].filter(Boolean).map((row: any) => (
                        <div key={row.label} className="flex justify-between items-center pb-3 border-b border-zinc-800/80 last:border-0 last:pb-0">
                            <span className="text-zinc-500 text-[11px] font-medium uppercase tracking-wider">{row.label}</span>
                            <div className="flex items-center gap-2">
                                <span className={`${row.color || 'text-zinc-200'} ${row.mono ? 'font-mono' : ''} ${row.size || 'text-[13px]'} ${row.small ? 'text-[11px] truncate max-w-[200px]' : ''}`}>{String(row.value)}</span>
                                {row.mono && (
                                    <button onClick={() => navigator.clipboard.writeText(String(row.value))} className="text-zinc-500 hover:text-white transition-colors">
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-5 text-[10.5px] leading-relaxed text-yellow-500/90 text-center bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20 w-full flex items-start gap-2">
                    <Shield className="w-4 h-4 flex-shrink-0 mt-0.5 opacity-80" />
                    <span className="text-left">Your password is securely hashed on the server. Please copy and save these credentials now.</span>
                </div>
            </div>
        );
    };

    const getHeader = () => {
        if (step === 0) return { title: 'Open an Account', sub: 'Select a broker to get started' };
        if (step === 1) return { title: 'Open an account', sub: 'Trade real or virtual money and gain experience' };
        if (step === 2) return { title: 'Opening a real account', sub: 'A real account is required for live trading on financial markets' };
        if (step === 3) return { title: 'Account Settings', sub: 'Configure currency, leverage and deposit for your new account' };
        return { title: 'Registration Successful', sub: 'Your new account details' };
    };

    const header = getHeader();
    const isStepValid = step === 0 ? !!selected : true;

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
            onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
        >
            <div
                className="relative w-[580px] flex flex-col overflow-hidden transition-all duration-300"
                style={{
                    background: 'linear-gradient(145deg, rgba(22, 24, 31, 0.65) 0%, rgba(28, 30, 40, 0.6) 40%, rgba(20, 22, 32, 0.65) 100%)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '12px',
                    boxShadow: '0 40px 80px rgba(0,0,0,0.75), 0 0 0 1px rgba(180,180,190,0.1), inset 0 1px 0 rgba(255,255,255,0.05)',
                    maxHeight: '90vh',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                }}
            >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-px opacity-60" style={{ background: 'linear-gradient(90deg, transparent, #6366f1, transparent)' }} />

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center gap-3">
                        {step === 0 && (
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', boxShadow: '0 4px 12px rgba(180,180,190,0.4)' }}>
                                <Building2 className="w-4 h-4 text-white" />
                            </div>
                        )}
                        <div>
                            <h2 className="text-[14px] font-semibold text-white tracking-tight">
                                {step > 0 ? `Open an Account: ${selectedBroker?.broker_name || 'Broker'}` : header.title}
                            </h2>
                            <p className="text-[10px] text-zinc-500 mt-0.5">{step > 0 ? header.title : header.sub}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all text-sm font-medium" title="Help">?</button>
                        <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-white hover:bg-red-500/20 transition-all" title="Close">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {step === 0 && renderStep0()}
                {step === 1 && renderStep1()}
                {step === 2 && renderStep2()}
                {step === 3 && renderStep3()}
                {step === 4 && renderStep4()}

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-4 mt-auto" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="text-[10px] text-zinc-600">
                        {step === 0 ? 'Double-click to proceed immediately' : ''}
                    </div>
                    <div className="flex items-center gap-2">
                        {step > 0 && (
                            <button
                                onClick={handleBack}
                                className="px-5 py-2 text-[12px] font-medium text-zinc-400 hover:text-zinc-200 rounded-lg transition-all"
                                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                            >
                                &lt; Back
                            </button>
                        )}
                        <button
                            onClick={handleNext}
                            disabled={!isStepValid || isCreating}
                            className="flex items-center gap-2 px-5 py-2 text-[12px] font-semibold text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', boxShadow: '0 4px 20px rgba(180,180,190,0.4), inset 0 1px 0 rgba(255,255,255,0.15)' }}
                        >
                            {isCreating ? 'Creating…' : step < 3 ? 'Next >' : step === 3 ? 'Register' : 'Finish'}
                        </button>
                        <button
                            onClick={onClose}
                            className="px-5 py-2 text-[12px] font-medium text-zinc-400 hover:text-zinc-200 rounded-lg transition-all ml-1"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default OpenAccountDialog;
