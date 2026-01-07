import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DailyMetricsSkeleton() {
  return (
    <div className="space-y-12">
      {Array.from({ length: 3 }).map((_, idx) => (
        <div key={idx} className="space-y-4">
          <Skeleton className="h-5 w-48" />
          <Card className="border-0 shadow-none">
            <CardHeader className="px-0">
              <Skeleton className="h-4 w-full" />
            </CardHeader>
            <CardContent className="px-0">
              <div className="space-y-3">
                <Skeleton className="h-[300px] w-full" />
                <div className="flex justify-center gap-6">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}
