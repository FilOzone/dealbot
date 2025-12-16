import { AlertCircle } from "lucide-react";

function ProviderCardEmptyState() {
  return (
    <div className="pt-2 pb-2 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-3">
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium mb-1">No Performance Data</p>
      <p className="text-xs text-muted-foreground">
        This provider is registered but hasn't completed any deals or retrievals yet
      </p>
    </div>
  );
}

export default ProviderCardEmptyState;
