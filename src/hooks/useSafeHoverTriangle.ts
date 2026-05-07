import { useState, useRef, useCallback, useEffect } from 'react';

interface Point {
  x: number;
  y: number;
}

interface SafeHoverTriangleOptions {
  parentElement: HTMLElement | null;
  submenuElement: HTMLElement | null;
  tolerance?: number;
}

/**
 * Implements the "safe hover triangle" pattern used in professional desktop menus.
 * Creates a virtual triangle from cursor to submenu corners - if mouse stays in triangle,
 * submenu stays open even when moving diagonally toward it.
 *
 * This prevents the frustrating "submenu closes before I can reach it" problem.
 *
 * Based on Amazon mega-menu algorithm and standard desktop UI patterns.
 */
export function useSafeHoverTriangle(options: SafeHoverTriangleOptions) {
  const { parentElement, submenuElement, tolerance = 100 } = options;
  const [isInSafeZone, setIsInSafeZone] = useState(false);
  const mousePositionRef = useRef<Point>({ x: 0, y: 0 });
  const lastMovementTimeRef = useRef<number>(Date.now());

  /**
   * Check if a point is inside a triangle using cross product method
   */
  const isPointInTriangle = useCallback((point: Point, triangle: [Point, Point, Point]): boolean => {
    const [p1, p2, p3] = triangle;

    const sign = (p1: Point, p2: Point, p3: Point): number => {
      return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    };

    const d1 = sign(point, p1, p2);
    const d2 = sign(point, p2, p3);
    const d3 = sign(point, p3, p1);

    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);

    return !(hasNeg && hasPos);
  }, []);

  /**
   * Get the safe hover triangle coordinates
   */
  const getSafeTriangle = useCallback((): [Point, Point, Point] | null => {
    if (!parentElement || !submenuElement) return null;

    const parentRect = parentElement.getBoundingClientRect();
    const submenuRect = submenuElement.getBoundingClientRect();
    const mouse = mousePositionRef.current;

    // Determine if submenu is on right or left
    const isSubmenuOnRight = submenuRect.left > parentRect.right;

    if (isSubmenuOnRight) {
      // Triangle: cursor → top-left of submenu → bottom-left of submenu
      return [
        { x: mouse.x, y: mouse.y },
        { x: submenuRect.left, y: submenuRect.top - tolerance },
        { x: submenuRect.left, y: submenuRect.bottom + tolerance },
      ];
    } else {
      // Triangle: cursor → top-right of submenu → bottom-right of submenu
      return [
        { x: mouse.x, y: mouse.y },
        { x: submenuRect.right, y: submenuRect.top - tolerance },
        { x: submenuRect.right, y: submenuRect.bottom + tolerance },
      ];
    }
  }, [parentElement, submenuElement, tolerance]);

  /**
   * Check if current mouse position is in safe zone
   */
  const checkSafeZone = useCallback((point: Point): boolean => {
    if (!parentElement || !submenuElement) return false;

    const triangle = getSafeTriangle();
    if (!triangle) return false;

    return isPointInTriangle(point, triangle);
  }, [parentElement, submenuElement, getSafeTriangle, isPointInTriangle]);

  /**
   * Handle mouse movement to update safe zone status
   */
  const onMouseMove = useCallback((e: MouseEvent) => {
    const point = { x: e.clientX, y: e.clientY };
    mousePositionRef.current = point;
    lastMovementTimeRef.current = Date.now();

    const inSafeZone = checkSafeZone(point);
    setIsInSafeZone(inSafeZone);
  }, [checkSafeZone]);

  /**
   * Track if mouse is over parent or submenu
   */
  const isMouseOverElements = useCallback((point: Point): boolean => {
    if (!parentElement || !submenuElement) return false;

    const parentRect = parentElement.getBoundingClientRect();
    const submenuRect = submenuElement.getBoundingClientRect();

    const overParent = (
      point.x >= parentRect.left &&
      point.x <= parentRect.right &&
      point.y >= parentRect.top &&
      point.y <= parentRect.bottom
    );

    const overSubmenu = (
      point.x >= submenuRect.left &&
      point.x <= submenuRect.right &&
      point.y >= submenuRect.top &&
      point.y <= submenuRect.bottom
    );

    return overParent || overSubmenu;
  }, [parentElement, submenuElement]);

  /**
   * Determine if submenu should stay open
   */
  const shouldStayOpen = useCallback((): boolean => {
    const point = mousePositionRef.current;

    // Always stay open if mouse is directly over parent or submenu
    if (isMouseOverElements(point)) return true;

    // Stay open if mouse is in safe hover triangle
    if (isInSafeZone) return true;

    return false;
  }, [isInSafeZone, isMouseOverElements]);

  // Set up global mouse tracking
  useEffect(() => {
    if (parentElement && submenuElement) {
      document.addEventListener('mousemove', onMouseMove);
      return () => {
        document.removeEventListener('mousemove', onMouseMove);
      };
    }
  }, [parentElement, submenuElement, onMouseMove]);

  return {
    isInSafeZone,
    shouldStayOpen,
    mousePosition: mousePositionRef.current,
  };
}
