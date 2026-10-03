import { concatBytes, toArrayBuffer } from '../core'
import { TextEncoder } from '../text-encoding'
import { File, type FormData } from './form-data'

const encoder = new TextEncoder()

/** HTML 规范:名称中的引号与换行按百分号转义。 */
function escapeHeaderParameter(value: string): string {
  return value
    .replace(/\r\n/g, '%0D%0A')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/"/g, '%22')
}

export interface SerializedFormData {
  bytes: Uint8Array
  contentType: string
}

export function serializeFormData(formData: FormData): SerializedFormData {
  const boundary = `----cornworldFormBoundary${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  const chunks: Uint8Array[] = []
  const pushText = (text: string) => chunks.push(encoder.encode(text))

  for (const entry of formData._entriesRaw()) {
    const { name, value } = entry
    pushText(`--${boundary}\r\n`)
    if (typeof value === 'string') {
      pushText(`Content-Disposition: form-data; name="${escapeHeaderParameter(name)}"\r\n\r\n`)
      pushText(value)
      pushText('\r\n')
    } else {
      const filename = entry.filename ?? (value instanceof File ? value.name : 'blob')
      pushText(
        `Content-Disposition: form-data; name="${escapeHeaderParameter(name)}"; filename="${escapeHeaderParameter(filename)}"\r\n`,
      )
      pushText(`Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`)
      chunks.push(value._bytes)
      pushText('\r\n')
    }
  }
  pushText(`--${boundary}--\r\n`)

  return {
    bytes: concatBytes(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

export { toArrayBuffer }
