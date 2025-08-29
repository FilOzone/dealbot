import { Input } from "./ui/input";
import { Search } from "lucide-react";

export function ProviderFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Input
        type="text"
        placeholder="Filter providers..."
        className="w-64 pl-8"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
    </div>
  );
}
