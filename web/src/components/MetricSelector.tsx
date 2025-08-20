import type { MetricKey } from "../App";

const metrics: { key: MetricKey; label: string }[] = [
  { key: "dealSuccessRate", label: "DEAL SUCCESS %" },
  { key: "retrievalSuccessRate", label: "RETRIEVAL SUCCESS %" },
  { key: "ingestLatency", label: "INGEST LATENCY" },
  { key: "chainLatency", label: "CHAIN LATENCY" },
  { key: "retrievalLatency", label: "RETRIEVAL LATENCY" },
  { key: "retrievalThroughput", label: "RETRIEVAL THROUGHPUT" },
  { key: "totalDeals", label: "TOTAL DEALS" },
  { key: "totalRetrievals", label: "TOTAL RETRIEVALS" },
];

export function MetricSelector({ value, onChange }: { value: MetricKey; onChange: (m: MetricKey) => void }) {
  return (
    <div className="relative">
      <select
        className="cyber-input pr-10 appearance-none cursor-pointer font-medium"
        value={value}
        onChange={(e) => onChange(e.target.value as MetricKey)}
      >
        {metrics.map((m) => (
          <option key={m.key} value={m.key} className="bg-black text-yellow-400">
            {m.label}
          </option>
        ))}
      </select>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5 absolute right-3 top-1/2 transform -translate-y-1/2 text-yellow-400/60 pointer-events-none"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
