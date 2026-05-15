# Instant Cleanup

Browser-side image cleanup built for Cloudflare Pages. The app uses
[`Carve/LaMa-ONNX`](https://huggingface.co/Carve/LaMa-ONNX) with
`onnxruntime-web`, prefers WebGPU, and falls back to single-threaded WASM.

The runtime now preloads:

- ONNX Runtime wasm assets
- the LaMa model binary
- the inference session

`Run Cleanup` stays disabled until those assets are fully loaded.

## Flow

1. Page loads and preloads wasm, model, and session.
2. User uploads an image.
3. The image is displayed on a Konva canvas.
4. User paints a mask.
5. The app computes a square ROI around the mask.
6. That ROI is resized to `512×512`.
7. ONNX Runtime Web runs LaMa locally in the browser.
8. The repaired patch is resized back to the ROI size.
9. A feathered mask blends the patch into the original image.
10. The result is downloaded as PNG.

## Stack

- Cloudflare Pages
- Vite + React + TypeScript
- `onnxruntime-web`
- WebGPU first, WASM fallback
- Canvas + Konva

## Local Setup

```bash
npm install
npm run model:fetch
npm run dev
```

Local model storage:

- Download path: `local-models/lama_fp32.onnx`
- Dev URL: `/models/lama_fp32.onnx`

That mapping is dev-only. The model file is not copied into `dist/`.

## Model Resolution

Model URL selection:

- If `VITE_MODEL_URL` is set, that value is used.
- Otherwise development uses `/models/lama_fp32.onnx`.
- Otherwise production uses `https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx`.

ORT wasm asset selection:

- Development uses local generated files under `src/generated/ort/`.
- Production uses `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/`.

This split exists because Cloudflare Pages free deploys reject files larger than
`25 MiB`, and the ORT `jsep.wasm` asset is slightly above that threshold.

## Runtime Behavior

- The app shows download progress for the model.
- The model binary is cached in browser Cache Storage when available.
- Later refreshes usually load from browser cache instead of re-downloading.
- Runtime metrics show model source, model size, init time, inference time, and
  per-step timings.

## Environment Override

To override the model URL:

```bash
cp .env.example .env.local
```

Example:

```bash
VITE_MODEL_URL=https://your-model-host.example.com/lama_fp32.onnx
```

Useful examples:

```bash
VITE_MODEL_URL=/models/lama_fp32.onnx
VITE_MODEL_URL=https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
```

## Scripts

- `npm run dev` starts local Vite development.
- `npm run build` creates the production bundle in `dist/`.
- `npm run check` runs lint and build.
- `npm run model:fetch` downloads `lama_fp32.onnx` into `local-models/`.
- `npm run cf:project:create` creates a Cloudflare Pages project.
- `npm run cf:deploy` builds and deploys with Wrangler.
- `npm run cf:dev` builds and serves the Pages output locally with Wrangler.
- `./scripts/smoke-fetch-model.sh` validates the helper script interface.

## Deploy To Cloudflare Pages

Standard Pages settings:

- Build command: `npm run build`
- Build output directory: `dist`

Wrangler config is included in [wrangler.jsonc](/home/luo/devOps/Instant-Cleanup/wrangler.jsonc:1):

- `name`: `instant-cleanup`
- `pages_build_output_dir`: `./dist`
- `compatibility_date`: `2026-05-15`

Deploy with Wrangler:

```bash
npm run cf:deploy
```

Notes:

- Update `name` in `wrangler.jsonc` if your Pages project uses a different name.
- `VITE_MODEL_URL` is a Vite build-time variable, not a Wrangler runtime
  binding.
- Production deploys should not include `local-models/lama_fp32.onnx`.

## Notes

- `_headers` sets long-lived cache headers for static assets that are actually
  shipped in `dist/`.
- The large ONNX model file is intentionally kept out of git and out of Pages
  build output.
