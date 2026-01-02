import { format } from "date-fns";
import { Calendar, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface TimeWindow {
  type: "preset" | "custom";
  preset?: string;
  startDate?: Date;
  endDate?: Date;
  label: string;
}

interface TimeWindowSelectorProps {
  value: TimeWindow;
  onChange: (window: TimeWindow) => void;
}

const PRESET_OPTIONS = [
  { value: "1h", label: "Last Hour" },
  { value: "6h", label: "Last 6 Hours" },
  { value: "12h", label: "Last 12 Hours" },
  { value: "24h", label: "Last 24 Hours" },
  { value: "2d", label: "Last 2 Days" },
  { value: "7d", label: "Last 7 Days" },
  { value: "14d", label: "Last 14 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "60d", label: "Last 60 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "all", label: "All Time" },
];

function TimeWindowSelector({ value, onChange }: TimeWindowSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [startDate, setStartDate] = useState<Date | undefined>(value.startDate);
  const [endDate, setEndDate] = useState<Date | undefined>(value.endDate);

  const handlePresetSelect = (preset: string, label: string) => {
    onChange({
      type: "preset",
      preset,
      label,
    });
    setCustomMode(false);
    setIsOpen(false);
  };

  const handleCustomApply = () => {
    if (startDate && endDate) {
      onChange({
        type: "custom",
        startDate,
        endDate,
        label: `${format(startDate, "MMM d")} - ${format(endDate, "MMM d")}`,
      });
      setIsOpen(false);
      setCustomMode(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full sm:w-auto justify-between gap-2 font-normal border-dashed hover:border-solid transition-all"
        >
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{value.label}</span>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        {!customMode ? (
          <div className="p-2">
            <div className="mb-2 px-2 py-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick Select</p>
            </div>
            <div className="space-y-0.5">
              {PRESET_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handlePresetSelect(option.value, option.label)}
                  className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                    value.type === "preset" && value.preset === option.value
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t">
              <button
                onClick={() => setCustomMode(true)}
                className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors flex items-center gap-2"
              >
                <Calendar className="h-4 w-4" />
                Custom Date Range
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Start Date</p>
              <CalendarComponent
                mode="single"
                selected={startDate}
                onSelect={setStartDate}
                disabled={(date: Date) => date > new Date() || (endDate ? date > endDate : false)}
                initialFocus
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">End Date</p>
              <CalendarComponent
                mode="single"
                selected={endDate}
                onSelect={setEndDate}
                disabled={(date: Date) => date > new Date() || (startDate ? date < startDate : false)}
              />
            </div>
            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setCustomMode(false)} className="flex-1">
                Cancel
              </Button>
              <Button size="sm" onClick={handleCustomApply} disabled={!startDate || !endDate} className="flex-1">
                Apply
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default TimeWindowSelector;
