import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const sourceDir = join(rootDir, 'node_modules', 'onnxruntime-web', 'dist')
const targetDir = join(rootDir, 'src', 'generated', 'ort')

const files = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]

await mkdir(targetDir, { recursive: true })

for (const file of files) {
  await copyFile(join(sourceDir, file), join(targetDir, file))
}

console.log(`synced ${files.length} ONNX Runtime assets to src/generated/ort`)
