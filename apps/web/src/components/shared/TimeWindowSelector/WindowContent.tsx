import type { DateRange, OnSelectHandler } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import type { PresetOption, PresetValue, TimeWindow } from "@/lib/time-window";

type WindowContentProps = {
  timeWindow: TimeWindow;
  onDateRangeSelect: OnSelectHandler<DateRange>;
  presetOptions: readonly PresetOption[];
  onPresetSelect: (preset: PresetValue) => void;
};

const WindowContent = ({ timeWindow, onDateRangeSelect, presetOptions, onPresetSelect }: WindowContentProps) => {
  return (
    <Card className="rounded-md flex flex-col items-starts border-none">
      <CardContent>
        <Calendar
          required
          mode="range"
          defaultMonth={timeWindow.range.from}
          selected={timeWindow.range}
          onSelect={onDateRangeSelect}
          numberOfMonths={2}
        />
      </CardContent>
      <CardFooter className="max-w-[536px] flex flex-wrap gap-2 border-t pt-4">
        {presetOptions.map((presetOption) => (
          <Button
            key={presetOption.value}
            variant={timeWindow.preset === presetOption.value ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={() => onPresetSelect(presetOption.value)}
          >
            {presetOption.label}
          </Button>
        ))}
      </CardFooter>
    </Card>
  );
};

export default WindowContent;
