type ModelSource = 'network' | 'cache'

const CACHE_NAME = 'instant-cleanup-model-cache-v1'

interface LoadModelBufferOptions {
  onProgress?: (progress: {
    source: ModelSource
    downloadedBytes: number
    totalBytes: number | null
    percent: number | null
  }) => void
}

export async function loadModelBuffer(
  modelUrl: string,
  options: LoadModelBufferOptions = {},
): Promise<{
  buffer: ArrayBuffer
  byteLength: number
  source: ModelSource
}> {
  const request = new Request(modelUrl, {
    mode: 'cors',
    credentials: 'omit',
  })

  if ('caches' in window) {
    const cache = await caches.open(CACHE_NAME)
    const cachedResponse = await cache.match(request)

    if (cachedResponse) {
      const cachedBuffer = await cachedResponse.arrayBuffer()
      options.onProgress?.({
        source: 'cache',
        downloadedBytes: cachedBuffer.byteLength,
        totalBytes: cachedBuffer.byteLength,
        percent: 100,
      })

      return {
        buffer: cachedBuffer,
        byteLength: cachedBuffer.byteLength,
        source: 'cache',
      }
    }

    const networkResponse = await fetch(request)
    const networkBuffer = await readResponseBuffer(networkResponse, 'network', options.onProgress)

    try {
      await cache.put(
        request,
        new Response(networkBuffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(networkBuffer.byteLength),
          },
        }),
      )
    } catch (error) {
      console.warn('Failed to persist model into Cache Storage.', error)
    }

    return {
      buffer: networkBuffer,
      byteLength: networkBuffer.byteLength,
      source: 'network',
    }
  }

  const response = await fetch(request)
  const buffer = await readResponseBuffer(response, 'network', options.onProgress)
  return {
    buffer,
    byteLength: buffer.byteLength,
    source: 'network',
  }
}

async function readResponseBuffer(
  response: Response,
  source: ModelSource,
  onProgress?: LoadModelBufferOptions['onProgress'],
): Promise<ArrayBuffer> {
  if (!response.ok) {
    throw new Error(`Model download failed with ${response.status} ${response.statusText}.`)
  }

  const totalBytesHeader = response.headers.get('content-length')
  const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : null

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    onProgress?.({
      source,
      downloadedBytes: buffer.byteLength,
      totalBytes: totalBytes ?? buffer.byteLength,
      percent: 100,
    })
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let downloadedBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    if (!value) {
      continue
    }

    chunks.push(value)
    downloadedBytes += value.byteLength

    onProgress?.({
      source,
      downloadedBytes,
      totalBytes,
      percent: totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : null,
    })
  }

  const combined = new Uint8Array(downloadedBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }

  onProgress?.({
    source,
    downloadedBytes,
    totalBytes: totalBytes ?? downloadedBytes,
    percent: 100,
  })

  return combined.buffer
}
