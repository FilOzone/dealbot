import { Activity, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const getConfig = () => ({
  dashboardUrl: window.__DEALBOT_CONFIG__?.DASHBOARD_URL ?? import.meta.env.VITE_DASHBOARD_URL ?? "",
  dashboardEmbedUrl: window.__DEALBOT_CONFIG__?.DASHBOARD_EMBED_URL ?? import.meta.env.VITE_DASHBOARD_EMBED_URL ?? "",
  logsUrl: window.__DEALBOT_CONFIG__?.LOGS_URL ?? import.meta.env.VITE_LOGS_URL ?? "",
});

export default function Landing() {
  const { dashboardUrl, dashboardEmbedUrl, logsUrl } = getConfig();

  return (
    <div className="flex flex-col items-center gap-8 py-12 max-w-5xl mx-auto">
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
      </div>

      {/* SP filter instructions */}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-base">View more details for a Storage Provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              To filter the dashboard or logs to your SP, update the{" "}
              <code className="font-mono text-foreground">providerId</code> variable on the dashboard to the appropriate
              provider ID.
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            {dashboardUrl ? (
              <Button size="lg" asChild>
                <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
                  View Metrics Dashboard
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            ) : (
              <p className="text-xs text-destructive">
                No dashboard URL configured — set <code className="font-mono">VITE_DASHBOARD_URL</code> or{" "}
                <code className="font-mono">DASHBOARD_URL</code> in runtime config.
              </p>
            )}
            {logsUrl && (
              <Button size="lg" variant="outline" asChild>
                <a href={logsUrl} target="_blank" rel="noopener noreferrer">
                  View Logs
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Embedded dashboard */}
      {dashboardEmbedUrl && (
        <div className="w-full rounded-xl border overflow-hidden">
          <iframe
            src={dashboardEmbedUrl}
            title="Metrics Dashboard"
            className="w-full"
            style={{ height: "80vh", minHeight: "600px", minWidth: "800px", border: "none" }}
          />
        </div>
      )}
    </div>
  );
}
