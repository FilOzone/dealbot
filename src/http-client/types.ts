export interface RequestMetrics {
  ttfb: number;
  totalTime: number;
  downloadTime: number;
  proxyUrl: string;
  statusCode: number;
  responseSize: number;
  timestamp: Date;
}

export interface RequestWithMetrics<T> {
  data: T;
  metrics: RequestMetrics;
}
