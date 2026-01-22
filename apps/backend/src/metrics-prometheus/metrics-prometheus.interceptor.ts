import { Injectable, type NestInterceptor, type ExecutionContext, type CallHandler } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter, Histogram } from "prom-client";
import { Observable, tap } from "rxjs";

@Injectable()
export class MetricsPrometheusInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric("http_requests_total") private readonly httpRequestsCounter: Counter,
    @InjectMetric("http_request_duration_seconds") private readonly httpRequestDuration: Histogram,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;

    // Skip metrics endpoint to avoid recursion
    if (url === "/metrics") {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          const duration = (Date.now() - startTime) / 1000;

          this.httpRequestsCounter.inc({
            method,
            path: this.normalizePath(url),
            status_code: response.statusCode,
          });

          this.httpRequestDuration.observe(
            {
              method,
              path: this.normalizePath(url),
              status_code: response.statusCode,
            },
            duration,
          );
        },
        error: (error) => {
          const duration = (Date.now() - startTime) / 1000;
          const statusCode = error.status || 500;

          this.httpRequestsCounter.inc({
            method,
            path: this.normalizePath(url),
            status_code: statusCode,
          });

          this.httpRequestDuration.observe(
            {
              method,
              path: this.normalizePath(url),
              status_code: statusCode,
            },
            duration,
          );
        },
      }),
    );
  }

  /**
   * Normalize URL path by removing IDs and other dynamic segments
   * to avoid high cardinality in metrics
   */
  private normalizePath(path: string): string {
    return path
      .split("?")[0] // Remove query parameters
      .replace(/\/[0-9a-f]{8,}/gi, "/:id") // Replace hex IDs
      .replace(/\/\d+/g, "/:id") // Replace numeric IDs
      .replace(/\/[0-9a-f-]{36}/gi, "/:uuid"); // Replace UUIDs
  }
}
