import { once } from "node:events";
import { createServer, type RequestListener, type Server } from "node:http";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IConfig } from "../config/index.js";
import { HttpClientService } from "./http-client.service.js";

describe("HttpClientService streaming responses", () => {
  let server: Server;
  let baseUrl: string;
  let handler: RequestListener;
  let service: HttpClientService;
  let shutdown: Promise<void> | undefined;

  beforeEach(async () => {
    shutdown = undefined;
    const config = new ConfigService<IConfig, true>({
      timeouts: {
        httpRequestTimeoutMs: 1000,
        http2RequestTimeoutMs: 1000,
        connectTimeoutMs: 1000,
      },
    });
    service = new HttpClientService(new HttpService(), config);
    server = createServer((request, response) => handler(request, response));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP server address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await (shutdown ?? service.onApplicationShutdown());
  });

  it("closes the keep-alive connection on application shutdown", async () => {
    // Idle expiry must not hide a missing client-side close.
    server.keepAliveTimeout = 60_000;
    handler = (_request, response) => response.end("piece bytes");
    const connected = once(server, "connection");

    const result = await service.requestWithMetrics<Buffer>(`${baseUrl}/piece/test`, { httpVersion: "2" });
    expect(result.data.toString()).toBe("piece bytes");
    const [socket] = await connected;
    expect(socket.destroyed).toBe(false);
    const closed = once(socket, "close");

    shutdown = service.onApplicationShutdown();
    await shutdown;
    await closed;
    expect(socket.destroyed).toBe(true);
  });

  it.each([301, 302])("follows HTTP %i from /piece to /public and preserves the streamed body", async (statusCode) => {
    const paths: string[] = [];
    handler = (request, response) => {
      paths.push(String(request.url));
      if (request.url === "/piece/test?download=1") {
        response.writeHead(statusCode, { location: "/public/test?download=1" });
        response.end("Moved Permanently");
      } else {
        response.end("piece bytes");
      }
    };

    const response = await service.requestStream(`${baseUrl}/piece/test?download=1`);
    expect(response.statusCode).toBe(200);
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("piece bytes");
    expect(paths).toEqual(["/piece/test?download=1", "/public/test?download=1"]);
  });

  it("safely destroys an unread body", async () => {
    handler = (_request, response) => {
      response.writeHead(404, { "content-length": "7" });
      response.end("payload");
    };

    const response = await service.requestStream(`${baseUrl}/piece/test`);
    // Pull checks discard non-2xx responses and bodies with the wrong size.
    // A real undici body emits this asynchronously even for destroy() with no error.
    const closed = new Promise<void>((resolve) => response.body.once("close", resolve));
    response.body.destroy();
    await closed;
    expect(response.body.destroyed).toBe(true);
  });

  it.each([301, 302])("follows HTTP %i for sampled retrieval and records the final response", async (statusCode) => {
    const paths: string[] = [];
    handler = (request, response) => {
      paths.push(String(request.url));
      if (request.url === "/piece/test") {
        response.writeHead(statusCode, { location: "/public/test" });
        response.end("Moved Permanently");
      } else {
        response.end("piece bytes");
      }
    };

    const result = await service.requestWithMetrics<Buffer>(`${baseUrl}/piece/test`, { httpVersion: "2" });
    expect(result.data.toString()).toBe("piece bytes");
    expect(result.metrics).toMatchObject({ statusCode: 200, responseSize: 11 });
    expect(result.metrics.ttfb).toBeGreaterThanOrEqual(0);
    expect(result.metrics.totalTime).toBeGreaterThanOrEqual(result.metrics.ttfb);
    expect(paths).toEqual(["/piece/test", "/public/test"]);
  });

  it("enforces the sampled retrieval byte limit after a redirect", async () => {
    handler = (request, response) => {
      if (request.url === "/piece/test") {
        response.writeHead(301, { location: "/public/test" });
        response.end();
      } else {
        response.end("piece bytes");
      }
    };

    const result = await service.requestWithMetrics<Buffer>(`${baseUrl}/piece/test`, {
      httpVersion: "2",
      maxBytes: 5,
    });
    expect(result.limitExceeded).toBe(true);
    expect(result.data.length).toBe(0);
    expect(result.metrics.statusCode).toBe(200);
  });

  it("stops following a redirect chain after five redirects", async () => {
    let requests = 0;
    handler = (_request, response) => {
      requests++;
      response.writeHead(301, { location: `/piece/test?hop=${requests}` });
      response.end("Moved Permanently");
    };

    const response = await service.requestStream(`${baseUrl}/piece/test`);
    expect(response.statusCode).toBe(301);
    expect(requests).toBe(6);
    const closed = new Promise<void>((resolve) => response.body.once("close", resolve));
    response.body.destroy();
    await closed;
  });

  it.each(["stream", "metrics"])("keeps caller cancellation active after a redirect for %s", async (mode) => {
    const controller = new AbortController();
    handler = (request, response) => {
      if (request.url === "/piece/test") {
        response.writeHead(301, { location: "/public/test" });
        response.end();
      } else {
        controller.abort();
      }
    };

    const request =
      mode === "stream"
        ? service.requestStream(`${baseUrl}/piece/test`, { signal: controller.signal })
        : service.requestWithMetrics(`${baseUrl}/piece/test`, { signal: controller.signal, httpVersion: "2" });
    await expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("still propagates body errors to stream consumers", async () => {
    handler = (_request, response) => {
      response.writeHead(200, { "content-length": "100" });
      response.write("partial", () => response.destroy());
    };

    const response = await service.requestStream(`${baseUrl}/piece/test`);
    const consume = async () => {
      for await (const _chunk of response.body) {
        // Consume until the server closes its incomplete response.
      }
    };
    await expect(consume()).rejects.toThrow();
  });
});
