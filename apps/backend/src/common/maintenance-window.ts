const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type MaintenanceWindow = {
  startMinutes: number;
  label: string;
};

export type MaintenanceWindowStatus = {
  active: boolean;
  window?: MaintenanceWindow;
};

export function parseMaintenanceWindowTimes(windowsUtc: string[]): MaintenanceWindow[] {
  const parsed: MaintenanceWindow[] = [];

  for (const raw of windowsUtc) {
    const value = raw.trim();
    if (value.length === 0) continue;

    const match = value.match(TIME_PATTERN);
    if (!match) {
      throw new Error(`Invalid maintenance window time "${raw}". Expected HH:MM in 24h UTC (e.g., "07:00").`);
    }

    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    parsed.push({
      startMinutes: hours * 60 + minutes,
      label: value,
    });
  }

  return parsed;
}

export function getMaintenanceWindowStatus(
  now: Date,
  windowsUtc: string[],
  durationMinutes: number,
): MaintenanceWindowStatus {
  if (!windowsUtc || windowsUtc.length === 0 || durationMinutes <= 0) {
    return { active: false };
  }

  const parsed = parseMaintenanceWindowTimes(windowsUtc);
  if (parsed.length === 0) {
    return { active: false };
  }

  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;
  const duration = durationMinutes;

  for (const window of parsed) {
    const start = window.startMinutes;
    const end = start + duration;
    if (end < 24 * 60) {
      if (nowMinutes >= start && nowMinutes < end) {
        return { active: true, window };
      }
    } else {
      const wrappedEnd = end - 24 * 60;
      if (nowMinutes >= start || nowMinutes < wrappedEnd) {
        return { active: true, window };
      }
    }
  }

  return { active: false };
}
