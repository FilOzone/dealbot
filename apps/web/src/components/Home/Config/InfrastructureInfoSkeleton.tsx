import { Skeleton } from "@/components/ui/skeleton";

function InfrastructureInfoSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[...Array(3)].map((_, index) => (
        <div key={index} className="flex items-start gap-3 p-4 rounded-lg border bg-card">
          <Skeleton className="mt-0.5 h-8 w-8 rounded-md" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default InfrastructureInfoSkeleton;
