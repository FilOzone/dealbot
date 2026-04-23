import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClientService } from "./http-client.service.js";

const { undiciRequestMock } = vi.hoisted(() => ({
  undiciRequestMock: vi.fn(),
}));

vi.mock("undici", () => ({
  request: undiciRequestMock,
}));

describe("HttpClientService", () => {
  const mockHttpService = {
    request: vi.fn(),
  };

  const mockConfigService = {
    get: vi.fn((key: string) => {
      if (key === "timeouts") {
        return {
          httpRequestTimeoutMs: 120000,
          http2RequestTimeoutMs: 600000,
          connectTimeoutMs: 25,
        };
      }
      return undefined;
    }),
  };

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const createService = async (): Promise<HttpClientService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HttpClientService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    return module.get<HttpClientService>(HttpClientService);
  };

  it("uses the configured timeout for HTTP/1.1 requests", async () => {
    const service = await createService();

    mockHttpService.request.mockReturnValueOnce(
      of({
        status: 200,
        data: Buffer.from("ok"),
      }),
    );

    await service.requestWithMetrics("http://example.com", { httpVersion: "1.1" });

    const config = mockHttpService.request.mock.calls[0][0];
    expect(config.timeout).toBe(120000);
  });

  it("times out HTTP/2 requests using the connection timeout", async () => {
    const service = await createService();

    if (typeof AbortSignal.timeout !== "function") {
      (AbortSignal as any).timeout = () => new AbortController().signal;
    }

    undiciRequestMock.mockImplementationOnce((_url: string, options: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });

    vi.useFakeTimers();

    const promise = service.requestWithMetrics("http://example.com", { httpVersion: "2" });
    const assertion = expect(promise).rejects.toThrow("HTTP/2 connection/headers timed out after 25ms");
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });

  it("returns partial bytes and metrics when HTTP/2 download is aborted after headers", async () => {
    const service = await createService();

    const parentAbort = new AbortController();

    async function* abortingBody() {
      yield Buffer.from("hello");
      yield Buffer.from(" world");
      // Simulate an abort mid-stream after two chunks.
      parentAbort.abort(new Error("Anon retrieval job timeout (60s) for sp1"));
      throw new Error("aborted");
    }

    undiciRequestMock.mockImplementationOnce(async () => ({
      statusCode: 200,
      body: abortingBody(),
    }));

    const result = await service.requestWithMetrics<Buffer>("http://example.com/piece", {
      httpVersion: "2",
      signal: parentAbort.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toContain("timeout");
    expect(result.metrics.statusCode).toBe(200);
    expect(result.metrics.responseSize).toBe(11);
    expect(Buffer.isBuffer(result.data) ? result.data.toString() : "").toBe("hello world");
  });

  it("rethrows non-abort download errors on HTTP/2", async () => {
    const service = await createService();

    async function* brokenBody() {
      yield Buffer.from("partial");
      throw new Error("network reset");
    }

    undiciRequestMock.mockImplementationOnce(async () => ({
      statusCode: 200,
      body: brokenBody(),
    }));

    await expect(service.requestWithMetrics<Buffer>("http://example.com/piece", { httpVersion: "2" })).rejects.toThrow(
      "network reset",
    );
  });
});
