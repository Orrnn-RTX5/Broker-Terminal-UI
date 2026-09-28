import {
  annotationLines,
  annotationTable,
  isAnnotationImage,
  isAnnotationLink,
} from '../annotationToolCatalog';
import type { Drawing, DrawingPoint } from '../model/drawing';
import { renderPictographStamp } from '../pictographRenderer';
import { STAMP_GLYPHS } from './stampGlyphCatalog';

type ScreenPoint = { x: number; y: number };

export interface DrawingAnnotationRendererOptions {
  projectPoint: (point: DrawingPoint) => ScreenPoint | null;
  formatPrice: (price: number) => string;
  getThemeToken: (name: string, fallback: string) => string;
  createLine: (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
    lineWidth: number,
    dash: string,
  ) => SVGLineElement;
  createText: (
    x: number,
    y: number,
    text: string,
    fill: string,
    size: number,
  ) => SVGTextElement;
  beginDrag: (event: PointerEvent, drawingId: string, nodeIndex: number | null) => void;
  openContextMenu: (event: MouseEvent, drawingId: string) => void;
  editAnnotation: (drawingId: string) => void;
}

/** Renders text, note, callout, image, table, and stamp drawing families. */
export class DrawingAnnotationRenderer {
  constructor(private readonly options: DrawingAnnotationRendererOptions) {}

  render(
    group: SVGGElement,
    drawing: Drawing,
    width: number,
    height: number,
    isPreview: boolean,
    color: string,
    lineWidth: number,
    dash: string,
    opacity: string,
  ): boolean {
    if (drawing.type === 'text') {
      this.renderText(group, drawing, height, isPreview, color, lineWidth, dash);
      return true;
    }
    if (drawing.type === 'callout') {
      this.renderCallout(group, drawing, color);
      return true;
    }
    if (drawing.type === 'stamp') {
      this.renderStamp(group, drawing, width, isPreview, opacity);
      return true;
    }
    return false;
  }

  private renderText(
    group: SVGGElement,
    drawing: Drawing,
    height: number,
    isPreview: boolean,
    color: string,
    lineWidth: number,
    dash: string,
  ): void {
    if (drawing.points.length < 1) return;
    const point = this.options.projectPoint(drawing.points.at(-1)!);
    if (!point) return;

    const appendResizeHandle = (x: number, y: number) => {
      if (!drawing.selected || drawing.locked || isPreview) return;
      const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      handle.setAttribute('x', String(x - 4));
      handle.setAttribute('y', String(y - 4));
      handle.setAttribute('width', '8');
      handle.setAttribute('height', '8');
      handle.setAttribute('fill', '#ffffff');
      handle.setAttribute('stroke', color);
      handle.setAttribute('data-annotation-resize', 'true');
      handle.setAttribute('pointer-events', 'all');
      handle.style.cursor = 'nwse-resize';
      handle.addEventListener('pointerdown', event => {
        this.options.beginDrag(event, drawing.id, -101);
      });
      group.appendChild(handle);
    };

    const isPriceLabel = drawing.subtype === 'price_label';
    const isPrice = drawing.subtype === 'price_note' || isPriceLabel;
    const isPin = drawing.subtype === 'pin';
    const isCallout = drawing.subtype === 'callout';
    const isComment = drawing.subtype === 'comment';
    const isSignpost = drawing.subtype === 'signpost';
    const fontSize = Math.max(
      8,
      Math.min(72, drawing.annotation?.fontSize ?? (isPrice ? 12 : 14)),
    );

    if (
      ['post', 'idea'].includes(drawing.subtype ?? '')
      && isAnnotationLink(drawing.annotation?.url ?? '', drawing.subtype!)
    ) {
      const isIdea = drawing.subtype === 'idea';
      const card = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      card.setAttribute('x', String(point.x));
      card.setAttribute('y', String(point.y));
      card.setAttribute('width', '320');
      card.setAttribute('height', '100');
      card.setAttribute('rx', '10');
      card.setAttribute('fill', this.options.getThemeToken('--bg-secondary', '#202024'));
      card.setAttribute('stroke', color);
      card.setAttribute('pointer-events', isPreview ? 'none' : 'all');
      card.style.cursor = drawing.locked ? 'default' : 'move';
      card.addEventListener('pointerdown', event => {
        this.options.beginDrag(event, drawing.id, null);
      });
      group.appendChild(card);
      const foreground = this.options.getThemeToken('--text-primary', '#eeeeee');
      const title = this.options.createText(
        point.x + 12,
        point.y + 25,
        isIdea ? 'Idea · TradingView' : '𝕏  Post',
        foreground,
        16,
      );
      title.setAttribute('pointer-events', 'none');
      group.appendChild(title);
      const caption = this.options.createText(
        point.x + 12,
        point.y + 49,
        (drawing.text || new URL(drawing.annotation!.url!).pathname).slice(0, 36),
        foreground,
        12,
      );
      caption.setAttribute('pointer-events', 'none');
      group.appendChild(caption);
      const link = document.createElementNS('http://www.w3.org/2000/svg', 'a');
      link.setAttribute('href', drawing.annotation!.url!);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.setAttribute('pointer-events', isPreview ? 'none' : 'all');
      link.addEventListener('pointerdown', event => event.stopPropagation());
      link.appendChild(this.options.createText(
        point.x + 12,
        point.y + 80,
        isIdea ? 'Open idea ↗' : 'Open post ↗',
        color,
        13,
      ));
      group.appendChild(link);
      return;
    }

    if (drawing.subtype === 'image' && isAnnotationImage(drawing.annotation?.imageUrl ?? '')) {
      const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      const imageWidth = Math.max(24, Math.min(1200, drawing.annotation?.width ?? 240));
      const imageHeight = Math.max(24, Math.min(1200, drawing.annotation?.height ?? 160));
      image.setAttribute('href', drawing.annotation!.imageUrl!);
      image.setAttribute('x', String(point.x));
      image.setAttribute('y', String(point.y));
      image.setAttribute('width', String(imageWidth));
      image.setAttribute('height', String(imageHeight));
      image.setAttribute('opacity', String(drawing.annotation?.opacity ?? 1));
      image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      image.setAttribute('pointer-events', isPreview ? 'none' : 'all');
      image.style.cursor = drawing.locked ? 'default' : 'move';
      image.addEventListener('pointerdown', event => {
        this.options.beginDrag(event, drawing.id, null);
      });
      image.setAttribute('data-geometry-role', 'annotation-background');
      group.appendChild(image);
      appendResizeHandle(point.x + imageWidth, point.y + imageHeight);
      return;
    }

    if (drawing.subtype === 'flag') {
      const flag = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      flag.setAttribute('d', `M ${point.x} ${point.y} V ${point.y - 20} H ${point.x + 18} L ${point.x + 14} ${point.y - 15} L ${point.x + 18} ${point.y - 10} H ${point.x} Z`);
      flag.setAttribute('fill', color);
      flag.setAttribute('stroke', color);
      flag.setAttribute('data-geometry-role', 'annotation-background');
      flag.setAttribute('pointer-events', isPreview ? 'none' : 'all');
      flag.style.cursor = drawing.locked ? 'default' : 'move';
      flag.addEventListener('pointerdown', event => {
        this.options.beginDrag(event, drawing.id, null);
      });
      group.appendChild(flag);
      return;
    }

    if (drawing.subtype === 'table') {
      this.renderTable(group, drawing, point, fontSize, isPreview, color, appendResizeHandle);
      return;
    }

    const lines = annotationLines(
      isPrice
        ? [this.options.formatPrice(drawing.points[0].price), drawing.text]
          .filter(Boolean)
          .join('\n')
        : drawing.text || 'Text',
      fontSize,
      drawing.annotation?.wrapWidth,
    );
    if (isPriceLabel) {
      const tail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tail.setAttribute('d', `M ${point.x} ${point.y} L ${point.x + 9} ${point.y - 18} L ${point.x + 22} ${point.y - 18} Z`);
      tail.setAttribute('fill', drawing.fillColor || color);
      tail.setAttribute('pointer-events', isPreview ? 'none' : 'all');
      tail.addEventListener('pointerdown', event => {
        this.options.beginDrag(event, drawing.id, null);
      });
      group.appendChild(tail);
      point.x += 8;
      point.y -= lines.length * fontSize * 1.25 + 20;
    }
    if (isPin) this.appendPin(group, drawing, point, lines.length, fontSize, isPreview, color);
    if (['note', 'price_note'].includes(drawing.subtype ?? '') && drawing.points.length > 1) {
      const anchor = this.options.projectPoint(drawing.points[0]);
      if (anchor) {
        const leader = this.options.createLine(
          anchor.x,
          anchor.y,
          point.x,
          point.y + fontSize / 2,
          color,
          lineWidth,
          dash,
        );
        leader.setAttribute('pointer-events', isPreview ? 'none' : 'stroke');
        leader.addEventListener('pointerdown', event => {
          this.options.beginDrag(event, drawing.id, null);
        });
        group.appendChild(leader);
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(anchor.x));
        dot.setAttribute('cy', String(anchor.y));
        dot.setAttribute('r', '2');
        dot.setAttribute('fill', color);
        group.appendChild(dot);
      }
    }

    const background = document.createElementNS(
      'http://www.w3.org/2000/svg',
      isComment ? 'path' : 'rect',
    );
    const textLength = Math.max(
      isPin ? 240 : 0,
      Math.max(...lines.map(line => line.length), 2) * fontSize * 0.62 + (isComment ? 20 : 8),
    );
    if (isSignpost) {
      const pole = this.options.createLine(point.x, point.y, point.x, height, color, 1, 'none');
      pole.setAttribute('pointer-events', isPreview ? 'none' : 'stroke');
      pole.addEventListener('pointerdown', event => {
        this.options.beginDrag(event, drawing.id, null);
      });
      group.appendChild(pole);
      point.x -= textLength / 2;
    }
    if (isComment) {
      const boxHeight = lines.length * fontSize * 1.25 + 16;
      point.y -= boxHeight;
      const radius = Math.min(20, boxHeight / 2);
      background.setAttribute('d', `M ${point.x} ${point.y + boxHeight} L ${point.x} ${point.y + radius} Q ${point.x} ${point.y} ${point.x + radius} ${point.y} H ${point.x + textLength - radius} Q ${point.x + textLength} ${point.y} ${point.x + textLength} ${point.y + radius} V ${point.y + boxHeight - radius} Q ${point.x + textLength} ${point.y + boxHeight} ${point.x + textLength - radius} ${point.y + boxHeight} Z`);
    }
    if (isCallout) {
      const anchor = this.options.projectPoint(drawing.points[0]);
      point.x -= textLength / 2;
      point.y -= (lines.length * fontSize * 1.25 + 4) / 2;
      if (anchor && drawing.points.length > 1) {
        const tail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const edgeX = Math.max(point.x + 8, Math.min(point.x + textLength - 8, anchor.x));
        const edgeY = anchor.y < point.y
          ? point.y
          : point.y + lines.length * fontSize * 1.25 + 4;
        tail.setAttribute('d', `M ${edgeX - 6} ${edgeY} L ${anchor.x} ${anchor.y} L ${edgeX + 6} ${edgeY} Z`);
        tail.setAttribute('fill', drawing.fillColor || color);
        tail.setAttribute('stroke', color);
        tail.setAttribute('pointer-events', isPreview ? 'none' : 'all');
        tail.addEventListener('pointerdown', event => {
          this.options.beginDrag(event, drawing.id, null);
        });
        group.appendChild(tail);
      }
    }
    background.setAttribute('x', String(point.x));
    background.setAttribute('y', String(point.y));
    background.setAttribute('width', String(textLength));
    background.setAttribute('height', String(lines.length * fontSize * 1.25 + 4));
    background.setAttribute('data-geometry-role', 'annotation-background');
    background.setAttribute(
      'fill',
      drawing.fillColor || (
        isPrice || isCallout || isComment
          ? color
          : isPin || isSignpost
            ? this.options.getThemeToken('--bg-secondary', '#202024')
            : 'transparent'
      ),
    );
    background.setAttribute('rx', isPrice || isCallout ? '4' : '0');
    background.setAttribute('fill-opacity', String(drawing.fillOpacity ?? 1));
    background.setAttribute('stroke', drawing.selected || drawing.annotation?.border ? color : 'none');
    background.setAttribute('stroke-width', '1');
    background.setAttribute('pointer-events', isPreview ? 'none' : 'all');
    background.style.cursor = drawing.locked ? 'default' : 'move';
    if (!isPreview) {
      background.addEventListener('pointerdown', event => {
        this.options.beginDrag(event as PointerEvent, drawing.id, null);
      });
      background.addEventListener('dblclick', event => {
        event.stopPropagation();
        this.options.editAnnotation(drawing.id);
      });
    }
    group.appendChild(background);
    const textElements: SVGElement[] = [background];
    lines.forEach((line, index) => {
      const label = this.options.createText(
        point.x + (isComment ? 10 : 4),
        point.y + (isComment ? 6 : 0) + fontSize + index * fontSize * 1.25,
        line,
        drawing.annotation?.textColor || (isPrice || isCallout || isComment ? '#ffffff' : color),
        fontSize,
      );
      label.setAttribute('font-weight', (drawing.annotation?.bold ?? isPriceLabel) ? '700' : '400');
      label.setAttribute('font-style', drawing.annotation?.italic ? 'italic' : 'normal');
      label.setAttribute('font-family', 'Arial, sans-serif');
      label.setAttribute('data-geometry-role', 'annotation-text');
      label.setAttribute('pointer-events', 'none');
      group.appendChild(label);
      textElements.push(label);
    });
    if (isPin && !drawing.selected && !isPreview) {
      textElements.forEach(element => { element.style.visibility = 'hidden'; });
      group.addEventListener('pointerenter', () => {
        textElements.forEach(element => { element.style.visibility = 'visible'; });
      });
      group.addEventListener('pointerleave', () => {
        textElements.forEach(element => { element.style.visibility = 'hidden'; });
      });
    }
  }

  private renderTable(
    group: SVGGElement,
    drawing: Drawing,
    point: ScreenPoint,
    fontSize: number,
    isPreview: boolean,
    color: string,
    appendResizeHandle: (x: number, y: number) => void,
  ): void {
    const cells = annotationTable(drawing.annotation?.tableData);
    const cellWidth = Math.max(40, Math.min(300, drawing.annotation?.cellWidth ?? 120));
    const cellHeight = Math.max(fontSize + 12, drawing.annotation?.cellHeight ?? 32);
    cells.slice(0, 10).forEach((row, rowIndex) => {
      row.slice(0, 10).forEach((value, columnIndex) => {
        const cell = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        cell.setAttribute('x', String(point.x + columnIndex * cellWidth));
        cell.setAttribute('y', String(point.y + rowIndex * cellHeight));
        cell.setAttribute('width', String(cellWidth));
        cell.setAttribute('height', String(cellHeight));
        cell.setAttribute('fill', drawing.fillColor || this.options.getThemeToken('--bg-secondary', '#202024'));
        cell.setAttribute('stroke', color);
        cell.setAttribute('stroke-width', '1');
        cell.setAttribute('pointer-events', isPreview ? 'none' : 'all');
        cell.setAttribute('data-geometry-role', 'annotation-background');
        cell.setAttribute('data-table-row', String(rowIndex));
        cell.setAttribute('data-table-column', String(columnIndex));
        cell.style.cursor = drawing.locked ? 'default' : 'move';
        cell.addEventListener('pointerdown', event => {
          this.options.beginDrag(event, drawing.id, null);
        });
        group.appendChild(cell);
        const align = drawing.annotation?.align ?? 'left';
        const label = this.options.createText(
          point.x + columnIndex * cellWidth + (
            align === 'center' ? cellWidth / 2 : align === 'right' ? cellWidth - 6 : 6
          ),
          point.y + rowIndex * cellHeight + fontSize + 6,
          value.slice(0, Math.floor((cellWidth - 12) / (fontSize * 0.62))),
          drawing.annotation?.textColor || color,
          fontSize,
        );
        label.setAttribute('text-anchor', align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start');
        label.setAttribute('font-weight', drawing.annotation?.bold ? '700' : '400');
        label.setAttribute('font-style', drawing.annotation?.italic ? 'italic' : 'normal');
        label.setAttribute('font-family', 'Arial, sans-serif');
        label.setAttribute('pointer-events', 'none');
        group.appendChild(label);
      });
    });
    appendResizeHandle(point.x + cells[0].length * cellWidth, point.y + cells.length * cellHeight);
  }

  private appendPin(
    group: SVGGElement,
    drawing: Drawing,
    point: ScreenPoint,
    lineCount: number,
    fontSize: number,
    isPreview: boolean,
    color: string,
  ): void {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    marker.setAttribute('d', `M ${point.x} ${point.y} C ${point.x - 20} ${point.y - 20} ${point.x - 10} ${point.y - 32} ${point.x} ${point.y - 32} C ${point.x + 10} ${point.y - 32} ${point.x + 20} ${point.y - 20} ${point.x} ${point.y} Z`);
    marker.setAttribute('fill', color);
    marker.setAttribute('pointer-events', isPreview ? 'none' : 'all');
    marker.style.cursor = drawing.locked ? 'default' : 'move';
    marker.addEventListener('pointerdown', event => {
      this.options.beginDrag(event, drawing.id, null);
    });
    group.appendChild(marker);
    const hole = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hole.setAttribute('cx', String(point.x));
    hole.setAttribute('cy', String(point.y - 22));
    hole.setAttribute('r', '4');
    hole.setAttribute('fill', '#fff');
    hole.setAttribute('pointer-events', 'none');
    group.appendChild(hole);
    point.x -= 120;
    point.y -= 44 + lineCount * fontSize * 1.25;
  }

  private renderCallout(group: SVGGElement, drawing: Drawing, color: string): void {
    if (drawing.points.length < 2) return;
    const first = this.options.projectPoint(drawing.points[0]);
    const second = this.options.projectPoint(drawing.points[1]);
    if (!first || !second) return;
    group.appendChild(this.options.createLine(first.x, first.y, second.x, second.y, color, 1, 'none'));
    const text = drawing.text || 'Label';
    const boxWidth = text.length * 7 + 12;
    const boxHeight = 22;
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', String(second.x - boxWidth / 2));
    background.setAttribute('y', String(second.y - boxHeight / 2));
    background.setAttribute('width', String(boxWidth));
    background.setAttribute('height', String(boxHeight));
    background.setAttribute('rx', '4');
    background.setAttribute('fill', '#18181b');
    background.setAttribute('stroke', color);
    background.setAttribute('stroke-width', '1');
    group.appendChild(background);
    const label = this.options.createText(second.x, second.y + 4, text, color, 12);
    label.setAttribute('text-anchor', 'middle');
    group.appendChild(label);
  }

  private renderStamp(
    group: SVGGElement,
    drawing: Drawing,
    width: number,
    isPreview: boolean,
    opacity: string,
  ): void {
    if (drawing.points.length < 1) return;
    const point = this.options.projectPoint(drawing.points[0]);
    if (!point) return;
    if (renderPictographStamp(group, drawing, point, {
      preview: isPreview,
      onPointerDown: event => this.options.beginDrag(event, drawing.id, 0),
    })) return;
    const icon = STAMP_GLYPHS[drawing.subtype || 'thumbsUp'];
    if (!icon) return;
    const size = icon.size;
    const iconColor = drawing.color || icon.color;
    if (icon.kind === 'label') {
      const labelWidth = 72;
      const labelHeight = 18;
      const labelX = icon.side === 'left' ? 2 : width - labelWidth - 2;
      const labelY = point.y - labelHeight / 2;
      const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      background.setAttribute('x', String(labelX));
      background.setAttribute('y', String(labelY));
      background.setAttribute('width', String(labelWidth));
      background.setAttribute('height', String(labelHeight));
      background.setAttribute('rx', '3');
      background.setAttribute('fill', icon.bg || iconColor);
      background.style.opacity = opacity;
      if (!isPreview) {
        background.setAttribute('pointer-events', 'all');
        background.style.cursor = 'pointer';
        background.addEventListener('pointerdown', event => {
          this.options.beginDrag(event, drawing.id, 0);
        });
        background.addEventListener('contextmenu', event => {
          this.options.openContextMenu(event, drawing.id);
        });
      }
      group.appendChild(background);
      const text = this.options.createText(
        labelX + labelWidth / 2,
        labelY + 12,
        drawing.points[0].price.toFixed(5),
        '#fff',
        10,
      );
      text.setAttribute('text-anchor', 'middle');
      group.appendChild(text);
      if (drawing.selected && !isPreview) {
        const selection = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        selection.setAttribute('x', String(labelX - 2));
        selection.setAttribute('y', String(labelY - 2));
        selection.setAttribute('width', String(labelWidth + 4));
        selection.setAttribute('height', String(labelHeight + 4));
        selection.setAttribute('rx', '4');
        selection.setAttribute('fill', 'none');
        selection.setAttribute('stroke', '#fff');
        selection.setAttribute('stroke-width', '2');
        group.appendChild(selection);
      }
      return;
    }
    const scale = size / 24;
    const iconGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    iconGroup.setAttribute('transform', `translate(${point.x - size / 2}, ${point.y - size / 2})`);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(size / 2));
    circle.setAttribute('cy', String(size / 2));
    circle.setAttribute('r', String(size / 2 + 2));
    circle.setAttribute('fill', 'rgba(0,0,0,0.35)');
    iconGroup.appendChild(circle);
    if (icon.path) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', icon.path);
      path.setAttribute('transform', `scale(${scale})`);
      if (icon.filled) {
        path.setAttribute('fill', iconColor);
        path.setAttribute('stroke', 'none');
      } else {
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', iconColor);
        path.setAttribute('stroke-width', String(2 / scale));
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
      }
      iconGroup.appendChild(path);
    }
    if (drawing.selected && !isPreview) {
      const selection = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      selection.setAttribute('cx', String(size / 2));
      selection.setAttribute('cy', String(size / 2));
      selection.setAttribute('r', String(size / 2 + 4));
      selection.setAttribute('fill', 'none');
      selection.setAttribute('stroke', '#fff');
      selection.setAttribute('stroke-width', '2');
      iconGroup.appendChild(selection);
    }
    if (!isPreview) {
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hit.setAttribute('x', '0');
      hit.setAttribute('y', '0');
      hit.setAttribute('width', String(size));
      hit.setAttribute('height', String(size));
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('pointer-events', 'all');
      hit.style.cursor = 'pointer';
      hit.addEventListener('pointerdown', event => {
        this.options.beginDrag(event, drawing.id, 0);
      });
      hit.addEventListener('contextmenu', event => {
        this.options.openContextMenu(event, drawing.id);
      });
      iconGroup.appendChild(hit);
    }
    group.appendChild(iconGroup);
  }
}
