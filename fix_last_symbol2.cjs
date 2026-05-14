const fs = require('fs');

let content = fs.readFileSync('src/components/LastSymbolPanel.tsx', 'utf8');

// The lines we need to replace are currently:
//             if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
//                 {/* Header — draggable */}
//
// We need to insert the missing code between them.

const missingCode = `
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
`;

// Find the line index
const lines = content.split('\n');
const insertIndex = lines.findIndex(line => line.includes('{/* Header — draggable */}'));

if (insertIndex !== -1) {
    // Insert the missing code right before the header line
    lines.splice(insertIndex, 0, missingCode);
    fs.writeFileSync('src/components/LastSymbolPanel.tsx', lines.join('\n'));
    console.log('Successfully inserted missing JSX wrapper.');
} else {
    console.log('Could not find insert point!');
}
