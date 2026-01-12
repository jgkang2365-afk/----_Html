import React, { useId } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, onKeyDown, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;

    const handleKeyDownInternal = (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Enter키 처리 (disabled가 아닌 경우에만)
      if (e.key === "Enter" && !props.disabled) {
        e.preventDefault();
        const form = e.currentTarget.form;
        if (form) {
          const inputs = Array.from(form.querySelectorAll("input:not([disabled]), textarea:not([disabled]), select:not([disabled])")) as HTMLElement[];
          const currentIndex = inputs.indexOf(e.currentTarget);
          if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
            inputs[currentIndex + 1].focus();
          }
        }
      }
      // 사용자 정의 핸들러도 호출
      if (onKeyDown) {
        onKeyDown(e);
      }
    };

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-text-700 mb-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "w-full px-4 py-3 text-base bg-white border border-slate-200 rounded-lg",
            "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent",
            error
              ? "border-error-500 focus:ring-error-500"
              : "border-surface-100",
            "disabled:bg-surface-50 disabled:text-text-500 disabled:cursor-not-allowed",
            className
          )}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onKeyDown={handleKeyDownInternal}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="mt-1 text-sm text-error-500" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

