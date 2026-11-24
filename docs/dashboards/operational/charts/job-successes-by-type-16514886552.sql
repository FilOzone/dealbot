WITH per_series AS (
  SELECT
    {{time}} AS time,
    label('job_type') AS job_type,
    label('network') AS network,
    series_id,
    maxMerge(value_max) AS max_counter
  FROM {{source}}
  WHERE name = 'jobs_completed_total'
    -- Seed the counter deltas before the longest mainnet window (48h).
    AND dt BETWEEN ({{start_time}} - INTERVAL 49 HOUR) AND {{end_time}}
    AND label('app') = 'dealbot'
    AND label('network') IN ('mainnet', 'calibration')
    AND label('handler_result') = 'success'
  GROUP BY time, job_type, network, series_id
),
ranked AS (
  SELECT *,
    row_number() OVER (PARTITION BY job_type, network, series_id ORDER BY time) AS rn,
    lagInFrame(max_counter, 1, max_counter)
      OVER (PARTITION BY job_type, network, series_id ORDER BY time) AS prev_counter
  FROM per_series
),
deltas AS (
  SELECT
    time,
    job_type,
    network,
    CASE
      WHEN rn = 1 AND max_counter <= 100 THEN max_counter
      WHEN rn = 1 THEN 0
      ELSE greatest(max_counter - prev_counter, 0)
    END AS delta
  FROM ranked
),
per_bucket AS (
  SELECT
    time,
    toUnixTimestamp(time) AS ts,
    concat(job_type, ' (', network, ')') AS series,
    network,
    job_type,
    sum(delta) AS bucket_value
  FROM deltas
  GROUP BY time, job_type, network
),
windowed AS (
  SELECT
    time,
    series,
    network,
    job_type,
    bucket_value,
    sum(bucket_value) OVER (PARTITION BY series ORDER BY ts RANGE BETWEEN 1500 PRECEDING AND CURRENT ROW) AS rolling_25m,
    sum(bucket_value) OVER (PARTITION BY series ORDER BY ts RANGE BETWEEN 10800 PRECEDING AND CURRENT ROW) AS rolling_3h,
    sum(bucket_value) OVER (PARTITION BY series ORDER BY ts RANGE BETWEEN 14400 PRECEDING AND CURRENT ROW) AS rolling_4h,
    sum(bucket_value) OVER (PARTITION BY series ORDER BY ts RANGE BETWEEN 43200 PRECEDING AND CURRENT ROW) AS rolling_12h,
    sum(bucket_value) OVER (PARTITION BY series ORDER BY ts RANGE BETWEEN 172800 PRECEDING AND CURRENT ROW) AS rolling_48h
  FROM per_bucket
)
SELECT
  time,
  series,
  CASE job_type
    WHEN 'deal' THEN if(network = 'mainnet', rolling_3h, rolling_25m)
    WHEN 'retrieval' THEN rolling_25m
    WHEN 'retrieval_sampled' THEN rolling_25m
    WHEN 'data_set_creation' THEN if(network = 'mainnet', rolling_48h, rolling_4h)
    WHEN 'data_retention_poll' THEN rolling_4h
    WHEN 'providers_refresh' THEN rolling_12h
    WHEN 'data_set_lifecycle_check' THEN rolling_4h
    ELSE bucket_value
  END AS value
FROM windowed
WHERE time >= {{start_time}}
ORDER BY time
