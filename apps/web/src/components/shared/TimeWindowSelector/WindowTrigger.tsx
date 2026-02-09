import { Calendar, ChevronDown } from "lucide-react";
import React from "react";
import { Button } from "@/components/ui/button";

type WindowTriggerProps = React.ComponentPropsWithoutRef<typeof Button> & {
  label: string;
};

const WindowTrigger = React.forwardRef<HTMLButtonElement, WindowTriggerProps>(({ label, ...props }, ref) => (
  <Button
    ref={ref}
    variant="outline"
    className="w-full sm:w-auto justify-between gap-2 font-normal border-dashed hover:border-solid transition-all"
    {...props}
  >
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm">{label}</span>
    </div>
    <ChevronDown className="h-4 w-4 text-muted-foreground" />
  </Button>
));

WindowTrigger.displayName = "WindowTrigger";

export default WindowTrigger;
