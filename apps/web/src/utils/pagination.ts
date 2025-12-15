/**
 * Generate page numbers for pagination display
 * @param currentPage - The current active page (1-indexed)
 * @param totalPages - Total number of pages
 * @param maxVisible - Maximum number of page buttons to show (default: 5)
 * @returns Array of page numbers to display
 */
export function generatePageNumbers(currentPage: number, totalPages: number, maxVisible: number = 5): number[] {
  const visiblePages = Math.min(maxVisible, totalPages);

  return Array.from({ length: visiblePages }, (_, i) => {
    if (totalPages <= maxVisible) {
      return i + 1;
    } else if (currentPage <= Math.ceil(maxVisible / 2)) {
      return i + 1;
    } else if (currentPage >= totalPages - Math.floor(maxVisible / 2)) {
      return totalPages - maxVisible + 1 + i;
    } else {
      return currentPage - Math.floor(maxVisible / 2) + i;
    }
  });
}
