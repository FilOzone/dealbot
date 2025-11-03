import { AlertCircle, Download } from "lucide-react";
import type { FailedRetrieval } from "../types/failed-retrievals";
import { AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Badge } from "./ui/badge";

interface FailedRetrievalItemProps {
  retrieval: FailedRetrieval;
}

export function FailedRetrievalItem({ retrieval }: FailedRetrievalItemProps) {
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getServiceTypeBadgeColor = (serviceType: string) => {
    switch (serviceType) {
      case "CDN":
        return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
      case "DIRECT_SP":
        return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
      case "IPFS_PIN":
        return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
      default:
        return "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20";
    }
  };

  return (
    <AccordionItem value={retrieval.id} className='border rounded-lg bg-card hover:bg-accent/5 transition-colors'>
      <AccordionTrigger className='px-4 py-3 hover:no-underline'>
        <div className='flex items-start justify-between w-full gap-4 text-left'>
          {/* Left side - Retrieval info */}
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2 mb-1 flex-wrap'>
              <Download className='h-4 w-4 text-red-500 flex-shrink-0' />
              <span className='font-medium truncate'>
                {retrieval.storageProvider?.name || "Unknown SP"} (
                {retrieval.storageProvider?.providerId || "Unknown ID"})
              </span>
              <Badge variant='destructive'>FAILED</Badge>
              <Badge className={getServiceTypeBadgeColor(retrieval.serviceType)}>{retrieval.serviceType}</Badge>
            </div>
            <div className='flex items-center gap-3 text-xs text-muted-foreground flex-wrap'>
              {retrieval.responseCode && <span>HTTP {retrieval.responseCode}</span>}
              {retrieval.latencyMs && (
                <>
                  <span>•</span>
                  <span>{retrieval.latencyMs}ms</span>
                </>
              )}
              <span>•</span>
              <span>Started: {formatDate(retrieval.startedAt)}</span>
            </div>
          </div>

          {/* Right side - Error preview */}
          <div className='flex items-center gap-2 flex-shrink-0'>
            <AlertCircle className='h-4 w-4 text-orange-500' />
            <span className='text-xs text-muted-foreground max-w-[200px] truncate hidden md:block'>
              {retrieval.errorMessage}
            </span>
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className='px-4 pb-4'>
        <div className='space-y-4 pt-2'>
          {/* Error Details */}
          <div className='bg-destructive/10 border border-destructive/20 rounded-md p-3'>
            <div className='flex items-start gap-2'>
              <AlertCircle className='h-5 w-5 text-destructive flex-shrink-0 mt-0.5' />
              <div className='flex-1'>
                <p className='text-sm font-medium text-destructive mb-1'>Error Message</p>
                <p className='text-sm text-foreground'>{retrieval.errorMessage}</p>
                {retrieval.responseCode && (
                  <p className='text-xs text-muted-foreground mt-2'>Response Code: {retrieval.responseCode}</p>
                )}
              </div>
            </div>
          </div>

          {/* Retrieval Details Grid */}
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <p className='text-xs text-muted-foreground mb-1'>Retry Count</p>
              <p className='text-sm font-medium'>{retrieval.retryCount}</p>
            </div>

            <div>
              <p className='text-xs text-muted-foreground mb-1'>Endpoint</p>
              <p className='text-xs font-mono truncate' title={retrieval.retrievalEndpoint}>
                {retrieval.retrievalEndpoint}
              </p>
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
