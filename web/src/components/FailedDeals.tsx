import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, FileX, Filter, Search, X } from "lucide-react";
import { useState } from "react";
import type { FailedDealsResponseDto } from "../types/stats";
import { generatePageNumbers } from "../utils/pagination";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface FailedDealsProps {
  data: FailedDealsResponseDto;
  onPageChange: (page: number) => void;
  onSearchChange: (search: string) => void;
  onProviderFilter: (provider: string) => void;
  onCDNFilter: (withCDN: boolean | undefined) => void;
  currentFilters: {
    search: string;
    provider: string;
    withCDN: boolean | undefined;
  };
}

export function FailedDeals({
  data,
  onPageChange,
  onSearchChange,
  onProviderFilter,
  onCDNFilter,
  currentFilters,
}: FailedDealsProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(currentFilters.search);

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
    const sizes = ["B", "KB", "MB", "GB"];
    if (bytes === 0) return "0 B";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(1)} ${sizes[i]}`;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "failed":
        return "destructive";
      case "timeout":
        return "secondary";
      case "error":
        return "destructive";
      default:
        return "outline";
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(searchInput);
  };

  const clearFilters = () => {
    setSearchInput("");
    onSearchChange("");
    onProviderFilter("all");
    onCDNFilter(undefined);
  };

  const hasActiveFilters =
    currentFilters.search ||
    (currentFilters.provider && currentFilters.provider !== "all") ||
    currentFilters.withCDN !== undefined;

  const uniqueProviders = Array.from(
    new Map(
      data.summary.failuresByProvider.map((p) => [p.provider, { address: p.provider, name: p.providerName }]),
    ).values(),
  );

  return (
    <div className='space-y-6'>
      {/* Search and Filters */}
      <Card>
        <CardContent className='pt-6'>
          <div className='space-y-4'>
            {/* Search Bar */}
            <form onSubmit={handleSearchSubmit} className='flex gap-2'>
              <div className='relative flex-1'>
                <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                <Input
                  type='text'
                  placeholder='Search by error message...'
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className='pl-9'
                />
              </div>
              <Button type='submit'>Search</Button>
            </form>

            {/* Filters */}
            <div className='flex flex-wrap gap-3 items-center'>
              <div className='flex items-center gap-2 text-sm font-medium'>
                <Filter className='h-4 w-4' />
                Filters:
              </div>

              {/* Provider Filter */}
              <Select value={currentFilters.provider || "all"} onValueChange={onProviderFilter}>
                <SelectTrigger className='w-[200px]'>
                  <SelectValue placeholder='All Providers' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All Providers</SelectItem>
                  {uniqueProviders.map((provider) => (
                    <SelectItem key={provider.address} value={provider.address}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* CDN Filter */}
              <Select
                value={currentFilters.withCDN === undefined ? "all" : currentFilters.withCDN ? "true" : "false"}
                onValueChange={(value: string) => onCDNFilter(value === "all" ? undefined : value === "true")}
              >
                <SelectTrigger className='w-[150px]'>
                  <SelectValue placeholder='CDN Status' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All CDN Status</SelectItem>
                  <SelectItem value='true'>With CDN</SelectItem>
                  <SelectItem value='false'>Without CDN</SelectItem>
                </SelectContent>
              </Select>

              {/* Clear Filters */}
              {hasActiveFilters && (
                <Button variant='ghost' size='sm' onClick={clearFilters} className='gap-1'>
                  <X className='h-4 w-4' />
                  Clear Filters
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>Total Failed Deals</CardTitle>
            <FileX className='h-4 w-4 text-muted-foreground' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold text-red-600'>{data.summary.totalFailedDeals}</div>
            <p className='text-xs text-muted-foreground'>
              From {data.dateRange.startDate} to {data.dateRange.endDate}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>Affected Providers</CardTitle>
            <AlertTriangle className='h-4 w-4 text-muted-foreground' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>{data.summary.uniqueProviders}</div>
            <p className='text-xs text-muted-foreground'>Storage providers with failures</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>Underperforming Provider</CardTitle>
            <AlertTriangle className='h-4 w-4 text-muted-foreground' />
          </CardHeader>
          <CardContent>
            <div className='flex items-center gap-2'>
              <div className='text-sm font-medium font-mono truncate'>
                {data.summary.failuresByProvider[0]?.provider || "N/A"}
              </div>
              {data.summary.failuresByProvider[0]?.provider && (
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-6 w-6 p-0 cursor-pointer'
                  onClick={() => copyToClipboard(data.summary.failuresByProvider[0].provider, "worst-provider")}
                >
                  {copiedId === "worst-provider" ? (
                    <Check className='h-3 w-3 text-green-600' />
                  ) : (
                    <Copy className='h-3 w-3' />
                  )}
                </Button>
              )}
            </div>
            <p className='text-xs text-muted-foreground'>
              {data.summary.failuresByProvider[0]?.failedDeals || 0} failures
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Error Summary */}
      {data.summary.mostCommonErrors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Most Common Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-2'>
              {data.summary.mostCommonErrors.slice(0, 5).map((error, index) => (
                <div key={index} className='flex items-center justify-between p-3 bg-muted rounded-lg'>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2'>
                      <Badge variant='outline' className='font-mono text-xs'>
                        {error.errorCode}
                      </Badge>
                      <span className='text-sm font-medium'>×{error.count}</span>
                    </div>
                    <p className='text-sm text-muted-foreground mt-1 truncate'>{error.errorMessage}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Failed Deals List */}
      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Recent Failed Deals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            {data.failedDeals.map((deal) => (
              <div key={deal.id} className='border rounded-lg p-4 space-y-3'>
                <div className='flex items-start justify-between'>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2 mb-2 flex-wrap'>
                      <div className='flex items-center gap-2'>
                        <h4 className='font-medium'>{deal.providerName}</h4>
                        <span className='text-xs text-muted-foreground font-mono'>({deal.storageProvider})</span>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-6 w-6 p-0'
                          onClick={() => copyToClipboard(deal.storageProvider, `provider-${deal.id}`)}
                        >
                          {copiedId === `provider-${deal.id}` ? (
                            <Check className='h-3 w-3 text-green-600' />
                          ) : (
                            <Copy className='h-3 w-3 cursor-pointer' />
                          )}
                        </Button>
                      </div>
                      <Badge variant={getStatusColor(deal.status)}>{deal.status}</Badge>
                      <Badge variant='outline'>{deal.withCDN ? "With CDN" : "Without CDN"}</Badge>
                      {deal.retryCount > 0 && (
                        <Badge variant='secondary' className='text-xs'>
                          Retry {deal.retryCount}
                        </Badge>
                      )}
                    </div>

                    <div className='grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-muted-foreground'>
                      <div>
                        <span className='font-medium'>Size:</span> {formatFileSize(deal.fileSize)}
                      </div>
                      <div>
                        <span className='font-medium'>Created:</span> {formatDate(deal.createdAt)}
                      </div>
                    </div>

                    {deal.cid && (
                      <div className='flex items-center gap-2 mt-2'>
                        <span className='text-sm font-medium'>CID:</span>
                        <code className='text-xs bg-muted px-2 py-1 rounded font-mono'>{deal.cid.slice(0, 20)}...</code>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-4 w-4 p-0'
                          onClick={() => copyToClipboard(deal.cid, `cid-${deal.id}`)}
                        >
                          {copiedId === `cid-${deal.id}` ? (
                            <Check className='h-3 w-3 text-green-600' />
                          ) : (
                            <Copy className='h-3 w-3' />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Error Information */}
                <div className='bg-red-50 border border-red-200 rounded-lg p-3'>
                  <div className='flex items-start gap-2'>
                    <AlertTriangle className='h-4 w-4 text-red-500 mt-0.5 flex-shrink-0' />
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Badge variant='destructive' className='text-xs'>
                          {deal.errorCode || "ERROR"}
                        </Badge>
                      </div>
                      <p className='text-sm text-red-800 break-words'>{deal.errorMessage}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className='flex items-center justify-between pt-4 border-t'>
              <div className='text-sm text-muted-foreground'>
                Showing {(data.pagination.page - 1) * data.pagination.limit + 1} to{" "}
                {Math.min(data.pagination.page * data.pagination.limit, data.pagination.total)} of{" "}
                {data.pagination.total} results
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => onPageChange(data.pagination.page - 1)}
                  disabled={data.pagination.page === 1}
                >
                  <ChevronLeft className='h-4 w-4 mr-1' />
                  Previous
                </Button>
                <div className='flex items-center gap-1'>
                  {generatePageNumbers(data.pagination.page, data.pagination.totalPages).map((pageNum) => (
                    <Button
                      key={pageNum}
                      variant={data.pagination.page === pageNum ? "default" : "outline"}
                      size='sm'
                      onClick={() => onPageChange(pageNum)}
                      className='w-9'
                    >
                      {pageNum}
                    </Button>
                  ))}
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => onPageChange(data.pagination.page + 1)}
                  disabled={data.pagination.page === data.pagination.totalPages}
                >
                  Next
                  <ChevronRight className='h-4 w-4 ml-1' />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
