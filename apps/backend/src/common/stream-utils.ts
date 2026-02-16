import type { WriteStream } from "node:fs";

/**
 * Close an async iterable stream by calling `.return()` on its iterator.
 * This signals the stream to release its underlying resources (e.g. HTTP
 * connections) immediately, without consuming any remaining data.
 * Silently swallows errors so callers can use it in cleanup paths without
 * masking the original error.
 */
export async function closeStream(stream: AsyncIterable<Uint8Array>): Promise<void> {
  try {
    const iterator = stream[Symbol.asyncIterator]();
    if (iterator.return) {
      await iterator.return();
    }
  } catch {
    // Ignore — stream may already be closed/errored
  }
}

/**
 * Write a buffer to a stream with proper backpressure handling
 * Returns a promise that resolves when the write is complete and buffer is drained
 */
export async function writeWithBackpressure(stream: WriteStream, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      stream.removeListener("drain", onDrain);
      stream.removeListener("error", onError);
      stream.removeListener("close", onClose);
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onDrain = () => resolveOnce();
    const onError = (error: Error) => rejectOnce(error);
    const onClose = () => rejectOnce(new Error("Stream closed before drain"));

    stream.once("error", onError);
    stream.once("close", onClose);

    let canWrite = false;
    try {
      canWrite = stream.write(buffer);
    } catch (error) {
      rejectOnce(error instanceof Error ? error : new Error("Stream write failed"));
      return;
    }

    if (canWrite) {
      resolveOnce();
    } else {
      // Backpressure detected - wait for drain event
      stream.once("drain", onDrain);
    }
  });
}
