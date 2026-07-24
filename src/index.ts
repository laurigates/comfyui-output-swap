// Output Swap — ComfyUI frontend extension (canvas-gesture pack).
//
// TypeScript source in `src/`, built to ESM via `bun build` and emitted to
// `web/dist/` (served at /extensions/comfyui-output-swap/index.js — the pack
// directory name IS the URL segment). Do not rename the pack dir without
// syncing EXT_NAME below. See ADR-0001.
//
// Pattern ("the gesture vein"): instead of intercepting a single widget, this
// pack adds CANVAS-LEVEL behavior. Dragging one output onto another node's
// output slot of the same type is a no-op in stock LiteGraph; this pack gives
// it meaning — the dragged output TAKES OVER all of the target output's
// downstream links (each downstream input is re-homed to the dragged source),
// leaving the target output disconnected. It saves hunting down where a
// connection goes just to re-source it.
//
// Additive + fail-soft: it hooks the LinkConnector 'dropped-on-node' event
// (still delivered under quick-connections' processMouseUp wrap, which calls
// through) and only acts when the drop lands on an output slot — every other
// drop falls through to native behavior. A hover affordance is drawn via
// canvas onDrawForeground (chained, never clobbering a prior handler). Nothing
// is written to serialized state beyond the links the user asked to move.
//
// Pure helpers are exported and unit-tested (tests/js); the canvas/DOM wiring
// below is exercised in the manual browser matrix. This variant has NO
// @laurigates/comfy-modal-kit dependency — there is no widget or modal.
//
// ComfyUI serves its frontend API at runtime from `/scripts/app.js`. The
// emitted import string stays `/scripts/app.js` (bun's `--external '/scripts/*'`
// keeps it unbundled); the type is supplied via a `paths` mapping in
// tsconfig.json that points the import at `src/comfyui-shims.d.ts`. See ADR-0001.
import { app } from "/scripts/app.js";

const EXT_NAME = "comfyui-output-swap";
const SETTING_ID = "OutputSwap.enable";

// Highlight colour for the takeover affordance. Distinct from LiteGraph's
// native input-slot hover marker (a solid gold #ffcc00 dot) so the two read
// differently: this is a hollow cyan ring + dashed cyan wires.
const HL = "#26d0ff";

// LiteGraph's spline control distance (src/renderer/core/canvas/pathRenderer.ts):
// controlDist = max(30, dist * 0.25). Matching it makes the highlight overlay
// sit exactly on the native wire when no other link renderer is active.
const MIN_CONTROL_DIST = 30;
const CONTROL_FACTOR = 0.25;

// ============================================================
// Types — the narrow, structural LiteGraph surface this pack reaches into.
// The frontend ships minified with these internals un-exported; model only
// what we touch and verify shapes against the sourcemap (see CLAUDE.md).
// ============================================================

type Vec2 = [number, number];

interface OutputSlot {
  links?: Array<number | string> | null;
}

interface LiteNode {
  title?: string;
  graph?: LiteGraph;
  outputs?: OutputSlot[];
  getOutputOnPos?(pos: Vec2): OutputSlot | undefined;
  getOutputPos(index: number): Vec2;
  getInputPos(slot: number): Vec2;
  connect(slot: number, target: LiteNode, targetSlot: number): unknown;
}

interface LinkRecord {
  target_id: number | string;
  target_slot: number;
}

interface LinksStore {
  get?(id: number | string): LinkRecord | undefined;
  [id: number]: LinkRecord;
  [id: string]: LinkRecord | ((id: number | string) => LinkRecord | undefined) | undefined;
}

interface LiteGraph {
  links?: LinksStore;
  _nodes?: LiteNode[];
  nodes?: LiteNode[];
  getNodeById(id: number | string): LiteNode | undefined;
  setDirtyCanvas?(foreground: boolean, background: boolean): void;
}

interface RenderLink {
  node: LiteNode;
  fromSlotIndex: number;
  toType?: string;
}

interface LinkConnectorLike {
  events: EventTarget;
  state?: { connectingTo?: string };
  renderLinks?: RenderLink[];
  isConnecting?: boolean;
}

interface LiteCanvas {
  linkConnector?: LinkConnectorLike;
  graph?: LiteGraph;
  graph_mouse?: Vec2;
  onDrawForeground?: ((ctx: CanvasRenderingContext2D, area?: unknown) => void) | null;
}

/** A downstream endpoint of the target output: which input gets re-homed. */
export interface DownstreamTarget {
  node: LiteNode;
  slot: number;
}

// ============================================================
// Pure helpers (unit-tested in tests/js)
// ============================================================

/**
 * Was the drop-target slot an OUTPUT slot? LiteGraph's getSlotInPosition/
 * getOutputOnPos return `{ output, slot }` for an output hit and
 * `{ input, slot }` for an input; we only act on outputs.
 */
export function isOutputSlotHit(found: unknown): found is { slot: number } {
  return (
    !!found &&
    typeof found === "object" &&
    "output" in (found as Record<string, unknown>) &&
    "slot" in (found as Record<string, unknown>)
  );
}

/**
 * LiteGraph's native spline control distance between two canvas-space points:
 * `max(30, euclideanDistance * 0.25)`.
 */
export function bezierControlDistance(a: Vec2, b: Vec2): number {
  return Math.max(MIN_CONTROL_DIST, Math.hypot(b[0] - a[0], b[1] - a[1]) * CONTROL_FACTOR);
}

/**
 * Resolve an output slot's link ids to concrete downstream targets. Missing
 * links or nodes (stale/dangling ids) are skipped, not fatal.
 */
export function collectDownstream(
  linkIds: ReadonlyArray<number | string>,
  resolveLink: (id: number | string) => LinkRecord | undefined,
  getNodeById: (id: number | string) => LiteNode | undefined,
): DownstreamTarget[] {
  const targets: DownstreamTarget[] = [];
  for (const id of linkIds) {
    const link = resolveLink(id);
    if (!link) continue;
    const node = getNodeById(link.target_id);
    if (node == null) continue;
    targets.push({ node, slot: link.target_slot });
  }
  return targets;
}

/**
 * Re-home each downstream target onto the source output. Because a LiteGraph
 * input holds at most one link, `connect` replaces the target output's link
 * automatically — the source takes over and the old output is left empty.
 * Returns how many links actually moved (connect() returns null on a rejected,
 * e.g. type-incompatible, connection — that is the "same kind" guard).
 */
export function performSwap(
  srcNode: LiteNode,
  srcOutputIndex: number,
  targets: ReadonlyArray<DownstreamTarget>,
): number {
  let moved = 0;
  for (const t of targets) {
    if (srcNode.connect(srcOutputIndex, t.node, t.slot)) moved++;
  }
  return moved;
}

// ============================================================
// Wiring (canvas events + draw; browser-matrix tested)
// ============================================================

let enabled = true;

function getCanvas(): LiteCanvas | undefined {
  return (app as unknown as { canvas?: LiteCanvas }).canvas;
}

function resolveLink(graph: LiteGraph, id: number | string): LinkRecord | undefined {
  const links = graph.links;
  if (!links) return undefined;
  return typeof links.get === "function"
    ? links.get(id)
    : (links[id as number] as LinkRecord | undefined);
}

/** The output slot currently under the pointer during a source-output drag. */
function hoveredOutput(
  canvas: LiteCanvas,
): { node: LiteNode; index: number; outSlot: OutputSlot } | null {
  const lc = canvas.linkConnector;
  if (!lc?.isConnecting || lc.state?.connectingTo !== "input") return null;
  const first = lc.renderLinks?.[0];
  if (!first || first.toType !== "input") return null;
  const mouse = canvas.graph_mouse;
  if (!mouse) return null;
  const nodes = canvas.graph?._nodes ?? canvas.graph?.nodes ?? [];
  for (const node of nodes) {
    if (node === first.node) continue; // never target the source itself
    const outSlot = node.getOutputOnPos?.([mouse[0], mouse[1]]);
    if (outSlot) return { node, index: node.outputs?.indexOf(outSlot) ?? -1, outSlot };
  }
  return null;
}

function drawRing(ctx: CanvasRenderingContext2D, p: Vec2, r: number): void {
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

/**
 * Hover affordance: mark the takeover output, the wires it will steal, and
 * their (possibly off-screen) input endpoints. Drawn in graph space by
 * onDrawForeground; wires use the native control distance so the overlay lands
 * on the real wire when no custom link renderer is active.
 */
function drawHint(canvas: LiteCanvas, ctx: CanvasRenderingContext2D): void {
  const hit = hoveredOutput(canvas);
  const graph = canvas.graph;
  if (!hit || !graph) return;
  const a = hit.node.getOutputPos(hit.index);
  ctx.save();
  const linkIds = hit.outSlot.links ?? [];
  for (const id of linkIds) {
    const link = resolveLink(graph, id);
    const dst = link ? graph.getNodeById(link.target_id) : undefined;
    if (!link || !dst) continue;
    const b = dst.getInputPos(link.target_slot);
    const cd = bezierControlDistance(a, b);
    const bezier = (): void => {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.bezierCurveTo(a[0] + cd, a[1], b[0] - cd, b[1], b[0], b[1]);
      ctx.stroke();
    };
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(38,208,255,0.28)";
    ctx.lineWidth = 8;
    bezier(); // glow underlay
    ctx.setLineDash([9, 6]);
    ctx.strokeStyle = HL;
    ctx.lineWidth = 2.5;
    bezier(); // dashed core
    drawRing(ctx, b, 7);
  }
  drawRing(ctx, a, 9);
  ctx.restore();
}

function onDropOnNode(canvas: LiteCanvas, e: Event): void {
  if (!enabled) return;
  const lc = canvas.linkConnector;
  if (!lc) return;
  try {
    const detail = (e as CustomEvent).detail as
      | { node?: LiteNode; event?: { canvasX: number; canvasY: number } }
      | undefined;
    const targetNode = detail?.node;
    const inner = detail?.event;
    if (!targetNode || !inner || lc.state?.connectingTo !== "input") return;
    const first = lc.renderLinks?.[0];
    if (!first || first.toType !== "input") return;

    const outSlot = targetNode.getOutputOnPos?.([inner.canvasX, inner.canvasY]);
    if (!outSlot) return; // not over an output slot — let native behavior run

    // We own this gesture: suppress the surprising native fallback (which would
    // connect the dragged output to this node's first matching INPUT).
    e.preventDefault();

    const srcNode = first.node;
    if (srcNode === targetNode) return; // self-drop: no-op (default already suppressed)
    const graph = targetNode.graph;
    if (!graph) return;

    const linkIds = outSlot.links ? [...outSlot.links] : []; // snapshot before mutating
    if (linkIds.length === 0) return;

    const targets = collectDownstream(
      linkIds,
      (id) => resolveLink(graph, id),
      (id) => graph.getNodeById(id),
    );
    const moved = performSwap(srcNode, first.fromSlotIndex, targets);
    console.info(`[${EXT_NAME}] moved ${moved}/${linkIds.length} link(s) -> "${srcNode.title}"`);
    graph.setDirtyCanvas?.(true, true);
  } catch (err) {
    console.warn(`[${EXT_NAME}] drop error, native fallback`, err);
  }
}

function installOutputSwap(): void {
  const canvas = getCanvas();
  const lc = canvas?.linkConnector;
  if (!canvas || !lc?.events) {
    console.warn(`[${EXT_NAME}] linkConnector unavailable — output-swap not installed`);
    return;
  }

  lc.events.addEventListener("dropped-on-node", (e) => onDropOnNode(canvas, e));

  // Chain onto any existing onDrawForeground rather than clobbering it (e.g.
  // another extension's overlay). Ours draws first, then the prior handler.
  const prevDraw = canvas.onDrawForeground;
  canvas.onDrawForeground = function chainedDrawForeground(
    this: LiteCanvas,
    ctx: CanvasRenderingContext2D,
    area?: unknown,
  ): void {
    if (enabled) {
      try {
        drawHint(canvas, ctx);
      } catch {
        // fail-soft: a rendering hiccup must never break the canvas
      }
    }
    prevDraw?.call(this, ctx, area);
  };

  console.log(
    `[${EXT_NAME}] installed — drag an output onto another output to take over its links`,
  );
}

app.registerExtension({
  name: "comfy.output-swap",
  settings: [
    {
      id: SETTING_ID,
      name: "Output swap: drag an output onto another to take over its links",
      tooltip:
        "Drop one output onto another node's output slot of the same type to re-home all of that output's downstream links to the dragged source.",
      type: "boolean",
      defaultValue: true,
      // The settings store fires onChange once at registration with the stored
      // value, so this both initializes and live-toggles `enabled`.
      onChange: (value: boolean) => {
        enabled = value !== false;
      },
    },
  ],
  async setup() {
    installOutputSwap();
  },
});
