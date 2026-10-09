import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUiTranslation } from '../hooks/useUiTranslation';

const TOOLTIP_TRIGGER_GAP_PX = 8;
const TOOLTIP_HALF_HEIGHT_PX = 15;
const VIEWPORT_EDGE_GAP_PX = 8;
const TOOLTIP_ID = 'web-drawing-tools-tooltip';

interface TooltipOwner {
  ownerId: string;
  label: string;
  trigger: HTMLButtonElement;
}

interface TooltipState extends TooltipOwner {
  left: number;
  top: number;
}

export interface DrawingRailTooltipHandle {
  enter: (owner: TooltipOwner) => void;
  leave: (ownerId: string) => void;
  focus: (owner: TooltipOwner) => void;
  blur: (ownerId: string) => void;
  hide: () => void;
  dismissOwner: (ownerId: string) => void;
}

/** Keep hover/focus updates out of the rail and its drawing catalogs. */
export const DrawingRailTooltip = forwardRef<DrawingRailTooltipHandle, {
  enabled: boolean;
  orientation: 'vertical' | 'horizontal';
}>(function DrawingRailTooltip({ enabled, orientation }, ref) {
  const tr = useUiTranslation();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoveredOwnerRef = useRef<TooltipOwner | null>(null);
  const focusedOwnerRef = useRef<TooltipOwner | null>(null);

  const show = (owner: TooltipOwner) => {
    if (!enabled) return;
    const rect = owner.trigger.getBoundingClientRect();
    const left = Math.round(orientation === 'horizontal'
      ? rect.left
      : Math.min(window.innerWidth - VIEWPORT_EDGE_GAP_PX, rect.right + TOOLTIP_TRIGGER_GAP_PX));
    const top = Math.round(orientation === 'horizontal'
      ? rect.bottom + TOOLTIP_TRIGGER_GAP_PX
      : Math.max(VIEWPORT_EDGE_GAP_PX + TOOLTIP_HALF_HEIGHT_PX, Math.min(
        window.innerHeight - VIEWPORT_EDGE_GAP_PX - TOOLTIP_HALF_HEIGHT_PX,
        rect.top + rect.height / 2,
      )));
    setTooltip(current => current?.ownerId === owner.ownerId
      && current.label === owner.label && current.trigger === owner.trigger
      && current.left === left && current.top === top
      ? current
      : { ...owner, left, top });
  };

  const hideOwner = (ownerId: string) => {
    setTooltip(current => current?.ownerId === ownerId ? null : current);
  };

  useImperativeHandle(ref, () => ({
    enter(owner) {
      hoveredOwnerRef.current = owner;
      show(owner);
    },
    leave(ownerId) {
      if (hoveredOwnerRef.current?.ownerId === ownerId) hoveredOwnerRef.current = null;
      if (focusedOwnerRef.current) show(focusedOwnerRef.current);
      else hideOwner(ownerId);
    },
    focus(owner) {
      focusedOwnerRef.current = owner;
      show(owner);
    },
    blur(ownerId) {
      if (focusedOwnerRef.current?.ownerId === ownerId) focusedOwnerRef.current = null;
      if (hoveredOwnerRef.current) show(hoveredOwnerRef.current);
      else hideOwner(ownerId);
    },
    hide() {
      setTooltip(null);
    },
    dismissOwner(ownerId) {
      if (hoveredOwnerRef.current?.ownerId === ownerId) hoveredOwnerRef.current = null;
      if (focusedOwnerRef.current?.ownerId === ownerId) focusedOwnerRef.current = null;
      hideOwner(ownerId);
    },
  }));

  useLayoutEffect(() => {
    if (!enabled || !tooltip) return;
    // This controller owns this attribute so describing a button does not
    // require rerendering every button and drawing icon in the rail.
    const trigger = tooltip.trigger;
    trigger.setAttribute('aria-describedby', TOOLTIP_ID);
    return () => {
      if (trigger.getAttribute('aria-describedby') === TOOLTIP_ID) {
        trigger.removeAttribute('aria-describedby');
      }
    };
  }, [enabled, tooltip?.trigger]);

  useLayoutEffect(() => {
    if (!enabled || !tooltip || orientation !== 'horizontal' || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    const left = Math.round(Math.max(VIEWPORT_EDGE_GAP_PX,
      Math.min(tooltip.left, window.innerWidth - rect.width - VIEWPORT_EDGE_GAP_PX)));
    const top = Math.round(Math.max(VIEWPORT_EDGE_GAP_PX,
      Math.min(tooltip.top, window.innerHeight - rect.height - VIEWPORT_EDGE_GAP_PX)));
    if (left !== tooltip.left || top !== tooltip.top) setTooltip({ ...tooltip, left, top });
  }, [enabled, tooltip, orientation]);

  return enabled && tooltip ? createPortal(
    <div
      ref={tooltipRef}
      id={TOOLTIP_ID}
      className="web-drawing-tools-tooltip"
      data-orientation={orientation}
      role="tooltip"
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tr(tooltip.label)}
    </div>,
    document.body,
  ) : null;
});
