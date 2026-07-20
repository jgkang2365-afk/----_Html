import React from "react";
import { cn } from "@/lib/utils";

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
  maxHeight?: string;
}

export interface TableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  children: React.ReactNode;
}

export interface TableBodyProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  children: React.ReactNode;
}

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  children: React.ReactNode;
  hover?: boolean;
  selected?: boolean;
}

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  children: React.ReactNode;
}

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  children: React.ReactNode;
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ children, className, maxHeight, ...props }, ref) => {
    return (
      <div className="w-full overflow-hidden rounded-xl border border-slate-200 shadow-sm bg-white">
        <div className={cn("overflow-x-auto [scrollbar-gutter:stable]", maxHeight && `overflow-y-auto ${maxHeight}`)}>
          <table
            ref={ref}
            className={cn("w-full caption-bottom text-base", className)}
            {...props}
          >
            {children}
          </table>
        </div>
      </div>
    );
  }
);

Table.displayName = "Table";

export const TableHeader = React.forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <thead
        ref={ref}
        className={cn(
          "bg-slate-50 sticky top-0 z-30 shadow-sm after:content-[''] after:absolute after:left-0 after:bottom-0 after:w-full after:border-b after:border-slate-200",
          className
        )}
        {...props}
      >
        {children}
      </thead>
    );
  }
);

TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<HTMLTableSectionElement, TableBodyProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <tbody
        ref={ref}
        className={className}
        {...props}
      >
        {children}
      </tbody>
    );
  }
);

TableBody.displayName = "TableBody";

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ children, className, hover = false, selected = false, ...props }, ref) => {
    return (
      <tr
        ref={ref}
        className={cn(
          "group relative border-b border-slate-100 transition-all duration-150 hover:bg-indigo-50/40 data-[state=selected]:bg-slate-100",
          hover && "hover:bg-slate-50",
          selected && "bg-blue-50/50",
          className
        )}
        {...props}
      >
        {children}
      </tr>
    );
  }
);

TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ children, className, ...props }, ref) => {
    return (

      <th
        ref={ref}
        className={cn(
          "h-12 px-4 text-left align-middle font-bold text-slate-800 [&:has([role=checkbox])]:pr-0 whitespace-nowrap", // Bold and darker for readability
          className
        )}
        {...props}
      >
        {children}
      </th>
    );
  }
);

TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <td
        ref={ref}
        className={cn(
          "p-4 align-middle [&:has([role=checkbox])]:pr-0 text-slate-600 whitespace-nowrap",
          className
        )}
        {...props}
      >
        {children}
      </td>
    );
  }
);

TableCell.displayName = "TableCell";

