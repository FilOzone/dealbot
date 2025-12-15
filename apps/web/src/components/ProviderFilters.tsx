import { CheckCircle2, Filter, PlayCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

interface ProviderFiltersProps {
  activeOnly: boolean;
  approvedOnly: boolean;
  onActiveOnlyChange: (value: boolean) => void;
  onApprovedOnlyChange: (value: boolean) => void;
  totalProviders: number;
  filteredCount: number;
}

export function ProviderFilters({
  activeOnly,
  approvedOnly,
  onActiveOnlyChange,
  onApprovedOnlyChange,
  totalProviders,
  filteredCount,
}: ProviderFiltersProps) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-4">
        {/* Left side - Filter label and count */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <span className="text-sm text-muted-foreground">
            {filteredCount} of {totalProviders} providers
          </span>
        </div>

        {/* Right side - Filter buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant={activeOnly ? "default" : "outline"}
            size="sm"
            onClick={() => onActiveOnlyChange(!activeOnly)}
            className="gap-2"
          >
            <PlayCircle className="h-4 w-4" />
            Active Only
          </Button>
          <Button
            variant={approvedOnly ? "default" : "outline"}
            size="sm"
            onClick={() => onApprovedOnlyChange(!approvedOnly)}
            className="gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            Approved Only
          </Button>
        </div>
      </div>
    </Card>
  );
}
