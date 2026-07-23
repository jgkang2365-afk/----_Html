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
  const polylinesRef = useRef<any[]>([]);
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
  const [nearbyBusinesses, setNearbyBusinesses] = useState<Array<BusinessEntry & { distanceKm?: number }>>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [nearbyPage, setNearbyPage] = useState(0);
  const [nearbyTotal, setNearbyTotal] = useState(0);
  const [nearbyHasNext, setNearbyHasNext] = useState(false);

  // 최적 동선 계산 상태
  const [optimizing, setOptimizing] = useState(false);
  const [optimalRouteResult, setOptimalRouteResult] = useState<any | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  // 포함/제외 상태 관리 (제외된 사업장 ID 집합)
  const [excludedIds, setExcludedIds] = useState<Set<string | number>>(new Set());
  // 출발지 지정 사업장 ID
  const [selectedStartId, setSelectedStartId] = useState<string | number | null>(null);
  // 안내/알림 메시지 상태
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  // 제외된 사업장 목록 접기/펼치기 상태
  const [showExcludedAccordion, setShowExcludedAccordion] = useState(false);

  // 윈도우 전역 함수 연동용 Ref
  const selectStartHandlerRef = useRef<(id: string | number) => void>(() => {});

  // 파생 상태: 포함 사업장 / 제외 사업장
  const includedBusinesses = mapBusinesses.filter(
    (b) => !excludedIds.has(b.id) && !excludedIds.has(String(b.id)) && !excludedIds.has(Number(b.id))
  );

  const excludedBusinesses = mapBusinesses.filter(
    (b) => excludedIds.has(b.id) || excludedIds.has(String(b.id)) || excludedIds.has(Number(b.id))
  );

  // 출발지 선택 핸들러
  const handleSelectStartBusiness = (id: string | number) => {
    // 만약 제외 상태 사업장이면 포함으로 자동 전환
    if (excludedIds.has(id) || excludedIds.has(String(id)) || excludedIds.has(Number(id))) {
      setExcludedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        next.delete(String(id));
        next.delete(Number(id));
        return next;
      });
    }

    setSelectedStartId((prev) => (String(prev) === String(id) ? null : id));
    setOptimalRouteResult(null);
    setNoticeMessage(null);
  };

  // selectStartHandlerRef 갱신
  selectStartHandlerRef.current = handleSelectStartBusiness;

  // 전역 윈도우 함수 바인딩
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__closeMapInfoWindow = () => {
        if (infoWindowRef.current) infoWindowRef.current.close();
      };
      (window as any).__selectStartBusiness = (id: string | number) => {
        selectStartHandlerRef.current(id);
      };
    }
  }, []);

  // 사업장 단일 포함/제외 토글 핸들러
  const handleToggleExclude = (id: string | number) => {
    setOptimalRouteResult(null);
    setNoticeMessage(null);

    const isExcluded = excludedIds.has(id) || excludedIds.has(String(id)) || excludedIds.has(Number(id));

    if (isExcluded) {
      // 다시 포함
      setExcludedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        next.delete(String(id));
        next.delete(Number(id));
        return next;
      });
    } else {
      // 제외하기
      setExcludedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      // 만약 현재 출발지로 지정된 사업장을 제외하는 경우: 출발지 지정 해제 및 안내
      if (selectedStartId !== null && String(selectedStartId) === String(id)) {
        setSelectedStartId(null);
        setNoticeMessage("출발지가 제외되었습니다. 포함된 사업장 중 출발지를 다시 지정하세요.");
      }
    }
  };

  // 전체 포함 핸들러
  const handleSelectAll = () => {
    setExcludedIds(new Set());
    setOptimalRouteResult(null);
    setNoticeMessage(null);
  };

  // 전체 제외 핸들러
  const handleExcludeAll = () => {
    const allIds = new Set(mapBusinesses.map((b) => b.id));
    setExcludedIds(allIds);
    setSelectedStartId(null);
    setOptimalRouteResult(null);
    setNoticeMessage("모든 사업장이 제외되었습니다. 동선을 계산하려면 사업장을 포함하세요.");
  };

  // 클라이언트 ID 획득
  const clientId = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID?.trim();

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

    const targetSrc = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    const existingScript = document.getElementById("naver-map-script") as HTMLScriptElement | null;
    
    if (existingScript) {
      // 기존 스크립트가 신형 ncpKeyId를 사용하지 않거나 Client ID가 다르면 제거 후 다시 로드
      if (!existingScript.src.includes(`ncpKeyId=${encodeURIComponent(clientId)}`)) {
        existingScript.remove();
      } else {
        // 동일 스크립트가 로드되었거나 대기 중인 경우 바인딩
        if ((window as any).naver && (window as any).naver.maps) {
          setMapScriptLoaded(true);
        } else {
          const handleLoad = () => {
            if ((window as any).naver && (window as any).naver.maps) {
              setMapScriptLoaded(true);
            } else {
              setMapScriptError("네이버 지도 API 스크립트가 로드되었으나 maps 객체를 찾을 수 없습니다.");
            }
          };
          existingScript.addEventListener("load", handleLoad);
          return () => existingScript.removeEventListener("load", handleLoad);
        }
        return;
      }
    }

    const script = document.createElement("script");
    script.id = "naver-map-script";
    script.src = targetSrc;
    script.async = true;
    script.onload = () => {
      if ((window as any).naver && (window as any).naver.maps) {
        setMapScriptLoaded(true);
      } else {
        setMapScriptError("네이버 지도 API 스크립트가 정상 로드되었으나 maps 객체를 찾을 수 없습니다.");
      }
    };
    script.onerror = () => {
      const maskedId = clientId ? `${clientId.substring(0, 3)}***` : "null";
      console.error(`네이버 지도 로드 실패: 파라미터(ncpKeyId) 사용 중. ClientID: ${maskedId}`);
      setMapScriptError(`네이버 지도 API 스크립트를 로드하는 데 실패했습니다. 파라미터 ncpKeyId(키 앞부분: ${maskedId})를 사용 중입니다.`);
    };

    document.head.appendChild(script);
  }, [isOpen, clientId]);

  // 지도에서는 DB에 저장되어 전달된 좌표만 사용한다.
  useEffect(() => {
    if (!isOpen) return;
    const selected = initialSelectedIds
      .map((id) => allBusinesses.find((business) => String(business.id) === String(id)))
      .filter((business): business is BusinessEntry => Boolean(business));
    setMapBusinesses(selected.filter((business) => Boolean(business.latitude && business.longitude)));
    setFailedBusinesses(selected.filter((business) => !business.latitude || !business.longitude));
    setGeocodingLoading(false);
  }, [allBusinesses, initialSelectedIds, isOpen]);

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

    // 기존 마커 및 경로선(Polyline) 삭제
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    const bounds = new naverMaps.LatLngBounds();
    let validCoordsCount = 0;

    // 최적 동선 결과가 있는 경우: 1, 2, 3, 4 번호 마커 및 도로 경로선(Polyline) 렌더링
    if (optimalRouteResult && Array.isArray(optimalRouteResult.orderedBusinesses)) {
      const orderedBusinesses: BusinessEntry[] = optimalRouteResult.orderedBusinesses;

      // 1. 번호 마커 (1, 2, 3, 4...) 생성
      orderedBusinesses.forEach((biz, idx) => {
        if (!biz.latitude || !biz.longitude) return;
        const position = new naverMaps.LatLng(biz.latitude, biz.longitude);
        bounds.extend(position);
        validCoordsCount++;

        const orderNum = idx + 1;
        const isStart = idx === 0;

        const markerHtml = `
          <div class="relative flex items-center justify-center cursor-pointer group">
            <div class="absolute w-9 h-9 rounded-full ${isStart ? 'bg-amber-500/50' : 'bg-emerald-500/40'} animate-ping"></div>
            <div class="relative flex items-center justify-center w-8 h-8 rounded-full ${
              isStart
                ? 'bg-gradient-to-tr from-amber-600 via-orange-500 to-yellow-400'
                : 'bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-500'
            } text-white font-black text-sm shadow-xl border-2 border-white hover:scale-110 transition-transform duration-200">
              ${orderNum}
            </div>
          </div>
        `;

        const marker = new naverMaps.Marker({
          position,
          map,
          icon: {
            content: markerHtml,
            anchor: new naverMaps.Point(16, 16),
          },
        });

        // 전역 닫기 헬퍼 등록
        if (typeof window !== "undefined") {
          (window as any).__closeMapInfoWindow = () => {
            if (infoWindowRef.current) {
              infoWindowRef.current.close();
            }
          };
        }

        // 최적 동선 마커 클릭 시 정보창
        naverMaps.Event.addListener(marker, "click", () => {
          const infoHtml = `
            <div class="bg-white/95 backdrop-blur-md p-4 rounded-xl shadow-2xl border border-slate-200/80 min-w-[260px] text-slate-800 relative">
              <div class="flex justify-between items-center mb-2 pb-1.5 border-b border-slate-100">
                <span class="text-xs font-bold ${isStart ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50'} px-2.5 py-0.5 rounded-full">
                  ${isStart ? `출발지 (방문순서 1)` : `방문순서 ${orderNum}`}
                </span>
                <button
                  type="button"
                  onclick="window.__closeMapInfoWindow && window.__closeMapInfoWindow()"
                  class="w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors font-bold text-xs"
                >
                  ✕
                </button>
              </div>
              <div class="text-sm font-bold text-slate-900 mb-1">${biz.business_name}</div>
              <div class="text-xs text-slate-500 bg-slate-50 p-2 rounded leading-relaxed">${biz.address || "주소 미등록"}</div>
            </div>
          `;

          infoWindowRef.current.setContent(infoHtml);
          infoWindowRef.current.open(map, marker);
        });

        markersRef.current.push(marker);
      });

      // 2. 도로 경로선(Polyline) 렌더링
      if (Array.isArray(optimalRouteResult.segments)) {
        optimalRouteResult.segments.forEach((seg: any) => {
          if (Array.isArray(seg.path) && seg.path.length > 0) {
            const linePath = seg.path.map(
              (pt: { lat: number; lng: number }) => new naverMaps.LatLng(pt.lat, pt.lng)
            );

            linePath.forEach((pt: any) => bounds.extend(pt));

            const polyline = new naverMaps.Polyline({
              map,
              path: linePath,
              strokeColor: "#10B981", // 에메랄드 메인 경로선
              strokeOpacity: 0.85,
              strokeWeight: 6,
              strokeStyle: "solid",
              lineCap: "round",
              lineJoin: "round",
            });

            polylinesRef.current.push(polyline);
          }
        });
      }
    } else {
      // 일반 마커 표시 모드 (포함 사업장만, 동일 좌표 묶기)
      const coordGroups = new Map<string, BusinessEntry[]>();
      includedBusinesses.forEach((biz) => {
        if (biz.latitude && biz.longitude) {
          const key = `${biz.latitude.toFixed(6)},${biz.longitude.toFixed(6)}`;
          const group = coordGroups.get(key) || [];
          group.push(biz);
          coordGroups.set(key, group);
        }
      });

      coordGroups.forEach((group, key) => {
        const [latStr, lngStr] = key.split(",");
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);

        if (isNaN(lat) || isNaN(lng) || lat < 33 || lat > 39 || lng < 124 || lng > 132) {
          return;
        }

        const position = new naverMaps.LatLng(lat, lng);
        bounds.extend(position);
        validCoordsCount++;

        const isMulti = group.length > 1;
        const hasStart = group.some((biz) => String(biz.id) === String(selectedStartId));

        let markerHtml = "";
        if (hasStart) {
          markerHtml = `
            <div class="relative flex items-center justify-center cursor-pointer group">
              <div class="absolute w-9 h-9 rounded-full bg-amber-500/50 animate-ping"></div>
              <div class="relative flex items-center justify-center px-2 py-1 rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white font-black text-xs shadow-xl border-2 border-white hover:scale-110 transition-transform duration-200">
                🚩 출발 ${isMulti ? `(${group.length})` : ""}
              </div>
            </div>
          `;
        } else if (isMulti) {
          markerHtml = `
            <div class="relative flex items-center justify-center cursor-pointer group">
              <div class="absolute w-8 h-8 rounded-full bg-indigo-500/40 animate-ping"></div>
              <div class="relative flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white font-black text-xs shadow-md border-2 border-white hover:scale-110 transition-transform duration-200">
                ${group.length}
              </div>
             </div>
          `;
        } else {
          markerHtml = `
            <div class="relative flex items-center justify-center cursor-pointer group">
              <div class="absolute w-8 h-8 rounded-full bg-rose-500/45 animate-ping"></div>
              <div class="relative flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-tr from-rose-600 via-red-500 to-amber-400 text-white font-bold text-xs shadow-md border-2 border-white hover:scale-110 transition-transform duration-200">
                📍
              </div>
             </div>
          `;
        }

        const marker = new naverMaps.Marker({
          position,
          map,
          icon: {
            content: markerHtml,
            anchor: new naverMaps.Point(14, 14),
          },
        });

        if (typeof window !== "undefined") {
          (window as any).__closeMapInfoWindow = () => {
            if (infoWindowRef.current) {
              infoWindowRef.current.close();
            }
          };
        }

        naverMaps.Event.addListener(marker, "click", () => {
          const infoHtml = `
            <div class="bg-white/95 backdrop-blur-md p-4 rounded-xl shadow-2xl border border-slate-200/80 min-w-[280px] max-w-[340px] text-slate-800 relative">
              <div class="flex justify-between items-center mb-2 pb-1.5 border-b border-slate-100">
                <span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">
                  ${isMulti ? `동일 위치 사업장 (${group.length}개)` : "사업장 위치 정보"}
                </span>
                <button
                  type="button"
                  onclick="window.__closeMapInfoWindow && window.__closeMapInfoWindow()"
                  class="w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors font-bold text-xs"
                  title="닫기"
                >
                  ✕
                </button>
              </div>
              <div class="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                ${group
                  .map((biz) => {
                    const isSelectedStart = String(biz.id) === String(selectedStartId);
                    return `
                  <div class="text-xs">
                    <div class="flex items-center justify-between gap-1 mb-0.5">
                      <div class="font-bold text-sm text-slate-900 truncate">${biz.business_name}</div>
                      ${
                        isSelectedStart
                          ? `<span class="shrink-0 text-[10px] font-extrabold bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full">🚩 출발지</span>`
                          : ""
                      }
                    </div>
                    <div class="text-slate-500 flex gap-2 mb-1 text-[11px]">
                      <span>코드: ${biz.code}</span>
                      <span>상태: <span class="${biz.is_registered_text === "실시" ? "text-green-600 font-semibold" : "text-amber-600"}">${biz.is_registered_text || "미실시"}</span></span>
                    </div>
                    <div class="text-slate-600 bg-slate-50 p-1.5 rounded leading-relaxed break-all mb-2">${biz.address || "주소 없음"}</div>
                    <div class="flex justify-end">
                      <button
                        type="button"
                        onclick="window.__selectStartBusiness && window.__selectStartBusiness('${biz.id}'); window.__closeMapInfoWindow && window.__closeMapInfoWindow();"
                        class="px-2.5 py-1 text-[11px] font-bold rounded-lg ${
                          isSelectedStart
                            ? "bg-amber-500 text-white shadow"
                            : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200"
                        } transition-colors flex items-center gap-1"
                      >
                        ${isSelectedStart ? "🚩 출발지 지정 해제" : "🚩 출발지로 지정"}
                      </button>
                    </div>
                  </div>
                `;
                  })
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
    }

    // 지도 바탕 클릭 시 정보창 자동 닫기 이벤트
    naverMaps.Event.addListener(map, "click", () => {
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
      }
    });

    // 모든 마커가 보이도록 bounds 자동 조정
    if (validCoordsCount === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(15);
    } else if (validCoordsCount > 1) {
      map.fitBounds(bounds, {
        top: 50,
        right: 50,
        bottom: 50,
        left: 50,
      });
    }

    // 지도 컨테이너 크기 재계산 (로딩 오버레이 소멸 및 모달 애니메이션 대응)
    if (map && typeof window !== "undefined") {
      window.dispatchEvent(new Event("resize"));
    }

  }, [mapScriptLoaded, mapBusinesses, isOpen, geocodingLoading, optimalRouteResult]);

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

  // 사업장 지도 묶음에 추가: DB 좌표가 없으면 좌표 관리 대상으로만 표시한다.
  const handleAddBusiness = (biz: BusinessEntry) => {
    const totalCount = mapBusinesses.length + failedBusinesses.length;
    if (totalCount >= 10) {
      alert("지도에 표시할 사업장은 최대 10개까지 선택 가능합니다.");
      return;
    }
    if (
      mapBusinesses.some((business) => String(business.id) === String(biz.id)) ||
      failedBusinesses.some((business) => String(business.id) === String(biz.id))
    ) {
      alert("이미 지도에 포함된 사업장입니다.");
      return;
    }

    if (biz.latitude && biz.longitude) {
      setMapBusinesses((previous) => [...previous, biz]);
    } else {
      setFailedBusinesses((previous) => [...previous, biz]);
      alert(`${biz.business_name}은(는) 좌표 미등록 상태입니다. 좌표 관리에서 조회한 뒤 다시 열어주세요.`);
    }
  };

  const handleLoadNearbyBusinesses = async (baseBusiness: BusinessEntry, page = 0) => {
    if (!baseBusiness.latitude || !baseBusiness.longitude) {
      setNearbyError("기준 사업장의 저장 좌표가 없습니다.");
      return;
    }
    setNearbyLoading(true);
    setNearbyError(null);
    try {
      const params = new URLSearchParams({
        year: String(baseBusiness.year),
        period: baseBusiness.period,
        baseId: String(baseBusiness.id),
        page: String(page),
        includeScheduled: "false",
        excludeIds: mapBusinesses.map((business) => String(business.id)).join(","),
      });
      const response = await fetch(`/api/businesses/nearby?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "주변 업체를 조회하지 못했습니다.");

      const candidates = (payload.candidates || []).map((candidate: any) => ({
        ...candidate,
        business_number: null,
        isRegistered: false,
        is_registered_text: candidate.is_registered_text || "미실시",
      }));
      setNearbyBusinesses(candidates);
      setNearbyPage(payload.page || 0);
      setNearbyTotal(payload.total || 0);
      setNearbyHasNext(payload.hasNext === true);
      setSearchResults([]);
    } catch (error) {
      setNearbyBusinesses([]);
      setNearbyError(error instanceof Error ? error.message : "주변 업체 조회 중 오류가 발생했습니다.");
    } finally {
      setNearbyLoading(false);
    }
  };

  // 최적 동선 계산 요청
  const handleOptimizeRoute = async () => {
    // 1. 포함 사업장 최소 개수 검증
    if (includedBusinesses.length < 2) {
      alert("동선을 계산하려면 사업장을 2개 이상 포함하세요.");
      return;
    }

    // 2. 포함 사업장 최대 개수 검증 (최대 6개)
    if (includedBusinesses.length > 6) {
      alert("현재 최적 동선 계산은 최대 6개 사업장까지 지원합니다. 일부 사업장을 제외한 후 다시 계산하세요.");
      return;
    }

    // 3. 출발지 지정 여부 검증
    if (selectedStartId === null || !includedBusinesses.some((b) => String(b.id) === String(selectedStartId))) {
      alert("지도에서 출발 사업장을 먼저 선택하세요.");
      return;
    }

    // 4. 출발지 좌표 검증
    const startBiz = includedBusinesses.find((b) => String(b.id) === String(selectedStartId));
    if (!startBiz || !startBiz.latitude || !startBiz.longitude) {
      alert("지정된 출발 사업장의 유효한 좌표 정보가 없어 동선을 계산할 수 없습니다.");
      return;
    }

    // 5. 포함 사업장 중 좌표 유효성 필터링
    const invalidBusinesses = includedBusinesses.filter((b) => !b.latitude || !b.longitude);
    const validIncludedBusinesses = includedBusinesses.filter((b) => b.latitude && b.longitude);

    if (invalidBusinesses.length > 0) {
      const invalidNames = invalidBusinesses.map((b) => b.business_name).join(", ");
      alert(`좌표가 없는 사업장 (${invalidNames})은 동선 계산 대상에서 제외됩니다.`);
    }

    if (validIncludedBusinesses.length < 2) {
      alert("좌표가 유효한 포함 사업장이 2개 미만이어서 동선을 계산할 수 없습니다.");
      return;
    }

    setOptimizing(true);
    setRouteError(null);
    setNoticeMessage(null);

    try {
      const payload = validIncludedBusinesses.map((b) => ({
        id: b.id,
        business_name: b.business_name,
        latitude: b.latitude,
        longitude: b.longitude,
        address: b.address,
      }));

      const res = await fetch("/api/businesses/route-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businesses: payload,
          startBusinessId: selectedStartId,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const errMsg = data.error || "모든 방문 순서 후보에서 경로 계산에 실패했습니다.";
        setRouteError(errMsg);
        setOptimalRouteResult(null);
      } else {
        setOptimalRouteResult(data.optimalRoute);
        setRouteError(null);
      }
    } catch (error: any) {
      console.error("최적 동선 요청 오류:", error);
      setRouteError(error.message || "동선 계산 중 네트워크 오류가 발생했습니다.");
      setOptimalRouteResult(null);
    } finally {
      setOptimizing(false);
    }
  };

  // 최적 동선 초기화 (일반 지도 모드로 복귀)
  const handleResetRoute = () => {
    setOptimalRouteResult(null);
    setRouteError(null);
  };

  // 사업장 삭제 (선택 목록에서 완전히 제거)
  const handleRemoveBusiness = (id: string | number, isFailed = false) => {
    setOptimalRouteResult(null);
    setNoticeMessage(null);

    // 삭제 대상이 출발지면 지정 해제 및 안내
    if (selectedStartId !== null && String(selectedStartId) === String(id)) {
      setSelectedStartId(null);
      setNoticeMessage("출발지가 삭제되었습니다. 포함된 사업장 중 출발지를 다시 지정하세요.");
    }

    // 제외 목록에서도 해당 ID 정리
    setExcludedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      next.delete(String(id));
      next.delete(Number(id));
      return next;
    });

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
        {/* 알림 메시지 배너 */}
        {noticeMessage && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-6 py-2.5 text-xs text-amber-300 font-semibold flex items-center justify-between animate-fadeIn shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-base">🔔</span>
              <span>{noticeMessage}</span>
            </div>
            <button
              onClick={() => setNoticeMessage(null)}
              className="text-amber-400 hover:text-amber-200 text-xs font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950/80 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-100">선택 사업장 위치 확인 및 최적 동선</h2>
            <div className="flex items-center gap-1.5">
              <span className="text-xs bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2.5 py-1 rounded-full font-semibold">
                포함: {includedBusinesses.length} / 총 {mapBusinesses.length}개
              </span>
              {excludedBusinesses.length > 0 && (
                <span className="text-xs bg-slate-800 text-slate-400 border border-slate-700 px-2.5 py-1 rounded-full font-semibold">
                  제외: {excludedBusinesses.length}개
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleOptimizeRoute}
              disabled={includedBusinesses.length < 2 || optimizing}
              variant="primary"
              className="h-9 px-3.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold border-none shadow-md disabled:bg-slate-800 disabled:text-slate-500 transition-colors"
            >
              {optimizing ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  동선 계산 중...
                </span>
              ) : (
                "⚡ 최적 동선 계산"
              )}
            </Button>
            {optimalRouteResult && (
              <Button
                onClick={handleResetRoute}
                variant="secondary"
                className="h-9 px-3 text-xs bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              >
                🔄 동선 초기화
              </Button>
            )}
            <Button
              onClick={handleRecenter}
              disabled={includedBusinesses.length === 0}
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
            ) : !mapScriptLoaded || geocodingLoading || optimizing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 z-10">
                <LoadingSpinner />
                <span className="mt-3 text-sm text-slate-300 font-semibold animate-pulse">
                  {optimizing ? "승용차 기준 최적 동선을 계산하는 중..." : "지도 및 좌표 정보를 불러오는 중..."}
                </span>
              </div>
            ) : null}

            {/* 실제 지도가 들어갈 컨테이너 */}
            <div ref={mapContainerRef} className="w-full h-full" />
          </div>

          {/* 오른쪽: 상세 패널 영역 */}
          <div className="w-full lg:w-[440px] bg-slate-900 flex flex-col overflow-hidden border-l border-slate-800 shrink-0">
            {routeError && (
              <div className="p-4 bg-red-950/50 border-b border-red-800/60 text-red-300 text-xs flex items-start justify-between gap-2 animate-fadeIn shrink-0">
                <div>
                  <div className="font-bold flex items-center gap-1.5 mb-1 text-red-400 text-sm">
                    ⚠️ 최적 동선 계산 실패
                  </div>
                  <div>{routeError}</div>
                </div>
                <button
                  onClick={() => setRouteError(null)}
                  className="text-red-400 hover:text-white text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            {optimalRouteResult ? (
              /* 최적 동선 결과 표출 패널 */
              <div className="flex-1 flex flex-col p-5 overflow-y-auto custom-scrollbar bg-slate-900">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🗺️</span>
                    <h3 className="text-base font-bold text-white">추천 방문 동선 결과</h3>
                  </div>
                  <button
                    onClick={handleResetRoute}
                    className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors font-medium"
                  >
                    일반 목록 보기
                  </button>
                </div>

                {/* 개요 요약 (포함 / 제외 수) */}
                <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-950 p-2.5 rounded-lg border border-slate-800 mb-3">
                  <span>계산 포함: <strong className="text-emerald-400 font-bold">{includedBusinesses.length}개</strong></span>
                  <span>계산 제외: <strong className="text-slate-400 font-bold">{excludedBusinesses.length}개</strong></span>
                </div>

                {/* 1. 출발 사업장 정보 */}
                <div className="mb-4 p-3.5 bg-amber-950/30 border border-amber-500/40 rounded-xl">
                  <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <span>🚩 출발지 사업장</span>
                  </div>
                  <div className="font-bold text-sm text-slate-100">
                    1. {optimalRouteResult.orderedBusinesses[0]?.business_name}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 line-clamp-1">
                    {optimalRouteResult.orderedBusinesses[0]?.address || "주소 미등록"}
                  </div>
                </div>

                {/* 2. 각 구간 추천 방문 순서 및 이동거리/시간 */}
                <div className="flex-1 space-y-3 mb-4">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>추천 방문 순서 ({optimalRouteResult.segments.length}개 구간)</span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                      승용차 추천 경로
                    </span>
                  </div>

                  {optimalRouteResult.segments.map((seg: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl hover:border-emerald-500/50 transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs font-bold text-emerald-400 mb-1">
                        <span>{idx + 1}. {seg.fromName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-100 my-1 pl-2">
                        <span className="text-emerald-400 font-bold">→</span>
                        <span>{seg.toName}: {seg.formattedDistance} / {seg.formattedDuration}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 3. 전체 총 이동거리 및 총 이동시간 요약 카드 */}
                <div className="p-4 bg-gradient-to-br from-emerald-950/40 via-slate-950 to-teal-950/40 border border-emerald-500/40 rounded-xl shadow-xl mb-4">
                  <div className="text-xs font-bold text-emerald-400 mb-2 uppercase tracking-wider flex items-center justify-between">
                    <span>전체 경로 요약</span>
                    <span className="text-[10px] text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">
                      최단 이동시간 순
                    </span>
                  </div>
                  <div className="space-y-1.5 text-sm font-semibold">
                    <div className="flex justify-between items-center text-slate-200">
                      <span className="text-slate-400">총 이동거리:</span>
                      <span className="text-base font-bold text-emerald-400">
                        {optimalRouteResult.formattedTotalDistance}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-slate-200">
                      <span className="text-slate-400">총 이동시간:</span>
                      <span className="text-base font-bold text-teal-400">
                        {optimalRouteResult.formattedTotalDuration}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. 접을 수 있는 보조 영역: 제외된 사업장 목록 */}
                {excludedBusinesses.length > 0 && (
                  <div className="border border-slate-800 rounded-xl bg-slate-950/50 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowExcludedAccordion((prev) => !prev)}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-bold text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      <span>🚫 동선 계산 제외 사업장 ({excludedBusinesses.length}개)</span>
                      <span>{showExcludedAccordion ? "▲ 접기" : "▼ 펼치기"}</span>
                    </button>
                    {showExcludedAccordion && (
                      <div className="p-3 border-t border-slate-800/60 space-y-2 text-xs">
                        {excludedBusinesses.map((b) => (
                          <div key={b.id} className="p-2 bg-slate-900/60 rounded-lg flex items-center justify-between text-slate-400">
                            <div className="truncate min-w-0 pr-2">
                              <span className="font-semibold text-slate-300">{b.business_name}</span>
                              <span className="text-[10px] text-slate-500 ml-2">({b.code})</span>
                            </div>
                            <span className="text-[10px] text-slate-500 shrink-0">사용자 제외 설정</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* 일반 지도 사업장 목록 패널 */
              <>
                {/* 1. 상단: 지도 사업장 목록 */}
                <div className="flex-1 p-4 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800 shrink-0">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      지도 사업장 목록 ({mapBusinesses.length}개)
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleSelectAll}
                        className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded font-medium transition-colors"
                      >
                        전체 포함
                      </button>
                      <button
                        onClick={handleExcludeAll}
                        className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded font-medium transition-colors"
                      >
                        전체 제외
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
                    {mapBusinesses.length === 0 && !geocodingLoading ? (
                      <div className="h-20 flex items-center justify-center border border-dashed border-slate-800 rounded-xl text-xs text-slate-500">
                        지도에 표시할 사업장이 없습니다.
                      </div>
                    ) : (
                      mapBusinesses.map((biz, idx) => {
                        const isExcluded = excludedIds.has(biz.id) || excludedIds.has(String(biz.id)) || excludedIds.has(Number(biz.id));
                        const isStart = selectedStartId !== null && String(selectedStartId) === String(biz.id);

                        return (
                          <div
                            key={biz.id}
                            className={`p-3.5 rounded-xl border flex flex-col gap-2 transition-all ${
                              isExcluded
                                ? "bg-slate-950/40 border-slate-850/60 opacity-50 grayscale"
                                : isStart
                                ? "bg-amber-950/20 border-amber-500/50 shadow-md shadow-amber-950/30"
                                : "bg-slate-950 border-slate-800 hover:border-slate-700"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-sm text-slate-200 truncate">{biz.business_name}</span>
                                  {isStart && (
                                    <span className="text-[10px] font-extrabold bg-amber-500/20 text-amber-400 border border-amber-500/40 px-2 py-0.5 rounded-full shrink-0">
                                      🚩 출발지
                                    </span>
                                  )}
                                  {isExcluded && (
                                    <span className="text-[10px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full shrink-0">
                                      제외됨
                                    </span>
                                  )}
                                  {!isStart && !isExcluded && idx === 0 && selectedStartId === null && (
                                    <span className="text-[10px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded shrink-0">
                                      💡 출발지 후보
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-1">
                                  <span>코드: {biz.code}</span>
                                  <span className={`w-1.5 h-1.5 rounded-full ${isExcluded ? "bg-slate-600" : "bg-green-500"}`}></span>
                                  <span className={isExcluded ? "text-slate-500" : "text-green-400"}>
                                    {isExcluded ? "동선 계산 제외" : "위치 확인 완료"}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-500 mt-1 break-all line-clamp-2 leading-relaxed" title={biz.address || ""}>
                                  {biz.address || "주소 미등록"}
                                </div>
                              </div>

                              {/* 삭제 버튼 (목록에서 완전히 제거) */}
                              <button
                                onClick={() => handleRemoveBusiness(biz.id, false)}
                                className="p-1 text-slate-500 hover:text-red-400 rounded-md hover:bg-slate-800 transition-colors shrink-0"
                                title="삭제 (지도 선택 목록에서 제거)"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>

                            {/* 하단 조작 버튼 영역 */}
                            <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-850">
                              {!isExcluded && (
                                <button
                                  onClick={() => handleSelectStartBusiness(biz.id)}
                                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors flex items-center gap-1 ${
                                    isStart
                                      ? "bg-amber-500 text-white shadow hover:bg-amber-600"
                                      : "bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700"
                                  }`}
                                >
                                  {isStart ? "🚩 출발지 해제" : "🚩 출발지로 지정"}
                                </button>
                              )}
                              {isStart && !isExcluded && (
                                <button
                                  onClick={() => handleLoadNearbyBusinesses(biz, 0)}
                                  disabled={nearbyLoading}
                                  className="px-2.5 py-1 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white transition-colors"
                                >
                                  {nearbyLoading ? "조회 중..." : "주변 업체 조회"}
                                </button>
                              )}
                              <button
                                onClick={() => handleToggleExclude(biz.id)}
                                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                  isExcluded
                                    ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600/50"
                                    : "bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-750"
                                }`}
                              >
                                {isExcluded ? "다시 포함" : "동선에서 제외"}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 2. 중단: 지도 표시 실패 / 예외 항목 */}
                {failedBusinesses.length > 0 && (
                  <div className="p-4 bg-slate-950/40 border-t border-slate-800 max-h-[160px] flex flex-col shrink-0">
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
                <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-col h-[360px] shrink-0">
                  <div className="mb-3 rounded-lg border border-indigo-900/60 bg-indigo-950/20 p-2.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-bold text-indigo-300">
                        주변 미실시 업체 {nearbyTotal > 0 ? `(${nearbyTotal}개)` : ""}
                      </div>
                      {nearbyBusinesses.length > 0 && (
                        <button
                          onClick={() => {
                            setNearbyBusinesses([]);
                            setNearbyError(null);
                            setNearbyTotal(0);
                          }}
                          className="text-[10px] text-slate-500 hover:text-slate-300"
                        >
                          닫기
                        </button>
                      )}
                    </div>
                    {nearbyError && <div className="text-[11px] text-red-400">{nearbyError}</div>}
                    {!nearbyError && nearbyBusinesses.length === 0 && (
                      <div className="text-[11px] text-slate-500">
                        출발지를 지정한 뒤 ‘주변 업체 조회’를 누르세요.
                      </div>
                    )}
                    {nearbyBusinesses.length > 0 && (
                      <>
                        <div className="max-h-24 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                          {nearbyBusinesses.map((business) => {
                            const isAdded = mapBusinesses.some((item) => String(item.id) === String(business.id));
                            return (
                              <div key={business.id} className="flex items-center justify-between gap-2 rounded bg-slate-900 px-2 py-1.5 text-xs">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-semibold text-slate-200">{business.business_name}</div>
                                  <div className="text-[10px] text-indigo-300">
                                    {typeof business.distanceKm === "number" ? `${business.distanceKm.toFixed(1)}km` : "거리 확인 중"}
                                  </div>
                                </div>
                                <Button
                                  disabled={isAdded || totalCount >= 10}
                                  onClick={() => handleAddBusiness(business)}
                                  variant="secondary"
                                  className="h-6 px-2 text-[10px]"
                                >
                                  {isAdded ? "추가됨" : "추가"}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-2 flex items-center justify-center gap-2">
                          <button
                            disabled={nearbyPage === 0 || nearbyLoading}
                            onClick={() => {
                              const base = mapBusinesses.find((business) => String(business.id) === String(selectedStartId));
                              if (base) void handleLoadNearbyBusinesses(base, nearbyPage - 1);
                            }}
                            className="text-[10px] text-slate-400 disabled:text-slate-700"
                          >
                            이전
                          </button>
                          <span className="text-[10px] text-slate-500">{nearbyPage + 1}페이지</span>
                          <button
                            disabled={!nearbyHasNext || nearbyLoading}
                            onClick={() => {
                              const base = mapBusinesses.find((business) => String(business.id) === String(selectedStartId));
                              if (base) void handleLoadNearbyBusinesses(base, nearbyPage + 1);
                            }}
                            className="text-[10px] text-slate-400 disabled:text-slate-700"
                          >
                            다음
                          </button>
                        </div>
                      </>
                    )}
                  </div>

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
              </>
            )}
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-850 flex justify-end gap-3 shrink-0">
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
