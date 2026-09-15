import fs from 'node:fs';
import postcss from 'postcss';

// Remove only size/weight declarations owned by a light selector. Shared font
// preferences, component styles, material, colors, and font families stay intact.
const files = ['src/styles/enterprise-light.css', 'src/styles/advanced-untitled-light.css', 'src/styles/theme.css'];
for (const file of files) {
  const root = postcss.parse(fs.readFileSync(file, 'utf8'));
  const removed = [];
  root.walkDecls(decl => {
    let parent = decl.parent;
    let light = false;
    while (parent) {
      if (parent.type === 'rule' && /rtx-skin-untitled-light|\.rtx-advanced-view|\.theme-light/.test(parent.selector)) light = true;
      parent = parent.parent;
    }
    if (!light) return;
    if (/^(font-size|font-weight)$/.test(decl.prop)
      || /^--rtx-advanced-(primary|dense|header)-font-size$/.test(decl.prop)
      || /^--rtx-light-font-.*(size|weight)$/.test(decl.prop)) {
      removed.push({line:decl.source.start.line, property:decl.prop, value:decl.value});
      decl.remove();
    }
  });
  root.walkRules(rule => { if (rule.nodes.length === 0) rule.remove(); });
  fs.writeFileSync(file, root.toString());
  console.log(file, removed.length);
  fs.writeFileSync(`artifacts/theme-typography-parity-20260915/${file.split('/').at(-1)}-removed.json`,JSON.stringify(removed,null,2));
}
