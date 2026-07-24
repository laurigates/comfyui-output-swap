import { describe, expect, it, vi } from "vitest";
// Vitest transpiles TypeScript, so the test imports the `.ts` source directly
// (no build step). Importing the module also confirms the registerExtension
// wiring loads cleanly against tests/js/__mocks__/app.js.
import {
  bezierControlDistance,
  collectDownstream,
  isOutputSlotHit,
  performSwap,
} from "../../src/index.ts";

describe("comfyui-output-swap helpers", () => {
  describe("isOutputSlotHit", () => {
    it("accepts an output-slot hit, rejects input hits and non-objects", () => {
      expect(isOutputSlotHit({ output: {}, slot: 0 })).toBe(true);
      expect(isOutputSlotHit({ input: {}, slot: 0 })).toBe(false);
      expect(isOutputSlotHit(null)).toBe(false);
      expect(isOutputSlotHit(undefined)).toBe(false);
    });
  });

  describe("bezierControlDistance", () => {
    it("matches LiteGraph's max(30, dist * 0.25)", () => {
      expect(bezierControlDistance([0, 0], [40, 0])).toBe(30); // 0.25*40=10, clamped to 30
      expect(bezierControlDistance([0, 0], [400, 0])).toBe(100); // 0.25*400
      expect(bezierControlDistance([0, 0], [300, 400])).toBe(125); // 3-4-5 -> dist 500 -> 125
    });
  });

  describe("collectDownstream", () => {
    const links = {
      1: { target_id: 10, target_slot: 0 },
      2: { target_id: 20, target_slot: 3 },
    };
    const nodes = { 10: { title: "A" }, 20: { title: "B" } };
    const resolveLink = (id) => links[id];
    const getNodeById = (id) => nodes[id];

    it("resolves link ids to downstream {node, slot} targets", () => {
      expect(collectDownstream([1, 2], resolveLink, getNodeById)).toEqual([
        { node: nodes[10], slot: 0 },
        { node: nodes[20], slot: 3 },
      ]);
    });

    it("skips dangling link ids and missing target nodes", () => {
      const targets = collectDownstream(
        [1, 99, 2], // 99 resolves to no link
        resolveLink,
        (id) => (id === 20 ? undefined : nodes[id]), // node 20 missing
      );
      expect(targets).toEqual([{ node: nodes[10], slot: 0 }]);
    });
  });

  describe("performSwap", () => {
    it("re-homes every target onto the source output and counts moves", () => {
      const connect = vi.fn(() => ({}));
      const targets = [
        { node: { title: "X" }, slot: 0 },
        { node: { title: "Y" }, slot: 1 },
      ];
      expect(performSwap({ connect }, 2, targets)).toBe(2);
      expect(connect).toHaveBeenNthCalledWith(1, 2, targets[0].node, 0);
      expect(connect).toHaveBeenNthCalledWith(2, 2, targets[1].node, 1);
    });

    it("does not count a rejected (null) connection — the type-mismatch guard", () => {
      const connect = vi.fn((_slot, node) => (node.ok ? {} : null));
      const targets = [
        { node: { ok: true }, slot: 0 },
        { node: { ok: false }, slot: 1 },
      ];
      expect(performSwap({ connect }, 0, targets)).toBe(1);
    });
  });
});
