import React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  action,
  className,
}) => {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4", className)}>
      <div className="text-6xl mb-4 text-text-300">📭</div>
      <h3 className="text-lg font-semibold text-text-900 mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-text-500 text-center max-w-md mb-4">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
};

