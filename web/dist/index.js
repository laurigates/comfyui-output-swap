/* web/dist bundle built by bun from src/ in this repository (see package.json). No third-party code is bundled. */

// src/index.ts
import { app } from "/scripts/app.js";
var EXT_NAME = "comfyui-output-swap";
var SETTING_ID = "OutputSwap.enable";
var AUTO_INSERT_SETTING_ID = "OutputSwap.autoInsert";
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
function isWildcardSlotType(type) {
  return type == null || type === "" || type === "*" || type === 0;
}
function isTypeCompatible(outType, inType) {
  if (isWildcardSlotType(outType) || isWildcardSlotType(inType))
    return true;
  const a = String(outType).toLowerCase();
  const b = String(inType).toLowerCase();
  if (!a.includes(",") && !b.includes(","))
    return a === b;
  return a.split(",").some((x) => b.split(",").some((y) => isTypeCompatible(x, y)));
}
function findInsertInput(inputs, outputType, isCompatible) {
  if (isWildcardSlotType(outputType) || !inputs)
    return -1;
  let found = -1;
  for (const [index, input] of inputs.entries()) {
    if (input.link != null)
      continue;
    if (isWildcardSlotType(input.type))
      continue;
    if (!isCompatible(outputType, input.type))
      continue;
    if (found !== -1)
      return -1;
    found = index;
  }
  return found;
}
function reachesDownstream(from, to, resolveLink, getNodeById) {
  if (from === to)
    return true;
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.pop();
    for (const output of node.outputs ?? []) {
      for (const id of output.links ?? []) {
        const link = resolveLink(id);
        if (!link)
          continue;
        const next = getNodeById(link.target_id);
        if (next == null || seen.has(next))
          continue;
        if (next === to)
          return true;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}
function planInsertion(srcNode, targetNode, outputType, ctx) {
  const index = findInsertInput(srcNode.inputs, outputType, ctx.isCompatible);
  if (index === -1)
    return -1;
  if (reachesDownstream(srcNode, targetNode, ctx.resolveLink, ctx.getNodeById))
    return -1;
  return index;
}
var enabled = true;
var autoInsert = true;
function getCanvas() {
  return app.canvas;
}
function getIsCompatible() {
  const global = globalThis.LiteGraph;
  const native = global?.isValidConnection;
  if (typeof native !== "function")
    return isTypeCompatible;
  return (outType, inType) => {
    try {
      return native.call(global, outType, inType);
    } catch {
      return isTypeCompatible(outType, inType);
    }
  };
}
function insertSuppressed(altKey) {
  return !autoInsert || altKey === true;
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
    if (outSlot) {
      return {
        node,
        index: node.outputs?.indexOf(outSlot) ?? -1,
        outSlot,
        srcNode: first.node
      };
    }
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
function drawWire(ctx, a, b, dash) {
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
  ctx.setLineDash(dash);
  ctx.strokeStyle = HL;
  ctx.lineWidth = 2.5;
  bezier();
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
    drawWire(ctx, a, b, [9, 6]);
    drawRing(ctx, b, 7);
  }
  if (linkIds.length > 0 && !insertSuppressed(canvas.pointer?.eMove?.altKey)) {
    const inputIndex = planInsertion(hit.srcNode, hit.node, hit.outSlot.type, {
      resolveLink: (id) => resolveLink(graph, id),
      getNodeById: (id) => graph.getNodeById(id),
      isCompatible: getIsCompatible()
    });
    if (inputIndex !== -1) {
      const dst = hit.srcNode.getInputPos(inputIndex);
      drawWire(ctx, a, dst, [4, 4]);
      drawRing(ctx, dst, 7);
    }
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
    const resolve = (id) => resolveLink(graph, id);
    const byId = (id) => graph.getNodeById(id);
    const targets = collectDownstream(linkIds, resolve, byId);
    const moved = performSwap(srcNode, first.fromSlotIndex, targets);
    let spliced = false;
    if (!insertSuppressed(inner.altKey)) {
      const outIndex = targetNode.outputs?.indexOf(outSlot) ?? -1;
      const inputIndex = planInsertion(srcNode, targetNode, outSlot.type, {
        resolveLink: resolve,
        getNodeById: byId,
        isCompatible: getIsCompatible()
      });
      if (outIndex !== -1 && inputIndex !== -1) {
        spliced = !!targetNode.connect(outIndex, srcNode, inputIndex);
      }
    }
    console.info(`[${EXT_NAME}] moved ${moved}/${linkIds.length} link(s) -> "${srcNode.title}"` + (spliced ? ` (spliced in after "${targetNode.title}")` : ""));
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
    },
    {
      id: AUTO_INSERT_SETTING_ID,
      name: "Output swap: also splice the dragged node into the stream",
      tooltip: "After a takeover, wire the taken-over output back into the dragged node's own input, inserting it between. Only fires when that input is unambiguous, free, concretely typed, and would not create a cycle. Hold Alt while dropping to skip it for one gesture.",
      type: "boolean",
      defaultValue: true,
      onChange: (value) => {
        autoInsert = value !== false;
      }
    }
  ],
  async setup() {
    installOutputSwap();
  }
});
export {
  reachesDownstream,
  planInsertion,
  performSwap,
  isWildcardSlotType,
  isTypeCompatible,
  isOutputSlotHit,
  findInsertInput,
  collectDownstream,
  bezierControlDistance
};
