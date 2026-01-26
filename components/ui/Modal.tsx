"use client";

import React, { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "full" | "full-75";
  showCloseButton?: boolean;
  headerActions?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  showCloseButton = true,
  headerActions,
}) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      // 모달이 열릴 때 위치 초기화
      setPosition({ x: 0, y: 0 });
    } else {
      document.body.style.overflow = "unset";
    }

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;

      // 화면 경계 체크
      if (modalRef.current) {
        const modalRect = modalRef.current.getBoundingClientRect();
        const maxX = (window.innerWidth - modalRect.width) / 2;
        const maxY = (window.innerHeight - modalRect.height) / 2;

        setPosition({
          x: Math.max(-maxX, Math.min(maxX, newX)),
          y: Math.max(-maxY, Math.min(maxY, newY)),
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [isDragging, dragStart]);

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // 닫기 버튼이나 다른 상호작용 요소를 클릭한 경우 드래그 방지
    if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("a")) {
      return;
    }

    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    setIsDragging(true);
  };

  if (!isOpen) return null;

  const sizes = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    "2xl": "max-w-6xl",
    "3xl": "max-w-7xl",
    full: "max-w-[95vw]",
    "full-75": "max-w-[71.25vw]",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
    >
      {/* 오버레이 */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 모달 박스 */}
      <div
        ref={modalRef}
        className={cn(
          "relative bg-white rounded-2xl shadow-2xl w-full mx-auto animate-scale-up ring-1 ring-slate-900/5 flex flex-col",
          sizes[size],
          "max-h-[85vh] overflow-hidden",
          isDragging && "cursor-move"
        )}
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          transition: isDragging ? "none" : "transform 0.2s ease-out",
        }}
      >
        {/* 헤더 - sticky로 고정 */}
        {(title || showCloseButton || headerActions) && (
          <div
            ref={headerRef}
            className={cn(
              "flex items-center justify-between px-8 pt-8 pb-4",
              "cursor-move select-none",
              "sticky top-0 z-10 bg-white border-b border-slate-200",
              !title && "h-6"
            )}
            onMouseDown={handleHeaderMouseDown}
          >
            {title && (
              <h2 id="modal-title" className="text-2xl font-bold text-slate-900 flex-1 tracking-tight">
                {title}
              </h2>
            )}
            <div className="flex items-center gap-2">
              {headerActions && (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {headerActions}
                </div>
              )}
              {showCloseButton && (
                <button
                  onClick={onClose}
                  className={cn(
                    "p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus:ring-2 focus:ring-primary-500",
                    "cursor-pointer"
                  )}
                  aria-label="닫기"
                  style={{ pointerEvents: "auto" }}
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 내용 - 스크롤 가능 */}
        <div className="px-8 pb-8 overflow-y-auto custom-scrollbar flex-1 min-h-0">
          <div className="text-text-900">{children}</div>
        </div>
      </div>
    </div>
  );
};

