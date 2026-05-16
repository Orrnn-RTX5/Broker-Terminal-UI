const fs = require('fs');

const css = `
/* === Connection Status Dropdown Advanced Mode === */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown {
  background: #ffffff !important;
  border-color: #d0d5dd !important;
  color: #101828 !important;
  box-shadow: var(--shadow-xl) !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown .border-\\[\\#3a3e4a\\] {
  border-color: #f2f4f7 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown .bg-\\[\\#161921\\] {
  background: #f9fafb !important;
  border-top: 1px solid #f2f4f7 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown button:hover,
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown .hover\\:bg-\\[\\#2a3040\\]:hover {
  background: #f9fafb !important;
}

/* Icons and Text Colors inside Dropdown */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown .text-zinc-200 {
  color: #101828 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown .text-zinc-400,
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown .text-zinc-500 {
  color: #667085 !important;
}

/* Primary Purple instead of blue */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown .text-blue-400 {
  color: #7E57C2 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown .text-cyan-400 {
  color: #027a48 !important; /* Greenish/Teal for network rescan to fit light mode */
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown .text-yellow-400 {
  color: #b54708 !important; /* Darker yellow/orange for readability on white */
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown .text-green-400 {
  color: #027a48 !important; /* Darker green */
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown button.hover\\:bg-\\[\\#2962FF\\]:hover {
  background: #f4ebff !important; /* Light purple hover */
  color: #7E57C2 !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-connection-dropdown button.hover\\:bg-\\[\\#2962FF\\]:hover svg {
  color: #7E57C2 !important;
}
`;

fs.appendFileSync('src/styles/advanced-untitled-light.css', css);
console.log('Appended Connection Status Dropdown CSS');
