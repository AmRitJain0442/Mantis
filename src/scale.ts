import { useCallback, useEffect, useState } from "react";

/** Interface scale for the whole shell — separate from the canvas's own zoom,
 *  which frames the trace rather than resizing the tool around it. */
export const SCALE_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

const STORAGE_KEY = "mantis:scale";
const DEFAULT_SCALE = 1;

export const readScale = (): number => {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return SCALE_STEPS.includes(stored as typeof SCALE_STEPS[number]) ? stored : DEFAULT_SCALE;
  } catch {
    return DEFAULT_SCALE;
  }
};

export function applyScale(scale: number) {
  // `zoom` on the root reflows the layout instead of just stretching pixels,
  // so panels keep their proportions and text stays sharp.
  document.documentElement.style.zoom = scale === 1 ? "" : String(scale);
}

export function useWorkspaceScale() {
  const [scale, setScale] = useState<number>(readScale);

  useEffect(() => {
    applyScale(scale);
    try {
      if (scale === DEFAULT_SCALE) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(scale));
    } catch {
      /* private mode — the choice just won't persist */
    }
  }, [scale]);

  const step = useCallback((direction: 1 | -1) => {
    setScale((current) => {
      const index = SCALE_STEPS.indexOf(current as typeof SCALE_STEPS[number]);
      const next = Math.min(SCALE_STEPS.length - 1, Math.max(0, index + direction));
      return SCALE_STEPS[next];
    });
  }, []);

  const resetScale = useCallback(() => setScale(DEFAULT_SCALE), []);

  // Alt-based so browser zoom (⌘/ctrl +, −, 0) keeps working untouched.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "=" || event.key === "+") { event.preventDefault(); step(1); }
      else if (event.key === "-" || event.key === "_") { event.preventDefault(); step(-1); }
      else if (event.key === "0") { event.preventDefault(); resetScale(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, resetScale]);

  return {
    scale,
    zoomIn: () => step(1),
    zoomOut: () => step(-1),
    resetScale,
    canZoomIn: scale < SCALE_STEPS[SCALE_STEPS.length - 1],
    canZoomOut: scale > SCALE_STEPS[0]
  };
}
