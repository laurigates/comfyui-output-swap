# syntax=docker/dockerfile:1.26
#
# Single-stage build for the README screenshot generator. Base image: the
# official Playwright image (Node 22 + Chromium pre-installed). On top we
# install Python + clone a pinned ComfyUI release + CPU-only torch + ComfyUI's
# requirements. The entrypoint boots ComfyUI headless on :8188, waits for
# /system_stats, then runs the Playwright driver which writes /out/takeover.png.

# Pin to a real ComfyUI release. Bumping is deliberate - the render is sensitive
# to the frontend bundle that ships with this release. v0.22.0 ships
# comfyui-frontend-package==1.43.18, clearing the pack's >=1.40 floor.
ARG COMFYUI_REF=v0.22.0

# Pinning the Playwright image version pins the Chromium revision too, the
# single largest source of cross-host font-rendering drift. Keep in sync with
# the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

ARG COMFYUI_REF

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    EXPECTED_OUTPUTS="takeover.png"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/local/bin/python

WORKDIR /opt
RUN git clone --depth 1 --branch "${COMFYUI_REF}" \
    https://github.com/comfyanonymous/ComfyUI.git /opt/ComfyUI

WORKDIR /opt/ComfyUI

# CPU-only torch keeps the image lean and avoids CUDA driver dependencies.
RUN pip install --index-url https://download.pytorch.org/whl/cpu \
        torch torchvision torchaudio \
    && pip install -r requirements.txt

WORKDIR /opt/screenshots
COPY screenshots/package.json /opt/screenshots/package.json
# Chromium is pre-installed in the Playwright base image, so we only need the
# npm dependency for the driver script itself.
RUN npm install --omit=dev

# The pack lives under custom_nodes/ with the canonical directory name. This
# name is the served URL prefix (/extensions/comfyui-output-swap/), so don't rename it.
COPY . /opt/ComfyUI/custom_nodes/comfyui-output-swap

COPY screenshots/capture.mjs /opt/screenshots/capture.mjs
COPY screenshots/workflow.json /opt/screenshots/workflow.json
COPY screenshots/entrypoint.sh /opt/screenshots/entrypoint.sh
RUN chmod +x /opt/screenshots/entrypoint.sh

WORKDIR /opt/ComfyUI

VOLUME ["/out"]

ENTRYPOINT ["/opt/screenshots/entrypoint.sh"]
