import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProviderTableRow } from "./components";
import { columns } from "./data/column-definitions";
import type { ProviderData } from "./types";

const EmptyState = (
  <TableRow>
    <TableCell colSpan={columns.length} className="h-24 text-center">
      No results.
    </TableCell>
  </TableRow>
);

const LoadingState = (
  <TableRow>
    <TableCell colSpan={columns.length} className="h-24 text-center">
      Loading providers...
    </TableCell>
  </TableRow>
);

const ErrorState = ({ message }: { message: string }) => (
  <TableRow>
    <TableCell colSpan={columns.length} className="h-24 text-center text-red-600">
      Error: {message}
    </TableCell>
  </TableRow>
);

interface ProvidersTableProps {
  data?: ProviderData[];
  isLoading?: boolean;
  error?: Error | null;
}

const EMPTY_DATA: ProviderData[] = [];

export default function ProvidersTable({ data = EMPTY_DATA, isLoading = false, error = null }: ProvidersTableProps) {
  const table = useReactTable(
    useMemo(
      () => ({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
      }),
      [data],
    ),
  );

  const rows = table.getRowModel().rows;
  const hasRows = rows.length > 0;

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="border-b">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="py-3 px-2 text-sm font-semibold text-muted-foreground bg-muted/50 uppercase"
                  // style={{ width: header.getSize() }}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            LoadingState
          ) : error ? (
            <ErrorState message={error.message} />
          ) : hasRows ? (
            rows.map((row) => <ProviderTableRow key={row.id} row={row} />)
          ) : (
            EmptyState
          )}
        </TableBody>
      </Table>
    </div>
  );
}
