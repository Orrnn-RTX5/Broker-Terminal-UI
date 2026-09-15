import { Icon } from './ui/Icon';
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';
import { getStoredBrokerServer, loadBrokerServers, persistBrokerServer, resolveLoginBrokerTarget } from '../services/brokerServers';
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
    const [server, setServer] = useState(() => getStoredBrokerServer());
    const [brokerServers, setBrokerServers] = useState<string[]>([]);
    const [rememberMe, setRememberMe] = useState(false);

    // Initial load for remembered account ID only. Passwords must not be restored from storage.
    React.useEffect(() => {
        const savedUsername = localStorage.getItem('rtx_saved_username');
        localStorage.removeItem('rtx_saved_password');
        if (savedUsername) {
            setUsername(savedUsername);
            setRememberMe(true);
        }
    }, []);

    React.useEffect(() => {
        let isMounted = true;
        loadBrokerServers()
            .then((servers) => {
                if (!isMounted || servers.length === 0) return;
                setBrokerServers(servers);
                setServer(current => servers.includes(current) ? current : current || servers[0]);
            })
            .catch((err) => console.warn('[Login] Could not load broker servers:', err));
        return () => {
            isMounted = false;
        };
    }, []);

    const setAuthenticated = useAppStore(state => state.setAuthenticated);
    const setAuthToken = useAppStore(state => state.setAuthToken);
    const addSavedAccount = useAppStore(state => state.addSavedAccount);
    const setActiveAccount = useAppStore(state => state.setActiveAccount);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const selectedServer = persistBrokerServer(server);
            const loginTarget = resolveLoginBrokerTarget(selectedServer);
            const data = await api.auth.login(username, password, {
                broker_id: loginTarget.broker_id,
                server: loginTarget.server,
            });

            console.log('[Login] Full login response user:', data.user);
            const token = data.access_token;
            if (!token) {
                throw new Error('No authentication token received');
            }

            const accountId = data.account_login ?? username;

            // Persist last successful login for session restore even without Remember Me
            localStorage.setItem('rtx_last_login', String(accountId));

            // Remember account ID only; never persist the password.
            localStorage.setItem('rtx_saved_username', String(accountId));
            localStorage.removeItem('rtx_saved_password');

            // Persist tokens for all subsequent requests
            import('../api/client').then(({ setToken, setRefreshToken }) => {
                setToken(token);
                if (data.refresh_token) {
                    setRefreshToken(data.refresh_token);
                }
                if (data.expires_at) {
                    localStorage.setItem('token_expires_at', data.expires_at);
                }
            });

            onLogin(String(accountId));

            // Save into savedAccounts for multi-account switching persistence
            const loginNum = parseInt(String(accountId), 10);
            if (!isNaN(loginNum)) {
                addSavedAccount({
                    login: loginNum,
                    name: data.user?.username || data.username || '',
                    server: loginTarget.server || data.broker_server || loginTarget.displayValue,
                    isLive: true,
                    lastUsed: Date.now(),
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
                    <h1 className="login-title">RTX 5 Web Terminal</h1>
                    {/* <p className="login-subtitle">Institutional Trading Environment</p> */}
                </div>

                {error && (
                    <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-[14px] leading-5 font-medium text-[#4a5568] uppercase tracking-[0.2em] mb-3 ml-1">
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
                    <div className="mb-6">
                        <label className="block text-[14px] leading-5 font-medium text-[#4a5568] uppercase tracking-[0.2em] mb-3 ml-1">
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
                                list="login-broker-servers"
                                onChange={(e) => setServer(e.target.value)}
                            />
                            <datalist id="login-broker-servers">
                                {brokerServers.map(serverName => (
                                    <option key={serverName} value={serverName} />
                                ))}
                            </datalist>
                        </div>
                    </div>

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
