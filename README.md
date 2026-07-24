# comfyui-output-swap

Drag one output onto another to take over its downstream links — reroute a connection's source without hunting for the target input.

> Part of a family of mobile-first ComfyUI usability packs
> ([gallery-loader](https://github.com/laurigates/comfyui-gallery-loader),
> [sampler-info](https://github.com/laurigates/comfyui-sampler-info)):
> touch-friendly gestures and HTML modals that replace clunky native
> LiteGraph interactions, additive and non-clobbering.

## Install

```sh
cd <ComfyUI>/custom_nodes
git clone https://github.com/laurigates/comfyui-output-swap
cd comfyui-output-swap
bun install
bun run build      # emit web/dist/ (served by ComfyUI)
```

Restart ComfyUI; hard-refresh the browser tab (Ctrl+Shift+R / Cmd+Shift+R).

## What it does

Drag one output onto another to take over its downstream links — reroute a connection's source without hunting for the target input.

It enhances the canvas gesture it adds and which targets it acts on — additive and mobile-first, always falling back to the
native control so serialized workflows never break. Expand this section with the
concrete before/after once the pack logic lands.

<!-- Hero screenshot: add the containerized screenshot pipeline with the
     `comfyui-screenshot-pipeline` skill (`just screenshots`), then embed the
     committed docs/*.png here with an italic caption, like the sibling packs. -->

## Compatibility

- ComfyUI: modern Vue frontend (`comfyui-frontend-package >= 1.40`) for
  the canvas pointer-event model (`app.canvas`, `ds.scale`/`ds.offset`).
- Frontend changes take effect after `bun run build` + a browser hard-refresh —
  no ComfyUI restart.

## License

MIT — see `LICENSE`.
