import { ArrowUpDown, Search } from "lucide-react";
import type { ProviderHealthStatus } from "../types/providers";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/**
 * Provider filter and sort component
 * Provides search, health status filtering, and sorting controls
 */

// Sort options for providers
export type ProviderSortKey = "health" | "name" | "deals" | "retrievals" | "successRate";
export type SortOrder = "asc" | "desc";

interface ProviderFilterProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  healthFilter: ProviderHealthStatus[];
  onHealthFilterChange: (statuses: ProviderHealthStatus[]) => void;
  sortBy: ProviderSortKey;
  onSortChange: (sort: ProviderSortKey) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
}

export function ProviderFilter({
  searchValue,
  onSearchChange,
  healthFilter,
  onHealthFilterChange,
  sortBy,
  onSortChange,
  sortOrder,
  onSortOrderChange,
}: ProviderFilterProps) {
  const healthStatuses: { value: ProviderHealthStatus; label: string; icon: string; color: string }[] = [
    { value: "excellent", label: "Excellent", icon: "✅", color: "text-green-600 dark:text-green-400" },
    { value: "good", label: "Good", icon: "👍", color: "text-blue-600 dark:text-blue-400" },
    { value: "fair", label: "Fair", icon: "⚠️", color: "text-yellow-700 dark:text-yellow-400" },
    { value: "poor", label: "Poor", icon: "🔴", color: "text-red-600 dark:text-red-400" },
    { value: "inactive", label: "Inactive", icon: "⚪", color: "text-muted-foreground" },
  ];

  const toggleHealthFilter = (status: ProviderHealthStatus) => {
    if (healthFilter.includes(status)) {
      onHealthFilterChange(healthFilter.filter((s) => s !== status));
    } else {
      onHealthFilterChange([...healthFilter, status]);
    }
  };

  return (
    <div className='space-y-4'>
      {/* Search and Sort Controls */}
      <div className='flex flex-wrap items-center gap-4'>
        {/* Search Input */}
        <div className='relative flex-1 min-w-[200px]'>
          <Input
            type='text'
            placeholder='Search providers...'
            className='pl-8'
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <Search className='absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
        </div>

        {/* Sort By */}
        <Select value={sortBy} onValueChange={(v) => onSortChange(v as ProviderSortKey)}>
          <SelectTrigger className='w-[180px]'>
            <SelectValue placeholder='Sort by' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='health'>Health Score</SelectItem>
            <SelectItem value='name'>Provider Address</SelectItem>
            <SelectItem value='deals'>Total Deals</SelectItem>
            <SelectItem value='retrievals'>Total Retrievals</SelectItem>
            <SelectItem value='successRate'>Success Rate</SelectItem>
          </SelectContent>
        </Select>

        {/* Sort Order */}
        <button
          type='button'
          onClick={() => onSortOrderChange(sortOrder === "asc" ? "desc" : "asc")}
          className='px-3 py-2 border border-input bg-background rounded-md hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2'
        >
          <ArrowUpDown className='h-4 w-4' />
          <span className='text-sm font-medium'>
            {sortBy === "name"
              ? sortOrder === "asc"
                ? "A → Z"
                : "Z → A"
              : sortOrder === "asc"
                ? "Low → High"
                : "High → Low"}
          </span>
        </button>
      </div>

      {/* Health Status Filters */}
      <div className='space-y-2'>
        <p className='text-sm font-medium text-muted-foreground'>Filter by Health Status:</p>
        <div className='flex flex-wrap gap-2'>
          {healthStatuses.map((status) => (
            <Badge
              key={status.value}
              variant={healthFilter.includes(status.value) ? "default" : "outline"}
              className={`cursor-pointer transition-all hover:scale-105 ${
                healthFilter.includes(status.value) ? status.color : ""
              }`}
              onClick={() => toggleHealthFilter(status.value)}
            >
              <span className='mr-1.5'>{status.icon}</span>
              <span className='text-xs'>{status.label}</span>
            </Badge>
          ))}
          {healthFilter.length > 0 && (
            <Badge
              variant='secondary'
              className='cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors'
              onClick={() => onHealthFilterChange([])}
            >
              <span className='text-xs'>Clear Filters ({healthFilter.length})</span>
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
