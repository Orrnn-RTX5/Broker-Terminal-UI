const fs = require('fs');

const css = `
/* === Hide MT5 Toolbar Dividers in Advanced Mode (they render as | on light background) === */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-main-toolbar > div > div.mx-\\[4px\\] {
  display: none !important;
}

/* Target the divider by its exact class combination */
html.rtx-advanced-view.rtx-skin-untitled-light div.mx-\\[4px\\].w-\\[2px\\].h-6 {
  display: none !important;
}

/* Broader selector for the toolbar divider element */
html.rtx-advanced-view.rtx-skin-untitled-light .bg-\\[\\#1a1c23\\].border-l {
  display: none !important;
}
`;

fs.appendFileSync('src/styles/advanced-untitled-light.css', css);
console.log('Appended divider hide CSS');
