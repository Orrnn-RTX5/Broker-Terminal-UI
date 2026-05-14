const fs = require('fs');

let content = fs.readFileSync('src/components/LastSymbolPanel.tsx', 'utf8');

const brokenChunk = `            if (diff < 3600) return \`\${Math.floor(diff / 60)}m ago\`;
                {/* Header — draggable */}`;

const fixedChunk = `            if (diff < 3600) return \`\${Math.floor(diff / 60)}m ago\`;
            return \`\${Math.floor(diff / 3600)}h ago\`;
        })()
        : '';

    return (
        <div
            ref={panelRef}
            className="rtx-last-symbol-panel fixed z-[9999] select-none"
            style={{ left: position.x, top: position.y }}
        >
            <div
                className="w-[252px] bg-[#1a1a22] border border-[#2a2e39] rounded-lg shadow-2xl overflow-hidden"
                style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
            >
                {/* Header — draggable */}`;

content = content.replace(brokenChunk, fixedChunk);
fs.writeFileSync('src/components/LastSymbolPanel.tsx', content);
console.log('Fixed LastSymbolPanel.tsx formatting');
