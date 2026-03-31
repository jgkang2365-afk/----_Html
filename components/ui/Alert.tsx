import React, { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useModalError } from "@/components/ui/Modal";

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: "success" | "warning" | "error";
  children: React.ReactNode;
  title?: string;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ variant, children, title, className, ...props }, ref) => {
    const context = useModalError();
    
    // 모달 내부에 있을 경우, 자동으로 모달 헤더로 에러 메시지를 전달 (문자열일 경우만)
    useEffect(() => {
      // useModalError의 기본 fallback으로 setGlobalError가 있으나, 실제 Modal 내부인지 확인
      if (variant === "error" && typeof children === "string" && context?.isInsideModal) {
        context.setGlobalError(children);
        return () => {
          context.setGlobalError(null);
        };
      }
    }, [variant, children, context]);

    if (variant === "error" && typeof children === "string" && context?.isInsideModal) {
      return null;
    }

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

