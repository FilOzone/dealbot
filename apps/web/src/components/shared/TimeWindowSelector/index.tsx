import { format } from "date-fns";
import { useState } from "react";
import type { DateRange, OnSelectHandler } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PRESET_OPTIONS } from "./constants";
import type { TimeWindow } from "./types";
import WindowContent from "./WindowContent";
import WindowTrigger from "./WindowTrigger";

interface TimeWindowSelectorProps {
  value: TimeWindow;
  onChange: (window: TimeWindow) => void;
}

function TimeWindowSelector({ value, onChange }: TimeWindowSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handlePresetSelect = (preset: string, label: string) => {
    onChange({
      type: "preset",
      preset,
      label,
    });
    setIsOpen(false);
  };

  const handleDateRangeSelect: OnSelectHandler<DateRange> = (selected) => {
    onChange({
      type: "custom",
      from: selected.from,
      to: selected.to,
      label: selected.from && selected.to ? `${format(selected.from, "MMM d")} - ${format(selected.to, "MMM d")}` : "",
    });
    if (selected.from && selected.to) {
      setIsOpen(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <WindowTrigger label={value.label} />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <WindowContent
          value={value}
          onDateRangeSelect={handleDateRangeSelect}
          presetOptions={PRESET_OPTIONS}
          onPresetSelect={handlePresetSelect}
        />
      </PopoverContent>
    </Popover>
  );
}

export default TimeWindowSelector;
