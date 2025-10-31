import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { Pagination as PaginationMeta } from "../types/failed-deals";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface PaginationProps {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination({
  pagination,
  onPageChange,
  onLimitChange,
  pageSizeOptions = [10, 20, 50, 100],
}: PaginationProps) {
  const { page, limit, total, totalPages, hasNext, hasPrev } = pagination;

  // Calculate range of items being displayed
  const startItem = total === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxPagesToShow = 7;

    if (totalPages <= maxPagesToShow) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (page > 3) {
        pages.push("...");
      }

      // Show pages around current page
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (page < totalPages - 2) {
        pages.push("...");
      }

      // Always show last page
      if (totalPages > 1) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className='flex flex-col sm:flex-row items-center justify-between gap-4 py-4'>
      {/* Left side - Items info and page size selector */}
      <div className='flex items-center gap-4'>
        <div className='text-sm text-muted-foreground'>
          Showing <span className='font-medium text-foreground'>{startItem}</span> to{" "}
          <span className='font-medium text-foreground'>{endItem}</span> of{" "}
          <span className='font-medium text-foreground'>{total}</span> results
        </div>

        <div className='flex items-center gap-2'>
          <span className='text-sm text-muted-foreground'>Per page:</span>
          <Select value={limit.toString()} onValueChange={(value) => onLimitChange(Number(value))}>
            <SelectTrigger className='w-[70px] h-8'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Right side - Page navigation */}
      <div className='flex items-center gap-2'>
        {/* First page button */}
        <Button
          variant='outline'
          size='sm'
          onClick={() => onPageChange(1)}
          disabled={!hasPrev}
          className='h-8 w-8 p-0'
          title='First page'
        >
          <ChevronsLeft className='h-4 w-4' />
        </Button>

        {/* Previous page button */}
        <Button
          variant='outline'
          size='sm'
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPrev}
          className='h-8 w-8 p-0'
          title='Previous page'
        >
          <ChevronLeft className='h-4 w-4' />
        </Button>

        {/* Page numbers */}
        <div className='hidden sm:flex items-center gap-1'>
          {pageNumbers.map((pageNum, idx) => {
            if (pageNum === "...") {
              return (
                <span key={`ellipsis-${idx}`} className='px-2 text-muted-foreground'>
                  ...
                </span>
              );
            }

            const isCurrentPage = pageNum === page;

            return (
              <Button
                key={pageNum}
                variant={isCurrentPage ? "default" : "outline"}
                size='sm'
                onClick={() => onPageChange(pageNum as number)}
                className='h-8 w-8 p-0'
              >
                {pageNum}
              </Button>
            );
          })}
        </div>

        {/* Mobile: Current page indicator */}
        <div className='sm:hidden text-sm text-muted-foreground px-2'>
          Page {page} of {totalPages}
        </div>

        {/* Next page button */}
        <Button
          variant='outline'
          size='sm'
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNext}
          className='h-8 w-8 p-0'
          title='Next page'
        >
          <ChevronRight className='h-4 w-4' />
        </Button>

        {/* Last page button */}
        <Button
          variant='outline'
          size='sm'
          onClick={() => onPageChange(totalPages)}
          disabled={!hasNext}
          className='h-8 w-8 p-0'
          title='Last page'
        >
          <ChevronsRight className='h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
