import { AlertCircle, Copy, FileX, Globe } from "lucide-react";
import { useState } from "react";
import type { FailedRetrievalsResponse } from "../types/failed-retrievals";
import { FailedRetrievalsFilters } from "./FailedRetrievalsFilters";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { ServiceType } from "@/types/services";

interface FailedRetrievalsProps {
  data: FailedRetrievalsResponse;
  searchValue: string;
  providerFilter: string;
  serviceTypeFilter: ServiceType | "all";
  onSearchChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onServiceTypeFilterChange: (value: ServiceType | "all") => void;
  providers: Array<{ address: string; name?: string }>;
}

export function FailedRetrievals({
  data,
  searchValue,
  providerFilter,
  serviceTypeFilter,
  onSearchChange,
  onProviderFilterChange,
  onServiceTypeFilterChange,
  providers,
}: FailedRetrievalsProps) {
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

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getServiceTypeBadge = (serviceType: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline"; label: string }> = {
      CDN: { variant: "default", label: "CDN" },
      DIRECT_SP: { variant: "secondary", label: "Direct SP" },
      IPFS_PIN: { variant: "outline", label: "IPFS Pin" },
    };
    return variants[serviceType] || { variant: "outline", label: serviceType };
  };

  // Client-side filtering for search
  const filteredRetrievals = data.failedRetrievals.filter((retrieval) => {
    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      return (
        retrieval.errorMessage.toLowerCase().includes(searchLower) ||
        retrieval.retrievalEndpoint.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  if (!data || data.failedRetrievals.length === 0) {
    return (
      <div className='text-center py-12'>
        <FileX className='h-12 w-12 mx-auto text-muted-foreground mb-3' />
        <p className='text-muted-foreground'>No failed retrievals found</p>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {/* Filters */}
      <FailedRetrievalsFilters
        searchValue={searchValue}
        providerFilter={providerFilter}
        serviceTypeFilter={serviceTypeFilter}
        onSearchChange={onSearchChange}
        onProviderFilterChange={onProviderFilterChange}
        onServiceTypeFilterChange={onServiceTypeFilterChange}
        providers={providers}
        totalRetrievals={data.summary.totalFailedRetrievals}
        filteredCount={filteredRetrievals.length}
      />

      {/* Summary Stats */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-4 mb-6'>
        <div className='bg-muted/50 p-4 rounded-lg'>
          <p className='text-xs text-muted-foreground'>Total Failed</p>
          <p className='text-2xl font-bold'>{data.summary.totalFailedRetrievals}</p>
        </div>
        <div className='bg-muted/50 p-4 rounded-lg'>
          <p className='text-xs text-muted-foreground'>Providers</p>
          <p className='text-2xl font-bold'>{data.summary.uniqueProviders}</p>
        </div>
        <div className='bg-muted/50 p-4 rounded-lg'>
          <p className='text-xs text-muted-foreground mb-2'>Top Error</p>
          <p className='text-xs font-medium truncate'>{data.summary.mostCommonErrors[0]?.errorMessage || "N/A"}</p>
          <p className='text-xs text-muted-foreground mt-1'>
            {data.summary.mostCommonErrors[0]?.count || 0} occurrences
          </p>
        </div>
      </div>

      {/* Expandable Failed Retrievals List */}
      {filteredRetrievals.length === 0 ? (
        <div className='text-center py-8'>
          <p className='text-muted-foreground'>No retrievals match your search criteria</p>
        </div>
      ) : (
        <Accordion type='single' collapsible className='space-y-2'>
          {filteredRetrievals.map((retrieval) => {
            const serviceTypeBadge = getServiceTypeBadge(retrieval.serviceType);
            return (
              <AccordionItem
                key={retrieval.id}
                value={retrieval.id}
                className='border rounded-lg bg-card hover:bg-accent/5 transition-colors'
              >
                <AccordionTrigger className='px-4 py-3 hover:no-underline'>
                  <div className='flex items-start justify-between w-full gap-4 text-left'>
                    {/* Left side - Retrieval info */}
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2 mb-1 flex-wrap'>
                        <Globe className='h-4 w-4 text-red-500 flex-shrink-0' />
                        <span className='font-medium truncate'>{retrieval.spAddress || "Unknown Provider"}</span>
                        <Badge variant='destructive' className='ml-2'>
                          FAILED
                        </Badge>
                        <Badge variant={serviceTypeBadge.variant}>{serviceTypeBadge.label}</Badge>
                      </div>
                      <div className='flex items-center gap-3 text-xs text-muted-foreground'>
                        <span>Started: {formatDate(retrieval.startedAt)}</span>
                        {retrieval.responseCode && (
                          <>
                            <span>•</span>
                            <span>HTTP {retrieval.responseCode}</span>
                          </>
                        )}
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
                            <p className='text-xs text-muted-foreground mt-2'>HTTP Status: {retrieval.responseCode}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Retrieval Details Grid */}
                    <div className='grid grid-cols-2 gap-4'>
                      <div className='col-span-2'>
                        <p className='text-xs text-muted-foreground mb-1'>Retrieval Endpoint</p>
                        <div className='flex items-center gap-2'>
                          <code className='text-xs bg-muted px-2 py-1 rounded font-mono truncate flex-1'>
                            {retrieval.retrievalEndpoint}
                          </code>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='h-6 w-6 p-0'
                            onClick={() => copyToClipboard(retrieval.retrievalEndpoint, `endpoint-${retrieval.id}`)}
                          >
                            {copiedId === `endpoint-${retrieval.id}` ? (
                              <span className='text-green-600 text-xs'>✓</span>
                            ) : (
                              <Copy className='h-3 w-3' />
                            )}
                          </Button>
                        </div>
                      </div>

                      {retrieval.spAddress && (
                        <div>
                          <p className='text-xs text-muted-foreground mb-1'>Storage Provider</p>
                          <code className='text-xs bg-muted px-2 py-1 rounded font-mono truncate block'>
                            {retrieval.spAddress}
                          </code>
                        </div>
                      )}

                      {retrieval.pieceCid && (
                        <div>
                          <p className='text-xs text-muted-foreground mb-1'>Piece CID</p>
                          <code className='text-xs bg-muted px-2 py-1 rounded font-mono truncate block'>
                            {retrieval.pieceCid}
                          </code>
                        </div>
                      )}

                      {retrieval.latencyMs !== undefined && (
                        <div>
                          <p className='text-xs text-muted-foreground mb-1'>Latency</p>
                          <p className='text-sm font-medium'>{retrieval.latencyMs.toFixed(0)} ms</p>
                        </div>
                      )}

                      {retrieval.ttfbMs !== undefined && (
                        <div>
                          <p className='text-xs text-muted-foreground mb-1'>TTFB</p>
                          <p className='text-sm font-medium'>{retrieval.ttfbMs.toFixed(0)} ms</p>
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

                      {retrieval.fileName && (
                        <div className='col-span-2'>
                          <p className='text-xs text-muted-foreground mb-1'>File Name</p>
                          <p className='text-sm font-medium truncate'>{retrieval.fileName}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
