import type { DateRange, OnSelectHandler } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PresetValue, TimeWindow } from "@/lib/time-window";
import { getTimeWindowLabel, PRESET_OPTIONS } from "@/lib/time-window";
import WindowContent from "./WindowContent";
import WindowTrigger from "./WindowTrigger";

interface TimeWindowSelectorProps {
  timeWindow: TimeWindow;
  onDateRangeSelect: OnSelectHandler<DateRange>;
  onPresetSelect: (preset: PresetValue) => void;
}

function TimeWindowSelector({ timeWindow, onDateRangeSelect, onPresetSelect }: TimeWindowSelectorProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <WindowTrigger label={getTimeWindowLabel(timeWindow)} />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <WindowContent
          timeWindow={timeWindow}
          onDateRangeSelect={onDateRangeSelect}
          presetOptions={PRESET_OPTIONS}
          onPresetSelect={onPresetSelect}
        />
      </PopoverContent>
    </Popover>
  );
}

export default TimeWindowSelector;
