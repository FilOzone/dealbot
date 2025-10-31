import { AlertCircle, Copy, Download } from "lucide-react";
import { useState } from "react";
import type { FailedRetrieval } from "../types/failed-retrievals";
import { AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface FailedRetrievalItemProps {
  retrieval: FailedRetrieval;
}

export function FailedRetrievalItem({ retrieval }: FailedRetrievalItemProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "N/A";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
              <span className='font-medium truncate'>{retrieval.spAddress || "Unknown SP"}</span>
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
            {retrieval.spAddress && (
              <div>
                <p className='text-xs text-muted-foreground mb-1'>Storage Provider</p>
                <div className='flex items-center gap-2'>
                  <code className='text-xs bg-muted px-2 py-1 rounded font-mono truncate'>{retrieval.spAddress}</code>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-0'
                    onClick={() => copyToClipboard(retrieval.spAddress!, `sp-${retrieval.id}`)}
                  >
                    {copiedId === `sp-${retrieval.id}` ? (
                      <span className='text-green-600 text-xs'>✓</span>
                    ) : (
                      <Copy className='h-3 w-3' />
                    )}
                  </Button>
                </div>
              </div>
            )}

            {retrieval.pieceCid && (
              <div>
                <p className='text-xs text-muted-foreground mb-1'>Piece CID</p>
                <div className='flex items-center gap-2'>
                  <code className='text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[150px]'>
                    {retrieval.pieceCid}
                  </code>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-0'
                    onClick={() => copyToClipboard(retrieval.pieceCid!, `cid-${retrieval.id}`)}
                  >
                    {copiedId === `cid-${retrieval.id}` ? (
                      <span className='text-green-600 text-xs'>✓</span>
                    ) : (
                      <Copy className='h-3 w-3' />
                    )}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className='text-xs text-muted-foreground mb-1'>Service Type</p>
              <Badge className={getServiceTypeBadgeColor(retrieval.serviceType)}>{retrieval.serviceType}</Badge>
            </div>

            <div>
              <p className='text-xs text-muted-foreground mb-1'>Status</p>
              <p className='text-sm font-medium'>{retrieval.status}</p>
            </div>

            {retrieval.latencyMs !== undefined && (
              <div>
                <p className='text-xs text-muted-foreground mb-1'>Latency</p>
                <p className='text-sm font-medium'>{retrieval.latencyMs}ms</p>
              </div>
            )}

            {retrieval.ttfbMs !== undefined && (
              <div>
                <p className='text-xs text-muted-foreground mb-1'>TTFB</p>
                <p className='text-sm font-medium'>{retrieval.ttfbMs}ms</p>
              </div>
            )}

            {retrieval.bytesRetrieved !== undefined && (
              <div>
                <p className='text-xs text-muted-foreground mb-1'>Bytes Retrieved</p>
                <p className='text-sm font-medium'>{formatBytes(retrieval.bytesRetrieved)}</p>
              </div>
            )}

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
