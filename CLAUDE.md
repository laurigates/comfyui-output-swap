# CLAUDE.md

Frontend-only ComfyUI custom-node pack in the canvas-gesture vein. `__init__.py` is a loader stub; the whole extension is TypeScript in `src/`, built to `web/dist/` via bun. See ADR-0001.

## The pattern ("the vein")

A mobile-first ComfyUI usability pack in the *gesture* vein: instead of intercepting a single widget, a frontend extension adds a CANVAS-LEVEL pointer layer. A two-finger pinch whose centroid lands inside a **selected** node (single tap selects it) resizes that node and suppresses the native canvas zoom for the gesture's duration. The enhancement is **additive** (no-op fallback if `app.canvas` or the pointer model is absent — native corner-handle resize still works), **touch-first**, and never breaks serialized workflows (it only writes `node.size`, which is already serialized). Pure geometry helpers are exported from `src/index.ts` and unit-tested; DOM/canvas wiring stays below them.

## File layout

| Path | Purpose |
|------|---------|
| `src/index.ts` | The extension: canvas pointer layer + exported pure geometry helpers. |
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
- ****No modal kit.** This gesture pack has no widget to hook and no modal; it adds a canvas pointer layer with self-contained pure helpers.**
- **Additive only.** Never clobber an existing tooltip/control; fall back to
  the native widget when there's no match. Never fabricate data.
- **Canvas pointer model is version-sensitive.** The pinch layer reads `app.canvas` / `ds.scale` / `ds.offset` and the pointer-event stream. Keep the no-op fallback (do nothing when they are absent) so native corner-handle resize always works.
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
