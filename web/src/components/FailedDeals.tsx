import { FileX } from "lucide-react";
import type { FailedDealsResponse } from "../types/failed-deals";
import { FailedDealItem } from "./FailedDealItem";
import { FailedDealsFilters } from "./FailedDealsFilters";
import { Pagination } from "./Pagination";
import { Accordion } from "./ui/accordion";

interface FailedDealsProps {
  data: FailedDealsResponse;
  searchValue: string;
  providerFilter: string;
  onSearchChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  providers: Array<{ address: string; name?: string }>;
}

export function FailedDeals({
  data,
  searchValue,
  providerFilter,
  onSearchChange,
  onProviderFilterChange,
  onPageChange,
  onLimitChange,
  providers,
}: FailedDealsProps) {
  // Client-side filtering for search (applied to current page results)
  const filteredDeals = data.failedDeals.filter((deal) => {
    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      return deal.errorMessage.toLowerCase().includes(searchLower) || deal.fileName.toLowerCase().includes(searchLower);
    }
    return true;
  });

  if (!data || data.pagination.total === 0) {
    return (
      <div className='text-center py-12'>
        <FileX className='h-12 w-12 mx-auto text-muted-foreground mb-3' />
        <p className='text-muted-foreground'>No failed deals found</p>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {/* Filters */}
      <FailedDealsFilters
        searchValue={searchValue}
        providerFilter={providerFilter}
        onSearchChange={onSearchChange}
        onProviderFilterChange={onProviderFilterChange}
        providers={providers}
        totalDeals={data.summary.totalFailedDeals}
        filteredCount={filteredDeals.length}
      />

      {/* Summary Stats */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
        <div className='bg-muted/50 p-4 rounded-lg'>
          <p className='text-xs text-muted-foreground'>Total Failed</p>
          <p className='text-2xl font-bold'>{data.summary.totalFailedDeals}</p>
        </div>
        <div className='bg-muted/50 p-4 rounded-lg'>
          <p className='text-xs text-muted-foreground'>Providers</p>
          <p className='text-2xl font-bold'>{data.summary.uniqueProviders}</p>
        </div>
        <div className='bg-muted/50 p-4 rounded-lg col-span-2'>
          <p className='text-xs text-muted-foreground mb-2'>Top Error</p>
          <p className='text-sm font-medium truncate'>{data.summary.mostCommonErrors[0]?.errorMessage || "N/A"}</p>
          <p className='text-xs text-muted-foreground mt-1'>
            {data.summary.mostCommonErrors[0]?.count || 0} occurrences
          </p>
        </div>
      </div>

      {/* Expandable Failed Deals List */}
      {data.failedDeals.length === 0 ? (
        <div className='text-center py-8'>
          <p className='text-muted-foreground'>No failed deals on this page</p>
        </div>
      ) : filteredDeals.length === 0 ? (
        <div className='text-center py-8'>
          <p className='text-muted-foreground'>No deals match your search criteria</p>
        </div>
      ) : (
        <>
          <Accordion type='single' collapsible className='space-y-2'>
            {filteredDeals.map((deal) => (
              <FailedDealItem key={deal.id} deal={deal} />
            ))}
          </Accordion>

          {/* Pagination */}
          <Pagination pagination={data.pagination} onPageChange={onPageChange} onLimitChange={onLimitChange} />
        </>
      )}
    </div>
  );
}
