import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { anySignal } from "any-signal";
import type { AxiosRequestConfig } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { firstValueFrom } from "rxjs";
import { SocksProxyAgent } from "socks-proxy-agent";
import { ProxyAgent as UndiciProxyAgent, request as undiciRequest } from "undici";
import { withTimeout } from "../common/utils.js";
import type { IConfig } from "../config/app.config.js";
import { ProxyService } from "../proxy/proxy.service.js";
import type { HttpVersion, RequestMetrics, RequestWithMetrics } from "./types.js";

@Injectable()
export class HttpClientService {
  private logger = new Logger(HttpClientService.name);
  private readonly http2TimeoutMs: number;
  private readonly http1TimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly proxyService: ProxyService,
    private readonly configService: ConfigService<IConfig, true>,
  ) {
    const timeouts = this.configService.get("timeouts");
    this.http2TimeoutMs = timeouts.http2RequestTimeoutMs;
    this.http1TimeoutMs = timeouts.httpRequestTimeoutMs;
    this.connectTimeoutMs = timeouts.connectTimeoutMs;
  }

  async requestWithRandomProxyAndMetrics<T = any>(
    url: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      data?: any;
      headers?: Record<string, string>;
      proxyUrl?: string;
      httpVersion?: HttpVersion; // '1.1' | '2'
      signal?: AbortSignal;
    } = {},
  ): Promise<RequestWithMetrics<T>> {
    const { method = "GET", data, headers = {}, proxyUrl, httpVersion = "1.1", signal } = options;

    const currentProxyUrl = proxyUrl ?? this.proxyService.getRandomProxy();

    if (!currentProxyUrl) {
      throw new Error("No proxy available");
    }

    // Route to appropriate implementation based on HTTP version
    if (httpVersion === "2") {
      return this.requestWithHttp2AndProxy<T>(url, {
        method,
        data,
        headers,
        proxyUrl: currentProxyUrl,
        signal,
      });
    }

    // Default HTTP/1.1 implementation (your existing code)
    return this.requestWithHttp1AndProxy<T>(url, {
      method,
      data,
      headers,
      proxyUrl: currentProxyUrl,
      signal,
    });
  }

  async requestWithoutProxyAndMetrics<T = any>(
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
      return this.requestWithHttp2Direct<T>(url, {
        method,
        data,
        headers,
        signal,
      });
    }

    return this.requestWithHttp1Direct<T>(url, {
      method,
      data,
      headers,
      signal,
    });
  }

  /**
   * HTTP/2 request with proxy using undici
   */
  private async requestWithHttp2AndProxy<T = any>(
    url: string,
    options: {
      method: string;
      data?: any;
      headers: Record<string, string>;
      proxyUrl: string;
      signal?: AbortSignal;
    },
  ): Promise<RequestWithMetrics<T>> {
    const { method, data, headers, proxyUrl, signal } = options;

    try {
      this.logger.debug(`Requesting ${url} via HTTP/2 proxy ${proxyUrl}`);

      const startTime = performance.now();
      let ttfbTime = 0;
      let statusCode = 0;

      // Create undici proxy agent
      const proxyAgent = new UndiciProxyAgent({
        uri: proxyUrl,
      });

      /**
       * Dual-timeout strategy for HTTP/2 requests:
       * 1. AbortSignal.timeout() - Undici's native timeout for the entire request lifecycle (10 min default)
       *    - Covers connection establishment, header exchange, AND body streaming
       *    - Most reliable for protecting against slow transfers
       * 2. withTimeout() wrapper - Application-level timeout for connection/headers only (10 sec default)
       *    - Provides fast-fail for unreachable servers or connection issues
       *    - Once headers are received, this promise resolves and no longer protects body streaming
       *
       * This defense-in-depth approach ensures:
       * - Fast detection of connection issues (10s)
       * - Protection against slow/stalled transfers (10min)
       * - No indefinite hangs
       */
      const requestOptions: any = {
        method,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...headers,
        },
        dispatcher: proxyAgent,
        signal: this.buildRequestSignal(signal),
      };

      if (data) {
        requestOptions.body = typeof data === "string" ? data : JSON.stringify(data);
        requestOptions.headers["Content-Type"] = "application/json";
      }

      const response = await withTimeout(
        undiciRequest(url, requestOptions),
        this.connectTimeoutMs,
        `HTTP/2 connection/headers timed out after ${this.connectTimeoutMs}ms`,
      );

      // TTFB is approximately when we get the response headers
      ttfbTime = performance.now() - startTime;
      statusCode = response.statusCode;

      this.logger.debug(`TTFB (HTTP/2): ${ttfbTime.toFixed(2)}ms`);

      // Read response body
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
        proxyUrl: this.maskProxyUrl(proxyUrl),
        statusCode,
        responseSize: dataBuffer.length,
        timestamp: new Date(),
        httpVersion: "2",
      };

      this.logger.log(
        `HTTP/2 Request successful - TTFB: ${metrics.ttfb}ms, Total: ${metrics.totalTime}ms, Size: ${this.formatBytes(
          dataBuffer.length,
        )}`,
      );

      return {
        data: dataBuffer as T,
        metrics,
      };
    } catch (error) {
      this.logger.warn(`HTTP/2 Request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * HTTP/2 request without proxy using undici
   */
  private async requestWithHttp2Direct<T = any>(
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
      this.logger.debug(`Requesting ${url} via HTTP/2 (direct connection)`);

      const startTime = performance.now();
      let ttfbTime = 0;
      let statusCode = 0;

      /**
       * Dual-timeout strategy for HTTP/2 direct requests (same as proxied requests):
       * 1. AbortSignal.timeout() - Undici's native timeout (10 min default)
       * 2. withTimeout() wrapper - Fast-fail for connection issues (10 sec default)
       * See requestWithHttp2AndProxy() for detailed explanation.
       */
      const requestOptions: any = {
        method,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...headers,
        },
        signal: this.buildRequestSignal(signal),
      };

      if (data) {
        requestOptions.body = typeof data === "string" ? data : JSON.stringify(data);
        requestOptions.headers["Content-Type"] = "application/json";
      }

      const response = await withTimeout(
        undiciRequest(url, requestOptions),
        this.connectTimeoutMs,
        `HTTP/2 direct connection/headers timed out after ${this.connectTimeoutMs}ms`,
      );

      ttfbTime = performance.now() - startTime;
      statusCode = response.statusCode;

      this.logger.debug(`TTFB (HTTP/2 direct): ${ttfbTime.toFixed(2)}ms`);

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
        proxyUrl: "direct",
        statusCode,
        responseSize: dataBuffer.length,
        timestamp: new Date(),
        httpVersion: "2",
      };

      this.logger.log(
        `HTTP/2 Request successful (direct) - TTFB: ${metrics.ttfb}ms, Total: ${
          metrics.totalTime
        }ms, Size: ${this.formatBytes(dataBuffer.length)}`,
      );

      return {
        data: dataBuffer as T,
        metrics,
      };
    } catch (error) {
      this.logger.warn(`HTTP/2 Direct request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * HTTP/1.1 request with proxy (your existing implementation)
   */
  private async requestWithHttp1AndProxy<T = any>(
    url: string,
    options: {
      method: string;
      data?: any;
      headers: Record<string, string>;
      proxyUrl: string;
      signal?: AbortSignal;
    },
  ): Promise<RequestWithMetrics<T>> {
    const { method, data, headers, proxyUrl, signal } = options;

    try {
      this.logger.debug(`Requesting ${url} via proxy ${proxyUrl}`);

      const startTime = performance.now();
      let ttfbTime = 0;
      let firstByteReceived = false;
      let _responseSize = 0;
      let statusCode = 0;

      const proxyAgent = this.createProxyAgent(proxyUrl);
      const config: AxiosRequestConfig = {
        method,
        url,
        data,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...headers,
        },
        httpsAgent: proxyAgent,
        httpAgent: proxyAgent,
        proxy: false,
        timeout: this.http1TimeoutMs,
        signal,
        maxRedirects: 5,
        responseType: "arraybuffer",
        onDownloadProgress: (progressEvent) => {
          if (!firstByteReceived) {
            ttfbTime = performance.now() - startTime;
            firstByteReceived = true;
            this.logger.debug(`TTFB: ${ttfbTime.toFixed(2)}ms`);
          }
          _responseSize = progressEvent.loaded;
        },
      };

      const response = await firstValueFrom(this.httpService.request<T>(config));

      const endTime = performance.now();
      const totalTime = endTime - startTime;
      statusCode = response.status;

      if (!firstByteReceived) {
        this.logger.debug(`TTFB not captured, estimating`);
        ttfbTime = totalTime * 0.8;
      }

      const dataBuffer = this.convertToBuffer(response.data);

      const metrics: RequestMetrics = {
        ttfb: Math.round(ttfbTime),
        totalTime: Math.round(totalTime),
        downloadTime: Math.round(totalTime - ttfbTime),
        proxyUrl: this.maskProxyUrl(proxyUrl),
        statusCode,
        responseSize: dataBuffer.length,
        timestamp: new Date(),
        httpVersion: "1.1",
      };

      this.logger.log(
        `Request successful - TTFB: ${metrics.ttfb}ms, Total: ${metrics.totalTime}ms, Size: ${this.formatBytes(
          dataBuffer.length,
        )}`,
      );

      return {
        data: dataBuffer as T,
        metrics,
      };
    } catch (error) {
      this.logger.warn(`Request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * HTTP/1.1 request without proxy (your existing implementation)
   */
  private async requestWithHttp1Direct<T = any>(
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
      this.logger.debug(`Requesting ${url} without proxy (direct connection)`);

      const startTime = performance.now();
      let ttfbTime = 0;
      let firstByteReceived = false;
      let _responseSize = 0;
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
        onDownloadProgress: (progressEvent) => {
          if (!firstByteReceived) {
            ttfbTime = performance.now() - startTime;
            firstByteReceived = true;
            this.logger.debug(`TTFB: ${ttfbTime.toFixed(2)}ms`);
          }
          _responseSize = progressEvent.loaded;
        },
      };

      const response = await firstValueFrom(this.httpService.request<T>(config));

      const endTime = performance.now();
      const totalTime = endTime - startTime;
      statusCode = response.status;

      if (!firstByteReceived) {
        this.logger.debug(`TTFB not captured, estimating`);
        ttfbTime = totalTime * 0.8;
      }

      const dataBuffer = this.convertToBuffer(response.data);

      const metrics: RequestMetrics = {
        ttfb: Math.round(ttfbTime),
        totalTime: Math.round(totalTime),
        downloadTime: Math.round(totalTime - ttfbTime),
        proxyUrl: "direct",
        statusCode,
        responseSize: dataBuffer.length,
        timestamp: new Date(),
        httpVersion: "1.1",
      };

      this.logger.log(
        `Request successful (direct) - TTFB: ${metrics.ttfb}ms, Total: ${metrics.totalTime}ms, Size: ${this.formatBytes(
          dataBuffer.length,
        )}`,
      );

      return {
        data: dataBuffer as T,
        metrics,
      };
    } catch (error) {
      this.logger.warn(`Direct request failed: ${error.message}`);
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

  /**
   * Format bytes to human readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
  }

  /**
   * Create appropriate proxy agent based on proxy URL protocol
   */
  private createProxyAgent(proxyUrl: string): HttpsProxyAgent<string> | SocksProxyAgent {
    const protocol = proxyUrl.split("://")[0].toLowerCase();

    if (protocol === "socks" || protocol === "socks5" || protocol === "socks4") {
      this.logger.debug(`Using SOCKS proxy agent for ${protocol}`);
      return new SocksProxyAgent(proxyUrl);
    }

    this.logger.debug(`Using HTTP/HTTPS proxy agent`);
    return new HttpsProxyAgent(proxyUrl);
  }

  /**
   * Mask proxy URL for logging (hide credentials)
   */
  private maskProxyUrl(url: string): string {
    return url.replace(/\/\/.*:.*@/, "//***:***@");
  }

  private buildRequestSignal(parentSignal?: AbortSignal): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(this.http2TimeoutMs);
    return parentSignal ? anySignal([timeoutSignal, parentSignal]) : timeoutSignal;
  }
}
