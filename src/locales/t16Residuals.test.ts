import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { supportedLanguages } from '../config/supportedLanguages';
import englishUi from './en/ui.json';

/**
 * T16 residuals: pins the resolved strings behind tr()/translateUi()/
 * feedbackLabel() calls whose arguments are NOT string literals, so the
 * catalog scanner in catalogs.test.ts cannot see them. Every key below must
 * exist in en/ui.json and in all 18 other locale catalogs (English values are
 * intentional placeholders pending a translator pass — see the
 * locale-fallback policy comment in src/i18n.ts).
 */
const DYNAMICALLY_RESOLVED_KEYS = [
    // OpenAccountDialog.tsx — tr(directoryError): only ever set to this string.
    'Broker servers are unavailable. Please try again.',
    // OpenAccountDialog.tsx — tr(realAccountAvailability.reason) and the
    // validationError assignments that reuse it.
    'Real-account creation is not enabled for this broker configuration. Complete identity verification through the broker onboarding channel instead.',
    // OpenAccountDialog.tsx — tr(validationError) / tr(createError) static subset.
    'Please select a broker server.',
    'Authentication failed',
    'First name and last name are required.',
    'Enter a valid email address.',
    'Select a country from the list.',
    'Select a valid leverage.',
    'Accept the terms and data protection policy to continue.',
    'Failed to create real account',
    'Failed to create demo account',
    // OpenAccountDialog.tsx — tr(label) over the details field table.
    'First name',
    'Last name',
    'Email',
    'Mobile phone',
    // OpenAccountDialog.tsx — tr(row.label) over the success summary rows.
    'Login (Account)',
    'Master Password',
    'Investor Password',
    'API Key',
    'Broker / Server',
    'Group',
    'Balance',
    'Leverage',
    // OpenAccountDialog.tsx — tr(header.title) / tr(header.title|header.sub).
    'Open an Account',
    'Select a broker to get started',
    'Open an account',
    'Trade real or virtual money and gain experience',
    'Real Account Application',
    'Complete identity verification with your broker',
    'Real Account Details',
    'Demo Account Details',
    'Enter the account holder information',
    'Real Account Settings',
    'Demo Account Settings',
    'Configure currency and leverage for your new account',
    'Registration Successful',
    'Your new account details',
    // OpenAccountDialog.tsx — tr(label) over desktopSteps.
    'Broker',
    'Account type',
    'Details',
    'Settings',
    'Verification',
    // OpenAccountDialog.tsx — tr(actionLabel === 'Next >' ? 'Next' : actionLabel).
    'Connecting...',
    'Creating...',
    'Connect',
    'Back to account types',
    'Next',
    'Create Real Account',
    'Create Demo Account',
    'Finish',
    // useTerminalCommandEvents.ts — translateUi(unavailableDockSections[...])
    // reachable only for the Experts/Scripts tab mapping.
    'Experts is currently unavailable.',
    'Code Base is currently unavailable.',
    // MenuBar.tsx — tr(item.unavailableReason) reachable raw reasons.
    'Calendar is currently unavailable.',
    'This Help resource is currently unavailable.',
    'Updates are available in the installed desktop app',
    'Minimize a floating window before arranging icons',
    'Documentation is not configured for this deployment',
    // MenuBar.tsx — tr(item.label) reachable raw labels without a literal
    // tr() site of their own.
    'Appearance & Themes...',
    'Auto (fit window)',
    // MenuBar.tsx — tr(menuKey) over DESKTOP_MENU_KEYS.
    'File',
    'View',
    'Insert',
    'Charts',
    'Tools',
    'Window',
    'Help',
    // TopToolbar.tsx — tr(flag ? "On" : "Off") ternaries.
    'On',
    'Off',
    // App.tsx — feedbackLabel(reverseSide === 'buy' ? ... : ...) ternaries and
    // feedbackLabel(reverseSide.toUpperCase()) / feedbackLabel(position.side).
    'Buy Market',
    'Sell Market',
    'BUY',
    'SELL',
    // App.tsx item 1 — converted from a raw publishOrderFeedback string.
    'No trading account is selected. Please sign in again.',
] as const;

const catalogs = import.meta.glob('./*/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>;

describe('T16 residual dynamic catalog keys', () => {
    it('registers every dynamically resolved string in the English source catalog', () => {
        const catalog = englishUi as Record<string, string>;
        for (const key of DYNAMICALLY_RESOLVED_KEYS) {
            expect(typeof catalog[key], `en/ui: ${key}`).toBe('string');
            expect(catalog[key]?.trim(), `en/ui: ${key}`).not.toBe('');
        }
    });

    it.each(supportedLanguages)('$code carries every dynamically resolved string (English fallback allowed)', ({ code }) => {
        const resource = catalogs[`./${code}/ui.json`] as Record<string, string>;
        expect(resource, `${code}/ui exists`).toBeDefined();
        for (const key of DYNAMICALLY_RESOLVED_KEYS) {
            const label = `${code}/ui: ${key}`;
            expect(typeof resource[key], label).toBe('string');
            expect(resource[key]?.trim(), label).not.toBe('');
        }
    });

    it('keeps the App.tsx no-account message inside the translated feedbackLabel call', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
        expect(source).toContain(`feedbackLabel('No trading account is selected. Please sign in again.')`);
        expect(source).not.toContain(`publishOrderFeedback('No trading account is selected`);
        // The close-position variant must split the sentence into a label so
        // it translates; the em-dash separator stays an untranslated value.
        expect(source).not.toContain(`feedbackValue(' — No trading account is selected`);
    });
});
