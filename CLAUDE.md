# CLAUDE.md

Frontend-only ComfyUI custom-node pack in the canvas-gesture vein. `__init__.py` is a loader stub; the whole extension is TypeScript in `src/`, built to `web/dist/` via bun. See ADR-0001.

## The pattern ("the vein")

A ComfyUI usability pack in the *canvas-behavior* vein: instead of intercepting a single widget, a frontend extension gives meaning to a gesture LiteGraph ignores. Dragging one output onto another node's output slot of the same type — a no-op in stock LiteGraph — makes the dragged output **take over all of the target output's downstream links** (each downstream input is re-homed to the dragged source), leaving the target output disconnected. It saves hunting down where a connection goes just to re-source it. The enhancement is **additive + fail-soft**: it hooks the `canvas.linkConnector` `dropped-on-node` event (still delivered under `quick-connections`' `processMouseUp` wrap, which calls through) and only acts when the drop lands on an output slot — every other drop falls through to native behavior. A hover affordance (takeover-output ring + dashed wires to each downstream input) is drawn via a **chained** `onDrawForeground` (never clobbering a prior handler). One boolean setting (`OutputSwap.enable`, default on) gates it. Pure helpers are exported from `src/index.ts` and unit-tested; canvas/DOM wiring stays below them.

## File layout

| Path | Purpose |
|------|---------|
| `src/index.ts` | The extension: LinkConnector `dropped-on-node` swap handler + chained `onDrawForeground` hint + exported pure helpers (`collectDownstream`, `performSwap`, `bezierControlDistance`, `isOutputSlotHit`). |
| `src/comfyui-shims.d.ts` | Types the `/scripts/app.js` runtime import (via the `paths` mapping in `tsconfig.json`). |
| `__init__.py` | Loader stub. Empty `NODE_CLASS_MAPPINGS`; exports `WEB_DIRECTORY = "./web/dist"`. |
| `web/dist/` | **Generated** by `bun run build`, committed (tracked) so git clone/update carries it. ComfyUI serves it at `/extensions/comfyui-output-swap/`. |
| `pyproject.toml` | Comfy Registry metadata. `PublisherId` + `version` are the fields you touch; `[tool.comfy] includes = ["web/dist"]` force-ships the built output. |
| `tsconfig.json` / `biome.json` / `knip.json` | Strict TS config, Biome lint/format, knip dead-code. |
| `.github/workflows/` | `ci.yml` (tsc+build/biome/vitest/ruff/pytest/gitleaks), `publish.yml` (builds then publishes on version bump), `release-please.yml`. |
| `tests/js/` | Vitest suite importing the `.ts` source directly. `tests/test_init.py` is a pytest loader-stub smoke test. |
| `justfile` | `build`, `lint`, `format`, `test`, `check` recipes — the local CI gate. |

## Hard rules

- **Pack directory name is part of the URL.** `web/dist/index.js` is served at
  `/extensions/comfyui-output-swap/index.js`. Renaming the pack dir breaks every fetch. If
  unavoidable, sync `EXT_NAME` in the source.
- **TypeScript source, bun build.** Author in `src/` (entry `src/index.ts`),
  build to `web/dist/` via `bun build ./src/index.ts --target browser --format
  esm --outdir web/dist --external '/scripts/*'`. `tsc --noEmit` is the type
  gate; `bun build` is the emit — they are decoupled. The `/scripts/app.js`
  import is left **unbundled** (resolved at runtime against ComfyUI's served
  module). See ADR-0001.
- **No Python dependencies. The pack is frontend-only; a feature genuinely needing Python belongs in a separate companion pack.**
- **No modal kit.** This pack has no widget to hook and no modal; it hooks a canvas event and draws an overlay, with self-contained pure helpers.
- **Additive only.** Never clobber an existing handler; chain onto `onDrawForeground` and only `preventDefault` a drop that landed on an output slot. Fall through to native behavior otherwise. Never fabricate data.
- **LiteGraph internals are version-sensitive.** The swap reads `canvas.linkConnector` (`state.connectingTo` / `renderLinks[].node`,`.fromSlotIndex` / `events`), `node.getOutputOnPos`/`getOutputPos`/`getInputPos`/`connect`, and `graph.links`/`getNodeById` — all un-exported and minified. Keep the fail-soft fallback (do nothing when absent) so native connection behavior always works, and verify shapes against the sourcemap on a `comfyui-frontend-package` bump.
- **Never hand-edit `CHANGELOG.md` or the `version` field** — release-please
  owns them (conventional commits drive the bump).

## Dev workflow

```sh
uv sync --group dev          # ruff, pytest, pre-commit
bun install                  # TypeScript, Biome, Vitest, knip, (no modal kit — gesture pack)
pre-commit install
just check                   # typecheck + build + lint + test — the local CI gate
```

Iterating on the frontend needs a **`bun run build`** (the served file is
`web/dist/index.js`, not the source) plus a browser hard-refresh — no ComfyUI
restart.

### Endpoint reachability check

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8188/extensions/comfyui-output-swap/index.js
```

## Verify the frontend API against the sourcemap

The ComfyUI frontend (`comfyui-frontend-package`) ships **minified** — property
and method names are renamed in the bundle, so reading the running app's objects
by guessed names (or trusting old tutorials) is unreliable. The TypeScript types
from `@comfyorg/comfyui-frontend-types` cover `ComfyApp` but **not** the internal
`LGraphNode` / `LGraphCanvas` / widget interfaces (un-exported). Model the small
surface you touch with local structural interfaces, and verify the real shape
against the bundled sourcemap before coding against a LiteGraph / canvas API.

LiteGraph is bundled in the **`api-*.js.map`** chunk under
`.venv/lib/python*/site-packages/comfyui_frontend_package/static/assets/`. The
`.js.map` embeds the original TypeScript in `sourcesContent` — grep that, not the
minified `.js`:

```sh
cd .venv/lib/python*/site-packages/comfyui_frontend_package/static/assets
grep -l 'LGraphGroup' *.js.map        # find the chunk
```

Facts worth confirming this way (recheck on a `comfyui-frontend-package` bump):
`LiteGraph.NODE_TITLE_HEIGHT` (30); `canvas.selectedItems` is a
`Set<Positionable>` holding nodes + groups + reroutes; `canvas.selected_nodes` is
a node-only dictionary; canvas zoom is **wheel-driven**
(`processMouseWheel -> ds.changeScale`).

Two gotchas that follow: discriminate selected items by **shape, not
`instanceof`** (the class is renamed under minification); and to suppress native
zoom during a gesture, intercept `wheel` (capture, `passive:false`,
`preventDefault`), not just pointer events. Record what you confirm in a
"Verified frontend API" table above so the next change doesn't re-derive it.

## Releases

Merge the release-please PR → the published GitHub release triggers
`publish.yml`, which runs `bun run build`, publishes via
`Comfy-Org/publish-node-action`, attaching the release notes as the per-version registry changelog (the "Updates" section). Requires the
`REGISTRY_ACCESS_TOKEN` repo secret. Use conventional commits; release-please
maintains `CHANGELOG.md` and the version bump PR.
