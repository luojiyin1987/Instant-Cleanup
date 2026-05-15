import { createReadStream, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-model-dev-server',
      configureServer(server) {
        const modelPath = resolve(server.config.root, 'local-models', 'lama_fp32.onnx')

        server.middlewares.use('/models/lama_fp32.onnx', (_req, res) => {
          if (!existsSync(modelPath)) {
            res.statusCode = 404
            res.end(
              'Local model not found. Run `npm run model:fetch` to download local-models/lama_fp32.onnx.',
            )
            return
          }

          const stat = statSync(modelPath)
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Length', String(stat.size))
          createReadStream(modelPath).pipe(res)
        })
      },
    },
  ],
})
