"use client";

import { useState } from "react";
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
}

export function ExcelUpload() {
  const [fileType, setFileType] = useState<"business-info" | "measurement-business" | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [autoSync, setAutoSync] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);

      // 파일명으로 자동 감지
      const fileName = selectedFile.name.toLowerCase();
      if (fileName.includes("사업장정보") || fileName.includes("business-info")) {
        setFileType("business-info");
      } else if (fileName.includes("측정사업장") || fileName.includes("measurement-business")) {
        setFileType("measurement-business");
      }
    }
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

      const response = await fetch("/api/upload/excel", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setResult({
          success: true,
          message: data.message || "파일이 성공적으로 업로드되었습니다.",
          file: data.file,
          syncWarning: data.syncWarning,
        });
        // 성공 시 파일 선택 초기화
        setFile(null);
        // 파일 입력 필드 초기화
        const fileInput = document.getElementById("excel-file-input") as HTMLInputElement;
        if (fileInput) {
          fileInput.value = "";
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
    <Card>
      <div className="p-4">
        <h3 className="text-lg font-semibold text-text-900 mb-4">Excel 파일 업로드</h3>

        <div className="space-y-4">
          {/* 파일 타입 선택 */}
          <div>
            <label className="block text-sm font-medium text-text-900 mb-2">
              파일 타입
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="fileType"
                  value="business-info"
                  checked={fileType === "business-info"}
                  onChange={(e) => setFileType(e.target.value as "business-info")}
                  className="mr-2"
                  disabled={uploading}
                />
                <span className="text-sm text-text-700">사업장정보</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="fileType"
                  value="measurement-business"
                  checked={fileType === "measurement-business"}
                  onChange={(e) => setFileType(e.target.value as "measurement-business")}
                  className="mr-2"
                  disabled={uploading}
                />
                <span className="text-sm text-text-700">측정사업장</span>
              </label>
            </div>
          </div>

          {/* 파일 선택 */}
          <div>
            <label htmlFor="excel-file-input" className="block text-sm font-medium text-text-900 mb-2">
              Excel 파일
            </label>
            <input
              id="excel-file-input"
              type="file"
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileChange}
              disabled={uploading}
              className="block w-full text-sm text-text-700 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-primary-600 file:text-white hover:file:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {file && (
              <p className="mt-2 text-sm text-text-600">
                선택된 파일: {file.name} ({formatFileSize(file.size)})
              </p>
            )}
          </div>

          {/* 자동 동기화 옵션 */}
          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                className="mr-2"
                disabled={uploading}
              />
              <span className="text-sm text-text-700">업로드 후 자동 동기화 (현재 미지원)</span>
            </label>
          </div>

          {/* 업로드 버튼 */}
          <Button
            variant="primary"
            onClick={handleUpload}
            disabled={!file || !fileType || uploading}
            className="w-full"
          >
            {uploading ? (
              <>
                <LoadingSpinner className="mr-2" />
                업로드 중...
              </>
            ) : (
              "파일 업로드"
            )}
          </Button>

          {/* 결과 표시 */}
          {result && (
            <div className="mt-4">
              {result.success ? (
                <Alert variant="success">
                  <div>
                    <p className="font-medium">{result.message}</p>
                    {result.file && (
                      <div className="mt-2 text-sm">
                        <p>파일명: {result.file.name}</p>
                        <p>크기: {formatFileSize(result.file.size)}</p>
                      </div>
                    )}
                    {result.syncWarning && (
                      <p className="mt-2 text-sm text-warning-700">{result.syncWarning}</p>
                    )}
                  </div>
                </Alert>
              ) : (
                <Alert variant="error">
                  {result.error || "파일 업로드 중 오류가 발생했습니다."}
                </Alert>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
