import React, { useEffect, useRef, useState } from "react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

// 측정대상사업장 데이터 인터페이스
interface BusinessEntry {
  id: string | number;
  code: string;
  year: number;
  period: string;
  business_name: string;
  business_number: string | null;
  address: string | null;
  isRegistered: boolean;
  is_registered_text: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocoding_status?: string | null;
  geocoding_error?: string | null;
  geocoded_address?: string | null;
  coordinate_locked?: boolean;
}

interface BusinessMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSelectedIds: (string | number)[];
  allBusinesses: BusinessEntry[]; // 전체 사업장 목록 (검색 및 추가용)
}

export const BusinessMapModal: React.FC<BusinessMapModalProps> = ({
  isOpen,
  onClose,
  initialSelectedIds,
  allBusinesses,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const infoWindowRef = useRef<any>(null);

  // 지도 로딩 상태
  const [mapScriptLoaded, setMapScriptLoaded] = useState(false);
  const [mapScriptError, setMapScriptError] = useState<string | null>(null);

  // 현재 지도에 포함된 사업장 목록 (최대 10개)
  const [mapBusinesses, setMapBusinesses] = useState<BusinessEntry[]>([]);
  // Geocoding 진행 상태
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  // 지도 표시 실패 항목 (좌표 없음, Geocoding 실패 등)
  const [failedBusinesses, setFailedBusinesses] = useState<BusinessEntry[]>([]);

  // 모달 내부 검색 관련 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BusinessEntry[]>([]);

  // 클라이언트 ID 획득
  const clientId = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;

  // ESC 키로 모달 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // 네이버 지도 스크립트 로드
  useEffect(() => {
    if (!isOpen) return;

    if ((window as any).naver && (window as any).naver.maps) {
      setMapScriptLoaded(true);
      return;
    }

    if (!clientId) {
      setMapScriptError("네이버 지도 Client ID 환경변수(NEXT_PUBLIC_NAVER_MAP_CLIENT_ID)가 설정되지 않았습니다.");
      return;
    }

    const existingScript = document.getElementById("naver-map-script");
    if (existingScript) {
      // 이미 스크립트 엘리먼트는 생성되었으나 로드 대기 중인 상태일 수 있음
      const handleLoad = () => setMapScriptLoaded(true);
      existingScript.addEventListener("load", handleLoad);
      return () => existingScript.removeEventListener("load", handleLoad);
    }

    const script = document.createElement("script");
    script.id = "naver-map-script";
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${clientId}&submodules=geocoder`;
    script.async = true;
    script.onload = () => {
      setMapScriptLoaded(true);
    };
    script.onerror = () => {
      setMapScriptError("네이버 지도 API 스크립트를 로드하는 데 실패했습니다. 네트워크 상태 및 클라이언트 ID를 확인하세요.");
    };

    document.head.appendChild(script);
  }, [isOpen, clientId]);

  // 초기 선택 사업장들을 바탕으로 Geocoding API를 호출하여 데이터 채우기
  useEffect(() => {
    if (!isOpen) return;

    const loadInitialBusinesses = async () => {
      setGeocodingLoading(true);
      try {
        const response = await fetch("/api/businesses/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessIds: initialSelectedIds }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Geocoding 요청 실패");
        }

        const data = await response.json();
        const results: any[] = data.results || [];

        // 성공한 항목들과 실패한 항목 분류
        const successList: BusinessEntry[] = [];
        const failedList: BusinessEntry[] = [];

        results.forEach((res) => {
          // original business 데이터와 머지
          const original = allBusinesses.find((b) => String(b.id) === String(res.id));
          if (original) {
            const updatedBiz = {
              ...original,
              latitude: res.latitude,
              longitude: res.longitude,
              geocoding_status: res.geocoding_status,
              geocoding_error: res.geocoding_error,
              geocoded_address: res.geocoded_address,
              coordinate_locked: res.coordinate_locked,
            };

            if (res.geocoding_status === "SUCCESS" && res.latitude && res.longitude) {
              successList.push(updatedBiz);
            } else {
              failedList.push(updatedBiz);
            }
          }
        });

        setMapBusinesses(successList);
        setFailedBusinesses(failedList);
      } catch (error: any) {
        console.error("Geocoding 초기화 오류:", error);
        alert(`좌표를 조회하는 중 오류가 발생했습니다: ${error.message}`);
      } finally {
        setGeocodingLoading(false);
      }
    };

    loadInitialBusinesses();
  }, [isOpen, initialSelectedIds, allBusinesses]);

  // 지도 인스턴스 초기화 및 갱신
  useEffect(() => {
    if (!mapScriptLoaded || !mapContainerRef.current || !isOpen) return;

    const naverMaps = (window as any).naver?.maps;
    if (!naverMaps) {
      console.warn("Naver maps object is not ready yet.");
      return;
    }

    // 지도 객체가 없으면 새로 생성
    if (!mapRef.current) {
      mapRef.current = new naverMaps.Map(mapContainerRef.current, {
        center: new naverMaps.LatLng(37.5665, 126.9780), // 기본 서울 시청 좌표
        zoom: 13,
        zoomControl: true,
        zoomControlOptions: {
          position: naverMaps.Position.TOP_LEFT,
        },
      });

      infoWindowRef.current = new naverMaps.InfoWindow({
        content: "",
        borderWidth: 0,
        backgroundColor: "transparent",
        disableAnchor: true,
      });
    }

    const map = mapRef.current;

    // 기존 마커들 삭제
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    // 동일 좌표 묶기
    // 좌표 key: "lat,lng"
    const coordGroups = new Map<string, BusinessEntry[]>();
    mapBusinesses.forEach((biz) => {
      if (biz.latitude && biz.longitude) {
        // 소수점 6자리까지 문자열화하여 동일 좌표 여부 판단 (약 10cm 정밀도)
        const key = `${biz.latitude.toFixed(6)},${biz.longitude.toFixed(6)}`;
        const group = coordGroups.get(key) || [];
        group.push(biz);
        coordGroups.set(key, group);
      }
    });

    const bounds = new naverMaps.LatLngBounds();
    let validCoordsCount = 0;

    coordGroups.forEach((group, key) => {
      const [latStr, lngStr] = key.split(",");
      const lat = parseFloat(latStr);
      const lng = parseFloat(lngStr);
      const position = new naverMaps.LatLng(lat, lng);
      
      bounds.extend(position);
      validCoordsCount++;

      const isMulti = group.length > 1;

      // 마커 아이콘 커스텀
      // 다중 마커일 경우 갯수를 표시하는 뱃지 스타일 적용 (Premium Glassmorphism 느낌)
      const markerHtml = isMulti
        ? `<div class="relative flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 text-white font-bold text-xs shadow-lg border border-indigo-400 hover:scale-110 transition-transform duration-150">
            ${group.length}
            <span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></span>
           </div>`
        : `<div class="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white font-bold text-[10px] shadow-md border border-blue-400 hover:scale-110 transition-transform duration-150">
            📍
           </div>`;

      const marker = new naverMaps.Marker({
        position,
        map,
        icon: {
          content: markerHtml,
          anchor: new naverMaps.Point(14, 14),
        },
      });

      // 마커 클릭 시 정보창(InfoWindow) 렌더링
      naverMaps.Event.addListener(marker, "click", () => {
        const infoHtml = `
          <div class="bg-white/95 backdrop-blur-md p-4 rounded-xl shadow-2xl border border-slate-200/80 min-w-[280px] max-w-[340px] text-slate-800">
            <div class="flex justify-between items-center mb-2 pb-1.5 border-b border-slate-100">
              <span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                ${isMulti ? `동일 위치 사업장 (${group.length}개)` : "사업장 위치 정보"}
              </span>
            </div>
            <div class="space-y-3 max-h-[220px] overflow-y-auto pr-1">
              ${group
                .map(
                  (biz) => `
                <div class="text-xs">
                  <div class="font-bold text-sm text-slate-900 mb-0.5">${biz.business_name}</div>
                  <div class="text-slate-500 flex gap-2 mb-1">
                    <span>코드: ${biz.code}</span>
                    <span>상태: <span class="${biz.is_registered_text === '실시' ? 'text-green-600 font-semibold' : 'text-amber-600'}">${biz.is_registered_text || '미실시'}</span></span>
                  </div>
                  <div class="text-slate-600 bg-slate-50 p-1.5 rounded leading-relaxed break-all">${biz.address || "주소 없음"}</div>
                </div>
              `
                )
                .join('<div class="border-t border-slate-100 my-2"></div>')}
            </div>
            <div class="mt-3 text-[10px] text-slate-400 text-right">
              좌표: ${lat.toFixed(5)}, ${lng.toFixed(5)}
            </div>
          </div>
        `;

        infoWindowRef.current.setContent(infoHtml);
        infoWindowRef.current.open(map, marker);
      });

      markersRef.current.push(marker);
    });

    // 모든 마커가 보이도록 bounds 자동 조정 (최소 1개 이상일 때)
    if (validCoordsCount === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(15);
    } else if (validCoordsCount > 1) {
      map.fitBounds(bounds, {
        top: 40,
        right: 40,
        bottom: 40,
        left: 40,
      });
    }

    // 지도 컨테이너 크기 재계산 (로딩 오버레이 소멸 및 모달 애니메이션 대응)
    if (map && typeof window !== "undefined") {
      window.dispatchEvent(new Event("resize"));
    }

  }, [mapScriptLoaded, mapBusinesses, isOpen, geocodingLoading]);

  // 지도 범위 강제 재조정
  const handleRecenter = () => {
    if (!mapRef.current || mapBusinesses.length === 0) return;
    const naverMaps = (window as any).naver.maps;
    const bounds = new naverMaps.LatLngBounds();
    let validCount = 0;

    mapBusinesses.forEach((biz) => {
      if (biz.latitude && biz.longitude) {
        bounds.extend(new naverMaps.LatLng(biz.latitude, biz.longitude));
        validCount++;
      }
    });

    if (validCount === 1) {
      mapRef.current.setCenter(bounds.getCenter());
      mapRef.current.setZoom(15);
    } else if (validCount > 1) {
      mapRef.current.fitBounds(bounds, {
        top: 40,
        right: 40,
        bottom: 40,
        left: 40,
      });
    }
  };

  // 모달 내 사업장 검색 핸들러
  const handleSearch = () => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      setSearchResults([]);
      return;
    }

    // 사업장명, 코드, 주소 기준으로 전체 목록에서 검색 (대소문자 구분 및 공백 무시)
    const results = allBusinesses.filter((biz) => {
      const name = (biz.business_name || "").toLowerCase().replace(/\s+/g, "");
      const code = (biz.code || "").toLowerCase().replace(/\s+/g, "");
      const addr = (biz.address || "").toLowerCase().replace(/\s+/g, "");
      const cleanQuery = query.replace(/\s+/g, "");

      return name.includes(cleanQuery) || code.includes(cleanQuery) || addr.includes(cleanQuery);
    });

    setSearchResults(results.slice(0, 15)); // 최대 15개만 표출
  };

  // 사업장 지도 묶음에 추가
  const handleAddBusiness = async (biz: BusinessEntry) => {
    const totalCount = mapBusinesses.length + failedBusinesses.length;
    if (totalCount >= 10) {
      alert("지도에 표시할 사업장은 최대 10개까지 선택 가능합니다.");
      return;
    }

    // 중복 체크
    if (
      mapBusinesses.some((b) => String(b.id) === String(biz.id)) ||
      failedBusinesses.some((b) => String(b.id) === String(biz.id))
    ) {
      alert("이미 지도에 포함된 사업장입니다.");
      return;
    }

    setGeocodingLoading(true);
    try {
      const response = await fetch("/api/businesses/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessIds: [biz.id] }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Geocoding 요청 실패");
      }

      const data = await response.json();
      const res = data.results && data.results[0];

      if (res) {
        const updatedBiz = {
          ...biz,
          latitude: res.latitude,
          longitude: res.longitude,
          geocoding_status: res.geocoding_status,
          geocoding_error: res.geocoding_error,
          geocoded_address: res.geocoded_address,
          coordinate_locked: res.coordinate_locked,
        };

        if (res.geocoding_status === "SUCCESS" && res.latitude && res.longitude) {
          setMapBusinesses((prev) => [...prev, updatedBiz]);
          alert(`${biz.business_name}이(가) 지도에 추가되었습니다.`);
        } else {
          setFailedBusinesses((prev) => [...prev, updatedBiz]);
          alert(`${biz.business_name}의 좌표 변환에 실패하여 오류 목록에 추가되었습니다.`);
        }
      }
    } catch (error: any) {
      console.error("추가 중 좌표 조회 오류:", error);
      alert(`좌표 조회 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      setGeocodingLoading(false);
    }
  };

  // 사업장 제외
  const handleRemoveBusiness = (id: string | number, isFailed = false) => {
    if (isFailed) {
      setFailedBusinesses((prev) => prev.filter((b) => String(b.id) !== String(id)));
    } else {
      setMapBusinesses((prev) => prev.filter((b) => String(b.id) !== String(id)));
      if (infoWindowRef.current) infoWindowRef.current.close();
    }
  };

  if (!isOpen) return null;

  const totalCount = mapBusinesses.length + failedBusinesses.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
      {/* 모달 박스 */}
      <div 
        className="relative bg-slate-900 border border-slate-800 text-white rounded-2xl shadow-2xl flex flex-col overflow-hidden w-[95%] h-[90%] max-w-[1600px] max-h-[1000px] animate-scaleUp"
        role="dialog"
        aria-modal="true"
      >
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950/80 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-100">선택 사업장 위치 확인</h2>
            <span className="text-xs bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2.5 py-1 rounded-full font-semibold">
              현재 포함: {totalCount} / 10개
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleRecenter}
              disabled={mapBusinesses.length === 0}
              variant="secondary"
              className="h-9 px-3 text-xs bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
            >
              🎯 전체 위치 보기
            </Button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors focus:outline-none"
              aria-label="모달 닫기"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 모달 메인 본문 */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* 왼쪽: 네이버 지도 영역 */}
          <div className="flex-1 relative bg-slate-950 border-r border-slate-800">
            {mapScriptError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-red-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="font-semibold text-lg">지도 로드 실패</div>
                <div className="text-sm text-slate-400 mt-1 max-w-md">{mapScriptError}</div>
              </div>
            ) : !mapScriptLoaded || geocodingLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 z-10">
                <LoadingSpinner />
                <span className="mt-3 text-sm text-slate-400 animate-pulse">지도 및 좌표 정보를 불러오는 중...</span>
              </div>
            ) : null}

            {/* 실제 지도가 들어갈 컨테이너 */}
            <div ref={mapContainerRef} className="w-full h-full" />
          </div>

          {/* 오른쪽: 상세 패널 영역 */}
          <div className="w-full lg:w-[420px] bg-slate-900 flex flex-col overflow-hidden">
            {/* 1. 상단: 지도 포함 사업장 목록 */}
            <div className="flex-1 p-4 flex flex-col overflow-hidden">
              <h3 className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">지도 표시 사업장 ({mapBusinesses.length})</h3>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {mapBusinesses.length === 0 && !geocodingLoading ? (
                  <div className="h-20 flex items-center justify-center border border-dashed border-slate-800 rounded-xl text-xs text-slate-500">
                    지도에 표시할 사업장이 없습니다.
                  </div>
                ) : (
                  mapBusinesses.map((biz) => (
                    <div key={biz.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-start justify-between gap-3 hover:border-slate-700 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-slate-200 truncate">{biz.business_name}</div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-1">
                          <span>코드: {biz.code}</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                          <span className="text-green-400">위치 확인 완료</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1.5 break-all line-clamp-2 leading-relaxed" title={biz.address || ""}>
                          {biz.address || "주소 미등록"}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveBusiness(biz.id, false)}
                        className="p-1 text-slate-500 hover:text-red-400 rounded-md hover:bg-slate-800 transition-colors shrink-0"
                        title="제외"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 2. 중단: 지도 표시 실패 / 예외 항목 */}
            {failedBusinesses.length > 0 && (
              <div className="p-4 bg-slate-950/40 border-t border-slate-800 max-h-[160px] flex flex-col">
                <h3 className="text-xs font-bold text-red-400 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                  ⚠️ 지도 표시 실패 ({failedBusinesses.length})
                </h3>
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {failedBusinesses.map((biz) => (
                    <div key={biz.id} className="p-2 bg-red-950/20 border border-red-900/30 rounded-lg flex items-center justify-between text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-200 truncate">{biz.business_name}</div>
                        <div className="text-[10px] text-red-400 truncate mt-0.5">
                          {biz.geocoding_error || "주소 불명확 또는 API 에러"}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveBusiness(biz.id, true)}
                        className="text-slate-500 hover:text-red-400 p-1"
                        title="지우기"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. 하단: 사업장 추가 검색창 */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-col h-[280px]">
              <h3 className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">지도에 사업장 추가</h3>
              <div className="flex gap-2 mb-3">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="사업장명, 코드, 주소 검색"
                  className="bg-slate-900 border-slate-800 text-white placeholder:text-slate-500 text-sm h-9 flex-1"
                />
                <Button onClick={handleSearch} variant="primary" className="h-9 px-3 text-xs shrink-0">
                  검색
                </Button>
              </div>

              {/* 검색 결과 리스트 */}
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                {searchResults.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-600">
                    {searchQuery ? "검색 결과가 없습니다." : "추가할 업체를 검색하세요."}
                  </div>
                ) : (
                  searchResults.map((biz) => {
                    const isAdded =
                      mapBusinesses.some((b) => String(b.id) === String(biz.id)) ||
                      failedBusinesses.some((b) => String(b.id) === String(biz.id));
                    return (
                      <div key={biz.id} className="p-2 bg-slate-900 border border-slate-850 rounded-lg flex items-center justify-between gap-3 text-xs hover:border-slate-750">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-200 truncate">{biz.business_name}</div>
                          <div className="text-[10px] text-slate-500 truncate mt-0.5">
                            {biz.code} | {biz.address || "주소 없음"}
                          </div>
                        </div>
                        <Button
                          disabled={isAdded || totalCount >= 10}
                          onClick={() => handleAddBusiness(biz)}
                          variant="secondary"
                          className={`h-7 px-2 text-[10px] shrink-0 font-bold ${
                            isAdded
                              ? "bg-slate-850 text-slate-600 border-none cursor-default"
                              : "bg-indigo-600 hover:bg-indigo-500 text-white border-none"
                          }`}
                        >
                          {isAdded ? "추가됨" : "추가"}
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-850 flex justify-end gap-3">
          <Button
            onClick={onClose}
            variant="secondary"
            className="h-10 px-4 bg-slate-800 border-slate-700 text-white hover:bg-slate-700 text-sm font-medium rounded-xl"
          >
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
};
