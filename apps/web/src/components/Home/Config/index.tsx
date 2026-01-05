import { ErrorState } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDealbotConfig } from "@/hooks/useDealbotConfig";
import InfrastructureInfo from "./InfrastructureInfo";
import InfrastructureInfoSkeleton from "./InfrastructureInfoSkeleton";

const Config = () => {
  const { data, loading, error, refetch } = useDealbotConfig();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Infrastructure configuration</CardTitle>
        <CardDescription>Dealbot operational parameters and scheduling frequencies</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <InfrastructureInfoSkeleton />}

        {error && <ErrorState message={error} onRetry={() => refetch()} />}

        {!loading && !error && data && <InfrastructureInfo config={data} />}
      </CardContent>
    </Card>
  );
};

export default Config;
