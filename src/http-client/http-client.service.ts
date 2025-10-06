import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import type { AxiosRequestConfig } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { firstValueFrom } from "rxjs";
import { ProxyService } from "../proxy/proxy.service.js";
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

    let currentProxyUrl = proxyUrl ?? this.proxyService.getRandomProxy();

    if (!currentProxyUrl) {
      throw new Error("No proxy available");
    }

    try {
      this.logger.debug(`Requesting ${url} via proxy`);

      const startTime = performance.now();
      let ttfbTime = 0;
      let firstByteReceived = false;
      let responseSize = 0;
      let statusCode = 0;

      const proxyAgent = new HttpsProxyAgent(currentProxyUrl);
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
        onDownloadProgress: (progressEvent) => {
          if (!firstByteReceived) {
            ttfbTime = performance.now() - startTime;
            firstByteReceived = true;
            this.logger.debug(`TTFB: ${ttfbTime.toFixed(2)}ms`);
          }
          responseSize = progressEvent.loaded;
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

      const metrics: RequestMetrics = {
        ttfb: Math.round(ttfbTime),
        totalTime: Math.round(totalTime),
        downloadTime: Math.round(totalTime - ttfbTime),
        proxyUrl: this.maskProxyUrl(currentProxyUrl),
        statusCode,
        responseSize,
        timestamp: new Date(),
      };

      this.logger.log(
        `Request successful - TTFB: ${metrics.ttfb}ms, Total: ${metrics.totalTime}ms, Size: ${this.formatBytes(responseSize)}`,
      );

      return {
        data: response.data,
        metrics,
      };
    } catch (error) {
      this.logger.warn(`Request failed: ${error.message}`);

      if (error.response?.status === 404 || error.response?.status === 403) {
        throw error;
      }
    }

    throw new Error("Request failed after all retries");
  }

  /**
   * Format bytes to human readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }

  /**
   * Mask proxy URL for logging (hide credentials)
   */
  private maskProxyUrl(url: string): string {
    return url.replace(/\/\/.*:.*@/, "//***:***@");
  }
}
