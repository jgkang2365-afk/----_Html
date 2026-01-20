"use client";

import { useState, useRef, DragEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
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
}

interface ExcelUploadProps {
  onSuccess?: () => void;
}

export function ExcelUpload({ onSuccess }: ExcelUploadProps) {
  const [fileType, setFileType] = useState<"business-info" | "measurement-business" | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setResult(null);

    // 파일명으로 자동 감지
    const fileName = selectedFile.name.toLowerCase();
    if (fileName.includes("사업장정보") || fileName.includes("business-info")) {
      setFileType("business-info");
    } else if (fileName.includes("측정사업장") || fileName.includes("measurement-business")) {
      setFileType("measurement-business");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
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

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.xls') || droppedFile.name.endsWith('.xlsx'))) {
      handleFileSelect(droppedFile);
    }
  };

  const handleDropZoneClick = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async () => {
    if (!file) {
      setResult({
        success: false,
        error: "파일을 선택해주세요.",
      });
      return;
    }

    if (!fileType) {
      setResult({
        success: false,
        error: "파일 타입을 선택해주세요.",
      });
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", fileType);
      formData.append("autoSync", autoSync.toString());

      // 디버깅: 전송할 데이터 확인
      console.log("업로드 요청 데이터:", {
        fileType,
        autoSync,
        fileName: file.name,
      });

      const response = await fetch("/api/upload/excel", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      // 디버깅: API 응답 확인
      console.log("업로드 API 응답:", data);

      if (response.ok && data.success) {
        const resultData: UploadResult = {
          success: true,
          message: data.message || "파일이 성공적으로 업로드되었습니다.",
          file: data.file,
          syncWarning: data.syncWarning,
          syncSuccess: data.syncSuccess,
          syncMessage: data.syncMessage,
        };

        // 디버깅: 결과 데이터 확인
        console.log("설정할 결과 데이터:", resultData);

        setResult(resultData);
        // 성공 시 파일 선택 초기화
        setFile(null);
        // 파일 입력 필드 초기화
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }

        // 성공 콜백 호출
        if (onSuccess) {
          onSuccess();
        }
      } else {
        setResult({
          success: false,
          error: data.error || "파일 업로드 중 오류가 발생했습니다.",
        });
      }
    } catch (error) {
      console.error("업로드 오류:", error);
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "파일 업로드 중 오류가 발생했습니다.",
      });
    } finally {
      setUploading(false);
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
          <h3 className="text-xl font-bold text-text-900 mb-1">Excel 파일 업로드</h3>
          <p className="text-sm text-text-500">Excel 파일을 업로드하여 데이터베이스에 동기화합니다</p>
        </div>

        <div className="space-y-6">
          {/* 파일 타입 선택 */}
          <div>
            <label className="block text-sm font-semibold text-text-900 mb-3">
              파일 타입
            </label>
            <div className="flex gap-3">
              <label className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="fileType"
                  value="business-info"
                  checked={fileType === "business-info"}
                  onChange={(e) => setFileType(e.target.value as "business-info")}
                  className="sr-only"
                  disabled={uploading}
                />
                <div className={`
                  px-4 py-3 rounded-lg border-2 transition-all duration-200
                  ${fileType === "business-info"
                    ? "border-primary-500 bg-primary-50 shadow-sm"
                    : "border-surface-200 bg-white hover:border-primary-300 hover:bg-primary-50/50"
                  }
                  ${uploading ? "opacity-50 cursor-not-allowed" : ""}
                `}>
                  <div className="flex items-center justify-center">
                    <div className={`
                      w-4 h-4 rounded-full border-2 mr-2 flex items-center justify-center
                      ${fileType === "business-info"
                        ? "border-primary-500 bg-primary-500"
                        : "border-surface-300"
                      }
                    `}>
                      {fileType === "business-info" && (
                        <div className="w-2 h-2 rounded-full bg-white"></div>
                      )}
                    </div>
                    <span className={`text-sm font-medium ${fileType === "business-info" ? "text-primary-700" : "text-text-700"
                      }`}>
                      사업장정보
                    </span>
                  </div>
                </div>
              </label>
              <label className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="fileType"
                  value="measurement-business"
                  checked={fileType === "measurement-business"}
                  onChange={(e) => setFileType(e.target.value as "measurement-business")}
                  className="sr-only"
                  disabled={uploading}
                />
                <div className={`
                  px-4 py-3 rounded-lg border-2 transition-all duration-200
                  ${fileType === "measurement-business"
                    ? "border-primary-500 bg-primary-50 shadow-sm"
                    : "border-surface-200 bg-white hover:border-primary-300 hover:bg-primary-50/50"
                  }
                  ${uploading ? "opacity-50 cursor-not-allowed" : ""}
                `}>
                  <div className="flex items-center justify-center">
                    <div className={`
                      w-4 h-4 rounded-full border-2 mr-2 flex items-center justify-center
                      ${fileType === "measurement-business"
                        ? "border-primary-500 bg-primary-500"
                        : "border-surface-300"
                      }
                    `}>
                      {fileType === "measurement-business" && (
                        <div className="w-2 h-2 rounded-full bg-white"></div>
                      )}
                    </div>
                    <span className={`text-sm font-medium ${fileType === "measurement-business" ? "text-primary-700" : "text-text-700"
                      }`}>
                      측정사업장
                    </span>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* 파일 선택 - 드래그 앤 드롭 */}
          <div>
            <label className="block text-sm font-semibold text-text-900 mb-3">
              Excel 파일
            </label>
            <input
              ref={fileInputRef}
              type="file"
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
                  : file
                    ? "border-primary-300 bg-primary-50/30"
                    : "border-surface-300 bg-surface-50 hover:border-primary-400 hover:bg-primary-50/50"
                }
                ${uploading ? "opacity-50 cursor-not-allowed" : ""}
              `}
            >
              {file ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center">
                    <svg className="w-12 h-12 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-900">{file.name}</p>
                    <p className="text-xs text-text-500 mt-1">{formatFileSize(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium mt-2"
                    disabled={uploading}
                  >
                    파일 변경
                  </button>
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

          {/* 자동 동기화 옵션 */}
          <div>
            <label className="flex items-center cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={(e) => setAutoSync(e.target.checked)}
                  className="sr-only"
                  disabled={uploading}
                />
                <div className={`
                  w-11 h-6 rounded-full transition-colors duration-200
                  ${autoSync ? "bg-primary-500" : "bg-surface-300"}
                  ${uploading ? "opacity-50" : ""}
                `}>
                  <div className={`
                    absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md
                    transition-transform duration-200
                    ${autoSync ? "translate-x-5" : "translate-x-0"}
                  `}></div>
                </div>
              </div>
              <span className={`ml-3 text-sm font-medium ${autoSync ? "text-text-900" : "text-text-600"
                }`}>
                업로드 후 자동 동기화
              </span>
            </label>
          </div>

          {/* 업로드 버튼 */}
          <Button
            variant="primary"
            onClick={handleUpload}
            disabled={!file || !fileType || uploading}
            className="w-full py-3 text-base font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <div className="flex items-center justify-center">
                <LoadingSpinner className="mr-2" />
                <span>업로드 중...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span>파일 업로드</span>
              </div>
            )}
          </Button>

          {/* 결과 표시 */}
          {result && (
            <div className="mt-4 space-y-3 animate-fade-in">
              {result.success ? (
                <>
                  <div className="rounded-lg bg-green-50 border border-green-200 p-4 shadow-sm">
                    <div className="flex items-start">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 rounded-full bg-success-500 flex items-center justify-center shadow-sm">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </div>
                      <div className="ml-3 flex-1">
                        <p className="text-sm font-semibold text-green-900">{result.message}</p>
                        {result.file && (
                          <div className="mt-2 text-xs text-green-700 space-y-1">
                            <p className="flex items-center">
                              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              {result.file.name}
                            </p>
                            <p className="flex items-center">
                              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                              </svg>
                              {formatFileSize(result.file.size)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {result.syncSuccess && result.syncMessage && (
                    <div className="rounded-lg bg-green-50 border border-green-200 p-4 shadow-sm">
                      <div className="flex items-start">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-success-500 flex items-center justify-center shadow-sm">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </div>
                        </div>
                        <div className="ml-3 flex-1">
                          <p className="text-sm font-semibold text-green-900">{result.syncMessage}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  {result.syncWarning && (
                    <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 shadow-sm">
                      <div className="flex items-start">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-warning-500 flex items-center justify-center shadow-sm">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </div>
                        </div>
                        <div className="ml-3 flex-1">
                          <p className="text-sm font-medium text-yellow-800">{result.syncWarning}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-lg bg-red-50 border border-red-200 p-4 shadow-sm">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-error-500 flex items-center justify-center shadow-sm">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                    </div>
                    <div className="ml-3 flex-1">
                      <p className="text-sm font-semibold text-red-900">
                        {result.error || "파일 업로드 중 오류가 발생했습니다."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
