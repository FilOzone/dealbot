import { AlertCircle, Copy, FileX } from "lucide-react";
import { useState } from "react";
import type { FailedDeal } from "../types/failed-deals";
import { AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface FailedDealItemProps {
  deal: FailedDeal;
}

export function FailedDealItem({ deal }: FailedDealItemProps) {
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

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <AccordionItem value={deal.id} className='border rounded-lg bg-card hover:bg-accent/5 transition-colors'>
      <AccordionTrigger className='px-4 py-3 hover:no-underline'>
        <div className='flex items-start justify-between w-full gap-4 text-left'>
          {/* Left side - File info */}
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2 mb-1'>
              <FileX className='h-4 w-4 text-red-500 flex-shrink-0' />
              <span className='font-medium truncate'>{deal.spAddress}</span>
              <Badge variant='destructive' className='ml-2'>
                FAILED
              </Badge>
            </div>
            <div className='flex items-center gap-3 text-xs text-muted-foreground'>
              <span>Size: {formatFileSize(deal.fileSize)}</span>
              <span>•</span>
              <span>Created: {formatDate(deal.createdAt)}</span>
            </div>
          </div>

          {/* Right side - Error preview */}
          <div className='flex items-center gap-2 flex-shrink-0'>
            <AlertCircle className='h-4 w-4 text-orange-500' />
            <span className='text-xs text-muted-foreground max-w-[200px] truncate hidden md:block'>
              {deal.errorMessage}
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
                <p className='text-sm text-foreground'>{deal.errorMessage}</p>
                {deal.errorCode && <p className='text-xs text-muted-foreground mt-2'>Code: {deal.errorCode}</p>}
              </div>
            </div>
          </div>

          {/* Deal Details Grid */}
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <p className='text-xs text-muted-foreground mb-1'>Storage Provider</p>
              <div className='flex items-center gap-2'>
                <code className='text-xs bg-muted px-2 py-1 rounded font-mono truncate'>{deal.spAddress}</code>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-6 w-6 p-0'
                  onClick={() => copyToClipboard(deal.spAddress, `sp-${deal.id}`)}
                >
                  {copiedId === `sp-${deal.id}` ? (
                    <span className='text-green-600 text-xs'>✓</span>
                  ) : (
                    <Copy className='h-3 w-3' />
                  )}
                </Button>
              </div>
            </div>

            {deal.pieceCid && (
              <div>
                <p className='text-xs text-muted-foreground mb-1'>Piece CID</p>
                <div className='flex items-center gap-2'>
                  <code className='text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[200px]'>
                    {deal.pieceCid}
                  </code>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-0'
                    onClick={() => copyToClipboard(deal.pieceCid!, `cid-${deal.id}`)}
                  >
                    {copiedId === `cid-${deal.id}` ? (
                      <span className='text-green-600 text-xs'>✓</span>
                    ) : (
                      <Copy className='h-3 w-3' />
                    )}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className='text-xs text-muted-foreground mb-1'>File Name</p>
              <p className='text-sm font-medium truncate' title={deal.fileName}>
                {deal.fileName}
              </p>
            </div>

            <div>
              <p className='text-xs text-muted-foreground mb-1'>Status</p>
              <p className='text-sm font-medium'>{deal.status}</p>
            </div>

            {deal.dataSetId && (
              <div>
                <p className='text-xs text-muted-foreground mb-1'>Dataset ID</p>
                <p className='text-sm font-medium'>{deal.dataSetId}</p>
              </div>
            )}

            <div>
              <p className='text-xs text-muted-foreground mb-1'>Retry Count</p>
              <p className='text-sm font-medium'>{deal.retryCount}</p>
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
