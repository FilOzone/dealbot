/**
 * Determines if a service URL uses HTTP protocol
 */
export function isHttpProtocol(serviceUrl: string | null | undefined): boolean {
  return serviceUrl?.toLowerCase().startsWith("http://") ?? false;
}

/**
 * Determines if a service URL uses HTTPS protocol
 */
export function isHttpsProtocol(serviceUrl: string | null | undefined): boolean {
  return serviceUrl?.toLowerCase().startsWith("https://") ?? false;
}

/**
 * Determines if a service URL is valid and has a recognized protocol
 */
export function hasValidProtocol(serviceUrl: string | null | undefined): boolean {
  return isHttpProtocol(serviceUrl) || isHttpsProtocol(serviceUrl);
}

/**
 * Version fetching strategy based on protocol
 */
export type FetchStrategy = "direct" | "batch" | "none";

/**
 * Determine the appropriate fetching strategy for a provider based on protocol
 */
export function getFetchStrategy(serviceUrl: string | null | undefined): FetchStrategy {
  if (!serviceUrl) return "none";
  if (isHttpsProtocol(serviceUrl)) return "direct";
  if (isHttpProtocol(serviceUrl)) return "batch";
  return "none";
}

/**
 * Check if provider should use direct fetch (HTTPS)
 */
export function shouldFetchDirect(serviceUrl: string | null | undefined): boolean {
  return getFetchStrategy(serviceUrl) === "direct";
}

/**
 * Check if provider should use batch fetch (HTTP)
 */
export function shouldFetchBatch(serviceUrl: string | null | undefined): boolean {
  return getFetchStrategy(serviceUrl) === "batch";
}
