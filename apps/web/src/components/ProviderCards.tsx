import { useProviderVersionsBatch } from "@/hooks/useProviderVersionsBatch";
import type { ProviderCombinedPerformance } from "@/types/providers";
import { ProviderCard } from "./ProviderCard";
import { ProviderFilters } from "./ProviderFilters";
import { ProviderPagination } from "./ProviderPagination";

interface ProviderCardsProps {
  providers: ProviderCombinedPerformance[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  activeOnly: boolean;
  approvedOnly: boolean;
  onActiveOnlyChange: (value: boolean) => void;
  onApprovedOnlyChange: (value: boolean) => void;
}

export function ProviderCards({
  providers,
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  activeOnly,
  approvedOnly,
  onActiveOnlyChange,
  onApprovedOnlyChange,
}: ProviderCardsProps) {
  // Batch fetch versions for all HTTP providers at once
  const { versions: batchedVersions } = useProviderVersionsBatch(providers);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <ProviderFilters
        activeOnly={activeOnly}
        approvedOnly={approvedOnly}
        onActiveOnlyChange={onActiveOnlyChange}
        onApprovedOnlyChange={onApprovedOnlyChange}
        totalProviders={totalItems}
        filteredCount={providers.length}
      />

      {/* Providers */}
      {providers.length > 0 && (
        <div>
          <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {providers
              .sort(
                (a, b) =>
                  Number(b.provider.isApproved) - Number(a.provider.isApproved) ||
                  Number(b.provider.isActive) - Number(a.provider.isActive),
              )
              .map((provider) => (
                <ProviderCard
                  key={provider.provider.address}
                  provider={provider}
                  batchedVersion={batchedVersions[provider.provider.address]}
                />
              ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {providers.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No providers found</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <ProviderPagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          itemsPerPage={itemsPerPage}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}
