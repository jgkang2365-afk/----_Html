"use client";

import React, { useState, useEffect } from "react";
import { DESIGNATED_OFFICE_OPTIONS } from "@/lib/constants/designated-offices";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/Table";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Checkbox } from "@/components/ui/Checkbox";
import { JournalEditForm } from "./JournalEditForm";
import { JournalRegisterModal } from "./JournalRegisterModal";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface JournalEntry {
  id: number | null; // measurement_business에서 온 데이터는 null
  code: string;
  measurement_year: number;
  measurement_period: string;
  business_name: string;
  designated_office: string;
  address: string;
  completion_status: string;
  measurement_start_date: string | null;
  measurement_end_date: string | null;
  measurer: string | null;
  document_number?: string | null;
  sequence_number?: string | null;
  five_plus_sequence?: string | null;
  total_employees?: number | null;
  manager_name?: string | null;
  manager_mobile?: string | null;
  business_number?: string | null;
  representative_name?: string | null;
  phone?: string | null;
  fax?: string | null;
  manager_email?: string | null;
  manager_position?: string | null;
  industrial_accident_number?: string | null;
  commencement_number?: string | null;
  invoice_email?: string | null;
  special_notes?: string | null;
  created_at: string;
  updated_at: string;
  _isFromBusiness?: boolean; // measurement_business에서 온 데이터인지 표시
}

export const JournalSearch: React.FC = () => {
  const router = useRouter();
  const searchParamsUrl = useSearchParams();
  const pathname = usePathname();

  // URL에서 탭 상태 읽기 (기본값: search)
  const [activeTab, setActiveTabState] = useState<"search" | "list">("search");

  useEffect(() => {
    const tabParam = searchParamsUrl.get("tab");
    if (tabParam === "list" || tabParam === "search") {
      setActiveTabState(tabParam);
    }
  }, [searchParamsUrl]);

  // 탭 변경 핸들러 (URL 업데이트 포함)
  const setActiveTab = (tab: "search" | "list") => {
    setActiveTabState(tab);
    const params = new URLSearchParams(searchParamsUrl.toString());
    params.set("tab", tab);
    router.replace(`${pathname}?${params.toString()}`);
  };

  // 검색 관련 상태
  const [searchParams, setSearchParams] = useState({
    code: "",
    measurementYear: "",
    measurementPeriod: "",
    businessName: "",
    designatedOffice: "",
    address: "",
    measurementDate: "",
  });
  const [results, setResults] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // 등록 현황 관련 상태
  const [allJournals, setAllJournals] = useState<JournalEntry[]>([]); // 전체 등록 현황
  const [filteredJournals, setFilteredJournals] = useState<JournalEntry[]>([]); // 필터링된 결과
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // 필터 초기값: 현재 년도와 상반기로 설정
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const currentPeriod = currentMonth <= 6 ? "상반기" : "하반기";

  const [filters, setFilters] = useState({
    measurementYear: currentYear.toString(),
    measurementPeriod: currentPeriod,
    designatedOffice: "",
    completionStatus: "",
    businessName: "",
  });

  // 순번 정렬 관련 상태
  const [sequenceSortOrder, setSequenceSortOrder] = useState<"asc" | "desc">("asc"); // 기본값: 오름차순 (등록 순서)

  // 일괄 삭제 관련 상태
  const [selectedJournalIds, setSelectedJournalIds] = useState<number[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletedJournalIds, setDeletedJournalIds] = useState<Set<number>>(new Set()); // 삭제된 항목 추적

  // 공통 상태
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isJournalFormSubmitting, setIsJournalFormSubmitting] = useState(false);

  // 업로드 관련 상태
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    message: string;
    successCount: number;
    errorCount: number;
    errors?: string[];
  } | null>(null);

  // 페이지 로드 시 초기 검색 실행 (최신 자료 표시)
  useEffect(() => {
    if (activeTab === "search") {
      handleSearch();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 측정년도 옵션 생성 (현재 년도 기준 -5년 ~ +1년, 내림차순)
  const yearOptions = Array.from({ length: 7 }, (_, i) => {
    const year = currentYear - 5 + i;
    return { value: year.toString(), label: year.toString() };
  }).reverse(); // 내림차순으로 정렬

  // 측정주기 옵션 (검색용)
  const searchPeriodOptions = [
    { value: "", label: "전체" },
    { value: "상반기", label: "상반기" },
    { value: "하반기", label: "하반기" },
  ];

  // 측정주기 옵션 (등록 현황 필터용)
  const periodOptions = [
    { value: "", label: "전체" },
    { value: "상반기", label: "상반기" },
    { value: "상반기(수시)", label: "상반기(수시)" },
    { value: "하반기", label: "하반기" },
    { value: "하반기(수시)", label: "하반기(수시)" },
  ];

  // 지정한계_관할지청 옵션 (검색용)
  const searchDesignatedOfficeOptions = [
    { value: "", label: "전체" },
    { value: "천안", label: "천안" },
    { value: "대전", label: "대전" },
    { value: "평택", label: "평택" },
    { value: "경기", label: "경기" },
  ];

  // 지정한계_관할지청 옵션 (필터/등록용)
  const designatedOfficeOptions = DESIGNATED_OFFICE_OPTIONS;

  const handleSearch = async () => {
    console.log("측정일지 검색 버튼 클릭됨", searchParams);
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const params = new URLSearchParams();
      if (searchParams.code) {
        params.append("code", searchParams.code);
      }
      if (searchParams.measurementYear) {
        params.append("measurementYear", searchParams.measurementYear);
      }
      if (searchParams.measurementPeriod) {
        params.append("measurementPeriod", searchParams.measurementPeriod);
      }
      if (searchParams.businessName) {
        params.append("businessName", searchParams.businessName);
      }
      if (searchParams.designatedOffice) {
        params.append("designatedOffice", searchParams.designatedOffice);
      }
      if (searchParams.address) {
        params.append("address", searchParams.address);
      }
      if (searchParams.measurementDate) {
        params.append("measurementDate", searchParams.measurementDate);
      }

      const response = await fetch(`/api/journal/search?${params.toString()}`);

      // 응답 파싱 안전 처리 (HTML 에러 페이지 등 JSON 이 아닐 때 대비)
      let data: any = null;
      try {
        data = await response.json();
      } catch {
        // JSON 파싱에 실패한 경우 (예: "Internal Server Error" 텍스트)
        if (!response.ok) {
          throw new Error("서버에서 올바른 데이터를 받지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      }

      if (response.ok) {
        const results = (data && data.results) || [];

        // 클라이언트 측에서도 중복 제거 (code-year-period 조합 기준)
        const deduplicatedResults = results.reduce((acc: JournalEntry[], current: JournalEntry) => {
          const key = `${current.code}-${current.measurement_year}-${current.measurement_period}`;
          const existing = acc.find((r) => `${r.code}-${r.measurement_year}-${r.measurement_period}` === key);

          if (!existing) {
            acc.push(current);
          } else {
            // 같은 조합이 있으면 더 최신 것(updated_at 또는 id가 더 큰 것) 선택
            const currentDate = new Date(current.updated_at || current.created_at || 0).getTime();
            const existingDate = new Date(existing.updated_at || existing.created_at || 0).getTime();

            if (currentDate > existingDate || (current.id && existing.id && current.id > existing.id)) {
              // 더 최신 항목으로 교체
              const index = acc.indexOf(existing);
              acc[index] = current;
            }
          }

          return acc;
        }, []);

        setResults(deduplicatedResults);
      } else {
        setError((data && data.error) || "검색 중 오류가 발생했습니다.");
        setResults([]);
      }
    } catch (err: any) {
      console.error("검색 오류:", err);
      setError(err.message || "검색 중 오류가 발생했습니다.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSearchParams({
      code: "",
      measurementYear: "",
      measurementPeriod: "",
      businessName: "",
      designatedOffice: "",
      address: "",
      measurementDate: "",
    });
    setResults([]);
    setError(null);
    setHasSearched(false);
  };

  const handleSelectJournal = async (entry: JournalEntry) => {
    // 측정일지 ID가 있으면 최신 데이터를 불러옴 (캐시 무시)
    if (entry.id) {
      try {
        // 캐시를 무시하고 최신 데이터를 가져오기 위해 timestamp 추가
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/journal/search?code=${encodeURIComponent(entry.code || '')}&measurementYear=${entry.measurement_year}&measurementPeriod=${entry.measurement_period}&_t=${timestamp}`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const data = await response.json();
          const latestJournal = data.results?.find((j: JournalEntry) => j.id === entry.id);
          if (latestJournal) {
            // 검색 결과 목록도 업데이트
            setResults((prevResults) => {
              const updatedResults = prevResults.map((r) =>
                r.id === latestJournal.id ? latestJournal : r
              );
              return updatedResults;
            });
            setSelectedEntry(latestJournal);
            setIsModalOpen(true);
            return;
          }
        }
      } catch (err) {
        console.error("측정일지 최신 데이터 조회 오류:", err);
        // 오류가 발생하면 기존 entry 사용
      }
    }
    // 최신 데이터를 불러오지 못했거나 ID가 없으면 기존 entry 사용
    setSelectedEntry(entry);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    // 모달이 닫힐 때 selectedEntry는 유지하지 않음 (다시 열 때 최신 데이터를 가져오기 위해)
    setSelectedEntry(null);
  };

  const handleSaveSuccess = async (savedJournalId?: number | null) => {
    // 저장된 측정일지의 최신 데이터를 불러와서 selectedEntry와 검색 결과 업데이트
    if (savedJournalId && selectedEntry) {
      try {
        // 캐시를 무시하고 최신 데이터를 가져오기 위해 timestamp 추가
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/journal/search?code=${encodeURIComponent(selectedEntry.code || '')}&measurementYear=${selectedEntry.measurement_year}&measurementPeriod=${encodeURIComponent(selectedEntry.measurement_period)}&_t=${timestamp}`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const data = await response.json();
          const updatedJournal = data.results?.find((j: JournalEntry) => j.id === savedJournalId);
          if (updatedJournal) {
            // selectedEntry 업데이트
            setSelectedEntry(updatedJournal);

            // 검색 결과 목록 업데이트: 같은 code-year-period 조합의 중복 제거
            setResults((prevResults) => {
              const key = `${updatedJournal.code}-${updatedJournal.measurement_year}-${updatedJournal.measurement_period}`;

              // 같은 code-year-period 조합의 항목들을 모두 제거하고, 업데이트된 항목만 추가
              const filteredResults = prevResults.filter((r) => {
                const rKey = `${r.code}-${r.measurement_year}-${r.measurement_period}`;
                return rKey !== key;
              });

              // 업데이트된 항목 추가
              return [...filteredResults, updatedJournal];
            });
          }
        }
      } catch (err) {
        console.error("저장된 측정일지 데이터 조회 오류:", err);
        // 오류가 발생해도 계속 진행
      }
    }

    // 저장 후 전체 검색을 다시 실행하여 최신 결과 반영 (중복 제거 보장)
    // 모달이 닫힌 후 검색을 실행하여 최신 상태 반영
    setTimeout(() => {
      handleSearch();
    }, 100);
    setTimeout(() => {
      handleSearch();
    }, 100);
  };

  const handleRegisterSelect = (data: {
    code: string;
    business_name: string;
    measurement_year: string;
    measurement_period: string;
    designated_office: string;
    address: string;
    business_number?: string;
    representative_name?: string;
    total_employees?: number | null;
    phone?: string;
    fax?: string;
    manager_name?: string;
    manager_position?: string;
    manager_mobile?: string;
    manager_email?: string;
    industrial_accident_number?: string;
    commencement_number?: string;
    invoice_email?: string;
    special_notes?: string;
  }) => {
    setIsRegisterModalOpen(false);

    const newEntry: JournalEntry = {
      id: null,
      code: data.code,
      measurement_year: parseInt(data.measurement_year),
      measurement_period: data.measurement_period,
      business_name: data.business_name,
      designated_office: data.designated_office,
      address: data.address,
      business_number: data.business_number,
      representative_name: data.representative_name,
      total_employees: data.total_employees,
      phone: data.phone,
      fax: data.fax,
      manager_name: data.manager_name,
      manager_position: data.manager_position,
      manager_mobile: data.manager_mobile,
      manager_email: data.manager_email,
      industrial_accident_number: data.industrial_accident_number,
      commencement_number: data.commencement_number,
      invoice_email: data.invoice_email,
      special_notes: data.special_notes,
      completion_status: "미완료",
      measurement_start_date: null,
      measurement_end_date: null,
      measurer: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      _isFromBusiness: false,
    };

    setSelectedEntry(newEntry);
    setIsModalOpen(true);
  };

  // 엑셀 다운로드
  const handleExportExcel = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.measurementYear) params.append("year", filters.measurementYear);
      if (filters.measurementPeriod) params.append("period", filters.measurementPeriod);

      const response = await fetch(`/api/export/journal?${params.toString()}`);

      if (!response.ok) {
        throw new Error("엑셀 다운로드 실패");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fileName = `측정일지등록현황_${filters.measurementYear || "전체"}_${filters.measurementPeriod || "전체"}_${new Date().toISOString().split("T")[0]}.xlsx`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error("엑셀 다운로드 오류:", err);
      alert("엑셀 다운로드 중 오류가 발생했습니다: " + (err.message || "알 수 없는 오류"));
    }
  };

  // 등록 현황 목록 로드 (전체 데이터)
  const loadJournalList = async () => {
    setListLoading(true);
    setListError(null);

    try {
      // 검색 조건 없이 전체 데이터 로드
      const response = await fetch(`/api/journal/search`);
      const data = await response.json();

      if (response.ok) {
        // measurement_journal에 실제 등록된 항목만 필터링 (id가 null이 아닌 것)
        // 삭제된 항목도 제외
        const registeredJournals = (data.results || []).filter(
          (entry: JournalEntry) =>
            entry.id !== null &&
            !entry._isFromBusiness &&
            !deletedJournalIds.has(entry.id)
        );
        setAllJournals(registeredJournals);
        // 초기 필터링 적용
        applyFilters(registeredJournals, filters, sequenceSortOrder);
        // 데이터 로드 시 선택 초기화
        setSelectedJournalIds([]);
      } else {
        setListError(data.error || "등록 현황을 불러오는 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("등록 현황 로드 오류:", err);
      setListError(err.message || "등록 현황을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setListLoading(false);
    }
  };

  // 필터 적용 함수
  const applyFilters = (journals: JournalEntry[], currentFilters: typeof filters, sortOrder: "asc" | "desc" = sequenceSortOrder) => {
    let filtered = [...journals];

    if (currentFilters.measurementYear) {
      filtered = filtered.filter(
        (entry) => entry.measurement_year.toString() === currentFilters.measurementYear
      );
    }

    if (currentFilters.measurementPeriod) {
      filtered = filtered.filter(
        (entry) => entry.measurement_period?.startsWith(currentFilters.measurementPeriod)
      );
    }

    if (currentFilters.designatedOffice) {
      filtered = filtered.filter(
        (entry) => entry.designated_office === currentFilters.designatedOffice
      );
    }

    if (currentFilters.completionStatus) {
      filtered = filtered.filter(
        (entry) => entry.completion_status === currentFilters.completionStatus
      );
    }

    if (currentFilters.businessName) {
      const searchTerms = currentFilters.businessName.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
      if (searchTerms.length > 0) {
        filtered = filtered.filter((entry) => {
          const businessName = entry.business_name?.toLowerCase() || "";
          return searchTerms.some(term => businessName.includes(term));
        });
      }
    }

    // 정렬: 측정년도 -> 측정주기 -> 등록일 (기본 내림차순)
    filtered = filtered.sort((a, b) => {
      const multiplier = sortOrder === "asc" ? 1 : -1;

      // 1. 측정년도
      if (a.measurement_year !== b.measurement_year) {
        return (a.measurement_year - b.measurement_year) * multiplier;
      }

      // 2. 측정주기 ("하반기" > "상반기" > "수시..." 순서가 되도록 문자열 비교)
      // "하반기"(D558) > "상반기"(C0C1) 이므로 내림차순시 하반기가 먼저 나옴
      if (a.measurement_period !== b.measurement_period) {
        const formA = a.measurement_period || "";
        const formB = b.measurement_period || "";
        return formA.localeCompare(formB) * multiplier;
      }

      // 3. 등록일 (created_at 기준)
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return (dateA - dateB) * multiplier;
    });

    setFilteredJournals(filtered);
  };

  // 필터 변경 핸들러
  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    applyFilters(allJournals, newFilters, sequenceSortOrder);
  };

  // 필터 초기화
  const handleFilterReset = () => {
    const resetFilters = {
      measurementYear: "",
      measurementPeriod: "",
      designatedOffice: "",
      completionStatus: "",
      businessName: "",
    };
    setFilters(resetFilters);
    applyFilters(allJournals, resetFilters, sequenceSortOrder);
  };

  // 탭 변경 시 목록 자동 로드
  useEffect(() => {
    if (activeTab === "list") {
      loadJournalList();
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // 일괄 삭제 관련 함수
  const handleSelectAllJournals = (checked: boolean) => {
    if (checked) {
      // id가 있는 항목만 선택 (measurement_business에서 온 데이터는 제외)
      const selectableIds = filteredJournals
        .filter((entry) => entry.id !== null)
        .map((entry) => entry.id as number);
      setSelectedJournalIds(selectableIds);
    } else {
      setSelectedJournalIds([]);
    }
  };

  const handleToggleJournalSelection = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedJournalIds([...selectedJournalIds, id]);
    } else {
      setSelectedJournalIds(selectedJournalIds.filter((selectedId) => selectedId !== id));
    }
  };

  const handleBulkDeleteJournals = async () => {
    if (selectedJournalIds.length === 0) {
      alert("삭제할 항목을 선택해주세요.");
      return;
    }

    if (!confirm(`선택한 ${selectedJournalIds.length}개의 측정일지를 정말 삭제하시겠습니까?`)) {
      return;
    }

    try {
      setIsDeleting(true);
      setListError(null);

      // 배치로 삭제 요청 (한 번에 10개씩 처리하여 서버 부하 방지)
      const batchSize = 10;
      const results: PromiseSettledResult<Response>[] = [];

      for (let i = 0; i < selectedJournalIds.length; i += batchSize) {
        const batch = selectedJournalIds.slice(i, i + batchSize);
        const batchPromises = batch.map((id) =>
          fetch(`/api/journal/${id}`, { method: "DELETE" })
        );
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);

        // 배치 간 약간의 지연 (서버 부하 방지)
        if (i + batchSize < selectedJournalIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      const successfullyDeletedIds: number[] = [];

      // 각 삭제 요청의 응답을 확인
      for (let index = 0; index < selectedJournalIds.length; index++) {
        const id = selectedJournalIds[index];
        const result = results[index];

        if (result.status === "fulfilled") {
          const response = result.value;
          try {
            let responseData: any = {};

            // 응답 본문을 한 번만 읽기
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              // JSON 응답 처리
              try {
                responseData = await response.json();
              } catch (parseError: any) {
                console.error(`항목 ${id} JSON 파싱 오류:`, parseError);
                responseData = {};
              }
            } else {
              // 텍스트 응답 처리
              try {
                const text = await response.text();
                try {
                  // 텍스트가 JSON인 경우 파싱 시도
                  responseData = JSON.parse(text);
                } catch {
                  // JSON이 아니면 텍스트로 처리
                  responseData = { message: text };
                }
              } catch (textError: any) {
                console.error(`항목 ${id} 텍스트 읽기 오류:`, textError);
                responseData = {};
              }
            }

            // 응답 상태 코드로 성공/실패 판단
            if (response.ok) {
              // success 필드가 false가 아니면 성공으로 간주
              if (responseData.success !== false) {
                successCount++;
                successfullyDeletedIds.push(id);
              } else {
                errorCount++;
                const errorMsg = responseData.error || responseData.details || "알 수 없는 오류";
                errors.push(`항목 ${id} 삭제 실패: ${errorMsg}`);
              }
            } else {
              // 에러 응답 처리
              errorCount++;
              const errorMsg = responseData.error || responseData.details || response.statusText || "알 수 없는 오류";
              errors.push(`항목 ${id} 삭제 실패: ${errorMsg}`);
            }
          } catch (error: any) {
            console.error(`항목 ${id} 삭제 처리 오류:`, error);
            errorCount++;
            errors.push(`항목 ${id} 삭제 중 오류 발생: ${error.message || "알 수 없는 오류"}`);
          }
        } else {
          // Promise가 거부된 경우
          errorCount++;
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason || "알 수 없는 오류");
          errors.push(`항목 ${id} 삭제 중 오류 발생: ${reason}`);
        }
      }

      if (errorCount > 0) {
        setListError(`${successCount}개 삭제 성공, ${errorCount}개 삭제 실패: ${errors.join(", ")}`);
      }

      // 성공적으로 삭제된 항목만 로컬 상태에서 즉시 제거
      if (successfullyDeletedIds.length > 0) {
        const deletedIdsSet = new Set(successfullyDeletedIds);
        // 삭제된 항목 ID를 추적 세트에 추가
        setDeletedJournalIds(prev => {
          const newSet = new Set(prev);
          successfullyDeletedIds.forEach(id => newSet.add(id));
          return newSet;
        });

        setAllJournals(prev => {
          const updated = prev.filter(entry => entry.id === null || !deletedIdsSet.has(entry.id));
          // 필터링된 목록도 업데이트
          applyFilters(updated, filters, sequenceSortOrder);
          return updated;
        });
      }

      // 선택 초기화
      setSelectedJournalIds([]);

      // 서버와 동기화는 하지 않고 로컬 상태만 업데이트
      // (사용자가 수동으로 새로고침하거나 다른 작업을 할 때 자동으로 동기화됨)

      if (errorCount === 0) {
        alert(`${successCount}개의 측정일지가 삭제되었습니다.`);
      }
    } catch (err: any) {
      console.error("일괄 삭제 오류:", err);
      setListError(err.message || "일괄 삭제 중 오류가 발생했습니다.");
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("ko-KR");
    } catch {
      return dateString;
    }
  };

  // 파일 업로드 핸들러
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Excel 파일만 허용
      const validExtensions = [".xlsx", ".xls"];
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
      if (!validExtensions.includes(fileExtension)) {
        setUploadError("Excel 파일(.xlsx, .xls)만 업로드할 수 있습니다.");
        return;
      }
      setUploadFile(file);
      setUploadError(null);
      setUploadResult(null);
    }
  };

  // 업로드 실행
  const handleUpload = async () => {
    if (!uploadFile) {
      setUploadError("파일을 선택해주세요.");
      return;
    }

    setUploadLoading(true);
    setUploadError(null);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);

      const response = await fetch("/api/journal/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setUploadResult(data);
        // 업로드 성공 시 목록 새로고침
        if (activeTab === "search") {
          handleSearch();
        } else {
          loadJournalList();
        }
      } else {
        setUploadError(data.error || "업로드 중 오류가 발생했습니다.");
      }
    } catch (error: any) {
      console.error("업로드 오류:", error);
      setUploadError(error.message || "업로드 중 오류가 발생했습니다.");
    } finally {
      setUploadLoading(false);
    }
  };

  // 업로드 모달 닫기
  const handleUploadModalClose = () => {
    setIsUploadModalOpen(false);
    setUploadFile(null);
    setUploadError(null);
    setUploadResult(null);
  };

  return (
    <div className="space-y-6">
      {/* 탭 네비게이션 */}
      <div className="border-b border-surface-200">
        <nav className="flex space-x-8" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "search"}
            onClick={() => setActiveTab("search")}
            className={`px-4 py-4 text-sm font-medium transition-colors border-b-2 cursor-pointer ${activeTab === "search"
              ? "text-primary-600 border-primary-600 font-semibold"
              : "text-text-600 border-transparent hover:text-text-900 hover:border-surface-300"
              }`}
          >
            검색
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "list"}
            onClick={() => setActiveTab("list")}
            className={`px-4 py-4 text-sm font-medium transition-colors border-b-2 cursor-pointer ${activeTab === "list"
              ? "text-primary-600 border-primary-600 font-semibold"
              : "text-text-600 border-transparent hover:text-text-900 hover:border-surface-300"
              }`}
          >
            등록 현황
          </button>
        </nav>
      </div>

      {/* 검색 탭 */}
      {activeTab === "search" && (
        <>
          {/* 검색 폼 */}
          <Card className="p-6 shadow-sm sticky top-0 z-20 bg-white">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-text-900">검색 조건</h2>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSearch();
                  }}
                  disabled={loading}
                  className="shadow-sm"
                >
                  {loading ? "검색 중..." : "검색"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleReset();
                  }}
                  disabled={loading}
                >
                  초기화
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setIsUploadModalOpen(true)}
                  className="shadow-sm"
                >
                  Excel 업로드
                </Button>
                <Button
                  onClick={() => setIsRegisterModalOpen(true)}
                  className="shadow-sm"
                >
                  등록
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-[100px]">
                <Input
                  label="코드"
                  value={searchParams.code}
                  onChange={(e) =>
                    setSearchParams({ ...searchParams, code: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                  placeholder=""
                />
              </div>
              <div className="w-[110px]">
                <Select
                  label="측정년도"
                  value={searchParams.measurementYear}
                  onChange={(e) =>
                    setSearchParams({ ...searchParams, measurementYear: e.target.value })
                  }
                  options={[{ value: "", label: "전체" }, ...yearOptions]}
                  className="text-center px-1"
                />
              </div>
              <div className="w-[100px]">
                <Select
                  label="측정주기"
                  value={searchParams.measurementPeriod}
                  onChange={(e) =>
                    setSearchParams({ ...searchParams, measurementPeriod: e.target.value })
                  }
                  options={searchPeriodOptions}
                  className="text-center px-1"
                />
              </div>
              <div className="w-[225px]">
                <Input
                  label="사업장명"
                  value={searchParams.businessName}
                  onChange={(e) =>
                    setSearchParams({ ...searchParams, businessName: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                  placeholder=""
                />
              </div>
              <div className="w-[120px]">
                <Select
                  label="지정지청"
                  value={searchParams.designatedOffice}
                  onChange={(e) =>
                    setSearchParams({ ...searchParams, designatedOffice: e.target.value })
                  }
                  options={searchDesignatedOfficeOptions}
                  className="text-center px-1"
                />
              </div>
              <div className="w-[150px]">
                <Input
                  type="date"
                  label="측정일(예비조사)"
                  value={searchParams.measurementDate}
                  onChange={(e) =>
                    setSearchParams({ ...searchParams, measurementDate: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                />
              </div>
              <div className="w-[360px]">
                <Input
                  label="주소"
                  value={searchParams.address}
                  onChange={(e) =>
                    setSearchParams({ ...searchParams, address: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                  placeholder="예: 서울, 경기"
                />
              </div>
            </div>
          </Card>

          {/* 검색 결과 */}
          {error && <Alert variant="error">{error}</Alert>}

          {hasSearched && !loading && (
            <Card className="p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-text-900">
                  검색 결과 ({results.length}건)
                </h2>
              </div>

              {results.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-text-500 text-lg">검색 결과가 없습니다.</p>
                </div>
              ) : (
                <div className="rounded-lg border border-surface-200 overflow-hidden">
                  <div className="max-h-[calc(100vh-500px)] overflow-y-auto overflow-x-auto">
                    <table className="w-full caption-bottom text-base">
                      <thead className="bg-slate-50/90 backdrop-blur supports-[backdrop-filter]:bg-slate-50/60 sticky top-0 z-10">
                        <tr className="border-b border-slate-100">
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-16 whitespace-nowrap sticky top-0 z-10">코드</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-20 whitespace-nowrap sticky top-0 z-10">측정년도</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-20 whitespace-nowrap sticky top-0 z-10">측정주기</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-24 whitespace-nowrap sticky top-0 z-10">지정지청</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-left align-middle font-bold text-slate-800 w-[200px] whitespace-nowrap sticky top-0 z-10">사업장명</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-left align-middle font-bold text-slate-800 w-[260px] whitespace-nowrap sticky top-0 z-10">주소</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-20 whitespace-nowrap sticky top-0 z-10">공문연번</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-20 whitespace-nowrap sticky top-0 z-10">연번</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-20 whitespace-nowrap sticky top-0 z-10">5인 이상 연번</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-20 whitespace-nowrap sticky top-0 z-10">총인원</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-28 whitespace-nowrap sticky top-0 z-10">측정시작일</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-20 whitespace-nowrap sticky top-0 z-10">담당자</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-32 whitespace-nowrap sticky top-0 z-10">담당자 휴대폰</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-20 whitespace-nowrap sticky top-0 z-10">측정자</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-16 whitespace-nowrap sticky top-0 z-10">완료여부</th>
                          <th className="bg-slate-50/90 backdrop-blur h-12 px-2 text-center align-middle font-bold text-slate-800 w-16 whitespace-nowrap sticky top-0 z-10">작업</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((entry) => (
                          <tr key={entry.id || `${entry.code}-${entry.measurement_year}-${entry.measurement_period}`} className="border-b border-slate-100 transition-colors hover:bg-slate-50/50">
                            <td className="p-1 align-middle font-medium text-center text-xs">{entry.code}</td>
                            <td className="p-1 align-middle font-medium text-center text-xs">{entry.measurement_year}</td>
                            <td className="p-1 align-middle text-center text-xs">{entry.measurement_period}</td>
                            <td className="p-1 align-middle text-center text-xs">{entry.designated_office}</td>
                            <td className="p-1 align-middle font-medium truncate max-w-[180px] text-xs" title={entry.business_name}>{entry.business_name}</td>
                            <td className="p-1 align-middle text-text-600 max-w-[300px] text-xs leading-tight break-keep" title={entry.address}>
                              <div className="line-clamp-2">
                                {entry.address || "-"}
                              </div>
                            </td>
                            <td className="p-1 align-middle text-center text-xs">{entry.document_number || "-"}</td>
                            <td className="p-1 align-middle text-center text-xs">{entry.sequence_number || "-"}</td>
                            <td className="p-1 align-middle text-center text-xs">{entry.five_plus_sequence || "-"}</td>
                            <td className={`p-1 align-middle text-center text-xs ${entry.total_employees !== null && entry.total_employees !== undefined && entry.total_employees < 5 ? 'bg-purple-100' : ''}`}>
                              {entry.total_employees || "-"}
                            </td>
                            <td className="p-1 align-middle text-center text-xs">{formatDate(entry.measurement_start_date)}</td>
                            <td className="p-1 align-middle text-center text-xs">{entry.manager_name || "-"}</td>
                            <td className="p-1 align-middle text-center text-xs">{entry.manager_mobile || "-"}</td>
                            <td className="p-1 align-middle text-text-600 text-center text-xs">{entry.measurer || "-"}</td>
                            <td className="p-1 align-middle text-center">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${entry.completion_status === "완료"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-yellow-100 text-yellow-800"
                                  }`}
                              >
                                {entry.completion_status}
                              </span>
                            </td>
                            <td className="p-1 align-middle text-center">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleSelectJournal(entry)}
                                className={`shadow-sm h-7 px-1.5 text-xs ${entry.id ? "bg-yellow-100 hover:bg-yellow-200 text-yellow-900 border border-yellow-200" : ""}`}
                              >
                                {entry.id ? "수정" : "등록"}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          )}

          {loading && (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          )}
        </>
      )}

      {/* 등록 현황 탭 */}
      {activeTab === "list" && (
        <>
          {/* 필터 */}
          <Card className="p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-text-900">필터</h2>
              <Button
                type="button"
                variant="secondary"
                onClick={handleFilterReset}
                disabled={listLoading}
                size="sm"
              >
                필터 초기화
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[120px]">
                <Select
                  label="측정년도"
                  value={filters.measurementYear}
                  onChange={(e) => handleFilterChange("measurementYear", e.target.value)}
                  options={[{ value: "", label: "전체" }, ...yearOptions]}
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <Select
                  label="측정주기"
                  value={filters.measurementPeriod}
                  onChange={(e) => handleFilterChange("measurementPeriod", e.target.value)}
                  options={periodOptions}
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <Select
                  label="지정지청"
                  value={filters.designatedOffice}
                  onChange={(e) => handleFilterChange("designatedOffice", e.target.value)}
                  options={designatedOfficeOptions}
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <Select
                  label="완료여부"
                  value={filters.completionStatus}
                  onChange={(e) => handleFilterChange("completionStatus", e.target.value)}
                  options={[
                    { value: "", label: "전체" },
                    { value: "완료", label: "완료" },
                    { value: "미완료", label: "미완료" },
                  ]}
                />
              </div>
              <div className="flex-[2] min-w-[200px] flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label="사업장명"
                    value={filters.businessName}
                    onChange={(e) => setFilters({ ...filters, businessName: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyFilters(allJournals, filters, sequenceSortOrder);
                      }
                    }}
                    placeholder="사업장명 입력"
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => applyFilters(allJournals, filters, sequenceSortOrder)}
                  className="mb-0.5"
                >
                  검색
                </Button>
              </div>
            </div>
          </Card>

          {/* 등록 현황 목록 */}
          {listError && <Alert variant="error">{listError}</Alert>}

          <Card className="p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-text-900">
                측정일지 등록 현황 ({filteredJournals.length}건 / 전체 {allJournals.length}건)
              </h2>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={handleExportExcel}>
                  엑셀 다운로드
                </Button>
                <Button onClick={() => setIsRegisterModalOpen(true)}>
                  등록
                </Button>
                {selectedJournalIds.length > 0 && (
                  <Button
                    variant="secondary"
                    onClick={handleBulkDeleteJournals}
                    disabled={isDeleting}
                  >
                    {isDeleting ? "삭제 중..." : `선택 삭제 (${selectedJournalIds.length})`}
                  </Button>
                )}
              </div>
            </div>

            {listLoading ? (
              <div className="flex justify-center py-12">
                <LoadingSpinner />
              </div>
            ) : filteredJournals.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-text-500 text-lg">
                  {allJournals.length === 0
                    ? "등록된 측정일지가 없습니다."
                    : "필터 조건에 맞는 측정일지가 없습니다."}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-surface-200">
                <Table maxHeight="max-h-[calc(100vh-300px)]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="bg-surface-50 w-8">
                        <Checkbox
                          checked={
                            filteredJournals.length > 0 &&
                            filteredJournals.filter((entry) => entry.id !== null).length > 0 &&
                            selectedJournalIds.length ===
                            filteredJournals.filter((entry) => entry.id !== null).length
                          }
                          onChange={(e) => handleSelectAllJournals(e.target.checked)}
                          disabled={filteredJournals.filter((entry) => entry.id !== null).length === 0}
                        />
                      </TableHead>
                      <TableHead className="bg-surface-50 w-12 text-center text-xs">
                        <div className="flex items-center justify-center gap-1">
                          <span>순번</span>
                          <button
                            onClick={() => {
                              const newOrder = sequenceSortOrder === "asc" ? "desc" : "asc";
                              setSequenceSortOrder(newOrder);
                              // 현재 필터 상태로 다시 필터링하여 정렬 적용
                              applyFilters(allJournals, filters, newOrder);
                            }}
                            className="p-1 hover:bg-surface-100 rounded transition-colors flex items-center justify-center"
                            title={sequenceSortOrder === "asc" ? "내림차순으로 변경" : "오름차순으로 변경"}
                          >
                            {sequenceSortOrder === "asc" ? (
                              // 빨간색 위 삼각형 (오름차순)
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 8L8 12H16L12 8Z" fill="#EF4444" />
                              </svg>
                            ) : (
                              // 파란색 아래 삼각형 (내림차순)
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 16L16 12H8L12 16Z" fill="#3B82F6" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </TableHead>
                      <TableHead className="bg-surface-50 w-12 text-center text-xs">코드</TableHead>
                      <TableHead className="bg-surface-50 w-12 text-center text-xs">측정년도</TableHead>
                      <TableHead className="bg-surface-50 w-12 text-center text-xs">측정주기</TableHead>
                      <TableHead className="bg-surface-50 w-14 text-center text-xs">지정지청</TableHead>
                      <TableHead className="bg-surface-50 w-[180px] text-xs">사업장명</TableHead>
                      <TableHead className="bg-surface-50 w-[300px] text-xs">주소</TableHead>
                      <TableHead className="bg-surface-50 w-12 text-center text-xs">공문연번</TableHead>
                      <TableHead className="bg-surface-50 w-12 text-center text-xs">연번</TableHead>
                      <TableHead className="bg-surface-50 w-12 text-center text-xs px-1">5인이상</TableHead>
                      <TableHead className="bg-surface-50 w-10 text-center text-xs">총인원</TableHead>
                      <TableHead className="bg-surface-50 w-20 text-center text-xs">측정 시작일</TableHead>
                      <TableHead className="bg-surface-50 w-14 text-center text-xs">담당자</TableHead>
                      <TableHead className="bg-surface-50 w-20 text-center text-xs">담당자 휴대폰</TableHead>
                      <TableHead className="bg-surface-50 w-12 text-center text-xs">측정자</TableHead>
                      <TableHead className="bg-surface-50 w-12 text-center text-xs">완료여부</TableHead>
                      <TableHead className="bg-surface-50 w-12 text-center text-xs">작업</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredJournals.map((entry, index) => {
                      const isSelected =
                        entry.id !== null && selectedJournalIds.includes(entry.id);
                      return (
                        <TableRow
                          key={
                            entry.id ||
                            `${entry.code}-${entry.measurement_year}-${entry.measurement_period}`
                          }
                          className="hover:bg-surface-50"
                        >
                          <TableCell>
                            {entry.id !== null ? (
                              <Checkbox
                                checked={isSelected}
                                onChange={(e) =>
                                  handleToggleJournalSelection(
                                    entry.id as number,
                                    e.target.checked,
                                  )
                                }
                              />
                            ) : (
                              <span className="text-text-400">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {index + 1}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-center">
                            {entry.code}
                          </TableCell>
                          <TableCell className="font-medium text-center text-xs">
                            {entry.measurement_year}
                          </TableCell>
                          <TableCell className="text-center text-xs">{entry.measurement_period}</TableCell>
                          <TableCell className="text-center text-xs">{entry.designated_office}</TableCell>
                          <TableCell className="font-medium truncate max-w-[180px] text-xs" title={entry.business_name}>
                            {entry.business_name}
                          </TableCell>
                          <TableCell className="text-text-600 max-w-[300px] text-xs leading-tight break-keep" title={entry.address}>
                            <div className="line-clamp-2">
                              {entry.address || "-"}
                            </div>
                          </TableCell>
                          <TableCell className="bg-surface-50 text-center text-xs">
                            {entry.document_number || "-"}
                          </TableCell>
                          <TableCell className="bg-surface-50 text-center text-xs">
                            {entry.sequence_number || "-"}
                          </TableCell>
                          <TableCell className="bg-surface-50 text-center text-xs">
                            {entry.five_plus_sequence || "-"}
                          </TableCell>
                          <TableCell className={`text-center text-xs ${entry.total_employees !== null && entry.total_employees !== undefined && entry.total_employees < 5 ? 'bg-purple-100' : 'bg-surface-50'}`}>
                            {entry.total_employees || "-"}
                          </TableCell>
                          <TableCell className="text-center text-xs">{formatDate(entry.measurement_start_date)}</TableCell>
                          <TableCell className="text-center text-xs">{entry.manager_name || "-"}</TableCell>
                          <TableCell className="text-center text-xs">{entry.manager_mobile || "-"}</TableCell>
                          <TableCell className="text-text-600 text-center text-xs">
                            {entry.measurer || "-"}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${entry.completion_status === "완료"
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                                }`}
                            >
                              {entry.completion_status}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleSelectJournal(entry)}
                              className="shadow-sm h-7 px-1.5 text-xs"
                            >
                              선택
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* 측정일지 수정 모달 */}
      {selectedEntry && (
        <Modal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          title={selectedEntry.id ? "측정일지 수정" : "측정일지 등록"}
          size="full-75"
          headerActions={
            <div className="flex gap-2">
              <Button
                type="submit"
                form="journal-edit-form"
                disabled={isJournalFormSubmitting}
                className="min-w-[80px]"
              >
                {isJournalFormSubmitting ? <LoadingSpinner size="sm" /> : selectedEntry.id ? "수정" : "등록"}
              </Button>
              <Button
                variant="secondary"
                onClick={handleModalClose}
                disabled={isJournalFormSubmitting}
              >
                취소
              </Button>
            </div>
          }
        >
          <JournalEditForm
            key={selectedEntry.id || `new-${selectedEntry.code}-${selectedEntry.measurement_year}-${selectedEntry.measurement_period}`}
            entry={selectedEntry}
            mode="journal"
            onClose={handleModalClose}
            onSuccess={handleSaveSuccess}
            setIsSubmitting={setIsJournalFormSubmitting}
          />
        </Modal>
      )}

      {/* 측정일지 등록(사업장 선택) 모달 */}
      <JournalRegisterModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        onSelect={handleRegisterSelect}
      />

      {/* Excel 업로드 모달 */}
      <Modal
        isOpen={isUploadModalOpen}
        onClose={handleUploadModalClose}
        title="측정일지 Excel 업로드"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-700 mb-2">
              Excel 파일 선택
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="block w-full text-sm text-text-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
              disabled={uploadLoading}
            />
            {uploadFile && (
              <p className="mt-2 text-sm text-text-600">선택된 파일: {uploadFile.name}</p>
            )}
          </div>

          {uploadError && (
            <Alert variant="error">{uploadError}</Alert>
          )}

          {uploadResult && (
            <Alert variant={uploadResult.success ? "success" : "warning"}>
              <div className="space-y-2">
                <p className="font-semibold">{uploadResult.message}</p>
                {uploadResult.errors && uploadResult.errors.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      오류 상세 ({uploadResult.errorCount}건)
                    </summary>
                    <ul className="mt-2 ml-4 list-disc space-y-1 text-sm max-h-60 overflow-y-auto">
                      {uploadResult.errors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </Alert>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant={uploadResult && !uploadLoading ? "primary" : "secondary"}
              onClick={handleUploadModalClose}
            >
              닫기
            </Button>
            <Button
              variant="primary"
              onClick={handleUpload}
              disabled={!uploadFile || uploadLoading || !!(uploadResult && !uploadLoading)}
            >
              {uploadLoading ? "업로드 중..." : "업로드"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

