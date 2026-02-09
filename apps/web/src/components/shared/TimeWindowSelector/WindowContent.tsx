import type { DateRange, OnSelectHandler } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import type { PresetOptions, TimeWindow } from "./types";

type WindowContentProps = {
  value: TimeWindow;
  onDateRangeSelect: OnSelectHandler<DateRange>;
  presetOptions: PresetOptions[];
  onPresetSelect: (preset: string, label: string) => void;
};

const WindowContent = ({ value, onDateRangeSelect, presetOptions, onPresetSelect }: WindowContentProps) => {
  const selectedRange = {
    from: value.from,
    to: value.to,
  };

  return (
    <Card className="flex flex-col items-start">
      <CardContent>
        <Calendar
          required
          mode="range"
          defaultMonth={value.from}
          selected={selectedRange}
          onSelect={onDateRangeSelect}
          numberOfMonths={2}
        />
      </CardContent>
      <CardFooter className="max-w-[536px] flex flex-wrap gap-2 border-t pt-4">
        {presetOptions.map((preset) => (
          <Button
            key={preset.value}
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => {
              onPresetSelect(preset.value, preset.label);
            }}
          >
            {preset.label}
          </Button>
        ))}
      </CardFooter>
    </Card>
  );
};

export default WindowContent;
