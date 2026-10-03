export { fetch } from './fetch'
export { Headers, headersToRecord, type HeadersInit } from './headers'
export { Request, type MPRequestInit, type MPRequestInfo, type MPBodyInit } from './request'
export { Response, type MPResponseInit } from './response'
export { AbortController, AbortSignal } from './abort'
export { Blob, File, FormData, type BlobPart, type FormDataEntryValue } from './form-data'
export { setReadableStreamClass, getReadableStreamClass, isStreamingSupported } from './streams'

export const MARKER = Symbol.for('cornworld.mp-polyfill')
