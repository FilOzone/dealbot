export function formatFileSize(size: number) {
  const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  return `${(size / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatThroughput(value: number) {
  return `${formatFileSize(value)}/s`;
}

export function formatMilliseconds(ms: number, decimals: number = 2): string {
  const units = [
    { label: "ms", divisor: 1, threshold: 1000 },
    { label: "sec", divisor: 1000, threshold: 60 * 1000 },
    { label: "min", divisor: 60 * 1000, threshold: 60 * 60 * 1000 },
    { label: "h", divisor: 60 * 60 * 1000, threshold: 24 * 60 * 60 * 1000 },
    { label: "day", divisor: 24 * 60 * 60 * 1000, threshold: Infinity },
  ];

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];

    if (ms < unit.threshold || i === units.length - 1) {
      const value = ms / unit.divisor;
      const formatted = unit.label === "ms" ? Math.round(value) : parseFloat(value.toFixed(decimals));

      const plural = formatted !== 1 && unit.label !== "ms" ? "s" : "";
      return `${formatted} ${unit.label}${plural}`;
    }
  }

  return `${ms} ms`;
}
