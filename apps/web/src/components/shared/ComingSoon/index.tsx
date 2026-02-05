import { LayoutDashboard, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type ComingSoonProps = {
  title?: string;
  description?: ReactNode;
  Icon?: LucideIcon;
};

export default function ComingSoon({
  title = "Coming Soon!",
  description = "We're working on an exciting new experience.",
  Icon = LayoutDashboard,
}: ComingSoonProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white p-4 shadow-sm border border-slate-200">
          <Icon className="h-10 w-10 text-slate-900" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
        <p className="text-lg text-muted-foreground max-w-md mx-auto">{description}</p>
      </div>
    </div>
  );
}
