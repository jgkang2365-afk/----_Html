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
  error?: string | null;
}

import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

export const ModalContext = createContext<{ setGlobalError: (err: string | null) => void; isInsideModal?: boolean }>({
  setGlobalError: () => {},
  isInsideModal: false,
});

export const useModalError = () => useContext(ModalContext);

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  showCloseButton = true,
  headerActions,
  resizable = false,
  error: parentError = null,
}) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // 리사이즈 관련 상태
  const [isResizing, setIsResizing] = useState(false);
  const [modalSize, setModalSize] = useState<{ width: number | string; height: number | string }>({ width: "", height: "" });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isTouch, setIsTouch] = useState(false);

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
      setGlobalError(null);
    } else {
      document.body.style.overflow = "unset";
      setGlobalError(null);
    }

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // 브라우저 뒤로가기 버튼 대응 (일시 비활성화: Next.js 라우팅 충돌 방지)
  /*
  useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ modalOpen: true }, "");

    const handlePopState = () => {
      onCloseRef.current();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (window.history.state?.modalOpen) {
        window.history.back();
      }
    };
  }, [isOpen]);
  */

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onCloseRef.current();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  // 드래그(이동) 및 리사이즈 이벤트 처리
  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      if (isDragging) {
        const newX = clientX - dragStart.x;
        const newY = clientY - dragStart.y;

        setPosition({
          x: newX,
          y: newY,
        });
      } else if (isResizing) {
        // 리사이징 중에는 스크롤 방지
        if (e.cancelable) e.preventDefault();
        
        const deltaX = clientX - resizeStart.x;
        const deltaY = clientY - resizeStart.y;

        setModalSize({
          width: Math.max(300, resizeStart.width + deltaX),
          height: Math.max(200, resizeStart.height + deltaY),
        });
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
      setIsResizing(false);
      setIsTouch(false);
      document.body.style.userSelect = "";
    };

    if (isDragging || isResizing) {
      if (isTouch) {
        document.addEventListener("touchmove", handleMove, { passive: false });
        document.addEventListener("touchend", handleEnd);
        document.addEventListener("touchcancel", handleEnd);
      } else {
        document.addEventListener("mousemove", handleMove);
        document.addEventListener("mouseup", handleEnd);
      }
      document.body.style.userSelect = "none";
    };

    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
      document.removeEventListener("touchcancel", handleEnd);
      document.body.style.userSelect = "";
    };
  }, [isDragging, dragStart, isResizing, resizeStart, isTouch]);

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
    e.stopPropagation();
    if (modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect();
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        width: rect.width,
        height: rect.height,
      });
      setIsTouch(false);
      setIsResizing(true);
      setModalSize({
        width: rect.width,
        height: rect.height,
      });
    }
  };

  const handleResizeTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (modalRef.current && e.touches.length > 0) {
      const rect = modalRef.current.getBoundingClientRect();
      const touch = e.touches[0];
      setResizeStart({
        x: touch.clientX,
        y: touch.clientY,
        width: rect.width,
        height: rect.height,
      });
      setIsTouch(true);
      setIsResizing(true);
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
          "w-full sm:w-auto", // 모바일에서는 전체 너비 사용
          !modalSize.width && sizes[size],
          !modalSize.height && "max-h-[90vh] sm:max-h-[85vh]", // 모바일에서 좀 더 높게
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
              "flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-8 pt-5 sm:pt-8 pb-3 sm:pb-4 gap-3 sm:gap-4",
              "cursor-move select-none",
              "sticky top-0 z-10 bg-white border-b border-slate-200",
              !title && "h-6",
              "rounded-t-2xl" // 헤더 모서리 둥글게
            )}
            onMouseDown={handleHeaderMouseDown}
          >
            {title && (
              <h2 id="modal-title" className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight leading-tight shrink-0">
                {title}
              </h2>
            )}
            
            {/* 고정된 에러 출력 영역 */}
            {(parentError || globalError) && (
              <div className="flex-1 min-w-0 mx-2 sm:mx-4 flex items-center h-full">
                <div className="w-full bg-red-50 text-red-600 px-3 py-1.5 rounded-md text-sm sm:text-base font-semibold border border-red-200 shadow-sm truncate animate-in fade-in zoom-in duration-300">
                  ⚠️ {parentError || globalError}
                </div>
              </div>
            )}
            {!(parentError || globalError) && <div className="flex-1" />}

            <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto shrink-0">
              {headerActions && (
                <div className="flex items-center gap-2 flex-1 sm:flex-none overflow-x-auto no-scrollbar" onClick={(e) => e.stopPropagation()}>
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
          "px-4 sm:px-8 pb-6 sm:pb-8 overflow-y-auto custom-scrollbar flex-1 min-h-0",
          // 리사이즈 핸들이 내용을 가리지 않도록 하단 패딩 추가
          resizable && "pb-8"
        )}>
          <ModalContext.Provider value={{ setGlobalError, isInsideModal: true }}>
            <div className="text-text-900">{children}</div>
          </ModalContext.Provider>
        </div>

        {/* 리사이즈 핸들 */}
        {resizable && (
          <div
            className="absolute bottom-0 right-0 w-8 h-8 cursor-nwse-resize z-20 flex items-center justify-center sm:w-6 sm:h-6"
            onMouseDown={handleResizeMouseDown}
            onTouchStart={handleResizeTouchStart}
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

