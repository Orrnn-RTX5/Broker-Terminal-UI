const fs = require('fs');
let content = fs.readFileSync('src/components/ConnectionStatus.tsx', 'utf8');

content = content.replace(
    'className="absolute bottom-full right-0 mb-1 w-64 bg-[#1e222d] border border-[#3a3e4a] rounded shadow-2xl z-[100] text-[11px] text-zinc-200 overflow-hidden"',
    'className="rtx-connection-dropdown absolute bottom-full right-0 mb-1 w-64 bg-[#1e222d] border border-[#3a3e4a] rounded shadow-2xl z-[100] text-[11px] text-zinc-200 overflow-hidden"'
);

fs.writeFileSync('src/components/ConnectionStatus.tsx', content);
console.log('Added rtx-connection-dropdown');
