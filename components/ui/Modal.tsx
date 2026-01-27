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
  resizable?: boolean;
}

import { createPortal } from "react-dom";

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  showCloseButton = true,
  headerActions,
  resizable = false,
}) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);

  // 리사이즈 관련 상태
  const [isResizing, setIsResizing] = useState(false);
  const [modalSize, setModalSize] = useState<{ width: number | string; height: number | string }>({ width: "", height: "" });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const modalRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      // 모달이 열릴 때 위치 및 크기 초기화
      setPosition({ x: 0, y: 0 });
      setModalSize({ width: "", height: "" });
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

  // 드래그(이동) 및 리사이즈 이벤트 처리
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragStart.x;
        const newY = e.clientY - dragStart.y;

        // 화면 경계 체크
        if (modalRef.current) {
          const modalRect = modalRef.current.getBoundingClientRect();
          const maxX = (window.innerWidth - modalRect.width) / 2;
          const maxY = (window.innerHeight - modalRect.height) / 2;

          // 너무 벗어나지 않게 (화면의 90% 정도까지만 허용)
          const boundX = (window.innerWidth / 2) + (modalRect.width / 2) - 50;
          const boundY = (window.innerHeight / 2) + (modalRect.height / 2) - 50;

          setPosition({
            x: newX, // 자유롭게 이동하되 화면 밖으로 완전히 사라지지 않게 제한하는 로직은 복잡해질 수 있어 일단 자유 이동 허용하거나 필요시 제한
            y: newY,
          });
        }
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStart.x;
        const deltaY = e.clientY - resizeStart.y;

        setModalSize({
          width: Math.max(300, resizeStart.width + deltaX), // 최소 너비 300px
          height: Math.max(200, resizeStart.height + deltaY), // 최소 높이 200px
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      document.body.style.userSelect = "";
    };

    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
    };

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = ""; // cleanup 시 복구
    };
  }, [isDragging, dragStart, isResizing, resizeStart]);

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

  const handleResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // 모달 드래그 방지
    if (modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect();
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        width: rect.width,
        height: rect.height,
      });
      setIsResizing(true);

      // 리사이즈 시작 시 현재 크기를 명시적으로 설정하여 transition 꼬임 방지
      setModalSize({
        width: rect.width,
        height: rect.height,
      });
    }
  };

  if (!isOpen || !mounted) return null;

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

  return createPortal(
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
          "relative bg-white rounded-2xl shadow-2xl flex flex-col ring-1 ring-slate-900/5",
          // 리사이즈 중이거나 사이즈가 설정되어 있으면 max-w 클래스 제거 또는 무시됨
          !modalSize.width && sizes[size],
          !modalSize.height && "max-h-[85vh]",
          isDragging && "cursor-move",
          // 리사이즈 중일 때는 transition 제거하여 부드럽게
          (isDragging || isResizing) ? "transition-none" : "animate-scale-up transition-transform duration-200 ease-out"
        )}
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          width: modalSize.width || undefined,
          height: modalSize.height || undefined,
          // 리사이즈 시 max-width/max-height 제한 해제
          maxWidth: modalSize.width ? 'none' : undefined,
          maxHeight: modalSize.height ? 'none' : undefined,
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
              !title && "h-6",
              "rounded-t-2xl" // 헤더 모서리 둥글게
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
        <div className={cn(
          "px-8 pb-8 overflow-y-auto custom-scrollbar flex-1 min-h-0",
          // 리사이즈 핸들이 내용을 가리지 않도록 하단 패딩 추가
          resizable && "pb-8"
        )}>
          <div className="text-text-900 h-full">{children}</div>
        </div>

        {/* 리사이즈 핸들 */}
        {resizable && (
          <div
            className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-20 flex items-center justify-center"
            onMouseDown={handleResizeMouseDown}
          >
            {/* 핸들 아이콘 (우측 하단 코너 표시) */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              className="text-slate-400 pointer-events-none absolute bottom-1 right-1"
            >
              <path
                d="M11 1L11 11L1 11"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

