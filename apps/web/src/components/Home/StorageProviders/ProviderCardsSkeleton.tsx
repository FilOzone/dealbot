import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ProviderCardsSkeletonProps {
  count?: number;
}

export function ProviderCardsSkeleton({ count = 6 }: ProviderCardsSkeletonProps) {
  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }).map((_, idx) => (
          <Card key={idx} className="border-l-4 border-l-muted">
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="h-6 w-3/4" />
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-7 w-32" />
                    <Skeleton className="h-7 w-7" />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-6 w-20" />
                </div>
              </div>

              <Skeleton className="h-10 w-full mt-3" />

              <Skeleton className="h-5 w-full mt-3" />

              <div className="flex items-center justify-between mt-3 pt-3 border-t">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-2 w-2 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>

              <div className="mt-4 pt-4 border-t">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 pt-0">
              <div className="space-y-3 pt-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>

              <div className="border-t pt-4 space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-32 w-full" />
              </div>

              <div className="border-t pt-4 space-y-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-40 w-full" />
              </div>

              <div className="border-t pt-4 space-y-3">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-16 w-full" />
              </div>

              <div className="border-t pt-4">
                <Skeleton className="h-10 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
