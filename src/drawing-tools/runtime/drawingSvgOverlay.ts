/** Create or repair the SVG host used by one mounted chart context. */
export function ensureDrawingSvgOverlay(
  container: HTMLElement,
  current: SVGSVGElement | null,
): SVGSVGElement {
  let overlay = current;
  if (overlay && overlay.parentElement !== container) {
    overlay.remove();
    overlay = null;
  }

  if (!overlay) {
    overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'chart-svg-overlay');
    // The SVG attribute lets interactive children override the root setting.
    overlay.setAttribute('pointer-events', 'none');
    overlay.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'overflow:visible',
      'z-index:10',
    ].join(';');
    container.appendChild(overlay);
    console.log('[DrawingManager] SVG overlay created in', container.className || container.tagName);
  }

  return overlay;
}
