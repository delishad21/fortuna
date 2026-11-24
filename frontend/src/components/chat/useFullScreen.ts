import { useEffect, useRef, type RefObject } from "react";

const TABBABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

const tabbable = (root: Element) =>
  [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (e) =>
      !e.matches(":disabled") &&
      e.tabIndex >= 0 &&
      e.getClientRects().length > 0,
  );

/** The child of <body> holding `node`; menus are portalled next to the app's own. */
const layerOf = (node: Element) => {
  let layer = node;
  while (layer.parentElement && layer.parentElement !== document.body)
    layer = layer.parentElement;
  return layer;
};

/**
 * Makes an element that covers the window behave as a modal dialog in place: it keeps focus,
 * leaves the page behind it unscrolled and closes on Escape. Menus opened from it stay usable.
 */
export function useFullScreen(
  open: boolean,
  dialog: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const root = dialog.current;
    if (!open || !root) return;
    let last: HTMLElement = root;
    root.focus({ preventScroll: true });

    const locked: Array<[HTMLElement, string]> = [];
    for (let e = root.parentElement; e; e = e.parentElement)
      if (
        e === document.body ||
        e === document.documentElement ||
        /auto|scroll/.test(getComputedStyle(e).overflowY)
      ) {
        locked.push([e, e.style.overflow]);
        e.style.overflow = "hidden";
      }

    const page = layerOf(root);
    const back = () => (last.isConnected ? last : root).focus();
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (root.contains(target)) last = target;
      else if (page.contains(target)) back();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const active = document.activeElement as HTMLElement | null;
      if (e.key === "Escape") {
        // Escape in a field or open menu belongs to that control.
        if (
          active?.closest("input, textarea, select, [contenteditable=true]") ||
          (active && active !== document.body && !root.contains(active))
        )
          return;
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const inside = !!active && root.contains(active);
      const layer =
        active && active !== document.body && !inside ? layerOf(active) : null;
      const stops = tabbable(layer && layer !== page ? layer : root);
      const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
      if (layer && layer !== page) {
        // Leaving a menu returns to where it was opened from.
        if (active !== edge) return;
        e.preventDefault();
        back();
        return;
      }
      if (inside && active !== edge && active !== root) return;
      if (active === root && !e.shiftKey && stops.length) return;
      e.preventDefault();
      (e.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKey);
      for (const [e, overflow] of locked) e.style.overflow = overflow;
    };
  }, [open, dialog]);
}
