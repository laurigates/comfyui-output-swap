"""Output Swap for ComfyUI.

Frontend-only pack: no Python nodes. The TypeScript source in `src/` is
compiled to ESM via `bun build` and emitted to `web/dist/`, which ComfyUI
serves as the extension root via WEB_DIRECTORY below. See ADR-0001.
"""

WEB_DIRECTORY = "./web/dist"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
