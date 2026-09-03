import { useCallback, useEffect, useRef, useState } from "react";
import { initialPositions, worldBounds, type Point, type Positions, type Rect } from "./layout";

export type Viewport = { x: number; y: number; k: number };

const MIN_K = 0.4;
const MAX_K = 2;
/** The title sits over the top of the canvas and the decks over the bottom, so
 *  centring has to happen inside what is actually left. */
const INSET = { top: 78, bottom: 62, side: 28 };
/** Below this much pointer travel a drag is really a click. */
const CLICK_SLOP = 4;

const clampZoom = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
const round = (k: number) => Math.round(k * 100) / 100;

/** Pan, zoom, and node dragging for the trace canvas. Positions live in world
 *  coordinates; the viewport is a single translate+scale over all of them. */
export function useCanvas() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Positions>(() => ({ ...initialPositions }));
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  const frameSize = (): Rect | null => {
    const box = frameRef.current?.getBoundingClientRect();
    return box ? { x: box.left, y: box.top, w: box.width, h: box.height } : null;
  };

  /** Zoom about a fixed point so the canvas grows under the cursor, not the corner. */
  const zoomAt = useCallback((nextK: number, pivot?: Point) => {
    setViewport((current) => {
      const k = clampZoom(nextK);
      if (k === current.k) return current;
      const frame = frameSize();
      const at = pivot ?? (frame ? { x: frame.w / 2, y: frame.h / 2 } : { x: 0, y: 0 });
      return {
        k: round(k),
        x: at.x - (at.x - current.x) * (k / current.k),
        y: at.y - (at.y - current.y) * (k / current.k)
      };
    });
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setViewport((current) => {
      const k = clampZoom(round(current.k + delta));
      if (k === current.k) return current;
      const frame = frameSize();
      const at = frame ? { x: frame.w / 2, y: frame.h / 2 } : { x: 0, y: 0 };
      return {
        k,
        x: at.x - (at.x - current.x) * (k / current.k),
        y: at.y - (at.y - current.y) * (k / current.k)
      };
    });
  }, []);

/** Centre `bounds` in the frame's usable area at scale `k`. */
  const centre = (frame: Rect, bounds: Rect, k: number): Viewport => ({
    k,
    x: INSET.side + (frame.w - INSET.side * 2 - bounds.w * k) / 2 - bounds.x * k,
    y: INSET.top + (frame.h - INSET.top - INSET.bottom - bounds.h * k) / 2 - bounds.y * k
  });

/** Scale the trace to the usable frame, never past 1:1 — a six-node graph
 *  blown up to 200% would look broken, not helpful. */
  const fitTo = useCallback((layout: Positions) => {
    const frame = frameSize();
    if (!frame) return;
    const bounds = worldBounds(layout);
    const k = clampZoom(Math.min(1, round(Math.min(
      (frame.w - INSET.side * 2) / bounds.w,
      (frame.h - INSET.top - INSET.bottom) / bounds.h
    ))));
    setViewport(centre(frame, bounds, k));
  }, []);

  const fit = useCallback(() => fitTo(positions), [fitTo, positions]);

  const reset = useCallback(() => {
    setPositions({ ...initialPositions });
    fitTo(initialPositions);
  }, [fitTo]);

  // Frame the trace once, after the frame has been measured.
  useEffect(() => { fitTo(initialPositions); }, [fitTo]);

  /** Trackpad and wheel: ctrl/⌘ zooms, everything else pans. */
  const onWheel = useCallback((event: React.WheelEvent) => {
    const frame = frameRef.current?.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      if (!frame) return;
      setViewport((current) => {
        const k = clampZoom(current.k * (1 - event.deltaY * 0.0022));
        if (k === current.k) return current;
        const at = { x: event.clientX - frame.left, y: event.clientY - frame.top };
        return {
          k: round(k),
          x: at.x - (at.x - current.x) * (k / current.k),
          y: at.y - (at.y - current.y) * (k / current.k)
        };
      });
      return;
    }
    setViewport((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
  }, []);

  const startPan = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const origin = { x: event.clientX, y: event.clientY };
    const start = { ...viewport };
    setPanning(true);
    const move = (e: PointerEvent) =>
      setViewport({ ...start, x: start.x + (e.clientX - origin.x), y: start.y + (e.clientY - origin.y) });
    const end = () => {
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }, [viewport]);

  /** Returns true when the pointer actually moved, so callers can tell a drag
   *  from a click and only suppress selection for real drags. */
  const startNodeDrag = useCallback((event: React.PointerEvent, id: string, onClick: () => void) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const origin = { x: event.clientX, y: event.clientY };
    const start = positions[id];
    const scale = viewport.k;
    let moved = false;

    const move = (e: PointerEvent) => {
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (!moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      if (!moved) { moved = true; setDragging(id); }
      setPositions((current) => ({
        ...current,
        [id]: { x: Math.round(start.x + dx / scale), y: Math.round(start.y + dy / scale) }
      }));
    };
    const end = () => {
      if (!moved) onClick();
      setDragging(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }, [positions, viewport.k]);

  return {
    frameRef, positions, viewport, panning, dragging,
    zoomBy, zoomAt, fit, reset, onWheel, startPan, startNodeDrag
  };
}
