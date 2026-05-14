const fs = require('fs');

const css = `
/* Update Header Bar to Light Purple Accent */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar {
  background: #F3E5F5 !important;
  color: #101828 !important;
  border-bottom: 1px solid #e9d7fe !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar span,
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar svg {
  color: #101828 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar button {
  color: #101828 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar button:hover {
  background: rgba(0, 0, 0, 0.05) !important;
  color: #101828 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar button[title="Close"]:hover {
  background: #e11d48 !important;
  color: #ffffff !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar button[title="Close"]:hover svg {
  color: #ffffff !important;
}

/* === Last Symbol Panel Advanced Mode === */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel > div {
  background: #ffffff !important;
  border-color: #e5e7eb !important;
  color: #101828 !important;
  box-shadow: var(--shadow-xl) !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .bg-\\[\\#22222d\\] {
  background: #f9fafb !important;
  border-color: #e5e7eb !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .border-\\[\\#2a2e39\\]\\/50,
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .border-\\[\\#2a2e39\\]\\/30,
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .border-\\[\\#2a2e39\\] {
  border-color: #e5e7eb !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .text-blue-400 {
  color: #7E57C2 !important;
  text-shadow: none !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .bg-blue-400 {
  background-color: #7E57C2 !important;
  box-shadow: 0 0 8px rgba(126, 87, 194, 0.3) !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .text-zinc-500,
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .text-zinc-400,
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .text-zinc-600 {
  color: #667085 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .text-zinc-300,
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .text-zinc-200 {
  color: #101828 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel input {
  background: #ffffff !important;
  border-color: #d0d5dd !important;
  color: #101828 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel button.bg-\\[\\#2a2e39\\] {
  background: #ffffff !important;
  border: 1px solid #d0d5dd !important;
  color: #475467 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel button.bg-\\[\\#2a2e39\\]:hover:not(:disabled) {
  background: #f9fafb !important;
}

/* Buy / Sell buttons */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .bg-teal-600\\/20 {
  background: #ecfdf3 !important;
  border-color: #a6f4c5 !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .text-teal-300 {
  color: #027a48 !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .bg-teal-600\\/20 svg {
  color: #027a48 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .bg-red-600\\/20 {
  background: #fef3f2 !important;
  border-color: #fecdd3 !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .text-red-300 {
  color: #b42318 !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .bg-red-600\\/20 svg {
  color: #b42318 !important;
}

/* Lot presets border override */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .border-\\[\\#2a2e39\\] {
  border-color: #d0d5dd !important;
}

/* Settings background */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-last-symbol-panel .bg-\\[\\#16161e\\] {
  background: #fcfcfd !important;
}
`;

fs.appendFileSync('src/styles/advanced-untitled-light.css', css);
console.log('Appended Header Light Purple and LastSymbolPanel CSS');
