import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { ReportStorage, ReportStorageObject } from './types'

type R2Env = {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

function readR2Env(): R2Env {
  const endpoint = import.meta.env.R2_ENDPOINT
  const accessKeyId = import.meta.env.R2_ACCESS_KEY_ID
  const secretAccessKey = import.meta.env.R2_SECRET_ACCESS_KEY
  const bucket = import.meta.env.R2_BUCKET_NAME

  const missing: string[] = []
  if (!endpoint) missing.push('R2_ENDPOINT')
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID')
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY')
  if (!bucket) missing.push('R2_BUCKET_NAME')

  if (missing.length > 0) {
    throw new Error(
      `Missing R2 credentials in env: ${missing.join(', ')}. Either set them or switch the tenant to "on_demand" mode.`
    )
  }

  return {
    endpoint: endpoint as string,
    accessKeyId: accessKeyId as string,
    secretAccessKey: secretAccessKey as string,
    bucket: bucket as string,
  }
}

/**
 * Lazy singleton — the SDK client is heavy enough that we don't want one
 * per request, but cheap to keep around for the lifetime of the server
 * process.
 */
let cachedClient: { client: S3Client; bucket: string } | null = null

function getClient(): { client: S3Client; bucket: string } {
  if (cachedClient) return cachedClient
  const env = readR2Env()
  cachedClient = {
    client: new S3Client({
      region: 'auto', // R2 ignores region; "auto" is the documented value.
      endpoint: env.endpoint,
      forcePathStyle: true, // R2 requires path-style addressing.
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
      },
    }),
    bucket: env.bucket,
  }
  return cachedClient
}

async function streamToBuffer(stream: GetObjectCommandOutput['Body']): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0)
  // The AWS SDK exposes `transformToByteArray()` on the streaming body in
  // both Node.js and browser-style runtimes (Bun fits the latter).
  // biome-ignore lint/suspicious/noExplicitAny: SDK union type
  const anyStream = stream as any
  if (typeof anyStream.transformToByteArray === 'function') {
    return await anyStream.transformToByteArray()
  }
  // Fallback for Node Readable streams.
  const chunks: Uint8Array[] = []
  for await (const chunk of anyStream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

/**
 * Cloudflare R2 implementation. Compatible with any S3 endpoint, so
 * pointing at AWS S3 / Backblaze B2 / MinIO is just a matter of swapping
 * the endpoint and credentials in env vars.
 */
export const r2Storage: ReportStorage = {
  driver: 'r2',

  async put(input: ReportStorageObject): Promise<string> {
    const { client, bucket } = getClient()
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        Body: input.bytes,
        ContentType: input.contentType ?? 'application/pdf',
      })
    )
    return input.key
  },

  async get(key: string): Promise<Uint8Array | null> {
    const { client, bucket } = getClient()
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      return await streamToBuffer(res.Body)
    } catch (err) {
      // NoSuchKey / 404 → object missing; treat as null instead of throwing
      // so the download endpoint can fall back to on-demand rendering.
      const code = err as { name?: string; $metadata?: { httpStatusCode?: number } }
      if (code?.name === 'NoSuchKey' || code?.$metadata?.httpStatusCode === 404) return null
      throw err
    }
  },
}
