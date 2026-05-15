# Instant Cleanup

Browser-side image cleanup built for Cloudflare Pages. The app uses the
[`Carve/LaMa-ONNX`](https://huggingface.co/Carve/LaMa-ONNX) model with
`onnxruntime-web`, prefers WebGPU, and falls back to WASM when GPU execution is
not available. The model is downloaded with visible progress, cached in the
browser, and reused across page refreshes when Cache Storage is available.

## Flow

1. User uploads an image.
2. The image is displayed on a Konva canvas.
3. User paints a mask.
4. The app computes a square ROI around the mask.
5. That ROI is resized to `512×512`.
6. ONNX Runtime Web runs LaMa locally in the browser.
7. The repaired patch is resized back to the ROI size.
8. A feathered mask blends the patch into the original image.
9. The result is downloaded as PNG.

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

The default model location is `public/models/lama_fp32.onnx`, which is served as
`/models/lama_fp32.onnx`.

Default model resolution is environment-specific:

- Development uses `/models/lama_fp32.onnx`
- Production uses `https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx`

## Optional Environment Override

If you want to host the model elsewhere, define `VITE_MODEL_URL`:

```bash
cp .env.example .env.local
```

Example:

```bash
VITE_MODEL_URL=https://your-model-host.example.com/lama_fp32.onnx
```

If `VITE_MODEL_URL` is set, it overrides both defaults.

Recommended local override:

```bash
VITE_MODEL_URL=/models/lama_fp32.onnx
```

Recommended Cloudflare Pages production override if you want to pin the exact
same Hugging Face path explicitly:

```bash
VITE_MODEL_URL=https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
```

## Scripts

- `npm run dev` starts local Vite development.
- `npm run build` creates the production bundle in `dist/`.
- `npm run check` runs lint and build.
- `npm run model:fetch` downloads `lama_fp32.onnx`.
- `./scripts/smoke-fetch-model.sh` validates the helper script interface.

## Deploy To Cloudflare Pages

Use the standard Vite Pages settings:

- Build command: `npm run build`
- Build output directory: `dist`

You can deploy from the dashboard or with Wrangler:

```bash
npx wrangler pages deploy dist
```

## Notes

- The included `_headers` file marks `/models/*` and `/assets/*` as immutable
  static assets for stronger Cloudflare edge caching when you use local model
  hosting.
- The repository intentionally does not commit the large ONNX model file by
  default.
