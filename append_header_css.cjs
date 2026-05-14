const fs = require('fs');

const css = `
/* === Header Bar Advanced Mode (Purple Accent) === */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar {
  background: #7E57C2 !important;
  color: #ffffff !important;
  border-bottom: 1px solid #6e4db1 !important;
  backdrop-filter: none !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar span,
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar svg {
  color: #ffffff !important;
}

/* Ensure window control buttons look good */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar button {
  color: #ffffff !important;
}

html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar button:hover {
  background: rgba(255, 255, 255, 0.2) !important;
  color: #ffffff !important;
  box-shadow: none !important;
}

/* Specific hover for the Close window button */
html.rtx-advanced-view.rtx-skin-untitled-light .rtx-header-bar button[title="Close"]:hover {
  background: #e11d48 !important; /* Tailwind rose-600 */
}
`;

fs.appendFileSync('src/styles/advanced-untitled-light.css', css);
console.log('Appended Header Bar Purple Accent CSS for Advanced Mode');
