import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function SummaryCardsSkeleton() {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(11)].map((_, index) => (
        <Card key={index}>
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

export default SummaryCardsSkeleton;
