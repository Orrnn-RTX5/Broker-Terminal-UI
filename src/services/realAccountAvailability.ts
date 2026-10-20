/**
 * Real-account creation availability, driven entirely by broker configuration.
 *
 * This build's self-registration endpoint provisions demo accounts only; a
 * broker supports terminal-driven real-account creation if and only if its
 * directory/config entry advertises a real-account onboarding contract (a
 * broker-operated onboarding/registration URL). Nothing here names a broker,
 * group, account, symbol, or business threshold — support turns on per broker
 * through configuration, never through code.
 *
 * The broker entry is accepted as `unknown` and narrowed internally so both
 * directory rows and normalized broker records can be checked without
 * tenant-specific typings.
 */

export interface RealAccountAvailability {
    /** True when the broker config advertises a real-account onboarding contract. */
    supported: boolean;
    /** Broker-operated onboarding URL when advertised, otherwise null. */
    onboardingUrl: string | null;
    /** Generic, non-tenant-specific reason shown when unsupported. */
    reason: string;
}

// Generic broker-config keys (snake_case and camelCase, per repo convention)
// that advertise a broker-operated real-account onboarding contract.
const ONBOARDING_URL_KEYS = [
    'real_account_url',
    'realAccountUrl',
    'live_account_url',
    'liveAccountUrl',
    'real_account_onboarding_url',
    'realAccountOnboardingUrl',
    'onboarding_url',
    'onboardingUrl',
    'registration_url',
    'registrationUrl',
    'signup_url',
    'signupUrl',
    'sign_up_url',
    'signUpUrl',
    'kyc_url',
    'kycUrl',
    'verification_url',
    'verificationUrl',
] as const;

// Generic broker-config opt-out flags. A present falsy value disables
// terminal-driven real-account creation for that broker entry.
const OPTOUT_FLAG_KEYS = [
    'real_account_enabled',
    'realAccountEnabled',
    'real_accounts_enabled',
    'realAccountsEnabled',
    'supports_real_accounts',
    'supportsRealAccounts',
    'live_account_enabled',
    'liveAccountEnabled',
] as const;

export const REAL_ACCOUNT_UNAVAILABLE_REASON =
    'Real-account creation is not enabled for this broker configuration. ' +
    'Complete identity verification through the broker onboarding channel instead.';

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
);

const readUnknown = (broker: unknown, key: string): unknown =>
    asRecord(broker)?.[key];

const readOnboardingUrl = (broker: unknown): string | null => {
    if (!broker) return null;
    for (const key of ONBOARDING_URL_KEYS) {
        const raw = readUnknown(broker, key);
        if (typeof raw !== 'string' || !raw.trim()) continue;
        const value = raw.trim();
        try {
            const parsed = new URL(value);
            if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) {
                return value;
            }
        } catch {
            // Not a usable URL — keep scanning the remaining keys.
        }
    }
    return null;
};

const hasExplicitOptOut = (broker: unknown): boolean => {
    const record = asRecord(broker);
    if (!record) return false;
    return OPTOUT_FLAG_KEYS.some(key => {
        if (!(key in record)) return false;
        const value = record[key];
        return value === false || value === 0 || value === '0' || value === 'false' || value === 'no' || value === 'off';
    });
};

/**
 * Resolves whether the given broker configuration entry supports
 * terminal-driven real-account creation through the existing
 * account-creation wiring. Never closes over tenant literals.
 */
export const resolveRealAccountAvailability = (
    broker: unknown,
): RealAccountAvailability => {
    if (hasExplicitOptOut(broker)) {
        return { supported: false, onboardingUrl: null, reason: REAL_ACCOUNT_UNAVAILABLE_REASON };
    }
    const onboardingUrl = readOnboardingUrl(broker);
    if (!onboardingUrl) {
        return { supported: false, onboardingUrl: null, reason: REAL_ACCOUNT_UNAVAILABLE_REASON };
    }
    return { supported: true, onboardingUrl, reason: '' };
};
