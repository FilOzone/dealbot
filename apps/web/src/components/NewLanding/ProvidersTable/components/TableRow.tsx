import { flexRender, type Row } from "@tanstack/react-table";
import { memo } from "react";
import { TableCell, TableRow as UITableRow } from "@/components/ui/table";
import type { ProviderData } from "../types";

interface ProviderTableRowProps {
  row: Row<ProviderData>;
}

function ProviderTableRowComponent({ row }: ProviderTableRowProps) {
  return (
    <UITableRow className="border-b last:border-0">
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id} className="px-2 py-4 text-sm" style={{ width: cell.column.getSize() }}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </UITableRow>
  );
}

export const ProviderTableRow = memo(ProviderTableRowComponent);
