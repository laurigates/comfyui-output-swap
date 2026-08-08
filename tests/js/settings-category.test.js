// Pins the "Touch Tools" settings filing. Node env, pure data inspection —
// importing the source runs `app.registerExtension` against the harness stub,
// which records the extension object.
//
// WHAT THIS TIER CANNOT ASSERT (all of it is browser-tier, on a live ComfyUI):
//   * That the dialog actually renders `Enable` above `Auto-insert`. The
//     reversal lives in ComfyUI's own flattenTree/sortedGroups, which is not
//     importable here; this file pins the INPUT (descending sortOrder in
//     registration order) that the spec's execution probe showed produces the
//     intended order.
//   * That the four family packs' categories do not collide with each other.
//     A collision is only observable when all of them are registered on one
//     page, which no single-pack tier can see.
//   * That stored values survived the re-key (they are keyed on `id`, and the
//     ids are pinned below — but the round-trip is a live check).
import { describe, expect, it } from "vitest";
import { registeredExtensions } from "./__mocks__/app.js";
import "../../src/index.ts";

const extension = registeredExtensions.find((e) => e.name === "comfy.output-swap");

describe("Touch Tools settings filing", () => {
  it("registered the extension with exactly two settings", () => {
    expect(extension).toBeDefined();
    expect(extension.settings).toHaveLength(2);
  });

  it("keeps the setting ids frozen, in master-then-dependent order", () => {
    // Persistence is keyed on `id` alone (settingStore.ts:78/142/157/199), so a
    // rename here silently resets every user's stored preference.
    expect(extension.settings.map((s) => s.id)).toEqual([
      "OutputSwap.enable",
      "OutputSwap.autoInsert",
    ]);
  });

  it("files both settings under Touch Tools > Output Swap", () => {
    for (const setting of extension.settings) {
      expect(setting.category?.slice(0, 2)).toEqual(["Touch Tools", "Output Swap"]);
    }
  });

  it("gives every category three elements with a distinct third", () => {
    // buildTree reuses the node at an identical full path and unconditionally
    // overwrites `parent.data` (treeUtil.ts:24-38): two settings sharing a
    // category array SILENTLY COLLAPSE into one, the first vanishing from the
    // dialog while its value stays stored. Length + distinctness is what makes
    // that impossible here.
    const thirds = extension.settings.map((s) => {
      expect(s.category).toHaveLength(3);
      return s.category[2];
    });
    expect(new Set(thirds).size).toBe(thirds.length);
  });

  it("orders sortOrder strictly descending across registration order", () => {
    // NOT cosmetic: flattenTree pops a stack (treeUtil.ts:57-66) so settings
    // render in REVERSE registration order, and the sort is stable on all-zero
    // sortOrder (SettingDialog.vue:191-195). Without descending values the
    // dependent `autoInsert` renders ABOVE the master `enable`.
    const orders = extension.settings.map((s) => s.sortOrder);
    expect(orders).toEqual([100, 90]);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeLessThan(orders[i - 1]);
    }
  });

  it("drops the redundant pack prefix from every name", () => {
    // The "Output Swap" group heading supplies the pack name now.
    for (const setting of extension.settings) {
      expect(setting.name).not.toMatch(/output swap/i);
      expect(setting.name.length).toBeGreaterThan(0);
    }
  });
});
