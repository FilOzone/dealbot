import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/shared";
import { FailedDeals } from "./FailedDeals";
import { FailedRetrievals } from "./FailedRetrievals";
import { useFailedDeals } from "@/hooks/useFailedDeals";
import { useFailedRetrievals } from "@/hooks/useFailedRetrievals";
import { useProvidersList } from "@/hooks/useProvidersList";
import type { ServiceType } from "@/types/services";
import { useState } from "react";

const FailedDealsAndRetrievals = () => {
  // Failed deals filter state
  const [failedDealsSearch, setFailedDealsSearch] = useState("");
  const [failedDealsProvider, setFailedDealsProvider] = useState("");
  const [failedDealsPage, setFailedDealsPage] = useState(1);
  const [failedDealsLimit, setFailedDealsLimit] = useState(20);

  // Failed retrievals filter state
  const [failedRetrievalsSearch, setFailedRetrievalsSearch] = useState("");
  const [failedRetrievalsProvider, setFailedRetrievalsProvider] = useState("");
  const [failedRetrievalsServiceType, setFailedRetrievalsServiceType] = useState<ServiceType | "all">("all");
  const [failedRetrievalsPage, setFailedRetrievalsPage] = useState(1);
  const [failedRetrievalsLimit, setFailedRetrievalsLimit] = useState(20);

  const { providers } = useProvidersList(0, 1_000);

  const {
    data: failedDealsData,
    loading: failedDealsLoading,
    error: failedDealsError,
  } = useFailedDeals({
    page: failedDealsPage,
    limit: failedDealsLimit,
    spAddress: failedDealsProvider && failedDealsProvider !== "all" ? failedDealsProvider : undefined,
  });
  const {
    data: failedRetrievalsData,
    loading: failedRetrievalsLoading,
    error: failedRetrievalsError,
  } = useFailedRetrievals({
    page: failedRetrievalsPage,
    limit: failedRetrievalsLimit,
    spAddress: failedRetrievalsProvider && failedRetrievalsProvider !== "all" ? failedRetrievalsProvider : undefined,
    serviceType:
      failedRetrievalsServiceType && failedRetrievalsServiceType !== "all" ? failedRetrievalsServiceType : undefined,
  });

  // Failed deals pagination handlers
  const handleFailedDealsLimitChange = (newLimit: number) => {
    setFailedDealsLimit(newLimit);
    setFailedDealsPage(1);
  };

  // Failed retrievals pagination handlers
  const handleFailedRetrievalsLimitChange = (newLimit: number) => {
    setFailedRetrievalsLimit(newLimit);
    setFailedRetrievalsPage(1);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Failure Analysis</CardTitle>
        <CardDescription>Track and analyze failed uploads and retrievals • Click to expand for details</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="deals" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="deals">
              Failed Uploads
              {failedDealsData && ` (${failedDealsData.summary.totalFailedDeals})`}
            </TabsTrigger>
            <TabsTrigger value="retrievals">
              Failed Retrievals
              {failedRetrievalsData && ` (${failedRetrievalsData.summary.totalFailedRetrievals})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="deals">
            {failedDealsLoading ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Loading failed deals...</p>
              </div>
            ) : failedDealsError ? (
              <ErrorState message={failedDealsError} onRetry={() => window.location.reload()} />
            ) : failedDealsData ? (
              <FailedDeals
                data={failedDealsData}
                searchValue={failedDealsSearch}
                providerFilter={failedDealsProvider}
                onSearchChange={setFailedDealsSearch}
                onProviderFilterChange={setFailedDealsProvider}
                onPageChange={setFailedDealsPage}
                onLimitChange={handleFailedDealsLimitChange}
                providers={providers ? providers.providers : []}
              />
            ) : null}
          </TabsContent>

          <TabsContent value="retrievals">
            {failedRetrievalsLoading ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Loading failed retrievals...</p>
              </div>
            ) : failedRetrievalsError ? (
              <ErrorState message={failedRetrievalsError} onRetry={() => window.location.reload()} />
            ) : failedRetrievalsData ? (
              <FailedRetrievals
                data={failedRetrievalsData}
                searchValue={failedRetrievalsSearch}
                providerFilter={failedRetrievalsProvider}
                serviceTypeFilter={failedRetrievalsServiceType}
                onSearchChange={setFailedRetrievalsSearch}
                onProviderFilterChange={setFailedRetrievalsProvider}
                onServiceTypeFilterChange={setFailedRetrievalsServiceType}
                onPageChange={setFailedRetrievalsPage}
                onLimitChange={handleFailedRetrievalsLimitChange}
                providers={providers ? providers.providers : []}
              />
            ) : null}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default FailedDealsAndRetrievals;
