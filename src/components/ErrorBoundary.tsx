import { translateUi as tr } from '../hooks/useUiTranslation';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
    label?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // Log clearly so we can see what crashed
        console.error(`[ErrorBoundary:${this.props.label || 'unknown'}] CRASH:`, error.message, '\n', error.stack, '\n', errorInfo.componentStack);
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }
            // Show a minimal error indicator in the panel
            return (
                <div style={{ padding: 8, color: '#f87171', fontSize: 11, fontFamily: 'monospace', background: '#1a0000' }}>
                    ⚠ {this.props.label || 'Component'} {tr(" error: ")}{this.state.error?.message}
                    <br />
                    <button
                        style={{ marginTop: 4, padding: '2px 8px', background: '#333', color: '#ccc', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                        onClick={() => this.setState({ hasError: false, error: null })}
                    >
                        {tr("Retry")}</button>
                </div>
            );
        }

        return this.props.children;
    }
}
