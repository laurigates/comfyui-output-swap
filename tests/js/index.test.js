import { describe, expect, it, vi } from "vitest";
// Vitest transpiles TypeScript, so the test imports the `.ts` source directly
// (no build step). Importing the module also confirms the registerExtension
// wiring loads cleanly against tests/js/__mocks__/app.js.
import {
  bezierControlDistance,
  collectDownstream,
  findInsertInput,
  isOutputSlotHit,
  isTypeCompatible,
  isWildcardSlotType,
  performSwap,
  planInsertion,
  reachesDownstream,
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

  describe("isWildcardSlotType", () => {
    it("folds LiteGraph's three wildcard spellings, and only those", () => {
      for (const t of ["", "*", 0, null, undefined]) expect(isWildcardSlotType(t)).toBe(true);
      for (const t of ["IMAGE", "MODEL", "IMAGE,LATENT"]) expect(isWildcardSlotType(t)).toBe(false);
    });
  });

  describe("isTypeCompatible", () => {
    it("matches identical types case-insensitively", () => {
      expect(isTypeCompatible("IMAGE", "IMAGE")).toBe(true);
      expect(isTypeCompatible("IMAGE", "image")).toBe(true);
      expect(isTypeCompatible("IMAGE", "LATENT")).toBe(false);
    });

    it("treats wildcards as matching anything", () => {
      expect(isTypeCompatible("IMAGE", "*")).toBe(true);
      expect(isTypeCompatible("*", "MODEL")).toBe(true);
      expect(isTypeCompatible("IMAGE", "")).toBe(true);
    });

    it("matches comma-separated union types on any permutation", () => {
      expect(isTypeCompatible("IMAGE,MASK", "MASK")).toBe(true);
      expect(isTypeCompatible("IMAGE", "LATENT,IMAGE")).toBe(true);
      expect(isTypeCompatible("IMAGE,MASK", "MODEL,CLIP")).toBe(false);
    });
  });

  describe("findInsertInput", () => {
    const free = (type) => ({ type, link: null });

    it("picks the single free, compatible, concretely-typed input", () => {
      const inputs = [free("MODEL"), free("IMAGE"), free("LATENT")];
      expect(findInsertInput(inputs, "IMAGE", isTypeCompatible)).toBe(1);
    });

    it("refuses when two inputs qualify — image1/image2 is a coin flip", () => {
      const inputs = [free("IMAGE"), free("IMAGE")];
      expect(findInsertInput(inputs, "IMAGE", isTypeCompatible)).toBe(-1);
    });

    it("skips occupied inputs rather than destroying an existing link", () => {
      const inputs = [{ type: "IMAGE", link: 7 }, free("IMAGE")];
      expect(findInsertInput(inputs, "IMAGE", isTypeCompatible)).toBe(1);
      expect(findInsertInput([{ type: "IMAGE", link: 7 }], "IMAGE", isTypeCompatible)).toBe(-1);
    });

    it("skips wildcard inputs — a '*' slot would match every drop", () => {
      expect(findInsertInput([free("*"), free("")], "IMAGE", isTypeCompatible)).toBe(-1);
    });

    it("refuses to guess from a wildcard output type", () => {
      expect(findInsertInput([free("IMAGE")], "*", isTypeCompatible)).toBe(-1);
    });

    it("handles a node with no inputs at all", () => {
      expect(findInsertInput(undefined, "IMAGE", isTypeCompatible)).toBe(-1);
      expect(findInsertInput([], "IMAGE", isTypeCompatible)).toBe(-1);
    });
  });

  describe("reachesDownstream", () => {
    // a -> b -> c, plus an isolated d
    const c = { title: "c", outputs: [] };
    const b = { title: "b", outputs: [{ links: [2] }] };
    const a = { title: "a", outputs: [{ links: [1] }] };
    const d = { title: "d", outputs: [] };
    const links = { 1: { target_id: "b" }, 2: { target_id: "c" } };
    const nodes = { a, b, c, d };
    const resolveLink = (id) => links[id];
    const getNodeById = (id) => nodes[id];

    it("finds direct and transitive descendants", () => {
      expect(reachesDownstream(a, b, resolveLink, getNodeById)).toBe(true);
      expect(reachesDownstream(a, c, resolveLink, getNodeById)).toBe(true);
    });

    it("does not walk upstream or reach disconnected nodes", () => {
      expect(reachesDownstream(c, a, resolveLink, getNodeById)).toBe(false);
      expect(reachesDownstream(a, d, resolveLink, getNodeById)).toBe(false);
    });

    it("reports a node as reaching itself", () => {
      expect(reachesDownstream(a, a, resolveLink, getNodeById)).toBe(true);
    });

    it("terminates on a graph that already contains a cycle", () => {
      const x = { outputs: [{ links: [10] }] };
      const y = { outputs: [{ links: [11] }] };
      const cyclic = { 10: { target_id: "y" }, 11: { target_id: "x" } };
      expect(
        reachesDownstream(
          x,
          { title: "elsewhere" },
          (id) => cyclic[id],
          (id) => (id === "x" ? x : y),
        ),
      ).toBe(false);
    });

    it("skips dangling links and missing nodes", () => {
      const orphan = { outputs: [{ links: [99] }] };
      expect(reachesDownstream(orphan, a, resolveLink, getNodeById)).toBe(false);
    });
  });

  describe("planInsertion", () => {
    const ctx = (links = {}, nodes = {}) => ({
      resolveLink: (id) => links[id],
      getNodeById: (id) => nodes[id],
      isCompatible: isTypeCompatible,
    });

    it("returns the input index when every guard passes", () => {
      const src = { inputs: [{ type: "IMAGE", link: null }], outputs: [] };
      const target = { outputs: [{ type: "IMAGE", links: [] }] };
      expect(planInsertion(src, target, "IMAGE", ctx())).toBe(0);
    });

    it("refuses when the splice would close a cycle (src is upstream of target)", () => {
      const target = { inputs: [], outputs: [{ type: "IMAGE", links: [] }] };
      const src = {
        inputs: [{ type: "IMAGE", link: null }],
        outputs: [{ links: [1] }], // src -> target already
      };
      const links = { 1: { target_id: "target" } };
      expect(planInsertion(src, target, "IMAGE", ctx(links, { target }))).toBe(-1);
    });

    it("refuses when no input qualifies, without walking the graph", () => {
      const src = { inputs: [{ type: "MODEL", link: null }], outputs: [] };
      const target = { outputs: [] };
      expect(planInsertion(src, target, "IMAGE", ctx())).toBe(-1);
    });
  });
});
