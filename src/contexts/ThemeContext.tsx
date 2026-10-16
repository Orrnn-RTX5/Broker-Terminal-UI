import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type ThemeMode = 'dark' | 'light' | 'custom';

interface ThemeContextType {
    theme: ThemeMode;
    accentColor: string;
    setTheme: (theme: ThemeMode) => void;
    setAccentColor: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'rtx5-theme';
const ACCENT_STORAGE_KEY = 'rtx5-accent-color';

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [theme, setThemeState] = useState<ThemeMode>(() => {
        if (typeof window === 'undefined') return 'dark';
        const isAdvancedLight = localStorage.getItem('rtx5-advanced-view-enabled') === 'true';
        if (isAdvancedLight) return 'light';
        const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode;
        return saved || 'dark';
    });

    const [accentColor, setAccentColorState] = useState(() => {
        return (typeof window !== 'undefined' ? localStorage.getItem(ACCENT_STORAGE_KEY) : null) || '#2196F3';
    });

    // Apply theme class to document root
    useEffect(() => {
        const root = document.documentElement;

        // Remove all theme classes
        root.classList.remove('theme-dark', 'theme-light', 'theme-custom');

        // Add current theme class
        root.classList.add(`theme-${theme}`);
        root.setAttribute('data-theme', theme);

        if (theme === 'light') {
            root.classList.add('rtx-advanced-view', 'rtx-skin-untitled-light');
            localStorage.setItem('rtx5-advanced-view-enabled', 'true');
        } else if (theme === 'dark') {
            root.classList.remove('rtx-advanced-view', 'rtx-skin-untitled-light');
            localStorage.setItem('rtx5-advanced-view-enabled', 'false');
        }

        // If custom theme, set the accent color CSS variable
        if (theme === 'custom') {
            root.style.setProperty('--color-primary', accentColor);
            root.style.setProperty('--color-primary-dim', `${accentColor}40`);
            root.style.setProperty('--color-primary-dimmer', `${accentColor}20`);
        } else if (root.getAttribute('data-rtx-theme-configured') !== 'true') {
            // Reset to default primary color
            root.style.removeProperty('--color-primary');
            root.style.removeProperty('--color-primary-dim');
            root.style.removeProperty('--color-primary-dimmer');
        }

        // Persist to localStorage
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    }, [theme, accentColor]);

    const setTheme = (newTheme: ThemeMode) => {
        setThemeState(newTheme);
    };

    const setAccentColor = (color: string) => {
        setAccentColorState(color);
        localStorage.setItem(ACCENT_STORAGE_KEY, color);
    };

    return (
        <ThemeContext.Provider value={{ theme, accentColor, setTheme, setAccentColor }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = (): ThemeContextType => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
