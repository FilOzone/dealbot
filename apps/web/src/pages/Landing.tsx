import { Activity, ExternalLink, LineChart } from "lucide-react";
import { NetworkBadge, NetworkSwitcher } from "@/components/shared";
import { NETWORK_LABEL } from "@/components/shared/Network/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useActiveNetworks } from "@/hooks/useActiveNetworks";
import { useProvidersList } from "@/hooks/useProvidersList";
import { useSelectedNetwork } from "@/hooks/useSelectedNetwork";
import type { Network } from "@/types/config";

/**
 * Builds a BetterStack dashboard or logs URL scoped to a single provider.
 * Appends time range and provider filter. Metrics dashboard uses vs[provider_id];
 * logs dashboard uses vs[providerId]. Network scoping is layered on separately
 * via withNetworkParam.
 */
function buildBetterStackUrlWithProvider(
  baseUrl: string,
  providerId: string,
  paramKey: "vs[provider_id]" | "vs[providerId]" = "vs[provider_id]",
): string {
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("rf", "now-72h");
    url.searchParams.set("rt", "now");
    url.searchParams.set(paramKey, providerId);
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

type NetworkUrlSource = { runtime?: string; build?: string };

/**
 * Adds the vs[network] dashboard filter to a URL, preserving existing params.
 * Empty/invalid input yields "", and a null network returns the URL unchanged.
 * A no-op until the BetterStack dashboard defines a {{network}} variable, so it
 * is safe to emit ahead of that dashboard change.
 */
const withNetworkParam = (baseUrl: string, network: Network | null): string => {
  if (!baseUrl || !network) return baseUrl;
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("vs[network]", network);
    return url.toString();
  } catch {
    return "";
  }
};

const getConfig = (network: Network | null) => {
  const runtimeConfig = typeof window === "undefined" ? undefined : window.__DEALBOT_CONFIG__;

  // Metrics dashboard and SP logs are a single per-environment dashboard; the
  // per-SP rows add a vs[network] filter (see withNetworkParam) so one dashboard
  // serves every network the deployment monitors.
  const dashboardUrl = getConfigUrl(runtimeConfig?.DASHBOARD_URL, import.meta.env.VITE_DASHBOARD_URL);
  const logsUrl = getConfigUrl(runtimeConfig?.LOGS_URL, import.meta.env.VITE_LOGS_URL);

  // Approved-SP dashboard: prefer the combined per-environment dashboard scoped
  // with vs[network]; fall back to the legacy per-network dashboards so existing
  // deployments keep working until infra sets APPROVED_SP_DASHBOARD_URL.
  const approvedSpGlobal = getConfigUrl(
    runtimeConfig?.APPROVED_SP_DASHBOARD_URL,
    import.meta.env.VITE_APPROVED_SP_DASHBOARD_URL,
  );
  const approvedSpPerNetworkSources: Record<Network, NetworkUrlSource> = {
    mainnet: {
      runtime: runtimeConfig?.APPROVED_SP_DASHBOARD_URL_MAINNET,
      build: import.meta.env.VITE_APPROVED_SP_DASHBOARD_URL_MAINNET,
    },
    calibration: {
      runtime: runtimeConfig?.APPROVED_SP_DASHBOARD_URL_CALIBRATION,
      build: import.meta.env.VITE_APPROVED_SP_DASHBOARD_URL_CALIBRATION,
    },
  };
  const approvedSpPerNetwork = network
    ? getConfigUrl(approvedSpPerNetworkSources[network].runtime, approvedSpPerNetworkSources[network].build)
    : { safe: "", isInvalid: false };
  let approvedSpDashboardUrl = approvedSpPerNetwork;
  if (approvedSpGlobal.safe) {
    approvedSpDashboardUrl = { safe: withNetworkParam(approvedSpGlobal.safe, network), isInvalid: false };
  } else if (approvedSpGlobal.isInvalid) {
    approvedSpDashboardUrl = approvedSpGlobal;
  }

  return {
    dashboardUrl: dashboardUrl.safe,
    dashboardUrlInvalid: dashboardUrl.isInvalid,
    approvedSpDashboardUrl: approvedSpDashboardUrl.safe,
    approvedSpDashboardUrlInvalid: approvedSpDashboardUrl.isInvalid,
    logsUrl: logsUrl.safe,
    logsUrlInvalid: logsUrl.isInvalid,
  };
};

export default function Landing() {
  const { activeNetworks, loading: configLoading } = useActiveNetworks();
  const [selectedNetwork, setSelectedNetwork] = useSelectedNetwork(activeNetworks);
  const {
    dashboardUrl,
    dashboardUrlInvalid,
    approvedSpDashboardUrl,
    approvedSpDashboardUrlInvalid,
    logsUrl,
    logsUrlInvalid,
  } = getConfig(selectedNetwork);
  // Pass null while config is loading to defer the fetch; once resolved, scope to the selected network.
  const {
    providers: providersResponse,
    loading: providersLoading,
    error: providersError,
  } = useProvidersList(0, 500, selectedNetwork);

  const providersPending = configLoading || selectedNetwork === null || providersLoading;

  return (
    <div className="flex w-full flex-col items-center gap-12 pt-8">
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2 text-primary">
          <Activity className="h-8 w-8" />
          <h1 className="text-3xl font-bold">DealBot</h1>
        </div>

        <div className="flex justify-center">
          <NetworkBadge network={selectedNetwork} loading={configLoading} />
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
        {approvedSpDashboardUrlInvalid && selectedNetwork && (
          <p className="text-sm text-yellow-600">
            Warning: approved-SP dashboard URL (<code>APPROVED_SP_DASHBOARD_URL</code> or{" "}
            <code>APPROVED_SP_DASHBOARD_URL_{selectedNetwork.toUpperCase()}</code>) configured but invalid. Link
            unavailable.
          </p>
        )}
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

      {/* Combined approved-SP dashboard CTA */}
      {approvedSpDashboardUrl && selectedNetwork && (
        <Card className="w-full border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col items-start gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <LineChart className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
              <div>
                <p className="font-medium">Filecoin Onchain Cloud: approved SP performance</p>
                <p className="text-sm text-muted-foreground">
                  Aggregated metrics across all SPs approved for FOC storage on {NETWORK_LABEL[selectedNetwork]}.
                </p>
              </div>
            </div>
            <Button asChild variant="default" size="sm">
              <a href={approvedSpDashboardUrl} target="_blank" rel="noopener noreferrer">
                View dashboard
                <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Storage providers – metrics & logs */}
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-base">Storage providers – metrics & logs</CardTitle>
            {selectedNetwork !== null && (
              <NetworkSwitcher networks={activeNetworks} selected={selectedNetwork} onChange={setSelectedNetwork} />
            )}
          </div>
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
          {providersPending && <p className="text-sm text-muted-foreground">Loading providers…</p>}
          {!providersPending &&
            !providersError &&
            (() => {
              const activeProviders = providersResponse.providers
                .filter((p) => p.isActive)
                .sort((a, b) => {
                  if (a.providerId == null && b.providerId == null) return 0;
                  if (a.providerId == null) return 1;
                  if (b.providerId == null) return -1;
                  return a.providerId.localeCompare(b.providerId, undefined, { numeric: true });
                });
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
                          dashboardUrl && providerId != null
                            ? withNetworkParam(
                                buildBetterStackUrlWithProvider(dashboardUrl, providerId, "vs[provider_id]"),
                                selectedNetwork,
                              )
                            : "";
                        const logsHref =
                          logsUrl && providerId != null
                            ? withNetworkParam(
                                buildBetterStackUrlWithProvider(logsUrl, providerId, "vs[providerId]"),
                                selectedNetwork,
                              )
                            : "";
                        return (
                          <tr key={provider.address} className="border-b last:border-b-0">
                            <td className="py-2 pr-4">{provider.name || provider.address}</td>
                            <td className="py-2 pr-4">{providerId != null ? providerId : "—"}</td>
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
                                  <ExternalLink className="ml-1 inline h-3 w-3" aria-hidden="true" />
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
                                  <ExternalLink className="ml-1 inline h-3 w-3" aria-hidden="true" />
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
