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
