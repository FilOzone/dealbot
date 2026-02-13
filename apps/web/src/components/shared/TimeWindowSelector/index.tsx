import { useCallback, useState } from "react";
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
  const [open, setOpen] = useState(false);

  const handleDateRangeSelect: OnSelectHandler<DateRange> = useCallback(
    (range, triggerDate, modifiers, e) => {
      onDateRangeSelect(range, triggerDate, modifiers, e);
      if (range.from && range.to) {
        setOpen(false);
      }
    },
    [onDateRangeSelect],
  );

  const handlePresetSelect = useCallback(
    (preset: PresetValue) => {
      onPresetSelect(preset);
      setOpen(false);
    },
    [onPresetSelect],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <WindowTrigger label={getTimeWindowLabel(timeWindow)} />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <WindowContent
          timeWindow={timeWindow}
          onDateRangeSelect={handleDateRangeSelect}
          presetOptions={PRESET_OPTIONS}
          onPresetSelect={handlePresetSelect}
        />
      </PopoverContent>
    </Popover>
  );
}

export default TimeWindowSelector;
