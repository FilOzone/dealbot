import type { DateRange } from "react-day-picker";
import { PRESET_OPTIONS } from "./constants";

export type PresetOption = (typeof PRESET_OPTIONS)[number];

export type PresetValue = PresetOption["value"];

export type TimeWindow = {
  range: DateRange;
  preset?: PresetValue;
};
