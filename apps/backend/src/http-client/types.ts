export type HttpVersion = "1.1" | "2";

export interface RequestMetrics {
  ttfb: number;
  totalTime: number;
  downloadTime: number;
  proxyUrl: string;
  statusCode: number;
  responseSize: number;
  timestamp: Date;
  httpVersion?: HttpVersion;
}

export interface RequestWithMetrics<T> {
  data: T;
  metrics: RequestMetrics;
}

export interface RequestStreamContext {
  body: AsyncIterable<Uint8Array>;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  startTime: number;
  ttfb: number;
  proxyUrl: string;
  httpVersion: HttpVersion;
}
