import { AlertCircle, FileX } from "lucide-react";
import type { FailedDeal } from "../types/failed-deals";
import { AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Badge } from "./ui/badge";

interface FailedDealItemProps {
  deal: FailedDeal;
}

export function FailedDealItem({ deal }: FailedDealItemProps) {
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
              <span className='font-medium truncate'>
                {deal.storageProvider?.name} ({deal.storageProvider?.providerId})
              </span>
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
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
