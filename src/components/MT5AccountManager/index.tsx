import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import './styles.css';

interface MT5AccountManagerProps {
  onAccountCreated?: (credentials: MT5Credentials) => void;
  onClose?: () => void;
}

interface MT5Credentials {
  login: number;
  masterPassword: string;
  investorPassword: string;
  server: string;
  group: string;
}

interface MT5Group {
  name: string;
  description?: string;
  type?: string;
}

export const MT5AccountManager: React.FC<MT5AccountManagerProps> = ({
  onAccountCreated,
  onClose,
}) => {
  const [status, setStatus] = useState<{ connected: boolean; message: string }>({
    connected: false,
    message: 'Checking connection...',
  });
  const [groups, setGroups] = useState<MT5Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdAccount, setCreatedAccount] = useState<MT5Credentials | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('YoFx/Plain');

  const { setAuthToken } = useAppStore();

  // Check MT5 status and load groups on mount
  useEffect(() => {
    checkStatusAndLoadGroups();
  }, []);

  const checkStatusAndLoadGroups = async () => {
    setLoading(true);
    setError(null);

    try {
      // Check MT5 connection status
      const statusData = await api.mt5Manager.getStatus();

      if (!statusData.connected) {
        setStatus({
          connected: false,
          message: statusData.last_error || 'Not connected to MT5 server',
        });
        setLoading(false);
        return;
      }

      setStatus({
        connected: true,
        message: `Connected to ${statusData.address || 'MT5 Server'}`,
      });

      // Load groups
      const groupsData = await api.mt5Manager.getGroups();
      setGroups(groupsData);

      // Set default group if YoFx/Plain exists
      if (groupsData.some((g) => g.name === 'YoFx/Plain')) {
        setSelectedGroup('YoFx/Plain');
      } else if (groupsData.length > 0) {
        setSelectedGroup(groupsData[0].name);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect to MT5');
      setStatus({
        connected: false,
        message: 'Connection failed',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);

    try {
      const response = await api.mt5Manager.createAccount({
        group: selectedGroup,
        name: name || 'New Trader',
        email: email || undefined,
        phone: phone || undefined,
        country: country || undefined,
        leverage: 100,
      });

      if (!response.success || !response.account) {
        throw new Error(response.message || 'Account creation failed');
      }

      const credentials: MT5Credentials = {
        login: response.account.login,
        masterPassword: response.account.master_password,
        investorPassword: response.account.investor_password,
        server: response.account.server,
        group: response.account.group,
      };

      setCreatedAccount(credentials);

      // Store credentials for auto-login
      localStorage.setItem('mt5_credentials', JSON.stringify(credentials));
      localStorage.setItem('mt5_auto_login', 'true');

      if (onAccountCreated) {
        onAccountCreated(credentials);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setCreating(false);
    }
  };

  const handleLoginWithNewAccount = () => {
    if (createdAccount) {
      // Store login credentials in format expected by the app
      localStorage.setItem('rtx_saved_username', String(createdAccount.login));
      try {
        localStorage.setItem('rtx_saved_password', btoa(createdAccount.masterPassword));
      } catch (e) {
        localStorage.setItem('rtx_saved_password', createdAccount.masterPassword);
      }
      localStorage.setItem('api_base_url', createdAccount.server);

      // Redirect to login or auto-login
      window.location.reload();
    }
  };

  const handleCopyCredentials = () => {
    if (createdAccount) {
      const text = `Login: ${createdAccount.login}\nPassword: ${createdAccount.masterPassword}\nServer: ${createdAccount.server}\nGroup: ${createdAccount.group}`;
      navigator.clipboard.writeText(text);
      alert('Credentials copied to clipboard!');
    }
  };

  // Show success state after account creation
  if (createdAccount) {
    return (
      <div className="mt5-account-manager">
        <div className="mt5-manager-header">
          <h2>Account Created Successfully!</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="mt5-success-message">
          <div className="success-icon">✓</div>
          <p>Your new MT5 trading account has been created.</p>
        </div>

        <div className="mt5-credentials-box">
          <h3>Account Credentials</h3>
          <div className="credential-row">
            <span className="credential-label">Login:</span>
            <span className="credential-value highlight">{createdAccount.login}</span>
          </div>
          <div className="credential-row">
            <span className="credential-label">Master Password:</span>
            <span className="credential-value">{createdAccount.masterPassword}</span>
          </div>
          <div className="credential-row">
            <span className="credential-label">Investor Password:</span>
            <span className="credential-value">{createdAccount.investorPassword}</span>
          </div>
          <div className="credential-row">
            <span className="credential-label">Server:</span>
            <span className="credential-value">{createdAccount.server}</span>
          </div>
          <div className="credential-row">
            <span className="credential-label">Group:</span>
            <span className="credential-value">{createdAccount.group}</span>
          </div>
        </div>

        <div className="mt5-warning-box">
          <strong>⚠️ Important:</strong> Save these credentials securely. The password cannot be retrieved later!
        </div>

        <div className="mt5-actions">
          <button className="btn-secondary" onClick={handleCopyCredentials}>
            Copy to Clipboard
          </button>
          <button className="btn-primary" onClick={handleLoginWithNewAccount}>
            Login with New Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt5-account-manager">
      <div className="mt5-manager-header">
        <h2>Create MT5 Trading Account</h2>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      {/* Connection Status */}
      <div className={`mt5-status ${status.connected ? 'connected' : 'disconnected'}`}>
        <span className="status-indicator"></span>
        <span className="status-text">{status.message}</span>
        {!status.connected && !loading && (
          <button className="btn-link" onClick={checkStatusAndLoadGroups}>
            Retry
          </button>
        )}
      </div>

      {error && (
        <div className="mt5-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt5-loading">
          <div className="spinner"></div>
          <p>Connecting to MT5 server...</p>
        </div>
      ) : !status.connected ? (
        <div className="mt5-not-connected">
          <p>Cannot connect to MT5 server. Please check:</p>
          <ul>
            <li>MT5 backend is running</li>
            <li>Manager credentials are configured in .env</li>
            <li>Network connection is available</li>
          </ul>
        </div>
      ) : (
        <form onSubmit={handleCreateAccount} className="mt5-form">
          <div className="form-group">
            <label>Account Group *</label>
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              required
            >
              {groups.map((group) => (
                <option key={group.name} value={group.name}>
                  {group.name} {group.description ? `- ${group.description}` : ''}
                </option>
              ))}
            </select>
            {selectedGroup === 'YoFx/Plain' && (
              <span className="group-badge recommended">Recommended</span>
            )}
          </div>

          <div className="form-group">
            <label>Full Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your full name"
              required
            />
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
            />
          </div>

          <div className="form-group">
            <label>Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 234 567 8900"
            />
          </div>

          <div className="form-group">
            <label>Country</label>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Your country"
            />
          </div>

          <div className="form-info">
            <p>Leverage will be set to <strong>1:100</strong> by default.</p>
          </div>

          <div className="mt5-form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={creating || !name}
            >
              {creating ? (
                <>
                  <span className="spinner-small"></span>
                  Creating...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default MT5AccountManager;
