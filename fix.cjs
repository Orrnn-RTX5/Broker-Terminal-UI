const fs = require('fs');

let content = fs.readFileSync('src/components/ModifyPositionDialog.tsx', 'utf8');

// Fix the swallowed formatBigPrice function
const brokenChunk = `                {/* Current price labels */}
                <rect x={w - pad - 55} y={askY - 8} width={55} height={16} rx={2} fill="var(--chart-ask, #ef4444)" />
                <text x={w - pad - 52} y={askY + 4} fill="white" fontSize="9" fontWeight="bold" fontFamily="monospace">{ask.toFixed(digits)}</text>
                <rect x={w - pad - 55} y={bidY - 8} width={55} height={16} rx={2} fill="var(--chart-bid, #8a8a8f)" />
                <text x={w - pad - 52} y={bidY + 4} fill="white" fontSize="9" fontWeight="bold" fontFamily="monospace">{bid.toFixed(digits)}</text>
        const str = price.toFixed(digits);`;

const fixedChunk = `                {/* Current price labels */}
                <rect x={w - pad - 55} y={askY - 8} width={55} height={16} rx={2} fill="var(--chart-ask, #ef4444)" />
                <text x={w - pad - 52} y={askY + 4} fill="white" fontSize="9" fontWeight="bold" fontFamily="monospace">{ask.toFixed(digits)}</text>
                <rect x={w - pad - 55} y={bidY - 8} width={55} height={16} rx={2} fill="var(--chart-bid, #8a8a8f)" />
                <text x={w - pad - 52} y={bidY + 4} fill="white" fontSize="9" fontWeight="bold" fontFamily="monospace">{bid.toFixed(digits)}</text>
                {/* Symbol label */}
                <text x={pad + 4} y={16} fill="var(--chart-text-bold, #888)" fontSize="10" fontWeight="bold">{position.symbol}</text>
                <text x={pad + 4} y={28} fill="var(--chart-text-muted, #666)" fontSize="8">{bid.toFixed(digits)} / {ask.toFixed(digits)}</text>
            </svg>
        );
    };

    // Format the big price with last digit enlarged
    const formatBigPrice = (price: number, color: string) => {
        const str = price.toFixed(digits);`;

if (content.includes(brokenChunk)) {
    content = content.replace(brokenChunk, fixedChunk);
    fs.writeFileSync('src/components/ModifyPositionDialog.tsx', content);
    console.log('Fixed broken chunk in ModifyPositionDialog.tsx');
} else {
    console.log('Could not find broken chunk!');
}
