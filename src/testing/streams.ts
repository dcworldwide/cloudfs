import { Readable } from "node:stream";

export function bufferStream(body: Buffer, chunkSize = 1024): Readable {
  let offset = 0;
  return new Readable({
    read() {
      if (offset >= body.length) {
        this.push(null);
        return;
      }
      const end = Math.min(offset + chunkSize, body.length);
      this.push(body.subarray(offset, end));
      offset = end;
    },
  });
}

export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
