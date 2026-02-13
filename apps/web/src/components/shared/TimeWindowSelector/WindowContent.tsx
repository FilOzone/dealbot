import { subDays } from "date-fns";
import type { DateRange, OnSelectHandler } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import type { PresetOption, PresetValue, TimeWindow } from "@/lib/time-window";

const today = new Date();
const ninetyDaysAgo = subDays(today, 90);

type WindowContentProps = {
  timeWindow: TimeWindow;
  onDateRangeSelect: OnSelectHandler<DateRange>;
  presetOptions: readonly PresetOption[];
  onPresetSelect: (preset: PresetValue) => void;
};

const WindowContent = ({ timeWindow, onDateRangeSelect, presetOptions, onPresetSelect }: WindowContentProps) => {
  return (
    <Card className="rounded-md border-none mx-auto w-fit max-w-[540px]">
      <CardContent>
        <Calendar
          required
          mode="range"
          defaultMonth={timeWindow.range.from}
          selected={timeWindow.range}
          onSelect={onDateRangeSelect}
          numberOfMonths={2}
          disabled={{ before: ninetyDaysAgo, after: today }}
          className="p-0 [--cell-size:--spacing(8.5)]"
        />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t pt-4">
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
