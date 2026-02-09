export interface TimeWindow {
  type: "preset" | "custom";
  preset?: string;
  from?: Date;
  to?: Date;
  label: string;
}

export interface PresetOptions {
  value: string;
  label: string;
}
