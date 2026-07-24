/* web/dist bundle built by bun from src/ in this repository (see package.json). No third-party code is bundled. */

// src/index.ts
import { app } from "/scripts/app.js";
var EXT_NAME = "comfyui-output-swap";
var DEFAULT_TITLE_HEIGHT = 30;
function pinchDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function centroid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function pointInRect(x, y, rect) {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h;
}
function nodeScreenRect(node, scale, offset, titleHeight = DEFAULT_TITLE_HEIGHT) {
  const x = (node.pos[0] + offset[0]) * scale;
  const yBody = (node.pos[1] + offset[1]) * scale;
  return {
    x,
    y: yBody - titleHeight * scale,
    w: node.size[0] * scale,
    h: node.size[1] * scale + titleHeight * scale
  };
}
function scaledSize(startSize, ratio, minSize = [0, 0]) {
  return [Math.max(minSize[0], startSize[0] * ratio), Math.max(minSize[1], startSize[1] * ratio)];
}
function selectedNodes(canvas) {
  if (!canvas || typeof canvas !== "object")
    return [];
  const c = canvas;
  const sel = c.selected_nodes;
  if (sel && typeof sel === "object")
    return Object.values(sel);
  if (c.selectedItems instanceof Set) {
    return [...c.selectedItems].filter((it) => !!it && typeof it === "object" && ("size" in it) && ("pos" in it));
  }
  return [];
}
function installGestureLayer() {
  const canvas = app.canvas;
  const el = canvas?.canvas;
  if (!el || !canvas) {
    console.warn(`[${EXT_NAME}] no canvas element — gesture layer not installed`);
    return;
  }
  const pointers = new Map;
  let lock = null;
  const localPoint = (e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function tryStartPinch() {
    if (pointers.size !== 2 || lock)
      return;
    const [p1, p2] = [...pointers.values()];
    const c = centroid(p1, p2);
    const scale = canvas?.ds?.scale ?? 1;
    const offset = canvas?.ds?.offset ?? [0, 0];
    for (const node of selectedNodes(canvas)) {
      if (pointInRect(c.x, c.y, nodeScreenRect(node, scale, offset))) {
        const minSize = typeof node.computeSize === "function" ? node.computeSize() : [0, 0];
        lock = {
          node,
          startDist: pinchDistance(p1, p2) || 1,
          startSize: [node.size[0], node.size[1]],
          minSize
        };
        return;
      }
    }
  }
  el.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, localPoint(e));
    tryStartPinch();
    if (lock)
      e.stopImmediatePropagation();
  }, true);
  el.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId))
      return;
    pointers.set(e.pointerId, localPoint(e));
    if (!lock || pointers.size < 2)
      return;
    const [p1, p2] = [...pointers.values()];
    const ratio = pinchDistance(p1, p2) / lock.startDist;
    const [w, h] = scaledSize(lock.startSize, ratio, lock.minSize);
    lock.node.size[0] = w;
    lock.node.size[1] = h;
    lock.node.onResize?.(lock.node.size);
    canvas?.setDirty?.(true, true);
    e.stopImmediatePropagation();
  }, true);
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2)
      lock = null;
  };
  el.addEventListener("pointerup", endPointer, true);
  el.addEventListener("pointercancel", endPointer, true);
  console.log(`[${EXT_NAME}] gesture layer installed — pinch a selected node to resize`);
}
app.registerExtension({
  name: "comfy.output-swap",
  async setup() {
    installGestureLayer();
  }
});
export {
  selectedNodes,
  scaledSize,
  pointInRect,
  pinchDistance,
  nodeScreenRect,
  centroid
};
