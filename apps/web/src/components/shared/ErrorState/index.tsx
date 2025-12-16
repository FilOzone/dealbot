import { AlertCircle, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  title?: string;
  showNetworkIcon?: boolean;
}

function ErrorState({ message, onRetry, title, showNetworkIcon = false }: ErrorStateProps) {
  const isNetworkError = message.toLowerCase().includes("network") || message.toLowerCase().includes("fetch");
  const displayTitle = title || "Something went wrong";

  return (
    <Card className="border-destructive/50 bg-gradient-to-br from-destructive/5 via-background to-background">
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        {/* Animated Icon Container */}
        <div className="relative mb-6">
          {/* Pulsing background circle */}
          <div className="absolute inset-0 animate-ping opacity-20">
            <div className="w-20 h-20 rounded-full bg-destructive" />
          </div>

          {/* Static background circle */}
          <div className="relative w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center backdrop-blur-sm border-2 border-destructive/20">
            {showNetworkIcon || isNetworkError ? (
              <WifiOff className="h-10 w-10 text-destructive animate-pulse" />
            ) : (
              <AlertCircle className="h-10 w-10 text-destructive animate-pulse" />
            )}
          </div>
        </div>

        {/* Error Title */}
        <h3 className="text-xl font-semibold mb-3 text-foreground">{displayTitle}</h3>

        {/* Error Message */}
        <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">{message}</p>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            onClick={onRetry}
            className="gap-2 shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105"
            size="lg"
          >
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="gap-2 hover:bg-muted transition-all duration-200"
            size="lg"
          >
            Reload Page
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default ErrorState;
