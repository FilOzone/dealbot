import { ErrorState } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useProviders } from "@/hooks/useProviders";
import { useState } from "react";
import { ProviderCards } from "./ProviderCards";
import { ProviderCardsSkeleton } from "./ProviderCardsSkeleton";

const StorageProviders = () => {
  // Filter state
  const [activeOnly, setActiveOnly] = useState(true); // Default to showing only active providers
  const [approvedOnly, setApprovedOnly] = useState(false);

  const {
    providers,
    total: totalProviders,
    page: currentPage,
    limit: itemsPerPage,
    loading: providersLoading,
    error: providersError,
    setOptions: setProviderOptions,
  } = useProviders({
    offset: 0,
    limit: 12, // Show 12 providers per page (4 rows of 3 cards)
    activeOnly,
    approvedOnly,
  });

  // Handle page change
  const handlePageChange = (page: number) => {
    setProviderOptions({
      offset: (page - 1) * itemsPerPage,
      limit: itemsPerPage,
      activeOnly,
      approvedOnly,
    });
  };

  // Handle filter changes
  const handleActiveOnlyChange = (value: boolean) => {
    setActiveOnly(value);
    setProviderOptions({
      offset: 0,
      limit: itemsPerPage,
      activeOnly: value,
      approvedOnly,
    });
  };

  const handleApprovedOnlyChange = (value: boolean) => {
    setApprovedOnly(value);
    setProviderOptions({
      offset: 0,
      limit: itemsPerPage,
      activeOnly,
      approvedOnly: value,
    });
  };

  const totalPages = Math.ceil(totalProviders / itemsPerPage);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage provider performance</CardTitle>
        {!providersLoading && !providersError && (
          <CardDescription>
            Showing {providers.length} of {totalProviders} providers • Page {currentPage} of {totalPages}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {providersLoading ? (
          <ProviderCardsSkeleton count={6} />
        ) : providersError ? (
          <ErrorState
            message={providersError}
            onRetry={() => {
              setProviderOptions({
                offset: 0,
                limit: itemsPerPage,
                activeOnly,
                approvedOnly,
              });
            }}
          />
        ) : (
          <ProviderCards
            providers={providers}
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalProviders}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
            activeOnly={activeOnly}
            approvedOnly={approvedOnly}
            onActiveOnlyChange={handleActiveOnlyChange}
            onApprovedOnlyChange={handleApprovedOnlyChange}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default StorageProviders;
