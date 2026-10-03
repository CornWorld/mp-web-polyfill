import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startWxMock, type WxMock } from '@cornworld/wx-mock'

let mock: WxMock
let tempDir: string

beforeEach(async () => {
  mock = await startWxMock()
  tempDir = mkdtempSync(join(tmpdir(), 'wx-mock-upload-'))
})

afterEach(async () => {
  await mock.close()
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('wx.uploadFile 模拟(磁盘文件 → multipart)', () => {
  it('文件与 formData 字段都以 multipart 到达服务端', async () => {
    const filePath = join(tempDir, 'avatar.png')
    writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))

    const done = new Promise<{ body: Buffer; headers: Record<string, string> }>((resolve, reject) => {
      mock.handler = (req, res, body) => {
        resolve({ body: body, headers: req.headers as Record<string, string> })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'r1' }))
      }
      mock.wx.uploadFile!({
        url: `${mock.origin}/api/collections/users/records`,
        filePath,
        name: 'avatar',
        header: { authorization: 'TOKEN123' },
        formData: { title: '我的头像' },
        fail: (err) => reject(new Error(err.errMsg)),
      })
    })

    const { body, headers } = await done
    expect(headers['authorization']).toBe('TOKEN123')
    expect(headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(body.toString('utf8')).toContain('Content-Disposition: form-data; name="title"')
    expect(body.toString('utf8')).toContain('name="avatar"; filename="avatar.png"')
    expect(body.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true)
  })

  it('文件不存在 → fail', async () => {
    const failed = new Promise<string>((resolve) => {
      mock.wx.uploadFile!({
        url: `${mock.origin}/x`,
        filePath: '/nonexistent/file.bin',
        name: 'file',
        fail: (err) => resolve(err.errMsg),
      })
    })
    await expect(failed).resolves.toContain('uploadFile:fail')
  })
})
