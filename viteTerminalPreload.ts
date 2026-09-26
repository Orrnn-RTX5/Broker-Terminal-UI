import type { Plugin } from 'vite'
import type { OutputBundle, OutputChunk } from 'rollup'

type ChunkWithStyles = OutputChunk & { viteMetadata?: { importedCss?: Set<string> } }

/** Follow static imports only; unopened dialogs must retain their lazy boundary. */
export const terminalPreloadAssets = (bundle: OutputBundle, base = '/'): Array<{ href: string; style: boolean }> => {
  const visited = new Set<string>()
  const scripts = new Set<string>()
  const styles = new Set<string>()
  const visit = (filename: string) => {
    if (visited.has(filename)) return
    visited.add(filename)
    const chunk = bundle[filename] as ChunkWithStyles | undefined
    if (chunk?.type !== 'chunk') return
    scripts.add(filename)
    for (const css of chunk.viteMetadata?.importedCss || []) styles.add(css)
    chunk.imports.forEach(visit)
  }
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') {
      // Vite removes the empty JS entry for a module that only imports CSS.
      // The terminal's global stylesheet therefore has no chunk to visit.
      if (/(?:^|\/)authenticatedStyles(?:-[^/]*)?\.css$/.test(chunk.fileName)) styles.add(chunk.fileName)
      continue
    }
    // Shared exports can make Rollup omit the facade even for a dynamic entry.
    const sources = [chunk.facadeModuleId || '', ...Object.keys(chunk.modules || {})]
    if (sources.some(source => /\/src\/(App|authenticatedStyles|components\/TradingChart)\.tsx?$/.test(source.replaceAll('\\', '/')))) visit(chunk.fileName)
  }
  return [
    ...Array.from(scripts, file => ({ href: base + file, style: false })),
    ...Array.from(styles, file => ({ href: base + file, style: true })),
  ]
}

/** Discover first-viewport chunks during HTML parsing, before React mounts. */
export const terminalPreloadPlugin = (): Plugin => {
  let base = '/'
  return {
    name: 'rtx5-terminal-preload',
    apply: 'build',
    configResolved(config) { base = config.base },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!context.bundle) return html
        const assets = terminalPreloadAssets(context.bundle, base)
        if (assets.length === 0) return html
        return {
          html,
          tags: [{
            tag: 'script', injectTo: 'head',
            // Preloading fetches code without mounting the authenticated app.
            // A desktop login keeps its existing lightweight entry path.
            children: `(function(){if(document.documentElement.getAttribute('data-rtx-initial-view')!=='terminal')return;${JSON.stringify(assets).replaceAll('<', '\\u003c')}.forEach(function(asset){var link=document.createElement('link');link.rel=asset.style?'preload':'modulepreload';if(asset.style)link.as='style';link.crossOrigin='';link.href=asset.href;document.head.appendChild(link);});})();`,
          }],
        }
      },
    },
  }
}
