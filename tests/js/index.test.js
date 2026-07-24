import { describe, expect, it } from "vitest";
// Vitest transpiles TypeScript, so the test imports the `.ts` source directly
// (no build step). Importing the module also confirms the registerExtension
// wiring loads cleanly against tests/js/__mocks__/app.js.
import { pinchDistance, pointInRect, scaledSize } from "../../src/index.ts";

// Smoke tests so `bun run test` is green from the first commit. Exercise the
// pure gesture helpers. Add a jsdom test for installGestureLayer's pointer
// handling as the real resize logic lands.
describe("comfyui-output-swap gesture helpers", () => {
  it("measures pinch distance", () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("hit-tests a screen point against a rect", () => {
    const rect = { x: 10, y: 10, w: 100, h: 50 };
    expect(pointInRect(50, 30, rect)).toBe(true);
    expect(pointInRect(5, 30, rect)).toBe(false);
  });

  it("uniform-scales and clamps to a minimum size", () => {
    expect(scaledSize([200, 100], 1.5)).toEqual([300, 150]);
    expect(scaledSize([200, 100], 0.1, [120, 60])).toEqual([120, 60]);
  });
});
