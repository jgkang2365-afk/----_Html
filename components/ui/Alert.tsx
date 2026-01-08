import React from "react";
import { cn } from "@/lib/utils";

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: "success" | "warning" | "error";
  children: React.ReactNode;
  title?: string;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ variant, children, title, className, ...props }, ref) => {
    const variants = {
      success: "bg-green-50 border-success-500 text-text-900",
      warning: "bg-yellow-50 border-warning-500 text-text-900",
      error: "bg-red-50 border-error-500 text-text-900",
    };

    const iconColors = {
      success: "text-success-500",
      warning: "text-warning-500",
      error: "text-error-500",
    };

    const icons = {
      success: "✓",
      warning: "⚠",
      error: "✕",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "border rounded-md p-4",
          variants[variant],
          className
        )}
        role="alert"
        {...props}
      >
        <div className="flex items-start">
          <div className={cn("flex-shrink-0 text-lg mr-3", iconColors[variant])}>
            {icons[variant]}
          </div>
          <div className="flex-1">
            {title && (
              <h3 className="text-sm font-semibold mb-1">{title}</h3>
            )}
            <div className="text-sm">{children}</div>
          </div>
        </div>
      </div>
    );
  }
);

Alert.displayName = "Alert";

