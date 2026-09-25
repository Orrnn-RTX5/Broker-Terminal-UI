import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

/** Capture title-bar gestures so dragging continues outside the panel without moving the chart. */
export function useFloatingPanelDrag(
    panelRef: RefObject<HTMLElement | null>,
    move: (position: { x: number; y: number }) => void,
) {
    const [isDragging, setIsDragging] = useState(false);
    const drag = useRef<{
        pointerId: number;
        target: HTMLElement;
        offsetX: number;
        offsetY: number;
    } | null>(null);

    const stop = useCallback(() => {
        const current = drag.current;
        drag.current = null;
        if (current?.target.hasPointerCapture?.(current.pointerId)) {
            current.target.releasePointerCapture(current.pointerId);
        }
        setIsDragging(false);
    }, []);

    useEffect(() => {
        window.addEventListener('blur', stop);
        return () => window.removeEventListener('blur', stop);
    }, [stop]);

    const onPointerDown = (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || drag.current) return;
        if ((event.target as Element).closest('button, input, select, textarea, a')) return;
        const bounds = panelRef.current?.getBoundingClientRect();
        if (!bounds) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = {
            pointerId: event.pointerId,
            target: event.currentTarget,
            offsetX: event.clientX - bounds.left,
            offsetY: event.clientY - bounds.top,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setIsDragging(true);
    };

    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        move({ x: event.clientX - current.offsetX, y: event.clientY - current.offsetY });
    };

    const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        event.stopPropagation();
        stop();
    };

    return {
        isDragging,
        cancelDrag: stop,
        dragHandleProps: {
            onPointerDown,
            onPointerMove,
            onPointerUp: onPointerEnd,
            onPointerCancel: onPointerEnd,
            onLostPointerCapture: onPointerEnd,
        },
    };
}
