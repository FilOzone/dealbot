import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton as UISkeleton } from "./ui/skeleton";

export function Skeleton() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header skeleton */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <UISkeleton className="h-10 w-10 rounded-md" />
            <div>
              <UISkeleton className="h-5 w-40 mb-2" />
              <UISkeleton className="h-4 w-24" />
            </div>
          </div>
          <UISkeleton className="h-9 w-24" />
        </CardContent>
      </Card>

      {/* Summary cards skeleton */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <UISkeleton className="h-4 w-24 mb-3" />
              <UISkeleton className="h-7 w-20" />
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Charts skeletons */}
      <Card>
        <CardHeader>
          <CardTitle>
            <UISkeleton className="h-5 w-56" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UISkeleton className="h-[420px] w-full" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <UISkeleton className="h-5 w-72" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UISkeleton className="h-[420px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
