import { z } from "zod";
import { PRESET_OPTIONS } from "./constants";
import type { PresetValue, TimeWindow } from "./types";

const DEFAULT_PRESET: PresetValue = "7d";

const VALID_PRESETS = PRESET_OPTIONS.map((o) => o.value) as [PresetValue, ...PresetValue[]];

const dateSchema = z
  .string()
  .refine((val) => !Number.isNaN(new Date(val).getTime()), "Invalid date string")
  .transform((val) => new Date(val));

const presetParamSchema = z.object({
  preset: z.enum(VALID_PRESETS),
});

const dateRangeParamSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine(({ from, to }) => from <= to, "Start date must be before end date");

/**
 * Parses a URL search parameter object into a TimeWindow object.
 * Validates presets against PRESET_OPTIONS and date ranges using Zod schemas.
 * Falls back to the default preset ("7d") if the URL params are invalid or absent.
 *
 * @param searchParams - URL search parameter object to parse
 * @returns Parsed TimeWindow object
 */
export function parseTimeWindowFromURL(searchParams: URLSearchParams): TimeWindow {
  const now = new Date();
  const params = Object.fromEntries(searchParams);

  const presetResult = presetParamSchema.safeParse(params);
  if (presetResult.success) {
    return { range: { from: now, to: undefined }, preset: presetResult.data.preset };
  }

  const rangeResult = dateRangeParamSchema.safeParse(params);
  if (rangeResult.success) {
    return { range: { from: rangeResult.data.from, to: rangeResult.data.to }, preset: undefined };
  }

  return { range: { from: now, to: undefined }, preset: DEFAULT_PRESET };
}

/**
 * Serializes a TimeWindow to URL search parameters.
 * Only includes necessary parameters based on the type.
 *
 * @param timeWindow - TimeWindow to serialize
 * @returns URLSearchParams with minimal required parameters
 */
export function serializeTimeWindowToURL({ range, preset }: TimeWindow): URLSearchParams {
  const params = new URLSearchParams();

  if (preset) {
    params.set("preset", preset);
  } else if (range.from && range.to) {
    params.set("from", range.from.toISOString());
    params.set("to", range.to.toISOString());
  }

  return params;
}

/**
 * Gets a human-readable label for a preset value.
 * Looks up the label from PRESET_OPTIONS to ensure consistency.
 *
 * @param preset - Preset string (e.g., "7d", "30d", "all")
 * @returns Human-readable label
 */
export function getPresetLabel(preset: PresetValue): string {
  const option = PRESET_OPTIONS.find((o) => o.value === preset);
  return option?.label ?? preset;
}

/**
 * Formats a custom date range into a readable label.
 *
 * @param from - Start date
 * @param to - End date
 * @returns Formatted date range string
 */
export function formatCustomDateRange(from: Date | undefined, to: Date | undefined): string {
  if (!from || !to) return "";

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return `${formatDate(from)} - ${formatDate(to)}`;
}

export function getTimeWindowLabel(timeWindow: TimeWindow): string {
  if (timeWindow.preset) return getPresetLabel(timeWindow.preset);
  return formatCustomDateRange(timeWindow.range.from, timeWindow.range.to);
}
