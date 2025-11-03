import { FileX } from "lucide-react";
import type { ServiceType } from "@/types/services";
import type { FailedRetrieval, FailedRetrievalsResponse } from "../types/failed-retrievals";
import { FailedRetrievalItem } from "./FailedRetrievalItem";
import { FailedRetrievalsFilters } from "./FailedRetrievalsFilters";
import { Pagination } from "./Pagination";
import { Accordion } from "./ui/accordion";

interface FailedRetrievalsProps {
  data: FailedRetrievalsResponse;
  searchValue: string;
  providerFilter: string;
  serviceTypeFilter: ServiceType | "all";
  onSearchChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onServiceTypeFilterChange: (value: ServiceType | "all") => void;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  providers: Array<{ address: string; name?: string; providerId?: number }>;
}

export function FailedRetrievals({
  data,
  searchValue,
  providerFilter,
  serviceTypeFilter,
  onSearchChange,
  onProviderFilterChange,
  onServiceTypeFilterChange,
  onPageChange,
  onLimitChange,
  providers,
}: FailedRetrievalsProps) {
  // Client-side filtering for search (applied to current page results)
  const filteredRetrievals = data.failedRetrievals.filter((retrieval) => {
    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      return (
        retrieval.errorMessage.toLowerCase().includes(searchLower) ||
        retrieval.retrievalEndpoint.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  if (!data) {
    return (
      <div className='text-center py-12'>
        <FileX className='h-12 w-12 mx-auto text-muted-foreground mb-3' />
        <p className='text-muted-foreground'>No failed retrievals found</p>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {/* Filters */}
      <FailedRetrievalsFilters
        searchValue={searchValue}
        providerFilter={providerFilter}
        serviceTypeFilter={serviceTypeFilter}
        onSearchChange={onSearchChange}
        onProviderFilterChange={onProviderFilterChange}
        onServiceTypeFilterChange={onServiceTypeFilterChange}
        providers={providers}
        totalRetrievals={data.summary.totalFailedRetrievals}
        filteredCount={filteredRetrievals.length}
      />

      {data.pagination.total === 0 ? (
        <NoRetrievalsFound />
      ) : (
        <Retrievals
          data={data}
          filteredRetrievals={filteredRetrievals}
          onPageChange={onPageChange}
          onLimitChange={onLimitChange}
        />
      )}
    </div>
  );
}

const NoRetrievalsFound = () => {
  return (
    <div className='text-center py-12'>
      <FileX className='h-12 w-12 mx-auto text-muted-foreground mb-3' />
      <p className='text-muted-foreground'>No failed retrievals found</p>
    </div>
  );
};

interface RetrievalsProps {
  data: FailedRetrievalsResponse;
  filteredRetrievals: FailedRetrieval[];
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

const Retrievals = ({ data, filteredRetrievals, onPageChange, onLimitChange }: RetrievalsProps) => {
  return (
    <>
      {/* Summary Stats */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
        <div className='bg-muted/50 p-4 rounded-lg'>
          <p className='text-xs text-muted-foreground'>Total Failed</p>
          <p className='text-2xl font-bold'>{data.summary.totalFailedRetrievals}</p>
        </div>
        <div className='bg-muted/50 p-4 rounded-lg'>
          <p className='text-xs text-muted-foreground'>Providers</p>
          <p className='text-2xl font-bold'>{data.summary.uniqueProviders}</p>
        </div>
        <div className='bg-muted/50 p-4 rounded-lg'>
          <p className='text-xs text-muted-foreground'>Service Types</p>
          <p className='text-2xl font-bold'>{data.summary.uniqueServiceTypes}</p>
        </div>
        <div className='bg-muted/50 p-4 rounded-lg'>
          <p className='text-xs text-muted-foreground mb-2'>Top Error</p>
          <p className='text-xs font-medium truncate'>{data.summary.mostCommonErrors[0]?.errorMessage || "N/A"}</p>
          <p className='text-xs text-muted-foreground mt-1'>
            {data.summary.mostCommonErrors[0]?.count || 0} occurrences
          </p>
        </div>
      </div>

      {/* Expandable Failed Retrievals List */}
      {data.failedRetrievals.length === 0 ? (
        <div className='text-center py-8'>
          <p className='text-muted-foreground'>No failed retrievals on this page</p>
        </div>
      ) : filteredRetrievals.length === 0 ? (
        <div className='text-center py-8'>
          <p className='text-muted-foreground'>No retrievals match your search criteria</p>
        </div>
      ) : (
        <>
          <Accordion type='single' collapsible className='space-y-2'>
            {filteredRetrievals.map((retrieval) => (
              <FailedRetrievalItem key={retrieval.id} retrieval={retrieval} />
            ))}
          </Accordion>

          {/* Pagination */}
          <Pagination pagination={data.pagination} onPageChange={onPageChange} onLimitChange={onLimitChange} />
        </>
      )}
    </>
  );
};
