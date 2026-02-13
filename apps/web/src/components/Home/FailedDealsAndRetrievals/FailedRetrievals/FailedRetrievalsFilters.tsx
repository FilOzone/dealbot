import { Filter, Search, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ServiceType } from "@/types/services";

interface FailedRetrievalsFiltersProps {
  searchValue: string;
  providerFilter: string;
  serviceTypeFilter: ServiceType | "all";
  onSearchChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onServiceTypeFilterChange: (value: ServiceType | "all") => void;
  providers: Array<{ address: string; name?: string; providerId?: number }>;
  totalRetrievals: number;
  filteredCount: number;
}

function FailedRetrievalsFilters({
  searchValue,
  providerFilter,
  serviceTypeFilter,
  onSearchChange,
  onProviderFilterChange,
  onServiceTypeFilterChange,
  providers,
  totalRetrievals,
  filteredCount,
}: FailedRetrievalsFiltersProps) {
  const [localSearch, setLocalSearch] = useState(searchValue);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(localSearch);
  };

  const handleClearFilters = () => {
    setLocalSearch("");
    onSearchChange("");
    onProviderFilterChange("");
    onServiceTypeFilterChange("all");
  };

  const hasActiveFilters = searchValue || providerFilter || serviceTypeFilter;

  return (
    <Card className="p-4 mb-4">
      <div className="flex flex-col gap-4">
        {/* Top row - Filter label and count */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <span className="text-sm text-muted-foreground">
              {filteredCount} of {totalRetrievals} failed retrievals
            </span>
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={handleClearFilters} className="gap-2">
              <X className="h-4 w-4" />
              Clear Filters
            </Button>
          )}
        </div>

        {/* Bottom row - Search and filters */}
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search */}
          <form onSubmit={handleSearchSubmit} className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by error message or endpoint..."
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="pl-9 pr-20"
              />
              {localSearch && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLocalSearch("");
                    onSearchChange("");
                  }}
                  className="absolute right-12 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              <Button type="submit" size="sm" className="absolute right-1 top-1/2 transform -translate-y-1/2">
                Search
              </Button>
            </div>
          </form>

          {/* Service Type Filter */}
          <div className="w-full md:w-[200px]">
            <Select value={serviceTypeFilter} onValueChange={onServiceTypeFilterChange}>
              <SelectTrigger>
                <SelectValue placeholder="All Service Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Service Types</SelectItem>
                <SelectItem value={ServiceType.DIRECT_SP}>Direct SP</SelectItem>
                <SelectItem value={ServiceType.IPFS_PIN}>IPFS Pin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Provider Filter */}
          <div className="w-full md:w-[280px]">
            <Select value={providerFilter} onValueChange={onProviderFilterChange}>
              <SelectTrigger>
                <SelectValue placeholder="All Providers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Providers</SelectItem>
                {providers
                  ? providers.map((provider) => (
                      <SelectItem key={provider.address} value={provider.address}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{provider.name || "Unknown"}</span>
                          <span className="text-muted-foreground">({provider.providerId || "N/A"})</span>
                        </div>
                      </SelectItem>
                    ))
                  : null}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default FailedRetrievalsFilters;
