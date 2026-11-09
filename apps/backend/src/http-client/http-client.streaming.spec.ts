import { once } from "node:events";
import { createServer, type RequestListener, type Server, type ServerResponse } from "node:http";
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

  beforeEach(async () => {
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
  });

  it.each([301, 302])("follows HTTP %i from /piece to /public and preserves the streamed body", async (statusCode) => {
    const paths: string[] = [];
    handler = (request, response) => {
      paths.push(request.url!);
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

  it.each([200, 404])("safely destroys an unread HTTP %i body", async (statusCode) => {
    handler = (_request, response) => {
      response.writeHead(statusCode, { "content-length": "7" });
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

  it("keeps caller cancellation active after a redirect", async () => {
    const controller = new AbortController();
    handler = (request, response) => {
      if (request.url === "/piece/test") {
        response.writeHead(301, { location: "/public/test" });
        response.end();
      } else {
        controller.abort();
      }
    };

    await expect(service.requestStream(`${baseUrl}/piece/test`, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("still propagates body errors to stream consumers", async () => {
    let serverResponse: ServerResponse;
    handler = (_request, response) => {
      serverResponse = response;
      response.writeHead(200, { "content-length": "100" });
      response.write("partial");
    };

    const response = await service.requestStream(`${baseUrl}/piece/test`);
    const consume = async () => {
      for await (const _chunk of response.body) {
        // Consume until the server closes its incomplete response.
      }
    };
    const consumed = consume();
    serverResponse!.destroy();
    await expect(consumed).rejects.toThrow();
  });
});
