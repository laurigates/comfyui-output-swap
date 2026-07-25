# README screenshot pipeline

Containerized [Playwright](https://playwright.dev) + ComfyUI generator that
regenerates the README screenshot (`docs/takeover.png`) reproducibly, so the shot
doesn't depend on whatever models/theme/frontend a particular dev machine has.

## Run

From the repo root:

```sh
just screenshots
```

First build is ~4 min (clones ComfyUI, installs CPU torch + ComfyUI deps, pulls
the npm driver dep on top of the pre-baked Chromium). Cached rebuilds are ~30s.
The PNG lands at `docs/takeover.png`.

## Iterating without a rebuild

`capture.mjs` + `workflow.json` are COPY'd late, so editing them rebuilds in
~30s. To iterate even faster, mount them into the cached image:

```sh
docker build -f screenshots/Dockerfile -t comfyui-output-swap-screenshots .
docker run --rm -v "$(pwd)/docs:/out" -v "$(pwd)/screenshots/capture.mjs:/opt/screenshots/capture.mjs" -v "$(pwd)/screenshots/workflow.json:/opt/screenshots/workflow.json" comfyui-output-swap-screenshots
```

## Pins (bump deliberately)

- **`ARG COMFYUI_REF`** (`Dockerfile`) - the ComfyUI release pins the frontend
  bundle the render depends on.
- **Playwright version** - pinned in BOTH `Dockerfile` (`FROM ...playwright:v1.49.1-noble`)
  and `package.json`. Keep them in lockstep; bump together.

## Don't hand-edit `docs/takeover.png`

It's generated. To change it, edit `capture.mjs` / `workflow.json` and re-run
`just screenshots`.
