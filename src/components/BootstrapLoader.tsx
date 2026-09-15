import { useAppStore } from '../store/useAppStore';

export function BootstrapLoader() {
  const isBootstrapping = useAppStore((state) => state.isBootstrapping);
  const bootstrapStep = useAppStore((state) => state.bootstrapStep);

  if (!isBootstrapping) return null;

  return (
    <div className="rtx-bootstrap-loader" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#ffffff',
      fontFamily: 'var(--font-sans)',
    }}>
      <svg
        viewBox="0 0 100 50"
        style={{ width: 100, height: 50, marginBottom: 24 }}
      >
        <path
          d="M 50 25 C 65 5, 95 5, 95 25 C 95 45, 65 45, 50 25 C 35 5, 5 5, 5 25 C 5 45, 35 45, 50 25 Z"
          fill="none"
          stroke="#F3E5F5"
          strokeWidth={6}
          strokeLinecap="round"
        />
        <path
          d="M 50 25 C 65 5, 95 5, 95 25 C 95 45, 65 45, 50 25 C 35 5, 5 5, 5 25 C 5 45, 35 45, 50 25 Z"
          fill="none"
          stroke="#7E57C2"
          strokeWidth={6}
          strokeLinecap="round"
          style={{
            strokeDasharray: 200,
            strokeDashoffset: 200,
            animation: 'rtxBootstrapTrace 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite',
          }}
        />
      </svg>

      <div style={{
        fontSize: 24,
        fontWeight: 600,
        lineHeight: '32px',
        color: '#101828',
        letterSpacing: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        RTX<span style={{ color: '#7E57C2' }}>5</span>
      </div>

      <div style={{
        marginTop: 16,
        fontSize: 14,
        fontWeight: 400,
        lineHeight: '20px',
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 2,
        animation: 'rtxBootstrapPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }}>
        {bootstrapStep || 'Initializing...'}
      </div>

      <style>{`
        @keyframes rtxBootstrapTrace {
          0%   { stroke-dashoffset: 200; }
          100% { stroke-dashoffset: -200; }
        }
        @keyframes rtxBootstrapPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
