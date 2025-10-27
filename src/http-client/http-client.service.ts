import type { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import type { AxiosRequestConfig } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { firstValueFrom } from "rxjs";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { ProxyService } from "../proxy/proxy.service.js";
import type { RequestMetrics, RequestWithMetrics } from "./types.js";

@Injectable()
export class HttpClientService {
  private logger = new Logger(HttpClientService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly proxyService: ProxyService,
  ) {}

  async requestWithRandomProxyAndMetrics<T = any>(
    url: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      data?: any;
      headers?: Record<string, string>;
      proxyUrl?: string;
    } = {},
  ): Promise<RequestWithMetrics<T>> {
    const { method = "GET", data, headers = {}, proxyUrl } = options;

    const currentProxyUrl = proxyUrl ?? this.proxyService.getRandomProxy();

    if (!currentProxyUrl) {
      throw new Error("No proxy available");
    }

    try {
      this.logger.debug(`Requesting ${url} via proxy ${currentProxyUrl}`);

      const startTime = performance.now();
      let ttfbTime = 0;
      let firstByteReceived = false;
      let _responseSize = 0;
      let statusCode = 0;

      const proxyAgent = this.createProxyAgent(currentProxyUrl);
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
        timeout: 30000,
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

      // Convert to Buffer once and calculate size
      const dataBuffer = this.convertToBuffer(response.data);

      const metrics: RequestMetrics = {
        ttfb: Math.round(ttfbTime),
        totalTime: Math.round(totalTime),
        downloadTime: Math.round(totalTime - ttfbTime),
        proxyUrl: this.maskProxyUrl(currentProxyUrl),
        statusCode,
        responseSize: dataBuffer.length,
        timestamp: new Date(),
      };

      this.logger.log(
        `Request successful - TTFB: ${metrics.ttfb}ms, Total: ${metrics.totalTime}ms, Size: ${this.formatBytes(dataBuffer.length)}`,
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

  async requestWithoutProxyAndMetrics<T = any>(
    url: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      data?: any;
      headers?: Record<string, string>;
    } = {},
  ): Promise<RequestWithMetrics<T>> {
    const { method = "GET", data, headers = {} } = options;

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
        timeout: 30000,
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

      // Convert to Buffer once and calculate size
      const dataBuffer = this.convertToBuffer(response.data);

      const metrics: RequestMetrics = {
        ttfb: Math.round(ttfbTime),
        totalTime: Math.round(totalTime),
        downloadTime: Math.round(totalTime - ttfbTime),
        proxyUrl: "direct",
        statusCode,
        responseSize: dataBuffer.length,
        timestamp: new Date(),
      };

      this.logger.log(
        `Request successful (direct) - TTFB: ${metrics.ttfb}ms, Total: ${metrics.totalTime}ms, Size: ${this.formatBytes(dataBuffer.length)}`,
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
}
