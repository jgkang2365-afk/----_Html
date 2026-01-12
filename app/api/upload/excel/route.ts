/**
 * Excel 파일 업로드 API
 * POST /api/upload/excel
 * 
 * 파일을 Supabase Storage에 업로드하고, 선택적으로 동기화를 실행합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

export async function POST(request: NextRequest) {
  try {
    // 권한 체크 (관리자 또는 사용자 모두 업로드 가능)
    await checkPermission(["system:settings", "dashboard:read"]);

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const fileType = formData.get("type") as string; // "business-info" | "measurement-business"
    const autoSync = formData.get("autoSync") === "true"; // 업로드 후 자동 동기화

    if (!file) {
      return NextResponse.json(
        { success: false, error: "파일이 제공되지 않았습니다." },
        { status: 400 }
      );
    }

    // 파일 타입 검증
    const allowedTypes = [
      "application/vnd.ms-excel", // .xls
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    ];

    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(xls|xlsx)$/i)) {
      return NextResponse.json(
        { success: false, error: "Excel 파일만 업로드할 수 있습니다. (.xls, .xlsx)" },
        { status: 400 }
      );
    }

    // 파일 크기 제한 (50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: "파일 크기는 50MB를 초과할 수 없습니다." },
        { status: 400 }
      );
    }

    // 파일 타입 결정
    let targetFileType = fileType;
    if (!targetFileType) {
      // 파일명으로 자동 감지
      if (file.name.includes("사업장정보") || file.name.includes("business-info")) {
        targetFileType = "business-info";
      } else if (file.name.includes("측정사업장") || file.name.includes("measurement-business")) {
        targetFileType = "measurement-business";
      } else {
        return NextResponse.json(
          { success: false, error: "파일명에서 파일 타입을 확인할 수 없습니다. 파일명에 '사업장정보' 또는 '측정사업장'이 포함되어야 합니다." },
          { status: 400 }
        );
      }
    }

    const supabase = await createClient();

    // 파일명 생성 (타입-원본파일명-타임스탬프)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const fileExtension = file.name.split(".").pop();
    const fileName = `${targetFileType}-${timestamp}.${fileExtension}`;
    const filePath = `${targetFileType}/${fileName}`;

    // 파일을 ArrayBuffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // Supabase Storage에 업로드
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("excel-files")
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false, // 기존 파일 덮어쓰기 방지
      });

    if (uploadError) {
      console.error("Storage 업로드 오류:", uploadError);
      return NextResponse.json(
        { success: false, error: `파일 업로드 실패: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // 업로드 성공 응답
    const response: any = {
      success: true,
      message: "파일이 성공적으로 업로드되었습니다.",
      file: {
        name: fileName,
        path: filePath,
        type: targetFileType,
        size: file.size,
        uploadedAt: new Date().toISOString(),
      },
    };

    // 자동 동기화가 요청된 경우
    if (autoSync) {
      try {
        const { syncBusinessInfo, syncMeasurementBusiness } = await import("@/lib/sync/excel-sync");
        
        // Storage에서 파일을 다운로드하여 동기화
        const { data: downloadData, error: downloadError } = await supabase.storage
          .from("excel-files")
          .download(filePath);

        if (downloadError) {
          console.error("파일 다운로드 오류:", downloadError);
          response.syncWarning = "파일은 업로드되었지만 동기화에 실패했습니다. 나중에 수동으로 동기화해주세요.";
        } else {
          // 임시 파일로 저장 (동기화 함수는 파일 경로를 요구)
          // 또는 동기화 함수를 수정하여 Buffer도 받을 수 있도록 해야 함
          // 일단 업로드만 성공 처리
          response.syncWarning = "파일 업로드는 완료되었습니다. 수동 동기화를 실행해주세요.";
        }
      } catch (syncError) {
        console.error("자동 동기화 오류:", syncError);
        response.syncWarning = "파일은 업로드되었지만 동기화에 실패했습니다. 나중에 수동으로 동기화해주세요.";
      }
    }

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("파일 업로드 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { success: false, error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { success: false, error: "권한이 없습니다." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "파일 업로드 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/upload/excel
 * 업로드된 Excel 파일 목록 조회
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission(["system:settings", "dashboard:read"]);

    const { searchParams } = new URL(request.url);
    const fileType = searchParams.get("type"); // "business-info" | "measurement-business"

    const supabase = await createClient();

    // Storage에서 파일 목록 조회
    const folder = fileType || "";
    const { data: files, error } = await supabase.storage
      .from("excel-files")
      .list(folder, {
        limit: 100,
        offset: 0,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (error) {
      console.error("파일 목록 조회 오류:", error);
      return NextResponse.json(
        { success: false, error: `파일 목록 조회 실패: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      files: files || [],
    });
  } catch (error) {
    console.error("파일 목록 API 오류:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "파일 목록 조회 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
