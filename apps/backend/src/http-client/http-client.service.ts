import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { anySignal } from "any-signal";
import type { AxiosRequestConfig } from "axios";
import { firstValueFrom } from "rxjs";
import { request as undiciRequest } from "undici";
import { toStructuredError } from "../common/logging.js";
import type { IConfig } from "../config/app.config.js";
import type { HttpVersion, RequestMetrics, RequestWithMetrics } from "./types.js";

@Injectable()
export class HttpClientService {
  private logger = new Logger(HttpClientService.name);
  private readonly http2TimeoutMs: number;
  private readonly http1TimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<IConfig, true>,
  ) {
    const timeouts = this.configService.get("timeouts");
    this.http2TimeoutMs = timeouts.http2RequestTimeoutMs;
    this.http1TimeoutMs = timeouts.httpRequestTimeoutMs;
    this.connectTimeoutMs = timeouts.connectTimeoutMs;
  }

  async requestWithMetrics<T = any>(
    url: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      data?: any;
      headers?: Record<string, string>;
      httpVersion?: HttpVersion;
      signal?: AbortSignal;
    } = {},
  ): Promise<RequestWithMetrics<T>> {
    const { method = "GET", data, headers = {}, httpVersion = "1.1", signal } = options;

    // Route to appropriate implementation
    if (httpVersion === "2") {
      return this.requestWithHttp2<T>(url, {
        method,
        data,
        headers,
        signal,
      });
    }

    return this.requestWithHttp1<T>(url, {
      method,
      data,
      headers,
      signal,
    });
  }

  /**
   * HTTP/2 request using undici
   */
  private async requestWithHttp2<T = any>(
    url: string,
    options: {
      method: string;
      data?: any;
      headers: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<RequestWithMetrics<T>> {
    const { method, data, headers } = options;

    try {
      this.logger.debug({
        event: "http2_request_started",
        message: "Requesting via HTTP/2",
        url,
      });

      const startTime = performance.now();
      let ttfbTime = 0;
      let statusCode = 0;

      /**
       * Dual-timeout strategy for HTTP/2 requests:
       * 1. AbortSignal.timeout() - Undici's native timeout (10 min default)
       * 2. AbortSignal.timeout() for connection/headers (10 sec default)
       */
      const { signal, connectTimeoutSignal } = this.buildHttp2Signals(options.signal);
      const requestOptions: any = {
        method,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...headers,
        },
        signal,
      };

      if (data) {
        requestOptions.body = typeof data === "string" ? data : JSON.stringify(data);
        requestOptions.headers["Content-Type"] = "application/json";
      }

      let response: Awaited<ReturnType<typeof undiciRequest<T>>>;
      try {
        response = await undiciRequest(url, requestOptions);
      } catch (error) {
        if (connectTimeoutSignal.aborted) {
          throw new Error(`HTTP/2 connection/headers timed out after ${this.connectTimeoutMs}ms`);
        }
        throw error;
      }

      ttfbTime = performance.now() - startTime;
      statusCode = response.statusCode;

      const chunks: Buffer[] = [];
      for await (const chunk of response.body) {
        chunks.push(Buffer.from(chunk));
      }
      const dataBuffer = Buffer.concat(chunks);

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      const metrics: RequestMetrics = {
        ttfb: Math.round(ttfbTime),
        totalTime: Math.round(totalTime),
        downloadTime: Math.round(totalTime - ttfbTime),
        statusCode,
        responseSize: dataBuffer.length,
        timestamp: new Date(),
        httpVersion: "2",
      };

      return {
        data: dataBuffer as T,
        metrics,
      };
    } catch (error) {
      this.logger.warn({
        event: "http2_request_failed",
        message: "HTTP/2 request failed",
        url,
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  /**
   * HTTP/1.1 request using axios
   */
  private async requestWithHttp1<T = any>(
    url: string,
    options: {
      method: string;
      data?: any;
      headers: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<RequestWithMetrics<T>> {
    const { method, data, headers, signal } = options;

    try {
      this.logger.debug({
        event: "http1_request_started",
        message: "Requesting via HTTP/1.1",
        url,
      });

      const startTime = performance.now();
      let ttfbTime = 0;
      let firstByteReceived = false;
      let statusCode = 0;

      const config: AxiosRequestConfig = {
        method,
        url,
        data,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...headers,
        },
        timeout: this.http1TimeoutMs,
        signal,
        maxRedirects: 5,
        responseType: "arraybuffer",
        onDownloadProgress: () => {
          if (!firstByteReceived) {
            ttfbTime = performance.now() - startTime;
            firstByteReceived = true;
          }
        },
      };

      const response = await firstValueFrom(this.httpService.request<T>(config));

      const endTime = performance.now();
      const totalTime = endTime - startTime;
      statusCode = response.status;

      if (!firstByteReceived) {
        this.logger.debug({
          event: "http1_ttfb_estimated",
          message: "TTFB not captured, estimating",
        });
        ttfbTime = totalTime * 0.8;
      }

      const dataBuffer = this.convertToBuffer(response.data);

      const metrics: RequestMetrics = {
        ttfb: Math.round(ttfbTime),
        totalTime: Math.round(totalTime),
        downloadTime: Math.round(totalTime - ttfbTime),
        statusCode,
        responseSize: dataBuffer.length,
        timestamp: new Date(),
        httpVersion: "1.1",
      };

      return {
        data: dataBuffer as T,
        metrics,
      };
    } catch (error) {
      this.logger.warn({
        event: "http_request_failed",
        message: "HTTP/1.1 request failed",
        url,
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  /**
   * Convert response data to Buffer
   * Handles different data types returned by axios
   */
  private convertToBuffer(data: any): Buffer {
    if (Buffer.isBuffer(data)) {
      return data;
    }

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }

    if (typeof data === "string") {
      return Buffer.from(data);
    }

    // Fallback for objects/arrays
    return Buffer.from(JSON.stringify(data));
  }

  private buildHttp2Signals(parentSignal?: AbortSignal): {
    signal: AbortSignal;
    connectTimeoutSignal: AbortSignal;
  } {
    const transferTimeoutSignal = AbortSignal.timeout(this.http2TimeoutMs);
    const connectTimeoutSignal = AbortSignal.timeout(this.connectTimeoutMs);

    if (parentSignal) {
      return {
        signal: anySignal([transferTimeoutSignal, connectTimeoutSignal, parentSignal]),
        connectTimeoutSignal,
      };
    }

    return {
      signal: anySignal([transferTimeoutSignal, connectTimeoutSignal]),
      connectTimeoutSignal,
    };
  }
}
