import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProxyService } from "../proxy/proxy.service.js";
import { HttpClientService } from "./http-client.service.js";

const { undiciRequestMock } = vi.hoisted(() => ({
  undiciRequestMock: vi.fn(),
}));

vi.mock("undici", () => ({
  ProxyAgent: class {},
  request: undiciRequestMock,
}));

describe("HttpClientService", () => {
  const mockHttpService = {
    request: vi.fn(),
  };

  const mockProxyService = {
    getRandomProxy: vi.fn(),
  };

  const mockConfigService = {
    get: vi.fn((key: string) => {
      if (key === "timeouts") {
        return {
          httpRequestTimeoutMs: 120000,
          http2RequestTimeoutMs: 600000,
          connectTimeoutMs: 25,
          retrievalTimeoutBufferMs: 60000,
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
        { provide: ProxyService, useValue: mockProxyService },
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

    await service.requestWithoutProxyAndMetrics("http://example.com", { httpVersion: "1.1" });

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

    const promise = service.requestWithoutProxyAndMetrics("http://example.com", { httpVersion: "2" });
    const assertion = expect(promise).rejects.toThrow("HTTP/2 direct connection/headers timed out after 25ms");
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });

});
