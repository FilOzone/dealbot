import type { WriteStream } from "node:fs";

/**
 * Write a buffer to a stream with proper backpressure handling
 * Returns a promise that resolves when the write is complete and buffer is drained
 */
export async function writeWithBackpressure(stream: WriteStream, buffer: Buffer): Promise<void> {
  return new Promise((resolve) => {
    const canWrite = stream.write(buffer);
    if (canWrite) {
      resolve();
    } else {
      // Backpressure detected - wait for drain event
      stream.once("drain", resolve);
    }
  });
}
