const fs = require('fs');

let content = fs.readFileSync('src/components/layout/TopToolbar.tsx', 'utf8');

// 1. Replace Group 9
const group9Regex = /\{\/\*\s*Group 9: Drawing Tools\s*—\s*BASIC MODE HIDDEN, ADVANCED MODE ONLY\s*\*\/\}\r?\n\s*\{\/\*\s*Drawing tools are accessible in Advanced Mode via the Draw dropdown in the navbar\.\s*\*\/\}/;

const group9Replacement = `{/* Group 9: Stamps Tool */}
            <MT5Group>
                <StampsPopover dispatchCommand={dispatchCommand} dispatchToolbar={dispatchToolbar} />
            </MT5Group>`;

if (group9Regex.test(content)) {
    content = content.replace(group9Regex, group9Replacement);
    console.log("Successfully replaced Group 9 placeholder.");
} else {
    console.log("Warning: Group 9 placeholder not found.");
}

// 2. Append StampsPopover
const stampsPopoverComponent = `

// ─── Stamps Popover ──────────────────────────────────────────────────────────
const STAMP_OPTIONS = [
    { subtype: 'thumbsUp',       label: 'Thumbs Up',         emoji: '👍' },
    { subtype: 'thumbsDown',     label: 'Thumbs Down',       emoji: '👎' },
    { subtype: 'arrowUp',        label: 'Arrow Up',          emoji: '↑'  },
    { subtype: 'arrowDown',      label: 'Arrow Down',        emoji: '↓'  },
    { subtype: 'stopSign',       label: 'Stop Sign',         emoji: '🛑' },
    { subtype: 'checkSign',      label: 'Check Sign',        emoji: '✅' },
    { subtype: 'buy',            label: 'Buy (▲)',           emoji: '▲'  },
    { subtype: 'sell',           label: 'Sell (▼)',          emoji: '▼'  },
    { subtype: 'leftPriceLabel', label: 'Left Price Label',  emoji: '⬤' },
    { subtype: 'rightPriceLabel',label: 'Right Price Label', emoji: '⬤' },
];

const StampsPopover: React.FC<{
    dispatchCommand: (cmd: any) => void;
    dispatchToolbar: (action: any) => void;
}> = ({ dispatchCommand, dispatchToolbar }) => {
    const [open, setOpen] = useState(false);
    const [lastSubtype, setLastSubtype] = useState('thumbsUp');
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const selectStamp = (subtype: string) => {
        setLastSubtype(subtype);
        setOpen(false);
        dispatchToolbar({ type: 'SELECT_TOOL', tool: 'stamp' as any });
        dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'stamp', subtype } } as any);
    };

    const opt = STAMP_OPTIONS.find(o => o.subtype === lastSubtype) || STAMP_OPTIONS[0];

    return (
        <div ref={ref} className="relative flex items-center">
            {/* Main button — re-selects last used subtype */}
            <button
                className="flex items-center gap-1 px-1.5 py-1 rounded text-xs text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
                title={\`Stamp: \${opt.label}\`}
                onClick={() => selectStamp(lastSubtype)}
            >
                <span className="text-base leading-none">{opt.emoji}</span>
                <span className="hidden sm:inline text-[10px] font-medium">Stamp</span>
            </button>
            {/* Chevron — opens popover */}
            <button
                className="px-0.5 py-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                title="Choose stamp type"
                onClick={() => setOpen(o => !o)}
            >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                </svg>
            </button>

            {open && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-[#131316] border border-zinc-800 rounded shadow-2xl z-[200] py-1 animate-in fade-in slide-in-from-top-1 duration-100">
                    {STAMP_OPTIONS.map(o => (
                        <button
                            key={o.subtype}
                            className={\`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-zinc-800 \${o.subtype === lastSubtype ? 'text-white bg-zinc-800/60' : 'text-zinc-300'}\`}
                            onClick={() => selectStamp(o.subtype)}
                        >
                            <span className="text-base w-5 text-center">{o.emoji}</span>
                            <span>{o.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
`;

content = content.replace('const MT5Divider = () => (', stampsPopoverComponent + '\nconst MT5Divider = () => (');

fs.writeFileSync('src/components/layout/TopToolbar.tsx', content, 'utf8');
console.log("Successfully patched TopToolbar.tsx with Node.js script.");
