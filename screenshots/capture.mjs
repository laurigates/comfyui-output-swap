// Playwright driver for the README screenshot (GESTURE-AFFORDANCE archetype,
// with forced connector state — a hybrid of the touch-resize and touch-connect
// drivers).
//
// The pack's affordance is painted by a chained `onDrawForeground`, but only
// while a link drag is in flight. A headless run can't perform a real drag, so
// instead of faking objects we drive LiteGraph's own API:
//
//   linkConnector.dragNewFromOutput(graph, nodeB, nodeB.outputs[CLIP])
//
// which sets `state.connectingTo = "input"` and pushes a real ToInputRenderLink
// — exactly the state a live drag from an output produces. Parking
// `canvas.graph_mouse` over node A's CLIP output then satisfies the pack's
// hoveredOutput() hit-test, so the takeover affordance paints: a ring on A's
// output, dashed wires to every downstream input it feeds, and a ring on each
// of those inputs. LiteGraph itself draws the in-flight drag line from B.
//
// The workflow is a fan-out (A.CLIP feeds two CLIPTextEncode nodes) so the shot
// shows the defining behaviour: ALL of the target output's links get taken over.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = resolve(HERE, "workflow.json");
const OUT_DIR = process.env.OUT_DIR || "/out";
const BASE_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188/";

const NODE_TARGET = 1; // Source A — currently feeds both upscalers
const NODE_SOURCE = 2; // Source B — the output being dragged
const OUT_SLOT = 0; // EmptyLatentImage has a single LATENT output

// The workflow deliberately uses file-free node types (EmptyLatentImage /
// LatentUpscale). A model-loader node would render with a red "missing model"
// error outline here, because the container ships no model files.

async function dismissStartupDialog(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".p-dialog-mask")) el.remove();
  });
}

// Hide the Vue UI chrome so the shot is canvas-only. Done before framing, since
// hiding it reflows the canvas element the graph coordinates project onto.
async function hideChrome(page) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = `
      .comfyui-menu, .comfyui-body-top, .comfyui-body-left, .comfyui-body-right,
      .comfyui-body-bottom, .comfy-menu, .actionbar, .p-toast,
      [data-testid="side-toolbar"] { display: none !important; }`;
    document.head.appendChild(style);
  });
  await page.waitForTimeout(250);
}

async function main() {
  const workflow = JSON.parse(await readFile(WORKFLOW_PATH, "utf8"));
  const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error" || t === "warning") console.log(`[page:${t}] ${msg.text()}`);
  });

  console.log(`Navigating to ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => window.app && window.app.graph && Array.isArray(window.app.graph._nodes),
    null,
    { timeout: 30_000 },
  );

  // Fail loudly if the pack didn't load — a silently missing affordance would
  // otherwise produce a plausible-looking but wrong screenshot.
  const packLoaded = await page.evaluate(() =>
    (window.app.extensions || []).some((e) => e && e.name === "comfy.output-swap"),
  );
  if (!packLoaded) throw new Error("comfy.output-swap extension not registered");

  console.log("Loading workflow...");
  await page.evaluate((wf) => window.app.loadGraphData(wf, true), workflow);
  await page.waitForFunction(() => window.app.graph._nodes.length >= 4, null, {
    timeout: 10_000,
  });
  await dismissStartupDialog(page);
  await hideChrome(page);

  console.log("Framing the graph and forcing the takeover drag...");
  const info = await page.evaluate(
    ({ targetId, sourceId, clipSlot }) => {
      const canvas = window.app.canvas;
      const graph = window.app.graph;
      const target = graph.getNodeById(targetId);
      const source = graph.getNodeById(sourceId);
      const TITLE = 30;
      // Generous margin so the clipped region clears the fixed top-left graph
      // breadcrumb without depending on a (drift-prone) chrome selector.
      const MARGIN = 150;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of graph._nodes) {
        minX = Math.min(minX, n.pos[0]);
        minY = Math.min(minY, n.pos[1] - TITLE);
        maxX = Math.max(maxX, n.pos[0] + n.size[0]);
        maxY = Math.max(maxY, n.pos[1] + n.size[1]);
      }

      const ds = canvas.ds;
      ds.scale = 1;
      ds.offset[0] = MARGIN - minX;
      ds.offset[1] = MARGIN - minY;

      // Drive LiteGraph's real drag-from-output entry point.
      canvas.linkConnector.reset();
      canvas.linkConnector.dragNewFromOutput(graph, source, source.outputs[clipSlot]);

      // Park the pointer on the target output so the pack's hit-test fires.
      const hover = target.getOutputPos(clipSlot);
      canvas.graph_mouse[0] = hover[0];
      canvas.graph_mouse[1] = hover[1];

      canvas.setDirty(true, true);
      canvas.draw(true, true);

      const lc = canvas.linkConnector;
      return {
        isConnecting: lc.isConnecting === true,
        connectingTo: lc.state && lc.state.connectingTo,
        renderLinks: (lc.renderLinks || []).length,
        takenOverLinks: (target.outputs[clipSlot].links || []).length,
        bbox: {
          x: (minX + ds.offset[0]) * ds.scale,
          y: (minY + ds.offset[1]) * ds.scale,
          w: (maxX - minX) * ds.scale,
          h: (maxY - minY) * ds.scale,
        },
      };
    },
    { targetId: NODE_TARGET, sourceId: NODE_SOURCE, clipSlot: OUT_SLOT },
  );

  console.log(
    `  connecting=${info.isConnecting} to=${info.connectingTo} ` +
      `renderLinks=${info.renderLinks} linksUnderTarget=${info.takenOverLinks}`,
  );
  if (!info.isConnecting || info.connectingTo !== "input" || info.renderLinks < 1) {
    throw new Error("failed to force the link-drag state; affordance would not paint");
  }
  if (info.takenOverLinks < 2) {
    throw new Error("target output should fan out to 2 inputs for the takeover shot");
  }

  // Redraw once more after a beat: the first draw can land before the frontend
  // has settled the node layout on a freshly loaded graph.
  await page.waitForTimeout(400);
  await page.evaluate(() => window.app.canvas.draw(true, true));
  await page.waitForTimeout(200);

  const PAD = 40;
  const clip = {
    x: Math.max(0, info.bbox.x - PAD),
    y: Math.max(0, info.bbox.y - PAD),
    width: info.bbox.w + PAD * 2,
    height: info.bbox.h + PAD * 2,
  };
  console.log(`Capturing ${OUT_DIR}/takeover.png...`);
  await page.screenshot({ path: `${OUT_DIR}/takeover.png`, clip });
  await browser.close();
}

main().catch((err) => {
  console.error("capture failed:", err);
  process.exit(1);
});
