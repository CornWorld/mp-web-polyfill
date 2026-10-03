// 小程序宿主的最小类型面:只声明 polyfill 家族实际用到的能力,
// 完整类型请配合 miniprogram-api-typings 使用。

export interface WxRequestSuccess {
  data: string | ArrayBuffer
  statusCode: number
  header: Record<string, string>
  cookies?: string[]
}

export interface WxRequestFail {
  errMsg: string
  errno?: number
}

export interface WxHeadersReceived {
  statusCode: number
  header: Record<string, string>
}

export interface WxChunkReceived {
  data: ArrayBuffer
}

export interface WxRequestOptions {
  url: string
  method?: string
  data?: string | ArrayBuffer | object
  header?: Record<string, string>
  timeout?: number
  enableChunked?: boolean
  responseType?: 'text' | 'arraybuffer'
  dataType?: string
  success?: (res: WxRequestSuccess) => void
  fail?: (err: WxRequestFail) => void
}

export interface WxRequestTask {
  abort: () => void
  onHeadersReceived?: (cb: (res: WxHeadersReceived) => void) => void
  onChunkReceived?: (cb: (res: WxChunkReceived) => void) => void
}

export interface WxStorageSync {
  getStorageSync: (key: string) => unknown
  setStorageSync: (key: string, value: unknown) => void
  removeStorageSync: (key: string) => void
  getStorageInfoSync?: () => { keys: string[]; currentSize: number; limitSize: number }
}

export interface WxUploadFileSuccess {
  data: string
  statusCode: number
}

export interface WxUploadFileOptions {
  url: string
  filePath: string
  name: string
  header?: Record<string, string>
  formData?: Record<string, string>
  timeout?: number
  success?: (res: WxUploadFileSuccess) => void
  fail?: (err: WxRequestFail) => void
}

export interface WxUploadFileTask {
  abort: () => void
}

export interface WxLike extends WxStorageSync {
  request: (options: WxRequestOptions) => WxRequestTask
  uploadFile?: (options: WxUploadFileOptions) => WxUploadFileTask
  connectSocket?: (...args: unknown[]) => unknown
}
