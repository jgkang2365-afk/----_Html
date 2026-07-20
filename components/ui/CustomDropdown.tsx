import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DropdownOption {
  value: string;
  label: string;
}

interface CustomDropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  className?: string;
  placeholder?: string;
}

export const CustomDropdown: React.FC<CustomDropdownProps> = ({
  options,
  value,
  onChange,
  className,
  placeholder = "선택"
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLUListElement>(null);
  const scrollTargetRef = useRef<HTMLLIElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // 년도-주기 형식인 경우(예: 2026-하반기) 스크롤할 타겟 value 계산
  const getScrollTargetValue = () => {
    if (value && /^\d{4}-/.test(value)) {
      const year = value.split("-")[0];
      const targetVal = `${year}-상반기`;
      if (options.some((opt) => opt.value === targetVal)) {
        return targetVal;
      }
    }
    return value;
  };

  const scrollTargetValue = getScrollTargetValue();

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 드롭다운이 열릴 때 대상 요소를 맨 위로 스크롤
  useEffect(() => {
    if (isOpen && scrollTargetRef.current && containerRef.current) {
      containerRef.current.scrollTop = scrollTargetRef.current.offsetTop;
    }
  }, [isOpen]);

  const handleOptionClick = (val: string) => {
    onChange({ target: { value: val } });
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className={cn("relative inline-block w-full", className)}>
      {/* 드롭다운 버튼 */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full h-9 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-left pr-8 truncate",
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
          "transition-all duration-200 cursor-pointer text-slate-700 block",
          "bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTUgNy41TDEwIDEyLjVMMTUgNy41IiBzdHJva2U9IiM2QjcyODAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjwvc3ZnPgo=')] bg-no-repeat bg-[position:right_10px_center] bg-[length:16px_16px]"
        )}
      >
        {selectedOption ? selectedOption.label : placeholder}
      </button>

      {/* 드롭다운 선택 리스트 */}
      {isOpen && (
        <ul
          ref={containerRef}
          className={cn(
            "absolute left-0 z-50 w-full mt-1 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl",
            "scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent focus:outline-none py-1"
          )}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            const isScrollTarget = option.value === scrollTargetValue;
            return (
              <li
                key={option.value}
                ref={isScrollTarget ? scrollTargetRef : null}
                onClick={() => handleOptionClick(option.value)}
                className={cn(
                  "px-4 py-2 text-sm text-left cursor-pointer select-none transition-colors duration-150",
                  isSelected
                    ? "bg-blue-600 text-white font-semibold"
                    : "text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                )}
              >
                {option.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
