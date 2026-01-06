import { useState } from "react";
import { ErrorState } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useProviders } from "@/hooks/useProviders";
import { ProviderCards, type ProviderCardsProps } from "./ProviderCards";
import { ProviderCardsSkeleton } from "./ProviderCardsSkeleton";

const StorageProviders = () => {
  const [activeOnly, setActiveOnly] = useState(true);
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
    limit: 12,
    activeOnly,
    approvedOnly,
  });

  const handlePageChange = (page: number) => {
    setProviderOptions({
      offset: (page - 1) * itemsPerPage,
      limit: itemsPerPage,
      activeOnly,
      approvedOnly,
    });
  };

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

  const handleRetry = () => {
    setProviderOptions({
      offset: 0,
      limit: itemsPerPage,
      activeOnly,
      approvedOnly,
    });
  };

  const totalPages = Math.ceil(totalProviders / itemsPerPage);
  const hasData = !providersLoading && !providersError;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage provider performance</CardTitle>
        {hasData && (
          <CardDescription>
            Showing {providers.length} of {totalProviders} providers • Page {currentPage} of {totalPages}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        <StorageProvidersContent
          loading={providersLoading}
          error={providersError}
          providers={providers}
          currentPage={currentPage}
          totalPages={totalPages}
          totalProviders={totalProviders}
          itemsPerPage={itemsPerPage}
          activeOnly={activeOnly}
          approvedOnly={approvedOnly}
          onPageChange={handlePageChange}
          onActiveOnlyChange={handleActiveOnlyChange}
          onApprovedOnlyChange={handleApprovedOnlyChange}
          onRetry={handleRetry}
        />
      </CardContent>
    </Card>
  );
};

export default StorageProviders;

interface StorageProvidersContentProps extends Omit<ProviderCardsProps, "totalItems"> {
  loading: boolean;
  error: string | null;
  totalProviders: number;
  onRetry: () => void;
}

function StorageProvidersContent({
  loading,
  error,
  providers,
  currentPage,
  totalPages,
  totalProviders,
  itemsPerPage,
  activeOnly,
  approvedOnly,
  onPageChange,
  onActiveOnlyChange,
  onApprovedOnlyChange,
  onRetry,
}: StorageProvidersContentProps) {
  if (loading) {
    return <ProviderCardsSkeleton count={12} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  return (
    <ProviderCards
      providers={providers}
      currentPage={currentPage}
      totalPages={totalPages}
      totalItems={totalProviders}
      itemsPerPage={itemsPerPage}
      onPageChange={onPageChange}
      activeOnly={activeOnly}
      approvedOnly={approvedOnly}
      onActiveOnlyChange={onActiveOnlyChange}
      onApprovedOnlyChange={onApprovedOnlyChange}
    />
  );
}
