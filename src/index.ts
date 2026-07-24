// Output Swap — ComfyUI frontend extension (canvas-gesture pack).
//
// TypeScript source in `src/`, built to ESM via `bun build` and emitted to
// `web/dist/` (served at /extensions/comfyui-output-swap/index.js — the pack directory
// name IS the URL segment). Do not rename the pack dir without syncing
// EXT_NAME below. See ADR-0001.
//
// Pattern ("the gesture vein"): instead of intercepting a single widget,
// this pack adds a CANVAS-LEVEL pointer layer. A two-finger pinch whose
// centroid lands inside a *selected* node (single tap selects it) resizes
// that node and suppresses the native canvas zoom for the gesture's
// duration. Additive + mobile-first: if app.canvas or the pointer model is
// absent it does nothing and native corner-handle resize still works.
// Resize only writes node.size (already serialized) so no workflow breaks.
//
// This variant has NO @laurigates/comfy-modal-kit dependency — there is no widget to
// hook and no modal to open. Pure geometry helpers are exported and
// unit-tested (tests/js); the DOM/canvas wiring below is exercised in the
// manual browser matrix.
//
// ComfyUI serves its frontend API at runtime from `/scripts/app.js`. The
// emitted import string stays `/scripts/app.js` (bun's `--external '/scripts/*'`
// keeps it unbundled); the type is supplied via a `paths` mapping in
// tsconfig.json that points the import at `src/comfyui-shims.d.ts`. See ADR-0001.
import { app } from "/scripts/app.js";

const EXT_NAME = "comfyui-output-swap";

// LiteGraph maps a canvas point p to screen space as (p + ds.offset) * ds.scale.
// LiteGraph.NODE_TITLE_HEIGHT = 30 (confirm against the frontend sourcemap).
const DEFAULT_TITLE_HEIGHT = 30;

// ============================================================
// Types
// ============================================================

/** A screen-space rectangle. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A 2-tuple of [x, y] / [w, h] used throughout the geometry. */
type Vec2 = [number, number];

/** The narrow node surface this pack reaches into. */
interface GestureNode {
  pos: Vec2;
  size: Vec2;
  computeSize?: () => Vec2;
  onResize?: (size: Vec2) => void;
}

// ============================================================
// Pure helpers (unit-tested in tests/js)
// ============================================================

/** Euclidean distance between two {x, y} pointers. */
export function pinchDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint between two {x, y} pointers. */
export function centroid(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Is screen point (x, y) inside rect {x, y, w, h}? */
export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h;
}

/** Node bounding rect (incl. title bar) in screen space. */
export function nodeScreenRect(
  node: GestureNode,
  scale: number,
  offset: Vec2,
  titleHeight = DEFAULT_TITLE_HEIGHT,
): Rect {
  const x = (node.pos[0] + offset[0]) * scale;
  const yBody = (node.pos[1] + offset[1]) * scale;
  return {
    x,
    y: yBody - titleHeight * scale,
    w: node.size[0] * scale,
    h: node.size[1] * scale + titleHeight * scale,
  };
}

/**
 * New [w, h] after a uniform pinch scale, clamped to a minimum.
 * ratio = currentPinchDistance / startPinchDistance; minSize = [minW, minH].
 */
export function scaledSize(startSize: Vec2, ratio: number, minSize: Vec2 = [0, 0]): Vec2 {
  return [Math.max(minSize[0], startSize[0] * ratio), Math.max(minSize[1], startSize[1] * ratio)];
}

/** Selected nodes as an array, defensively across LiteGraph variants. */
export function selectedNodes(canvas: unknown): GestureNode[] {
  if (!canvas || typeof canvas !== "object") return [];
  const c = canvas as {
    selected_nodes?: Record<string, GestureNode>;
    selectedItems?: Set<unknown>;
  };
  const sel = c.selected_nodes;
  if (sel && typeof sel === "object") return Object.values(sel);
  if (c.selectedItems instanceof Set) {
    return [...c.selectedItems].filter(
      (it): it is GestureNode => !!it && typeof it === "object" && "size" in it && "pos" in it,
    );
  }
  return [];
}

// ============================================================
// Wiring (DOM + canvas; browser-matrix tested)
// ============================================================

interface PinchLock {
  node: GestureNode;
  startDist: number;
  startSize: Vec2;
  minSize: Vec2;
}

function installGestureLayer(): void {
  const canvas = (
    app as {
      canvas?: {
        canvas?: HTMLCanvasElement;
        ds?: { scale?: number; offset?: Vec2 };
        setDirty?: (a: boolean, b: boolean) => void;
      };
    }
  ).canvas;
  const el = canvas?.canvas; // the actual <canvas> element
  if (!el || !canvas) {
    console.warn(`[${EXT_NAME}] no canvas element — gesture layer not installed`);
    return;
  }

  const pointers = new Map<number, { x: number; y: number }>();
  let lock: PinchLock | null = null;

  const localPoint = (e: PointerEvent): { x: number; y: number } => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function tryStartPinch(): void {
    if (pointers.size !== 2 || lock) return;
    const [p1, p2] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const c = centroid(p1, p2);
    const scale = canvas?.ds?.scale ?? 1;
    const offset = canvas?.ds?.offset ?? ([0, 0] as Vec2);
    for (const node of selectedNodes(canvas)) {
      if (pointInRect(c.x, c.y, nodeScreenRect(node, scale, offset))) {
        const minSize: Vec2 = typeof node.computeSize === "function" ? node.computeSize() : [0, 0];
        lock = {
          node,
          startDist: pinchDistance(p1, p2) || 1,
          startSize: [node.size[0], node.size[1]],
          minSize,
        };
        return;
      }
    }
  }

  el.addEventListener(
    "pointerdown",
    (e) => {
      pointers.set(e.pointerId, localPoint(e));
      tryStartPinch();
      if (lock) e.stopImmediatePropagation(); // suppress native pinch-zoom
    },
    true,
  );

  el.addEventListener(
    "pointermove",
    (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, localPoint(e));
      if (!lock || pointers.size < 2) return;
      const [p1, p2] = [...pointers.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const ratio = pinchDistance(p1, p2) / lock.startDist;
      const [w, h] = scaledSize(lock.startSize, ratio, lock.minSize);
      lock.node.size[0] = w;
      lock.node.size[1] = h;
      lock.node.onResize?.(lock.node.size);
      canvas?.setDirty?.(true, true);
      e.stopImmediatePropagation();
    },
    true,
  );

  const endPointer = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lock = null;
  };
  el.addEventListener("pointerup", endPointer, true);
  el.addEventListener("pointercancel", endPointer, true);

  console.log(`[${EXT_NAME}] gesture layer installed — pinch a selected node to resize`);
}

app.registerExtension({
  name: "comfy.output-swap",
  async setup() {
    installGestureLayer();
    // TODO: groups — extend selectedNodes()/nodeScreenRect() to graph._groups
    //   (group.pos/group.size; no title bar) so a pinch resizes groups too.
    // TODO: discoverability — draw a faint corner affordance on selected nodes
    //   (canvas onDrawForeground) so the pinch gesture is learnable.
    // TODO: optional anisotropic mode — decompose the two-finger vector into
    //   independent W/H instead of uniform scale (behind a config flag).
  },
});
