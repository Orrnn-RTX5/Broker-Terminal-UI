import { api } from './api';

export interface MT5Group {
  name: string;
  description?: string;
  type?: string;
}

export interface CreateAccountRequest {
  group: string;
  name: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  leverage: number;
}

export interface CreateAccountResponse {
  success: boolean;
  message: string;
  account?: {
    login: number;
    master_password: string;
    investor_password: string;
    group: string;
    server: string;
    created_at: string;
  };
}

export interface MT5Status {
  connected: boolean;
  address?: string;
  login?: number;
  last_error?: string;
}

export interface MT5AccountCredentials {
  login: number;
  masterPassword: string;
  investorPassword: string;
  server: string;
  group: string;
}

class MT5Service {
  /**
   * Get MT5 connection status
   */
  async getStatus(): Promise<MT5Status> {
    return api.mt5Manager.getStatus();
  }

  /**
   * Get all available MT5 groups
   */
  async getGroups(): Promise<MT5Group[]> {
    return api.mt5Manager.getGroups();
  }

  /**
   * Create a new MT5 account
   */
  async createAccount(request: CreateAccountRequest): Promise<CreateAccountResponse> {
    const response = await api.mt5Manager.createAccount(request);
    return response;
  }

  /**
   * Create account in YoFx/Plain group specifically
   */
  async createAccountInYoFxPlain(name: string, email?: string): Promise<CreateAccountResponse> {
    return this.createAccount({
      group: 'YoFx/Plain',
      name,
      email,
      leverage: 100,
    });
  }

  /**
   * Check if MT5 is connected and ready
   */
  async isReady(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return status.connected;
    } catch {
      return false;
    }
  }

  /**
   * Store credentials in localStorage for auto-login
   */
  storeCredentials(credentials: MT5AccountCredentials): void {
    localStorage.setItem('mt5_credentials', JSON.stringify(credentials));
    localStorage.setItem('mt5_auto_login', 'true');
  }

  /**
   * Get stored credentials
   */
  getStoredCredentials(): MT5AccountCredentials | null {
    const stored = localStorage.getItem('mt5_credentials');
    if (stored) {
      return JSON.parse(stored);
    }
    return null;
  }

  /**
   * Clear stored credentials
   */
  clearCredentials(): void {
    localStorage.removeItem('mt5_credentials');
    localStorage.removeItem('mt5_auto_login');
  }

  /**
   * Check if auto-login is enabled
   */
  isAutoLoginEnabled(): boolean {
    return localStorage.getItem('mt5_auto_login') === 'true';
  }
}

export const mt5Service = new MT5Service();
export default mt5Service;
