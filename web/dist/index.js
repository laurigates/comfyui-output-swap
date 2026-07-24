/* web/dist bundle built by bun from src/ in this repository (see package.json). No third-party code is bundled. */

// src/index.ts
import { app } from "/scripts/app.js";
var EXT_NAME = "comfyui-output-swap";
var SETTING_ID = "OutputSwap.enable";
var HL = "#26d0ff";
var MIN_CONTROL_DIST = 30;
var CONTROL_FACTOR = 0.25;
function isOutputSlotHit(found) {
  return !!found && typeof found === "object" && "output" in found && "slot" in found;
}
function bezierControlDistance(a, b) {
  return Math.max(MIN_CONTROL_DIST, Math.hypot(b[0] - a[0], b[1] - a[1]) * CONTROL_FACTOR);
}
function collectDownstream(linkIds, resolveLink, getNodeById) {
  const targets = [];
  for (const id of linkIds) {
    const link = resolveLink(id);
    if (!link)
      continue;
    const node = getNodeById(link.target_id);
    if (node == null)
      continue;
    targets.push({ node, slot: link.target_slot });
  }
  return targets;
}
function performSwap(srcNode, srcOutputIndex, targets) {
  let moved = 0;
  for (const t of targets) {
    if (srcNode.connect(srcOutputIndex, t.node, t.slot))
      moved++;
  }
  return moved;
}
var enabled = true;
function getCanvas() {
  return app.canvas;
}
function resolveLink(graph, id) {
  const links = graph.links;
  if (!links)
    return;
  return typeof links.get === "function" ? links.get(id) : links[id];
}
function hoveredOutput(canvas) {
  const lc = canvas.linkConnector;
  if (!lc?.isConnecting || lc.state?.connectingTo !== "input")
    return null;
  const first = lc.renderLinks?.[0];
  if (!first || first.toType !== "input")
    return null;
  const mouse = canvas.graph_mouse;
  if (!mouse)
    return null;
  const nodes = canvas.graph?._nodes ?? canvas.graph?.nodes ?? [];
  for (const node of nodes) {
    if (node === first.node)
      continue;
    const outSlot = node.getOutputOnPos?.([mouse[0], mouse[1]]);
    if (outSlot)
      return { node, index: node.outputs?.indexOf(outSlot) ?? -1, outSlot };
  }
  return null;
}
function drawRing(ctx, p, r) {
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(38,208,255,0.25)";
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = HL;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.stroke();
}
function drawHint(canvas, ctx) {
  const hit = hoveredOutput(canvas);
  const graph = canvas.graph;
  if (!hit || !graph)
    return;
  const a = hit.node.getOutputPos(hit.index);
  ctx.save();
  const linkIds = hit.outSlot.links ?? [];
  for (const id of linkIds) {
    const link = resolveLink(graph, id);
    const dst = link ? graph.getNodeById(link.target_id) : undefined;
    if (!link || !dst)
      continue;
    const b = dst.getInputPos(link.target_slot);
    const cd = bezierControlDistance(a, b);
    const bezier = () => {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.bezierCurveTo(a[0] + cd, a[1], b[0] - cd, b[1], b[0], b[1]);
      ctx.stroke();
    };
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(38,208,255,0.28)";
    ctx.lineWidth = 8;
    bezier();
    ctx.setLineDash([9, 6]);
    ctx.strokeStyle = HL;
    ctx.lineWidth = 2.5;
    bezier();
    drawRing(ctx, b, 7);
  }
  drawRing(ctx, a, 9);
  ctx.restore();
}
function onDropOnNode(canvas, e) {
  if (!enabled)
    return;
  const lc = canvas.linkConnector;
  if (!lc)
    return;
  try {
    const detail = e.detail;
    const targetNode = detail?.node;
    const inner = detail?.event;
    if (!targetNode || !inner || lc.state?.connectingTo !== "input")
      return;
    const first = lc.renderLinks?.[0];
    if (!first || first.toType !== "input")
      return;
    const outSlot = targetNode.getOutputOnPos?.([inner.canvasX, inner.canvasY]);
    if (!outSlot)
      return;
    e.preventDefault();
    const srcNode = first.node;
    if (srcNode === targetNode)
      return;
    const graph = targetNode.graph;
    if (!graph)
      return;
    const linkIds = outSlot.links ? [...outSlot.links] : [];
    if (linkIds.length === 0)
      return;
    const targets = collectDownstream(linkIds, (id) => resolveLink(graph, id), (id) => graph.getNodeById(id));
    const moved = performSwap(srcNode, first.fromSlotIndex, targets);
    console.info(`[${EXT_NAME}] moved ${moved}/${linkIds.length} link(s) -> "${srcNode.title}"`);
    graph.setDirtyCanvas?.(true, true);
  } catch (err) {
    console.warn(`[${EXT_NAME}] drop error, native fallback`, err);
  }
}
function installOutputSwap() {
  const canvas = getCanvas();
  const lc = canvas?.linkConnector;
  if (!canvas || !lc?.events) {
    console.warn(`[${EXT_NAME}] linkConnector unavailable — output-swap not installed`);
    return;
  }
  lc.events.addEventListener("dropped-on-node", (e) => onDropOnNode(canvas, e));
  const prevDraw = canvas.onDrawForeground;
  canvas.onDrawForeground = function chainedDrawForeground(ctx, area) {
    if (enabled) {
      try {
        drawHint(canvas, ctx);
      } catch {}
    }
    prevDraw?.call(this, ctx, area);
  };
  console.log(`[${EXT_NAME}] installed — drag an output onto another output to take over its links`);
}
app.registerExtension({
  name: "comfy.output-swap",
  settings: [
    {
      id: SETTING_ID,
      name: "Output swap: drag an output onto another to take over its links",
      tooltip: "Drop one output onto another node's output slot of the same type to re-home all of that output's downstream links to the dragged source.",
      type: "boolean",
      defaultValue: true,
      onChange: (value) => {
        enabled = value !== false;
      }
    }
  ],
  async setup() {
    installOutputSwap();
  }
});
export {
  performSwap,
  isOutputSlotHit,
  collectDownstream,
  bezierControlDistance
};
