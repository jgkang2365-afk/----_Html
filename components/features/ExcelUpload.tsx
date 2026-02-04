"use client";

import { useState, useRef, DragEvent, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

interface UploadResult {
  success: boolean;
  message?: string;
  error?: string;
  file?: {
    name: string;
    path: string;
    type: string;
    size: number;
    uploadedAt: string;
  };
  syncWarning?: string;
  syncSuccess?: boolean;
  syncMessage?: string;
  syncChangeLog?: string[]; // 변경 로그 추가
}

interface ExcelUploadProps {
  onSuccess?: () => void;
  fixedFileType?: "business-info" | "measurement-business";
  hideAutoSync?: boolean;
  defaultAutoSync?: boolean;
  apiEndpoint?: string; // API 엔드포인트 커스터마이징
}

export function ExcelUpload({
  onSuccess,
  fixedFileType,
  hideAutoSync = false,
  defaultAutoSync = false,
  apiEndpoint = "/api/upload/excel" // 기본값 유지
}: ExcelUploadProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [autoSync] = useState(true); // 항상 True 고정
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);



  const handleFileSelect = (selectedFiles: FileList | File[]) => {
    const newFiles = Array.from(selectedFiles).filter(f =>
      f.name.toLowerCase().endsWith('.xls') || f.name.toLowerCase().endsWith('.xlsx')
    );

    setFiles(prev => [...prev, ...newFiles]);
    setResults([]);
  };

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setResults([]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files);
    }
  };

  const handleDropZoneClick = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setResults([{
        success: false,
        error: "파일을 선택해주세요.",
      }]);
      return;
    }

    setUploading(true);
    setResults([]);

    const newResults: UploadResult[] = [];

    for (const file of files) {
      try {
        // 파일 타입 자동 감지
        let currentFileType = fixedFileType || "";
        if (!currentFileType) {
          const fileName = file.name.toLowerCase();
          if (fileName.includes("측정사업장") || fileName.includes("measurement") || fileName.includes("measurement_business") || fileName.includes("measurement-business")) {
            currentFileType = "measurement-business";
          } else if (fileName.includes("사업장정보") || fileName.includes("business_info") || fileName.includes("business-info") || fileName === "business_info.xlsx") {
            currentFileType = "business-info";
          }
        }

        if (!currentFileType && apiEndpoint.includes("/upload/excel")) {
          newResults.push({
            success: false,
            file: { name: file.name, path: "", type: "", size: file.size, uploadedAt: "" },
            error: "파일 타입을 식별할 수 없습니다. (파일명에 '사업장정보' 또는 '측정사업장' 포함 필요)"
          });
          continue;
        }

        const formData = new FormData();
        formData.append("file", file);
        if (currentFileType) {
          formData.append("type", currentFileType);
        }
        formData.append("autoSync", "true"); // 강제 True

        const response = await fetch(apiEndpoint, {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (response.ok && data.success) {
          newResults.push({
            success: true,
            message: data.message || "업로드 성공",
            file: data.file,
            syncWarning: data.syncWarning,
            syncSuccess: data.syncSuccess,
            syncMessage: data.syncMessage,
            syncChangeLog: data.syncChangeLog
          });
        } else {
          newResults.push({
            success: false,
            file: { name: file.name, path: "", type: "", size: file.size, uploadedAt: "" },
            error: data.error || "업로드 실패"
          });
        }
      } catch (error) {
        newResults.push({
          success: false,
          file: { name: file.name, path: "", type: "", size: file.size, uploadedAt: "" },
          error: error instanceof Error ? error.message : "오류 발생"
        });
      }
    }

    setResults(newResults);
    setUploading(false);

    // 모두 성공 시 파일 목록 초기화
    if (newResults.every(r => r.success)) {
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (onSuccess) onSuccess();
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-6">
        <div className="mb-6">
          <div>
            <h3 className="text-xl font-bold text-text-900 mb-1">Excel 파일 업로드</h3>
            <p className="text-sm text-text-500">
              {fixedFileType === "business-info"
                ? "사업장정보 Excel 파일을 업로드하여 데이터베이스에 동기화합니다"
                : fixedFileType === "measurement-business"
                  ? "측정사업장 Excel 파일을 업로드하여 데이터베이스에 동기화합니다"
                  : "Excel 파일들을 업로드하여 DB와 자동 동기화합니다 (드래그 앤 드롭 가능)"
              }
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* 파일 타입 선택 (fixedFileType이 없을 때만 표시) */}
          {/* 파일 타입 선택 UI 제거 (자동 감지) */}

          {/* 파일 선택 - 드래그 앤 드롭 */}
          <div>
            {!fixedFileType && (
              <label className="block text-sm font-semibold text-text-900 mb-3">
                Excel 파일
              </label>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple // 다중 선택 허용
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileChange}
              disabled={uploading}
              className="hidden"
            />
            <div
              onClick={handleDropZoneClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`
                relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
                transition-all duration-200
                ${isDragging
                  ? "border-primary-500 bg-primary-50 scale-[1.02]"
                  : files.length > 0
                    ? "border-primary-300 bg-primary-50/30"
                    : "border-surface-300 bg-surface-50 hover:border-primary-400 hover:bg-primary-50/50"
                }
                ${uploading ? "opacity-50 cursor-not-allowed" : ""}
              `}
            >
              {files.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center mb-4">
                    <svg className="w-10 h-10 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {files.map((f, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-white p-2 rounded shadow-sm border text-left">
                        <div>
                          <p className="text-sm font-semibold text-text-900">{f.name}</p>
                          <p className="text-xs text-text-500">{formatFileSize(f.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFile(idx);
                          }}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 text-xs text-primary-600 font-medium">
                    총 {files.length}개 파일 선택됨 (클릭하여 추가)
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                      <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-900">
                      파일을 드래그하거나 클릭하여 선택
                    </p>
                    <p className="text-xs text-text-500 mt-1">
                      Excel 파일 (.xls, .xlsx)만 업로드 가능
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 자동 동기화 옵션 (항상 켜져있으므로 숨김 or 안내문구) */}
          <div className="flex items-center text-sm text-primary-700 bg-primary-50 p-3 rounded-lg">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            업로드 시 DB 자동 동기화가 적용됩니다.
          </div>

          <Button
            variant="primary"
            onClick={handleUpload}
            disabled={files.length === 0 || uploading}
            className="w-full py-3 text-base font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <div className="flex items-center justify-center">
                <LoadingSpinner className="mr-2" />
                <span>업로드 중 ({files.length}개 파일)...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span>{files.length > 0 ? `${files.length}개 파일 업로드` : "파일 업로드"}</span>
              </div>
            )}
          </Button>

          {/* 결과 표시 */}
          {/* 결과 표시 (다중) */}
          {results.length > 0 && (
            <div className="mt-4 space-y-3 animate-fade-in">
              {results.map((result, idx) => (
                <div key={idx} className={`rounded-lg border p-4 shadow-sm ${result.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      {result.success ? (
                        <div className="w-8 h-8 rounded-full bg-success-500 flex items-center justify-center shadow-sm">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-error-500 flex items-center justify-center shadow-sm">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="ml-3 flex-1">
                      <p className={`text-sm font-semibold ${result.success ? "text-green-900" : "text-red-900"}`}>
                        {result.file?.name} - {result.message || result.error}
                      </p>

                      {result.success && (
                        <div className="mt-2 space-y-2">
                          {/* 동기화 메시지 */}
                          {result.syncMessage && <p className="text-xs text-green-800">{result.syncMessage}</p>}
                          {result.syncWarning && <p className="text-xs text-yellow-800 bg-yellow-100 p-1 rounded inline-block">{result.syncWarning}</p>}

                          {/* 변경 로그 */}
                          {result.syncChangeLog && result.syncChangeLog.length > 0 && (
                            <div className="bg-white/60 p-2 rounded text-xs text-gray-700 max-h-40 overflow-y-auto">
                              <p className="font-bold mb-1">변경 내역:</p>
                              <ul className="list-disc pl-4 space-y-1">
                                {result.syncChangeLog.map((log, logIdx) => {
                                  const isMismatch = log.includes("[데이터 불일치]");
                                  return (
                                    <li
                                      key={logIdx}
                                      className={isMismatch ? "bg-red-100 text-red-700 font-medium p-1 rounded -ml-2 pl-2 list-none mb-1 border border-red-200" : ""}
                                    >
                                      {log}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
