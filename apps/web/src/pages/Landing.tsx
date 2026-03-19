import { Activity, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProvidersList } from "@/hooks/useProvidersList";

/**
 * Builds a BetterStack dashboard or logs URL scoped to a single provider.
 * Appends time range (now-24h to now) and provider filter.
 * Metrics dashboard uses vs[provider_id]; logs dashboard uses vs[providerId].
 */
function buildBetterStackUrlWithProvider(
  baseUrl: string,
  providerId: number,
  paramKey: "vs[provider_id]" | "vs[providerId]" = "vs[provider_id]",
): string {
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("rf", "now-72h");
    url.searchParams.set("rt", "now");
    url.searchParams.set(paramKey, String(providerId));
    return url.toString();
  } catch {
    return "";
  }
}

const sanitizeConfigUrl = (value: string) => {
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(value);
    const isHttps = parsed.protocol === "https:";
    const isLocalDev = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
    return isHttps || isLocalDev ? parsed.toString() : "";
  } catch {
    return "";
  }
};

const getConfigUrl = (runtimeValue?: string, buildValue?: string) => {
  const raw = (runtimeValue ?? buildValue ?? "").trim();
  const safe = sanitizeConfigUrl(raw);
  return { safe, isInvalid: Boolean(raw) && !safe };
};

const getConfig = () => {
  const runtimeConfig = typeof window === "undefined" ? undefined : window.__DEALBOT_CONFIG__;

  const dashboardUrl = getConfigUrl(runtimeConfig?.DASHBOARD_URL, import.meta.env.VITE_DASHBOARD_URL);
  const logsUrl = getConfigUrl(runtimeConfig?.LOGS_URL, import.meta.env.VITE_LOGS_URL);

  return {
    dashboardUrl: dashboardUrl.safe,
    dashboardUrlInvalid: dashboardUrl.isInvalid,
    logsUrl: logsUrl.safe,
    logsUrlInvalid: logsUrl.isInvalid,
  };
};

export default function Landing() {
  const { dashboardUrl, dashboardUrlInvalid, logsUrl, logsUrlInvalid } = getConfig();
  const { providers: providersResponse, loading: providersLoading, error: providersError } = useProvidersList(0, 500);

  return (
    <div className="flex w-full flex-col items-center gap-12 pt-8">
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2 text-primary">
          <Activity className="h-8 w-8" />
          <h1 className="text-3xl font-bold">DealBot</h1>
        </div>

        <p className="text-muted-foreground text-lg">
          DealBot creates synthetic traffic for SPs in the onchain SP registry and monitors success/failures. It
          collects metrics from this traffic and computes stats for each SP to help determine which SPs are eligible for
          approval in Filecoin Warm Storage Service contracts.{" "}
          <a
            href="https://github.com/FilOzone/dealbot/tree/main/docs/checks#what-is-dealbot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            Learn more ↗
          </a>
        </p>

        <p className="text-sm text-muted-foreground">
          This instance checks <strong>all non-dev SPs</strong> in the registry. <strong>Filecoin Onchain Cloud</strong>{" "}
          uses these results to determine which SPs should be approved for storage deals by default.{" "}
          <a
            href="https://github.com/FilOzone/dealbot/blob/main/docs/checks/production-configuration-and-approval-methodology.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            See the approval methodology ↗
          </a>
        </p>
        <p className="text-sm text-muted-foreground">
          We currently link to BetterStack public dashboards.{" "}
          <a
            href="https://github.com/FilOzone/dealbot/issues/176#issuecomment-4013747738"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            Learn why.
          </a>
        </p>
      </div>

      {/* Storage providers – metrics & logs */}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-base">Storage providers – metrics & logs</CardTitle>
        </CardHeader>
        <CardContent>
          {(dashboardUrlInvalid || logsUrlInvalid) && (
            <p className="mb-2 text-sm text-yellow-600">
              Warning: {dashboardUrlInvalid && "DASHBOARD_URL"}
              {dashboardUrlInvalid && logsUrlInvalid && " and "}
              {logsUrlInvalid && "LOGS_URL"} configured but invalid — links will be unavailable.
            </p>
          )}
          {!dashboardUrl && !dashboardUrlInvalid && (
            <p className="mb-2 text-sm text-muted-foreground">
              Metrics dashboard links are disabled. Set <code>DASHBOARD_URL</code> in the web runtime config or
              environment to enable them.
            </p>
          )}
          {!logsUrl && !logsUrlInvalid && (
            <p className="mb-2 text-sm text-muted-foreground">
              Logs links are disabled. Set <code>LOGS_URL</code> in the web runtime config or environment to enable
              them.
            </p>
          )}
          {providersError && <p className="text-sm text-destructive">{providersError}</p>}
          {providersLoading && <p className="text-sm text-muted-foreground">Loading providers…</p>}
          {!providersLoading &&
            !providersError &&
            (() => {
              const activeProviders = providersResponse.providers
                .filter((p) => p.isActive)
                .sort((a, b) => (a.providerId ?? Number.MAX_SAFE_INTEGER) - (b.providerId ?? Number.MAX_SAFE_INTEGER));
              return activeProviders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No providers found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-4 font-medium">SP name</th>
                        <th className="text-left py-2 pr-4 font-medium">ID</th>
                        <th className="text-left py-2 pr-4 font-medium">Approved</th>
                        <th className="text-left py-2 pr-4 font-medium">Metrics dashboard</th>
                        <th className="text-left py-2 font-medium">Logs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeProviders.map((provider) => {
                        const providerId = provider.providerId;
                        const metricsHref =
                          dashboardUrl && typeof providerId === "number"
                            ? buildBetterStackUrlWithProvider(dashboardUrl, providerId, "vs[provider_id]")
                            : "";
                        const logsHref =
                          logsUrl && typeof providerId === "number"
                            ? buildBetterStackUrlWithProvider(logsUrl, providerId, "vs[providerId]")
                            : "";
                        return (
                          <tr key={provider.address} className="border-b last:border-b-0">
                            <td className="py-2 pr-4">{provider.name || provider.address}</td>
                            <td className="py-2 pr-4">{typeof providerId === "number" ? providerId : "—"}</td>
                            <td className="py-2 pr-4">{provider.isApproved ? "Approved" : "Unapproved"}</td>
                            <td className="py-2 pr-4">
                              {metricsHref ? (
                                <a
                                  href={metricsHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  Metrics
                                  <ExternalLink className="ml-1 inline h-3 w-3" />
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-2">
                              {logsHref ? (
                                <a
                                  href={logsHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  Logs
                                  <ExternalLink className="ml-1 inline h-3 w-3" />
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          {!providersLoading && !providersError && providersResponse.total > providersResponse.providers.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing first {providersResponse.providers.length} of {providersResponse.total} providers.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
