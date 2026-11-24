# Dealbot dashboard changes

The files in `operational/` cover the mainnet deal, dataset creation, and storage sample alerts on the [Dealbot Operational Dashboard](https://telemetry.betterstack.com/team/t468215/dashboards/618457). Chart filenames contain their Better Stack IDs. Each alert JSON identifies its dashboard, chart, alert, and monitored series.

## Applying a reviewed change

1. Get a teammate's approval on the PR, then compare the live settings with the PR baseline. [Dashboard review workflow](https://github.com/FilOzone/dealbot/issues/629)
2. In the existing charts, replace the SQL with the corresponding file from `operational/charts/`. In each existing alert, update the fields changed by the PR. The job windows are defined in chart SQL. The storage sample window is the alert's `aggregation_interval`, in seconds.
3. Preview the mainnet series in Better Stack, verify the five alert rules, then merge the PR.

## Restoring the usual cadence

When the [temporary mainnet schedule](https://github.com/FilOzone/infra/pull/473) ends, restore the previous dashboard settings in the same rollout. The original job windows were 25 minutes for deals and 4 hours for dataset creation. The storage sample alert used a 2-hour aggregation interval (7,200 seconds), although its original name said 1 hour. Use the baseline commit from the alert-window PR for the original queries and settings.
