import React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  hover?: boolean;
  onClick?: () => void;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className, hover = false, onClick, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "bg-white border border-surface-100 rounded-lg shadow-sm p-6",
          hover && "hover:shadow-md cursor-pointer transition-shadow",
          className
        )}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        } : undefined}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

