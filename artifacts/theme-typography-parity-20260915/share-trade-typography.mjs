import fs from 'node:fs';
import postcss from 'postcss';

const file = 'src/index.css';
const root = postcss.parse(fs.readFileSync(file, 'utf8'));
const rules = [];
root.walkRules(rule => {
  if (rule.selector.includes('html:not(.rtx-skin-untitled-light)')
    && rule.nodes.some(node => node.type === 'decl' && /^(font-size|font-weight)$/.test(node.prop))) rules.push(rule);
});
for (const rule of rules) {
  const shared = postcss.rule({selector:rule.selector.replaceAll('html:not(.rtx-skin-untitled-light)', 'html')});
  for (const node of [...rule.nodes]) {
    if (node.type !== 'decl' || !/^(font-size|font-weight)$/.test(node.prop)) continue;
    shared.append(node.clone());
    node.remove();
  }
  rule.before(shared);
}
fs.writeFileSync(file,root.toString());
console.log(`Shared typography from ${rules.length} trade rules without changing their values.`);
