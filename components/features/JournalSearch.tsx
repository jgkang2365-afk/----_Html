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
  measurement_days: number | null;
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
  business_category?: string | null;
  created_at: string;
  updated_at: string;
  _isFromBusiness?: boolean; // measurement_business에서 온 데이터인지 표시
  sort_date?: string; // 정렬용 날짜 (예비조사 등록일 or created_at)
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

  // 검색 조건 저장 키
  const SEARCH_PARAMS_KEY = "journal_search_params";

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

  // 쿼터 데이터 로드
  useEffect(() => {
    const fetchQuotas = async () => {
      try {
        const response = await fetch('/api/admin/quotas');
        if (response.ok) {
          const result = await response.json();
          // setQuotas(result.data || []); // This line was removed as per instruction
        }
      } catch (err) {
        console.error("쿼터 로드 실패:", err);
      }
    };
    fetchQuotas();
  }, []);

  // 필터 초기값: 현재 년도와 상반기로 설정
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const currentPeriod = currentMonth <= 6 ? "상반기" : "하반기";

  const [filters, setFilters] = useState({
    measurementYear: currentYear.toString(),
    measurementPeriod: currentPeriod,
    designatedOffice: "",
    completionStatus: "",
    measurementDate: "", // 측정일 필터 추가
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

  // 페이지 로드 시 초기 검색 실행 (URL 파라미터 우선, 없으면 로컬 스토리지)
  useEffect(() => {
    // 1. URL 파라미터 확인 (우선순위 1)
    const codeParam = searchParamsUrl.get("code");
    const nameParam = searchParamsUrl.get("businessName");
    const yearParam = searchParamsUrl.get("year");
    const periodParam = searchParamsUrl.get("period");
    const autoOpenParam = searchParamsUrl.get("autoOpen") === "true";

    if (codeParam || nameParam) {
      const newParams = {
        ...searchParams,
        code: codeParam || "",
        businessName: nameParam || "",
        measurementYear: yearParam || searchParams.measurementYear || (new Date().getFullYear()).toString(),
        measurementPeriod: periodParam || searchParams.measurementPeriod || "",
      };
      setSearchParams(newParams);
      
      // URL 파라미터가 있을 경우 즉시 검색 (검색어 상태 업데이트가 비동기이므로 직접 전달)
      handleSearch(newParams, autoOpenParam);
      return;
    }

    // 2. 로컬 스토리지에서 검색 조건 복원
    const savedParams = localStorage.getItem("journal_search_params");
    if (savedParams) {
      try {
        const parsed = JSON.parse(savedParams);
        setSearchParams(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error("검색 조건 복원 실패:", e);
      }
    }

    if (activeTab === "search") {
      handleSearch();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  // 검색 조건 변경시 로컬 스토리지에 저장 (hasSearched 체크 없이 항상 저장하여 입력 중 상태 유지)
  useEffect(() => {
    // 값이 하나라도 변경되면 저장
    if (Object.values(searchParams).some(v => v !== "")) {
      localStorage.setItem("journal_search_params", JSON.stringify(searchParams));
    }
  }, [searchParams]);

  // 측정년도 옵션 생성 (현재 년도 기준 -5년 ~ +1년, 내림차순)
  const yearOptions = Array.from({ length: 7 }, (_, i) => {
    const year = currentYear - 5 + i;
    return { value: year.toString(), label: year.toString() };
  }).reverse(); // 내림차순으로 정렬

  // 측정주기 옵션 (검색용)
  const searchPeriodOptions = [
    { value: "", label: "전체" },
    { value: "상반기(전체)", label: "상반기 + 수시" },
    { value: "하반기(전체)", label: "하반기 + 수시" },
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

  const handleSearch = async (overrideParams?: typeof searchParams, autoOpen: boolean = false) => {
    const currentParams = overrideParams || searchParams;
    console.log("측정일지 검색 실행", currentParams);
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const params = new URLSearchParams();
      if (currentParams.code) {
        params.append("code", currentParams.code);
      }
      if (currentParams.measurementYear) {
        params.append("measurementYear", currentParams.measurementYear);
      }
      if (currentParams.measurementPeriod) {
        params.append("measurementPeriod", currentParams.measurementPeriod);
      }
      if (currentParams.businessName) {
        params.append("businessName", currentParams.businessName);
      }
      if (currentParams.designatedOffice) {
        params.append("designatedOffice", currentParams.designatedOffice);
      }
      if (currentParams.address) {
        params.append("address", currentParams.address);
      }
      if (currentParams.measurementDate) {
        params.append("measurementDate", currentParams.measurementDate);
      }

      params.append("menuType", "registration"); // 등록 현황 화면임을 API에 전달 (공문연번 정렬용)
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

        // 클라이언트 측 중복 제거 로직 수정 (code-year-period 조합 기준) - 서버에서 정렬해 준 순서를 반드시 보장하기 위함
        const seenKeys = new Map<string, JournalEntry>();

        // 서버에서 최신 순(또는 연번 우선 순)으로 정렬해서 보냈으므로, 배열을 순서대로 돌면서 첫 등장만 유지하는 것을 원칙으로 함 (다만, 혹시나 뒤에 더 최신 데이터가 있다면 교체)
        // 하지만 이미 서버 API에서 1차적인 중복 제거를 해서 보내기 때문에, 클라이언트에서는 순서를 해치지 않는 선에서 Set/Map을 사용해 한 번 더 걸러줌
        results.forEach((current: JournalEntry) => {
          const key = `${current.code}-${current.measurement_year}-${current.measurement_period}`;
          const existing = seenKeys.get(key);

          if (!existing) {
            seenKeys.set(key, current);
          } else {
            // 같은 조합이 있으면 더 최신 것(updated_at 또는 id가 더 큰 것) 선택
            const currentDate = new Date(current.updated_at || current.created_at || 0).getTime();
            const existingDate = new Date(existing.updated_at || existing.created_at || 0).getTime();

            if (currentDate > existingDate || (current.id && existing.id && current.id > existing.id)) {
              // 더 최신 항목으로 Map의 값 교체 (키의 순서는 유지됨)
              seenKeys.set(key, current);
            }
          }
        });

        // Map의 values를 배열로 변환하면 Map에 삽입된 순서대로 추출됨 (서버의 정렬 순서 보존)
        const deduplicatedResults = Array.from(seenKeys.values());

        setResults(deduplicatedResults);

        // 결과가 1건이고 autoOpen이 true인 경우 자동으로 모달 팝업
        if (autoOpen && deduplicatedResults.length === 1) {
          handleSelectJournal(deduplicatedResults[0]);
        }
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
    if (!entry) return;

    // 1. 즉시 상태 업데이트하여 모달 오픈 (빠른 응답성)
    setSelectedEntry(entry);
    setIsModalOpen(true);

    // 2. 백그라운드에서 최신 데이터 패치 (상세 정보 보완)
    if (entry.id) {
      try {
        const timestamp = new Date().getTime();
        // ID 기반 직접 조회로 변경하여 더 정확하고 빠른 데이터 확보
        const response = await fetch(`/api/journal/${entry.id}?_t=${timestamp}`, {
          cache: 'no-store',
        });
        
        if (response.ok) {
          const latestJournal = await response.json();
          
          if (latestJournal && latestJournal.id === entry.id) {
            // 검색 결과 목록 조용히 업데이트
            setResults((prevResults) => {
              return prevResults.map((r) =>
                r.id === latestJournal.id ? latestJournal : r
              );
            });
            // 모달 안의 상세 데이터(selectedEntry) 조용히 업데이트
            setSelectedEntry(latestJournal);
          }
        }
      } catch (err) {
        console.error("[JournalSearch] 백그라운드 데이터 갱신 실패:", err);
      }
    }
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
        // 캐시를 무시하고 최신 데이터를 가져오기 위해 timestamp 추가 (menuType=registration 추가)
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/journal/search?code=${encodeURIComponent(selectedEntry.code || '')}&measurementYear=${selectedEntry.measurement_year}&measurementPeriod=${encodeURIComponent(selectedEntry.measurement_period)}&menuType=registration&_t=${timestamp}`, {
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
    business_category?: string;
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
      business_category: data.business_category,
      completion_status: "미완료",
      measurement_start_date: null,
      measurement_end_date: null,
      measurement_days: null,
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

  // 쿼터 데이터 상태
  const [quotas, setQuotas] = useState<any[]>([]);

  // 필터 적용 함수
  const applyFilters = React.useCallback((journals: JournalEntry[], currentFilters: typeof filters, sortOrder: "asc" | "desc" = sequenceSortOrder) => {
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

    if (currentFilters.measurementDate) {
      filtered = filtered.filter(
        (entry) => entry.measurement_start_date?.substring(0, 10) === currentFilters.measurementDate
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

    // 정렬: 공문연번 -> 연번 -> 예비조사 등록일(sort_date) -> 측정년도 -> 측정주기 -> 등록일 (기본 오름차순)
    filtered = filtered.sort((a, b) => {
      const multiplier = sortOrder === "asc" ? 1 : -1;

      // 1. 공문연번 (Natural sorting: 대-001, 대-002...)
      const docA = a.document_number || "";
      const docB = b.document_number || "";

      if (docA !== docB) {
        // 둘 다 값이 있는 경우 natural sorting 적용
        if (docA && docB) {
          return docA.localeCompare(docB, 'ko-KR', { numeric: true }) * multiplier;
        }
        // 하나만 값이 있는 경우 값이 있는 것이 위로 (오름차순 기준)
        if (docA) return -1 * multiplier;
        if (docB) return 1 * multiplier;
      }

      // 2. 연번 (숫자 기준 정렬 시도)
      const seqA = a.sequence_number || "";
      const seqB = b.sequence_number || "";
      if (seqA !== seqB) {
        if (seqA && seqB) {
          return seqA.localeCompare(seqB, undefined, { numeric: true }) * multiplier;
        }
        if (seqA) return -1 * multiplier;
        if (seqB) return 1 * multiplier;
      }

      // 3. 예비조사 등록일 (sort_date)
      if (a.sort_date && b.sort_date) {
        const dateA = new Date(a.sort_date).getTime();
        const dateB = new Date(b.sort_date).getTime();
        if (dateA !== dateB) {
          return (dateA - dateB) * multiplier;
        }
      }

      // 4. 측정년도
      if (a.measurement_year !== b.measurement_year) {
        return (a.measurement_year - b.measurement_year) * multiplier;
      }

      // 5. 측정주기
      if (a.measurement_period !== b.measurement_period) {
        const formA = a.measurement_period || "";
        const formB = b.measurement_period || "";
        return formA.localeCompare(formB) * multiplier;
      }

      // 6. 등록일 (created_at 기준)
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return (dateA - dateB) * multiplier;
    });

    setFilteredJournals(filtered);
  }, [sequenceSortOrder]);

  // 등록 현황 목록 로드 (전체 데이터)
  const loadJournalList = React.useCallback(async () => {
    setListLoading(true);
    setListError(null);

    try {
      // 1. 쿼터 데이터 로드
      const quotasResponse = await fetch(`/api/admin/quotas`);
      const quotasData = await quotasResponse.json();
      if (quotasResponse.ok) {
        setQuotas(quotasData.data || []);
      }

      // 2. 검색 조건 없이 전체 데이터 로드
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
  }, [deletedJournalIds, filters, sequenceSortOrder, applyFilters]);



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
      measurementDate: "",
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
            <div className="flex flex-wrap items-end gap-4">
              {/* 1. 측정년도 */}
              <div className="w-[110px] shrink-0">
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

              {/* 2. 측정주기 */}
              <div className="w-[150px] shrink-0">
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

              {/* 3. 지정지청 */}
              <div className="w-[120px] shrink-0">
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

              {/* 4. 측정일 (추가) */}
              <div className="flex items-end gap-1">
                <div className="w-[140px]">
                  <Input
                    type="date"
                    label="측정일"
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
                    className="text-center px-1"
                  />
                </div>
                {searchParams.measurementDate && (
                  <button
                    onClick={() => setSearchParams({ ...searchParams, measurementDate: "" })}
                    className="text-blue-400 hover:text-blue-600 focus:outline-none mb-3.5"
                    title="날짜 초기화"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </div>

              {/* 4. 코드 */}
              <div className="w-[100px] shrink-0">
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

              {/* 5. 사업장명 (안내 문구 삭제) */}
              <div className="w-[300px] shrink-0">
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
                  placeholder="예: A기업, B기업 (쉼표로 구분)"
                />
              </div>

              {/* 6. 주소 (너비 축소: 기존 min-w-[200px] flex-1 -> w-[220px]) */}
              <div className="w-[220px] shrink-0">
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

              {/* 버튼 그룹 (우측 배치) */}
              <div className="flex gap-2 ml-auto">
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
                <div className="rounded-lg border border-surface-200 overflow-hidden bg-white">
                  <Table maxHeight="max-h-[calc(100vh-500px)]">
                    <TableHeader className="bg-sky-100 border-b-2 border-sky-200 z-20 text-black">
                      <TableRow>
                        <TableHead className="w-[55px] text-left text-xs font-bold text-slate-800 pl-2.5">코드</TableHead>
                        <TableHead className="w-20 text-center text-xs font-bold text-slate-800">측정년도</TableHead>
                        <TableHead className="w-20 text-center text-xs font-bold text-slate-800">측정주기</TableHead>
                        <TableHead className="w-24 text-center text-xs font-bold text-slate-800">지정지청</TableHead>
                        <TableHead className="w-[180px] text-left text-xs font-bold text-slate-800">사업장명</TableHead>
                        <TableHead className="w-[260px] text-left text-xs font-bold text-slate-800">주소</TableHead>
                        <TableHead className="w-20 text-center text-xs font-bold text-slate-800">공문연번</TableHead>
                        <TableHead className="w-20 text-center text-xs font-bold text-slate-800">연번</TableHead>
                        <TableHead className="w-20 text-center text-xs font-bold text-slate-800">5인이상</TableHead>
                        <TableHead className="w-16 text-center text-xs font-bold text-slate-800">총인원</TableHead>
                        <TableHead className="w-28 text-center text-xs font-bold text-slate-800">측정시작일</TableHead>
                        <TableHead className="w-12 text-center text-xs font-bold text-slate-800">일수</TableHead>
                        <TableHead className="w-20 text-center text-xs font-bold text-slate-800">담당자</TableHead>
                        <TableHead className="w-32 text-center text-xs font-bold text-slate-800">휴대폰</TableHead>
                        <TableHead className="w-20 text-center text-xs font-bold text-slate-800">측정자</TableHead>
                        <TableHead className="w-16 text-center text-xs font-bold text-slate-800">완료</TableHead>
                        <TableHead className="w-16 text-center text-xs font-bold text-slate-800">작업</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((entry) => (
                        <TableRow 
                          key={entry.id || `${entry.code}-${entry.measurement_year}-${entry.measurement_period}`} 
                          className="hover:bg-blue-50/40 border-b border-slate-100 last:border-0 group relative growable-row"
                        >
                          <TableCell className="w-[55px] text-left text-xs py-2 px-1 font-medium pl-2.5 relative">
                            {/* 표준 블루 인디케이터 바 */}
                            <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                            {entry.code}
                          </TableCell>
                          <TableCell className="text-center text-xs py-1 px-1 font-medium">{entry.measurement_year}</TableCell>
                          <TableCell className={`text-center text-xs py-1 px-1 ${entry.measurement_period.includes("(수시)") ? "text-red-500 font-bold" : ""}`}>
                            {entry.measurement_period}
                          </TableCell>
                          <TableCell className="text-center text-xs py-1 px-1">{entry.designated_office}</TableCell>
                          <TableCell className="text-left text-xs py-1 px-1 font-medium truncate max-w-[170px]" title={entry.business_name}>
                            {entry.business_name}
                          </TableCell>
                          <TableCell className="text-left text-xs py-1 px-1 text-slate-600 max-w-[250px] leading-tight break-keep" title={entry.address}>
                            <div className="line-clamp-2">{entry.address || "-"}</div>
                          </TableCell>
                          <TableCell className="text-center text-xs py-1 px-1">{entry.document_number || "-"}</TableCell>
                          <TableCell className="text-center text-xs py-1 px-1">{entry.sequence_number || "-"}</TableCell>
                          <TableCell className="text-center text-xs py-1 px-1">
                            {entry.five_plus_sequence ? (
                              <span>
                                {entry.five_plus_sequence}
                                {(() => {
                                  let quota = quotas.find(
                                    (q) =>
                                      q.year === entry.measurement_year &&
                                      q.period === entry.measurement_period &&
                                      q.office_name === entry.designated_office
                                  );

                                  if (!quota && entry.measurement_period && entry.measurement_period.includes('(수시)')) {
                                    const basePeriod = entry.measurement_period.replace('(수시)', '');
                                    quota = quotas.find(
                                      (q) =>
                                        q.year === entry.measurement_year &&
                                        q.period === basePeriod &&
                                        q.office_name === entry.designated_office
                                    );
                                  }

                                  return quota ? <span className="text-gray-400 text-[10px] ml-1">/ {quota.quota}</span> : null;
                                })()}
                              </span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className={`text-center text-xs py-1 px-1 ${entry.total_employees !== null && entry.total_employees !== undefined && entry.total_employees < 5 ? 'bg-purple-100' : ''}`}>
                            {entry.total_employees || "-"}
                          </TableCell>
                          <TableCell className="text-center text-xs py-1 px-1">{formatDate(entry.measurement_start_date)}</TableCell>
                          <TableCell className="text-center text-xs py-1 px-1 font-bold text-primary-600">{entry.measurement_days || "-"}</TableCell>
                          <TableCell className="text-center text-xs py-1 px-1">{entry.manager_name || "-"}</TableCell>
                          <TableCell className="text-center text-xs py-1 px-1">{entry.manager_mobile || "-"}</TableCell>
                          <TableCell className="text-center text-xs py-1 px-1 text-text-600 font-medium">{entry.measurer || "-"}</TableCell>
                          <TableCell className="text-center text-xs py-1 px-1">
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${entry.completion_status === "완료" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                              {entry.completion_status}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-xs py-1 px-1">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => handleSelectJournal(entry)}
                              className={`shadow-sm h-7 px-1.5 text-xs ${entry.id ? "bg-yellow-100 hover:bg-yellow-200 text-yellow-900 border border-yellow-200" : ""}`}
                            >
                              {entry.id ? "수정" : "등록"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
      )
      }

      {/* 등록 현황 탭 */}
      {
        activeTab === "list" && (
          <>
            {/* 필터 */}
            <Card className="p-6 shadow-sm">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-[80px]">
                  <Select
                    label="측정년도"
                    value={filters.measurementYear}
                    onChange={(e) => handleFilterChange("measurementYear", e.target.value)}
                    options={[{ value: "", label: "전체" }, ...yearOptions]}
                    className="text-center px-1"
                  />
                </div>
                <div className="w-[100px]">
                  <Select
                    label="측정주기"
                    value={filters.measurementPeriod}
                    onChange={(e) => handleFilterChange("measurementPeriod", e.target.value)}
                    options={periodOptions}
                    className="text-center px-1"
                  />
                </div>
                <div className="w-[80px]">
                  <Select
                    label="지정지청"
                    value={filters.designatedOffice}
                    onChange={(e) => handleFilterChange("designatedOffice", e.target.value)}
                    options={designatedOfficeOptions}
                    className="text-center px-1"
                  />
                </div>
                <div className="w-[80px]">
                  <Select
                    label="완료여부"
                    value={filters.completionStatus}
                    onChange={(e) => handleFilterChange("completionStatus", e.target.value)}
                    options={[
                      { value: "", label: "전체" },
                      { value: "완료", label: "완료" },
                      { value: "미완료", label: "미완료" },
                    ]}
                    className="text-center px-1"
                  />
                </div>
                {/* 측정일 필터 추가 (초기화 버튼 포함 - 입력창 밖으로 이동) */}
                <div className="flex items-end gap-1">
                  <div className="w-[140px]">
                    <Input
                      type="date"
                      label="측정일"
                      value={filters.measurementDate}
                      onChange={(e) => handleFilterChange("measurementDate", e.target.value)}
                      className="text-center px-1"
                    />
                  </div>
                  {filters.measurementDate && (
                    <button
                      onClick={() => handleFilterChange("measurementDate", "")}
                      className="text-blue-400 hover:text-blue-600 focus:outline-none mb-3.5"
                      title="날짜 초기화"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="w-[220px]">
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
                    placeholder="콤마(,) 구문 검색"
                  />
                </div>
                <div className="flex items-end gap-2 ml-auto">
                  <Button
                    type="button"
                    onClick={() => applyFilters(allJournals, filters, sequenceSortOrder)}
                    className="mb-0.5 whitespace-nowrap"
                  >
                    검색
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleFilterReset}
                    disabled={listLoading}
                    className="mb-0.5 whitespace-nowrap"
                  >
                    필터 초기화
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
                  <a
                    href="/api/templates/journal"
                    download="측정일지_업로드_양식.xlsx"
                    className="inline-flex items-center justify-center rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm font-medium text-text-700 transition-colors hover:bg-surface-50"
                  >
                    양식 다운로드
                  </a>
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
                    <TableHeader className="bg-sky-100 border-b-2 border-sky-200 z-20 text-black">
                      <TableRow>
                        <TableHead className="w-8">
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
                        <TableHead className="w-12 text-center text-xs text-black font-bold">
                          순번
                        </TableHead>
                        <TableHead className="w-16 !text-left !pl-2.5 text-xs">코드</TableHead>
                        <TableHead className="w-16 text-center text-xs">측정년도</TableHead>
                        <TableHead className="w-16 text-center text-xs">측정주기</TableHead>
                        <TableHead className="w-14 text-center text-xs">지정지청</TableHead>
                        <TableHead className="w-[180px] text-xs font-bold text-slate-800">사업장명</TableHead>
                        <TableHead className="w-[300px] text-xs font-bold text-slate-800">주소</TableHead>
                        <TableHead className="w-12 text-center text-xs">
                          <div className="flex items-center justify-center gap-1">
                            <span>공문연번</span>
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
                        <TableHead className="w-12 text-center text-xs">연번</TableHead>
                        <TableHead className="w-12 text-center text-xs px-1">5인이상</TableHead>
                        <TableHead className="w-10 text-center text-xs">총인원</TableHead>
                        <TableHead className="w-20 text-center text-xs">측정 시작일</TableHead>
                        <TableHead className="w-10 text-center text-xs">일수</TableHead>
                        <TableHead className="w-14 text-center text-xs">담당자</TableHead>
                        <TableHead className="w-20 text-center text-xs">담당자 휴대폰</TableHead>
                        <TableHead className="w-12 text-center text-xs">측정자</TableHead>
                        <TableHead className="w-12 text-center text-xs">완료여부</TableHead>
                        <TableHead className="w-12 text-center text-xs">작업</TableHead>
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
                            className="hover:bg-blue-50/40 group relative transition-colors"
                          >
                            <TableCell className="relative">
                              {/* 표준 블루 인디케이터 바 */}
                              <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                              
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
                            <TableCell className="font-mono text-xs !text-left !pl-2.5">
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
                              {entry.five_plus_sequence ? (
                                <span>
                                  {entry.five_plus_sequence}
                                  {(() => {
                                    // 1. 정확히 일치하는 주기 검색
                                    let quota = quotas.find(
                                      (q) =>
                                        q.year === entry.measurement_year &&
                                        q.period === entry.measurement_period &&
                                        q.office_name === entry.designated_office
                                    );

                                    // 2. '(수시)'가 포함된 경우, '(수시)'를 제거한 주기로 검색 (예: '상반기(수시)' -> '상반기')
                                    if (!quota && entry.measurement_period.includes('(수시)')) {
                                      const basePeriod = entry.measurement_period.replace('(수시)', '');
                                      quota = quotas.find(
                                        (q) =>
                                          q.year === entry.measurement_year &&
                                          q.period === basePeriod &&
                                          q.office_name === entry.designated_office
                                      );
                                    }

                                    return quota ? <span className="text-gray-400 text-[10px] ml-1">/ {quota.quota}</span> : null;
                                  })()}
                                </span>
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell className={`text-center text-xs ${entry.total_employees !== null && entry.total_employees !== undefined && entry.total_employees < 5 ? 'bg-purple-100' : 'bg-surface-50'}`}>
                              {entry.total_employees || "-"}
                            </TableCell>
                            <TableCell className="text-center text-xs">{formatDate(entry.measurement_start_date)}</TableCell>
                            <TableCell className="text-center text-xs font-bold text-primary-600">{entry.measurement_days || "-"}</TableCell>
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
                                type="button"
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
        )
      }

      {/* 측정일지 수정 모달 */}
      {
        selectedEntry && (
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
        )
      }

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
    </div >
  );
};

