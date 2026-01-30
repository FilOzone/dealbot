import { CheckCircle2, Filter, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ProviderFiltersProps {
  activeOnly: boolean;
  approvedOnly: boolean;
  onActiveOnlyChange: (value: boolean) => void;
  onApprovedOnlyChange: (value: boolean) => void;
  totalProviders: number;
  filteredCount: number;
}

function ProviderFilters({
  activeOnly,
  approvedOnly,
  onActiveOnlyChange,
  onApprovedOnlyChange,
  totalProviders,
  filteredCount,
}: ProviderFiltersProps) {
  return (
    <Card className="p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Left side - Filter label and count */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <span className="text-xs sm:text-sm text-muted-foreground">
            {filteredCount} of {totalProviders}
          </span>
        </div>

        {/* Right side - Filter buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={activeOnly ? "default" : "outline"}
            size="sm"
            onClick={() => onActiveOnlyChange(!activeOnly)}
            className="gap-1.5"
          >
            <PlayCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Active Only</span>
            <span className="inline sm:hidden">Active</span>
          </Button>
          <Button
            variant={approvedOnly ? "default" : "outline"}
            size="sm"
            onClick={() => onApprovedOnlyChange(!approvedOnly)}
            className="gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span className="hidden sm:inline">Approved Only</span>
            <span className="inline sm:hidden">Approved</span>
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default ProviderFilters;
