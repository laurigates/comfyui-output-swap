// Minimal stub of ComfyUI's scripts/app.js for the Vitest harness.
// Extension-module tests import `app` without a real frontend.

/**
 * Every object the module under test passed to `app.registerExtension`, in
 * call order. Importing `src/index.ts` populates this as a module side effect,
 * which is the only handle a test has on the extension object — the pack does
 * not export it.
 */
export const registeredExtensions = [];

export const app = {
  registerExtension(extension) {
    registeredExtensions.push(extension);
  },
  graph: { _nodes: [] },
};
