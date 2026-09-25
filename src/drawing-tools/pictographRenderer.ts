import type { Drawing } from '../services/drawingManager';
import { getPictographStamp, getResolvedPictographDataUrl, resolvePictographDataUrl } from './pictographCatalog';

const SVG_NS = 'http://www.w3.org/2000/svg';

type PictographRenderOptions = {
  preview: boolean;
  onPointerDown: (event: PointerEvent) => void;
};

/** Keep the asset in screen pixels while its center follows the saved time/price. */
export function renderPictographStamp(
  parent: SVGGElement,
  drawing: Pick<Drawing, 'type' | 'subtype' | 'selected' | 'locked'>,
  anchor: { x: number; y: number },
  { preview, onPointerDown }: PictographRenderOptions,
): boolean {
  if (drawing.type !== 'stamp') return false;
  const stamp = getPictographStamp(drawing.subtype);
  if (!stamp || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return false;

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('data-geometry-role', 'pictograph-stamp');
  group.setAttribute('data-pictograph-id', stamp.id);
  group.setAttribute('transform', `translate(${anchor.x - stamp.size / 2}, ${anchor.y - stamp.size / 2})`);
  group.setAttribute('opacity', preview ? '0.65' : '1');
  group.setAttribute('pointer-events', preview ? 'none' : 'auto');

  const asset = document.createElementNS(SVG_NS, 'image');
  asset.setAttribute('data-geometry-role', 'pictograph-image');
  // Only the fixed catalogue can supply an asset. Saved drawing text/URLs are
  // never interpreted as an image source or inserted as markup.
  // The on-screen overlay can load the catalogue URL directly, but exports
  // rasterize this SVG in a context that cannot fetch, so prefer the inlined
  // data URI and swap it in as soon as the artwork resolves.
  const resolvedDataUrl = getResolvedPictographDataUrl(stamp);
  asset.setAttribute('href', resolvedDataUrl ?? stamp.assetUrl);
  if (resolvedDataUrl === undefined) {
    void resolvePictographDataUrl(stamp).then((dataUrl) => {
      if (asset.isConnected) asset.setAttribute('href', dataUrl);
    }).catch(() => undefined);
  }
  asset.setAttribute('width', String(stamp.size));
  asset.setAttribute('height', String(stamp.size));
  asset.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  asset.setAttribute('pointer-events', 'none');
  asset.setAttribute('role', 'img');
  asset.setAttribute('aria-label', stamp.glyph);
  group.appendChild(asset);

  if (drawing.selected && !preview) {
    // A pale halo keeps the blue selection edge readable on both chart themes.
    for (const [stroke, width] of [['#ffffff', '3'], ['#2962ff', '1.5']]) {
      const outline = document.createElementNS(SVG_NS, 'rect');
      outline.setAttribute('data-geometry-role', 'pictograph-selection');
      outline.setAttribute('x', '-4');
      outline.setAttribute('y', '-4');
      outline.setAttribute('width', String(stamp.size + 8));
      outline.setAttribute('height', String(stamp.size + 8));
      outline.setAttribute('rx', '6');
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', stroke);
      outline.setAttribute('stroke-width', width);
      outline.setAttribute('pointer-events', 'none');
      group.appendChild(outline);
    }
  }

  if (!preview) {
    const hit = document.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('data-geometry-role', 'pictograph-hit-target');
    hit.setAttribute('x', '-4');
    hit.setAttribute('y', '-4');
    hit.setAttribute('width', String(stamp.size + 8));
    hit.setAttribute('height', String(stamp.size + 8));
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('pointer-events', 'all');
    hit.style.cursor = drawing.locked ? 'default' : 'move';
    hit.addEventListener('pointerdown', onPointerDown);
    group.appendChild(hit);
  }

  parent.appendChild(group);
  return true;
}
