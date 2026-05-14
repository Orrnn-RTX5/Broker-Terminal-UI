const fs = require('fs');

const css = `
/* === Modify Position Dialog Advanced Mode === */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog {
  background: #ffffff !important;
  border-color: #e5e7eb !important;
  color: #101828 !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .bg-\\[\\#2d2d2d\\] {
  background: #f9fafb !important;
  border-color: #e5e7eb !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .text-zinc-200 {
  color: #101828 !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .bg-\\[\\#151515\\] {
  background: #fcfcfd !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .bg-\\[\\#2a2a2a\\] {
  background: #ffffff !important;
  border-color: #d0d5dd !important;
  color: #101828 !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog input.bg-\\[\\#2a2a2a\\]:focus {
  border-color: #7E57C2 !important;
  box-shadow: 0 0 0 2px #F3E5F5 !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .text-zinc-500 {
  color: #475467 !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .border-zinc-700,
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .border-zinc-600 {
  border-color: #e5e7eb !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .border-t.border-zinc-700 {
  border-color: #e5e7eb !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .border-r.border-zinc-700 {
  border-color: #e5e7eb !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .border-b.border-zinc-700 {
  border-color: #e5e7eb !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog button.bg-zinc-700 {
  background: #7E57C2 !important;
  color: #ffffff !important;
}
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog button.bg-zinc-700:hover {
  background: #6e4db1 !important;
}

/* Fix Big Price colors */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog .text-zinc-100 {
  color: #101828 !important;
}

/* SVG Chart specific variables */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-modify-dialog {
  --chart-grid: #e5e7eb;
  --chart-axis: #98a2b3;
  --chart-ask: #f04438;
  --chart-bid: #2e90fa;
  --chart-text-bold: #101828;
  --chart-text-muted: #475467;
}
`;

fs.appendFileSync('src/styles/advanced-untitled-light.css', css);
console.log('Appended Modify Dialog CSS');
