import { Icon } from './ui/Icon';
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';
import { API_BASE_URL } from '../config/api';
import '../styles/login.css';

interface LoginProps {
    onLogin: (accountId: string) => void;
}

export function Login({ onLogin }: LoginProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form fields
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [server, setServer] = useState(
        import.meta.env.DEV
            ? 'rtxbackend.tradecopier.org'
            : API_BASE_URL.replace('http://', '').replace('https://', '')
    );
    const [rememberMe, setRememberMe] = useState(false);

    // Initial load for remembered credentials
    React.useEffect(() => {
        const savedUsername = localStorage.getItem('rtx_saved_username');
        const savedPassword = localStorage.getItem('rtx_saved_password');
        if (savedUsername && savedPassword) {
            setUsername(savedUsername);
            try {
                // Basic decoding - not true encryption but better than plain text in storage
                setPassword(atob(savedPassword));
            } catch (e) {
                // Fallback if decoding fails
            }
            setRememberMe(true);
        }
    }, []);

    const setAuthenticated = useAppStore(state => state.setAuthenticated);
    const setAuthToken = useAppStore(state => state.setAuthToken);
    const addSavedAccount = useAppStore(state => state.addSavedAccount);
    const setActiveAccount = useAppStore(state => state.setActiveAccount);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        // Always call the backend directly
        const BACKEND_URL = 'https://rtxbackend.tradecopier.org';

        try {
            // Make login request using the direct backend URL
            const data = await api.auth.login(username, password, BACKEND_URL);

            console.log('[Login] Full login response user:', data.user);
            const token = data.access_token;
            if (!token) {
                throw new Error('No authentication token received');
            }

            // Extract true account ID from user data, fallback to username if not present
            const accountId = data.user?.id || username;

            // Persist last successful login for session restore even without Remember Me
            localStorage.setItem('rtx_last_login', String(accountId));

            // Always save credentials for session restore / auto re-login
            localStorage.setItem('rtx_saved_username', username);
            try {
                localStorage.setItem('rtx_saved_password', btoa(password));
            } catch (e) {
                // Ignore encoding errors
            }

            // Persist the base URL and tokens for all subsequent requests
            import('../api/client').then(({ setBaseUrl, setToken, setRefreshToken }) => {
                setBaseUrl(BACKEND_URL);
                setToken(token);
                if (data.refresh_token) {
                    setRefreshToken(data.refresh_token);
                }
                if (data.expires_at) {
                    localStorage.setItem('token_expires_at', data.expires_at);
                }
            });

            onLogin(accountId);

            // Save into savedAccounts for multi-account switching persistence
            const loginNum = parseInt(username, 10);
            if (!isNaN(loginNum)) {
                addSavedAccount({
                    login: loginNum,
                    name: data.user?.username || '',
                    server: 'FlexyMarkets-Server',
                    isLive: true,
                    lastUsed: Date.now(),
                    password: btoa(password),
                });
                setActiveAccount(loginNum);
            }
        } catch (err: any) {
            console.error('Auth error:', err);
            setError(err.message || 'Authentication failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page-container">
            {/* Background Layers */}
            <img
                src="file:///C:/Users/ADMIN/.gemini/antigravity/brain/23cdb6e2-d121-4948-83d4-5877c4d33bb6/login_branding_visual_1771853546436.png"
                className="login-background-visual"
                alt=""
            />
            <div className="login-background-overlay" />

            {/* Login Card */}
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo-container">
                        <Icon name="shield" size="xl" className="text-white" />
                    </div>
                    <h1 className="login-title">RTX Terminal</h1>
                    {/* <p className="login-subtitle">Institutional Trading Environment</p> */}
                </div>

                {error && (
                    <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-[10px] font-bold text-[#4a5568] uppercase tracking-[0.2em] mb-3 ml-1">
                            Credential
                        </label>
                        <div className="login-input-group">
                            <Icon name="user" size="lg" className="input-icon" />
                            <input
                                type="text"
                                className="login-input"
                                placeholder="Account ID"
                                required
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                        </div>

                        <div className="login-input-group">
                            <Icon name="lock" size="lg" className="input-icon" />
                            <input
                                type="password"
                                className="login-input"
                                placeholder="Password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                    </div>
                    {/* 
                    <div className="mb-6">
                        <label className="block text-[10px] font-bold text-[#4a5568] uppercase tracking-[0.2em] mb-3 ml-1">
                            Server Connection
                        </label>
                        <div className="login-input-group">
                            <Icon name="server" size="lg" className="input-icon" />
                            <input
                                type="text"
                                className="login-input"
                                placeholder="Server Address"
                                required
                                value={server}
                                onChange={(e) => setServer(e.target.value)}
                            />
                        </div>
                    </div> */}

                    <div className="mb-6 flex items-center">
                        <input
                            type="checkbox"
                            id="rememberMe"
                            className="w-4 h-4 bg-[#131316] border-zinc-700 rounded text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                        />
                        <label htmlFor="rememberMe" className="ml-2 text-sm text-zinc-400 font-medium cursor-pointer">
                            Remember credentials
                        </label>
                    </div>

                    <button
                        type="submit"
                        className="login-submit-btn"
                        disabled={loading}
                    >
                        {loading ? (
                            <Icon name="refresh" size="sm" className="animate-spin" />
                        ) : (
                            <>
                                Login <Icon name="arrow-right" size="lg" />
                            </>
                        )}
                    </button>
                </form>

                <div className="server-info-badge">
                    <div className="status-dot" />
                    <span>System Operational</span>
                </div>

                <p className="login-footer-text">
                    Need help?
                    <a href="#" className="footer-link">Support Center</a>
                </p>
            </div>
        </div>
    );
}
