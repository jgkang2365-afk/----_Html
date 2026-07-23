"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isMeasurementMapMessage,
  isValidKoreanCoordinate,
  LONG_SEGMENT_WARNING_MINUTES,
  MAX_OPTIMIZATION_BUSINESSES,
  MEASUREMENT_MAP_CHANNEL,
  MeasurementMapBusiness,
  MeasurementMapContext,
  MeasurementMapInitializePayload,
  MeasurementMapMessage,
  NEARBY_PAGE_SIZE,
  toMeasurementMapBusiness,
} from "@/lib/measurement-map/types";

interface RouteSegment {
  fromName: string;
  toName: string;
  distance: number;
  duration: number;
  formattedDistance: string;
  formattedDuration: string;
  path: { lat: number; lng: number }[];
  isLongSegment?: boolean;
}

interface RouteResult {
  totalDistance: number;
  totalDuration: number;
  formattedTotalDistance: string;
  formattedTotalDuration: string;
  orderedBusinesses: MeasurementMapBusiness[];
  segments: RouteSegment[];
}

interface NearbyResponse {
  candidates: MeasurementMapBusiness[];
  page: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

interface Notice {
  text: string;
  undo?: () => void;
}

const RECENT_STORAGE_KEY = "measurement-map-recent-v1";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function encodeInlineArgument(value: string | number) {
  return escapeHtml(JSON.stringify(String(value)));
}

function idMatches(first: string | number | null, second: string | number | null) {
  return first !== null && second !== null && String(first) === String(second);
}

function uniqueBusinesses(businesses: MeasurementMapBusiness[]) {
  const result = new Map<string, MeasurementMapBusiness>();
  businesses.forEach((business) => result.set(String(business.id), business));
  return Array.from(result.values());
}

export function MeasurementMapViewer() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylinesRef = useRef<any[]>([]);
  const infoWindowRef = useRef<any>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const routeRequestIdRef = useRef(0);
  const messageHandlerRef = useRef<(message: unknown) => void>(() => undefined);

  const [connected, setConnected] = useState(false);
  const [context, setContext] = useState<MeasurementMapContext | null>(null);
  const [businesses, setBusinesses] = useState<MeasurementMapBusiness[]>([]);
  const [baseBusinessId, setBaseBusinessId] = useState<string | number | null>(null);
  const [startBusinessId, setStartBusinessId] = useState<string | number | null>(null);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<MeasurementMapBusiness[]>([]);
  const [candidatePage, setCandidatePage] = useState(0);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [includeScheduled, setIncludeScheduled] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const includedBusinesses = useMemo(
    () => businesses.filter((business) => !excludedIds.has(String(business.id))),
    [businesses, excludedIds],
  );
  const excludedBusinesses = useMemo(
    () => businesses.filter((business) => excludedIds.has(String(business.id))),
    [businesses, excludedIds],
  );
  const baseBusiness = useMemo(
    () => businesses.find((business) => idMatches(business.id, baseBusinessId)) || null,
    [baseBusinessId, businesses],
  );

  const invalidateRoute = useCallback(() => {
    routeAbortRef.current?.abort();
    routeRequestIdRef.current += 1;
    setOptimizing(false);
    setRouteResult(null);
    setRouteError(null);
  }, []);

  const publishState = useCallback(
    (nextBusinesses = businesses) => {
      if (!context) return;
      const payload: MeasurementMapInitializePayload = {
        context,
        businesses: nextBusinesses.map((business) => ({
          ...business,
          included: !excludedIds.has(String(business.id)),
        })),
        baseBusinessId,
      };
      channelRef.current?.postMessage({ type: "VIEWER_STATE", payload } satisfies MeasurementMapMessage);
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "VIEWER_STATE", payload }, window.location.origin);
      }
    },
    [baseBusinessId, businesses, context, excludedIds],
  );

  const applyInitialize = useCallback(
    (payload: MeasurementMapInitializePayload) => {
      const nextBusinesses = uniqueBusinesses(
        payload.businesses.map(toMeasurementMapBusiness).filter(Boolean) as MeasurementMapBusiness[],
      );
      if (!Number.isInteger(payload.context?.year) || typeof payload.context?.period !== "string") {
        return;
      }
      invalidateRoute();
      setContext(payload.context);
      setBusinesses(nextBusinesses);
      setExcludedIds(
        new Set(
          nextBusinesses
            .filter((business) => business.included === false)
            .map((business) => String(business.id)),
        ),
      );
      setBaseBusinessId(
        nextBusinesses.some((business) => idMatches(business.id, payload.baseBusinessId))
          ? payload.baseBusinessId
          : nextBusinesses[0]?.id ?? null,
      );
      setStartBusinessId(null);
      setCandidates([]);
      setCandidatePage(0);
      setCandidateTotal(0);
      setCandidateError(null);
      setConnected(true);
      setNotice(null);
    },
    [invalidateRoute],
  );

  const resetMap = useCallback(() => {
    invalidateRoute();
    setBusinesses([]);
    setBaseBusinessId(null);
    setStartBusinessId(null);
    setExcludedIds(new Set());
    setCandidates([]);
    setCandidatePage(0);
    setCandidateTotal(0);
    setCandidateError(null);
    setNotice({ text: "메인 화면에서 기준 사업장을 선택하세요." });
  }, [invalidateRoute]);

  const handleMessage = useCallback(
    (rawMessage: unknown) => {
      if (!isMeasurementMapMessage(rawMessage)) return;
      const message = rawMessage;
      switch (message.type) {
        case "MAP_INITIALIZE":
          applyInitialize(message.payload);
          break;
        case "SET_CONTEXT":
          if (Number.isInteger(message.payload.year) && message.payload.period) {
            invalidateRoute();
            setContext(message.payload);
            setCandidatePage(0);
            setCandidates([]);
          }
          break;
        case "SET_BASE_BUSINESS":
          invalidateRoute();
          setBaseBusinessId(message.payload.businessId);
          setCandidatePage(0);
          break;
        case "ADD_BUSINESS": {
          const business = toMeasurementMapBusiness(message.payload.business);
          if (business) {
            invalidateRoute();
            setBusinesses((current) => uniqueBusinesses([...current, business]));
          }
          break;
        }
        case "REMOVE_BUSINESS":
          invalidateRoute();
          setBusinesses((current) =>
            current.filter((business) => !idMatches(business.id, message.payload.businessId)),
          );
          break;
        case "REFRESH_BUSINESS": {
          const refreshed = toMeasurementMapBusiness(message.payload.business);
          if (refreshed) {
            invalidateRoute();
            setBusinesses((current) =>
              current.map((business) =>
                idMatches(business.id, refreshed.id) ? refreshed : business,
              ),
            );
          }
          break;
        }
        case "RESET_MAP":
          resetMap();
          break;
        case "REQUEST_CURRENT_STATE":
          publishState();
          break;
        case "VIEWER_READY":
        case "VIEWER_STATE":
          break;
      }
    },
    [applyInitialize, invalidateRoute, publishState, resetMap],
  );

  messageHandlerRef.current = handleMessage;

  useEffect(() => {
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(MEASUREMENT_MAP_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = (event) => messageHandlerRef.current(event.data);
      channel.postMessage({ type: "VIEWER_READY" } satisfies MeasurementMapMessage);
    }

    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      messageHandlerRef.current(event.data);
    };
    window.addEventListener("message", onWindowMessage);

    if (window.opener && !window.opener.closed) {
      setConnected(true);
      window.opener.postMessage({ type: "VIEWER_READY" }, window.location.origin);
    }

    const connectionTimer = window.setInterval(() => {
      if (window.opener && window.opener.closed) setConnected(false);
    }, 2000);

    return () => {
      channelRef.current?.close();
      channelRef.current = null;
      window.removeEventListener("message", onWindowMessage);
      window.clearInterval(connectionTimer);
      routeAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID?.trim();
    if ((window as any).naver?.maps) {
      setMapReady(true);
      return;
    }
    if (!clientId) {
      setMapError("네이버 지도 Client ID 환경변수가 설정되지 않았습니다.");
      return;
    }
    const existing = document.getElementById("naver-map-viewer-script") as HTMLScriptElement | null;
    const script = existing || document.createElement("script");
    script.id = "naver-map-viewer-script";
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    script.async = true;
    const onLoad = () => setMapReady(Boolean((window as any).naver?.maps));
    const onError = () => setMapError("네이버 지도를 불러오지 못했습니다.");
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (!existing) document.head.appendChild(script);
    return () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    if (!baseBusiness || !context || !isValidKoreanCoordinate(baseBusiness.latitude, baseBusiness.longitude)) {
      setCandidates([]);
      setCandidateTotal(0);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      year: String(context.year),
      period: context.period,
      baseId: String(baseBusiness.id),
      page: String(candidatePage),
      includeScheduled: String(includeScheduled),
      excludeIds: businesses.map((business) => String(business.id)).join(","),
    });
    setCandidateLoading(true);
    setCandidateError(null);
    fetch(`/api/businesses/nearby?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as NearbyResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || "주변 사업장을 조회하지 못했습니다.");
        setCandidates(
          (data.candidates || []).map(toMeasurementMapBusiness).filter(Boolean) as MeasurementMapBusiness[],
        );
        setCandidateTotal(data.total || 0);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCandidates([]);
        setCandidateTotal(0);
        setCandidateError(error instanceof Error ? error.message : "주변 사업장 조회 오류");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCandidateLoading(false);
      });
    return () => controller.abort();
  }, [baseBusiness, businesses, candidatePage, context, includeScheduled]);

  const addCandidate = useCallback(
    (id: string | number) => {
      const candidate = candidates.find((item) => idMatches(item.id, id));
      if (!candidate) return;
      invalidateRoute();
      setBusinesses((current) => uniqueBusinesses([...current, { ...candidate, included: true }]));
      setCandidates((current) => current.filter((item) => !idMatches(item.id, id)));
      setCandidateTotal((current) => Math.max(0, current - 1));
      infoWindowRef.current?.close();
      setNotice({ text: `${candidate.business_name}을(를) 동선에 추가했습니다.` });
    },
    [candidates, invalidateRoute],
  );

  const chooseBase = useCallback(
    (id: string | number) => {
      if (idMatches(id, baseBusinessId)) return;
      invalidateRoute();
      setBaseBusinessId(id);
      setCandidatePage(0);
      setCandidates([]);
      setNotice({ text: "기준 사업장이 변경되어 기존 동선 결과를 초기화했습니다." });
      infoWindowRef.current?.close();
    },
    [baseBusinessId, invalidateRoute],
  );

  const chooseStart = useCallback(
    (id: string | number) => {
      if (excludedIds.has(String(id))) return;
      const previousStart = startBusinessId;
      invalidateRoute();
      setStartBusinessId(idMatches(id, startBusinessId) ? null : id);
      if (idMatches(id, startBusinessId)) {
        setNotice({
          text: "출발지 지정을 해제했습니다.",
          undo: () => setStartBusinessId(previousStart),
        });
      }
      infoWindowRef.current?.close();
    },
    [excludedIds, invalidateRoute, startBusinessId],
  );

  useEffect(() => {
    (window as any).__measurementMapAddCandidate = addCandidate;
    (window as any).__measurementMapChooseBase = chooseBase;
    (window as any).__measurementMapChooseStart = chooseStart;
    (window as any).__measurementMapCloseInfo = () => infoWindowRef.current?.close();
    return () => {
      delete (window as any).__measurementMapAddCandidate;
      delete (window as any).__measurementMapChooseBase;
      delete (window as any).__measurementMapChooseStart;
      delete (window as any).__measurementMapCloseInfo;
    };
  }, [addCandidate, chooseBase, chooseStart]);

  useEffect(() => {
    if (!mapReady || !mapContainerRef.current) return;
    const naverMaps = (window as any).naver?.maps;
    if (!naverMaps) return;
    if (!mapRef.current) {
      mapRef.current = new naverMaps.Map(mapContainerRef.current, {
        center: new naverMaps.LatLng(36.5, 127.8),
        zoom: 8,
        zoomControl: true,
        zoomControlOptions: { position: naverMaps.Position.TOP_LEFT },
      });
      infoWindowRef.current = new naverMaps.InfoWindow({
        content: "",
        borderWidth: 0,
        backgroundColor: "transparent",
        disableAnchor: true,
      });
    }

    const map = mapRef.current;
    markersRef.current.forEach((marker) => marker.setMap(null));
    polylinesRef.current.forEach((polyline) => polyline.setMap(null));
    markersRef.current = [];
    polylinesRef.current = [];
    const bounds = new naverMaps.LatLngBounds();
    let coordinateCount = 0;

    const addMarker = (
      business: MeasurementMapBusiness,
      content: string,
      infoContent: string,
    ) => {
      if (!isValidKoreanCoordinate(business.latitude, business.longitude)) return;
      const position = new naverMaps.LatLng(business.latitude, business.longitude);
      const marker = new naverMaps.Marker({
        map,
        position,
        icon: { content, anchor: new naverMaps.Point(17, 17) },
      });
      naverMaps.Event.addListener(marker, "click", () => {
        infoWindowRef.current.setContent(infoContent);
        infoWindowRef.current.open(map, marker);
      });
      bounds.extend(position);
      coordinateCount += 1;
      markersRef.current.push(marker);
    };

    if (routeResult) {
      routeResult.orderedBusinesses.forEach((business, index) => {
        const isStart = index === 0;
        addMarker(
          business,
          `<div style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${isStart ? "#d97706" : "#059669"};border:3px solid white;color:white;font-weight:800;box-shadow:0 3px 10px #0006">${index + 1}</div>`,
          `<div style="background:white;padding:12px;border-radius:10px;min-width:220px;box-shadow:0 8px 24px #0003;color:#0f172a"><b>${escapeHtml(business.business_name)}</b><div style="font-size:12px;color:#64748b;margin-top:5px">${escapeHtml(business.address || "주소 미등록")}</div></div>`,
        );
      });
      routeResult.segments.forEach((segment) => {
        if (!segment.path?.length) return;
        const path = segment.path.map((point) => new naverMaps.LatLng(point.lat, point.lng));
        path.forEach((point) => bounds.extend(point));
        polylinesRef.current.push(
          new naverMaps.Polyline({
            map,
            path,
            strokeColor: "#10b981",
            strokeOpacity: 0.9,
            strokeWeight: 6,
          }),
        );
      });
    } else {
      includedBusinesses.forEach((business) => {
        const isBase = idMatches(business.id, baseBusinessId);
        const isStart = idMatches(business.id, startBusinessId);
        const color = isStart ? "#d97706" : isBase ? "#0284c7" : "#e11d48";
        const label = isStart ? "S" : isBase ? "기준" : "●";
        addMarker(
          business,
          `<div style="min-width:34px;height:34px;padding:0 7px;border-radius:18px;display:flex;align-items:center;justify-content:center;background:${color};border:3px solid white;color:white;font-size:${isBase ? "10px" : "14px"};font-weight:800;box-shadow:0 3px 10px #0006">${label}</div>`,
          `<div style="background:white;padding:13px;border-radius:10px;min-width:260px;box-shadow:0 8px 24px #0003;color:#0f172a"><div style="font-size:11px;color:#64748b">${escapeHtml(business.code)}</div><b>${escapeHtml(business.business_name)}</b><div style="font-size:12px;color:#64748b;margin:5px 0 10px">${escapeHtml(business.address || "주소 미등록")}</div><div style="display:flex;gap:6px"><button onclick="window.__measurementMapChooseStart(${encodeInlineArgument(business.id)})" style="padding:6px 8px;border:0;border-radius:6px;background:#d97706;color:white;cursor:pointer">출발지로 지정</button><button onclick="window.__measurementMapChooseBase(${encodeInlineArgument(business.id)})" style="padding:6px 8px;border:0;border-radius:6px;background:#0284c7;color:white;cursor:pointer">주변 업체 찾기</button></div></div>`,
        );
      });
      candidates.forEach((business) => {
        const scheduled = Boolean(business.measurement_date);
        addMarker(
          business,
          `<div style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${scheduled ? "#a78bfa" : "#7c3aed"};opacity:${scheduled ? 0.72 : 1};border:3px solid white;color:white;font-weight:800;box-shadow:0 3px 10px #0005">◆</div>`,
          `<div style="background:white;padding:13px;border-radius:10px;min-width:260px;box-shadow:0 8px 24px #0003;color:#0f172a"><div style="font-size:11px;color:#7c3aed">${escapeHtml(business.code)}</div><b>${escapeHtml(business.business_name)}</b><div style="font-size:12px;color:#64748b;margin-top:5px">${escapeHtml(business.address || "주소 미등록")}</div><div style="font-size:12px;color:#7c3aed;margin:6px 0">기준점에서 약 ${business.distanceKm?.toFixed(1) ?? "-"}km${scheduled ? ` · 다른 일정 예정: ${escapeHtml(business.measurement_date)}` : ""}</div><button onclick="window.__measurementMapAddCandidate(${encodeInlineArgument(business.id)})" style="padding:6px 9px;border:0;border-radius:6px;background:#7c3aed;color:white;cursor:pointer">동선에 추가</button></div>`,
        );
      });
    }

    naverMaps.Event.addListener(map, "click", () => infoWindowRef.current?.close());
    if (coordinateCount === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(15);
    } else if (coordinateCount > 1) {
      map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
    }
    window.dispatchEvent(new Event("resize"));
  }, [
    baseBusinessId,
    candidates,
    includedBusinesses,
    mapReady,
    routeResult,
    startBusinessId,
  ]);

  useEffect(() => {
    if (!context || businesses.length === 0) return;
    const recent = {
      context,
      businesses: businesses.map((business) => ({
        ...business,
        included: !excludedIds.has(String(business.id)),
      })),
      baseBusinessId,
      startBusinessId,
      savedAt: Date.now(),
    };
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recent));
    publishState();
  }, [baseBusinessId, businesses, context, excludedIds, publishState, startBusinessId]);

  const restoreRecent = () => {
    try {
      const raw = localStorage.getItem(RECENT_STORAGE_KEY);
      if (!raw) return;
      const recent = JSON.parse(raw);
      applyInitialize(recent);
      const restoredBusinesses = (recent.businesses || [])
        .map(toMeasurementMapBusiness)
        .filter(Boolean) as MeasurementMapBusiness[];
      const restoredStart = restoredBusinesses.find((business) =>
        idMatches(business.id, recent.startBusinessId),
      );
      if (
        restoredStart &&
        restoredStart.included !== false
      ) {
        setStartBusinessId(recent.startBusinessId);
      }
      setNotice({ text: "최근 검토 조합을 복원했습니다. 경로는 다시 계산해 주세요." });
    } catch {
      localStorage.removeItem(RECENT_STORAGE_KEY);
      setNotice({ text: "최근 검토 조합을 복원하지 못했습니다." });
    }
  };

  const toggleExcluded = (business: MeasurementMapBusiness) => {
    const id = String(business.id);
    const wasExcluded = excludedIds.has(id);
    const wasStart = idMatches(business.id, startBusinessId);
    invalidateRoute();
    setExcludedIds((current) => {
      const next = new Set(current);
      if (wasExcluded) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!wasExcluded && wasStart) {
      setStartBusinessId(null);
      setNotice({
        text: "출발지가 제외되었습니다. 포함된 사업장 중 출발지를 다시 지정하세요.",
        undo: () => {
          setExcludedIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
          setStartBusinessId(business.id);
        },
      });
    } else if (!wasExcluded) {
      setNotice({
        text: `${business.business_name}을(를) 동선에서 제외했습니다.`,
        undo: () =>
          setExcludedIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          }),
      });
    }
  };

  const removeBusiness = (business: MeasurementMapBusiness) => {
    const index = businesses.findIndex((item) => idMatches(item.id, business.id));
    const wasExcluded = excludedIds.has(String(business.id));
    const wasStart = idMatches(business.id, startBusinessId);
    const wasBase = idMatches(business.id, baseBusinessId);
    invalidateRoute();
    setBusinesses((current) => current.filter((item) => !idMatches(item.id, business.id)));
    setExcludedIds((current) => {
      const next = new Set(current);
      next.delete(String(business.id));
      return next;
    });
    if (wasStart) setStartBusinessId(null);
    if (wasBase) {
      setBaseBusinessId(null);
      setCandidates([]);
    }
    setNotice({
      text: `${business.business_name}을(를) 목록에서 삭제했습니다.`,
      undo: () => {
        setBusinesses((current) => {
          const next = [...current];
          next.splice(Math.max(0, index), 0, business);
          return uniqueBusinesses(next);
        });
        if (wasExcluded) setExcludedIds((current) => new Set(current).add(String(business.id)));
        if (wasStart) setStartBusinessId(business.id);
        if (wasBase) setBaseBusinessId(business.id);
      },
    });
  };

  const calculateRoute = async () => {
    const validBusinesses = includedBusinesses.filter((business) =>
      isValidKoreanCoordinate(business.latitude, business.longitude),
    );
    const invalidBusinesses = includedBusinesses.filter(
      (business) => !isValidKoreanCoordinate(business.latitude, business.longitude),
    );
    if (includedBusinesses.length > MAX_OPTIMIZATION_BUSINESSES) {
      setRouteError(
        "현재 최적 동선 계산은 최대 6개 사업장까지 지원합니다. 일부 사업장을 동선에서 제외한 후 다시 계산하세요.",
      );
      return;
    }
    if (validBusinesses.length < 2) {
      setRouteError("동선을 계산하려면 좌표가 유효한 사업장을 2개 이상 포함하세요.");
      return;
    }
    if (!startBusinessId || !validBusinesses.some((business) => idMatches(business.id, startBusinessId))) {
      setRouteError("지도에서 출발 사업장을 먼저 선택하세요.");
      return;
    }
    if (invalidBusinesses.length) {
      setNotice({
        text: `좌표 미등록으로 계산에서 제외: ${invalidBusinesses.map((item) => item.business_name).join(", ")}`,
      });
    }

    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    const requestId = ++routeRequestIdRef.current;
    setOptimizing(true);
    setRouteError(null);
    setRouteResult(null);
    try {
      const response = await fetch("/api/businesses/route-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          businesses: validBusinesses,
          startBusinessId,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "선택한 사업장의 자동차 경로를 계산하지 못했습니다.");
      }
      if (requestId !== routeRequestIdRef.current) return;
      setRouteResult(data.optimalRoute);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestId !== routeRequestIdRef.current) return;
      setRouteError(
        error instanceof Error
          ? error.message
          : "선택한 사업장의 자동차 경로를 계산하지 못했습니다.",
      );
    } finally {
      if (requestId === routeRequestIdRef.current) setOptimizing(false);
    }
  };

  const statusText = context ? `${context.year}년 ${context.period}` : "미연결";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/95 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">측정계획 지도 · 최적 동선</h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span>측정연도·주기: {statusText}</span>
              <span>기준: {baseBusiness ? `${baseBusiness.code} · ${baseBusiness.business_name}` : "미지정"}</span>
              <span>주변 후보: {candidateTotal}개</span>
              <span>동선 포함: {includedBusinesses.length}개</span>
              <span>동선 제외: {excludedBusinesses.length}개</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2.5 py-1 font-semibold ${
                connected ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {connected ? "메인 화면 연결됨" : "메인 화면과 연결이 끊겼습니다."}
            </span>
            <button
              type="button"
              onClick={restoreRecent}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 hover:bg-slate-700"
            >
              최근 검토 복원
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div className="flex items-center justify-between gap-3 border-b border-sky-900/50 bg-sky-950/40 px-5 py-2 text-sm text-sky-200">
          <span>{notice.text}</span>
          <div className="flex gap-2">
            {notice.undo && (
              <button
                type="button"
                onClick={() => {
                  notice.undo?.();
                  invalidateRoute();
                  setNotice(null);
                }}
                className="font-bold underline"
              >
                되돌리기
              </button>
            )}
            <button type="button" onClick={() => setNotice(null)} aria-label="안내 닫기">
              ✕
            </button>
          </div>
        </div>
      )}

      {!context && (
        <section className="mx-auto mt-16 max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <div className="text-lg font-bold">메인 화면과 연결되지 않았습니다.</div>
          <p className="mt-2 text-sm text-slate-400">
            측정대상사업장 관리 화면에서 지도를 다시 열어주세요. 최근 조합이 있다면 상단의
            ‘최근 검토 복원’을 사용할 수 있습니다.
          </p>
        </section>
      )}

      {context && (
        <div className="grid h-[calc(100vh-76px)] min-h-[650px] grid-cols-[minmax(0,1fr)_430px]">
          <section className="relative border-r border-slate-800">
            <div ref={mapContainerRef} className="h-full w-full bg-slate-900" />
            {mapError && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 p-6 text-center text-red-300">
                {mapError}
              </div>
            )}
            {!mapError && !mapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm text-slate-300">
                네이버 지도를 불러오는 중...
              </div>
            )}
          </section>

          <aside className="flex min-h-0 flex-col bg-slate-900">
            <div className="border-b border-slate-800 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold">선택 사업장</h2>
                <div className="flex gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      invalidateRoute();
                      setExcludedIds(new Set());
                    }}
                    className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
                  >
                    전체 포함
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      invalidateRoute();
                      setExcludedIds(new Set(businesses.map((item) => String(item.id))));
                      setStartBusinessId(null);
                      setNotice({ text: "모든 사업장을 제외했습니다. 출발지도 해제되었습니다." });
                    }}
                    className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
                  >
                    전체 제외
                  </button>
                </div>
              </div>
              <div className="mt-3 max-h-[220px] space-y-2 overflow-y-auto pr-1">
                {businesses.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 p-5 text-center text-xs text-slate-500">
                    메인 화면에서 기준 사업장을 선택하세요.
                  </div>
                ) : (
                  businesses.map((business) => {
                    const excluded = excludedIds.has(String(business.id));
                    const isStart = idMatches(business.id, startBusinessId);
                    const isBase = idMatches(business.id, baseBusinessId);
                    return (
                      <article
                        key={business.id}
                        className={`rounded-xl border p-3 ${
                          excluded
                            ? "border-slate-800 bg-slate-950/40 opacity-50"
                            : "border-slate-700 bg-slate-950"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-500">{business.code}</div>
                            <div className="truncate text-sm font-bold">{business.business_name}</div>
                            <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                              {business.address || "주소 미등록"}
                            </div>
                            <div className="mt-1 flex gap-1">
                              {isBase && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">기준점</span>}
                              {isStart && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">출발지</span>}
                              {excluded && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px]">제외됨</span>}
                              {!isValidKoreanCoordinate(business.latitude, business.longitude) && (
                                <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">좌표 미등록</span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeBusiness(business)}
                            className="text-slate-500 hover:text-red-400"
                            title="선택 목록에서 삭제"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap justify-end gap-1.5 border-t border-slate-800 pt-2 text-[11px]">
                          {!excluded && (
                            <>
                              <button
                                type="button"
                                onClick={() => chooseBase(business.id)}
                                className="rounded bg-sky-700 px-2 py-1 hover:bg-sky-600"
                              >
                                주변 업체 찾기
                              </button>
                              <button
                                type="button"
                                onClick={() => chooseStart(business.id)}
                                className="rounded bg-amber-700 px-2 py-1 hover:bg-amber-600"
                              >
                                {isStart ? "출발지 해제" : "출발지로 지정"}
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleExcluded(business)}
                            className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
                          >
                            {excluded ? "다시 포함" : "동선에서 제외"}
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold">주변 미실시 후보</h2>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={includeScheduled}
                    onChange={(event) => {
                      setIncludeScheduled(event.target.checked);
                      setCandidatePage(0);
                    }}
                  />
                  다른 일정 예정 사업장도 보기
                </label>
              </div>
              {!baseBusiness ? (
                <p className="mt-3 text-xs text-slate-500">기준 사업장을 지정하면 가까운 후보를 조회합니다.</p>
              ) : candidateLoading ? (
                <p className="mt-3 text-xs text-slate-400">거리순 후보를 조회하는 중...</p>
              ) : candidateError ? (
                <p className="mt-3 rounded-lg bg-red-950/40 p-3 text-xs text-red-300">{candidateError}</p>
              ) : candidates.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500">
                  조건에 맞는 주변 미실시 사업장이 없습니다.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {candidates.map((candidate) => (
                    <article key={candidate.id} className="rounded-xl border border-violet-800/50 bg-violet-950/20 p-3">
                      <div className="text-[10px] text-violet-400">{candidate.code}</div>
                      <div className="text-sm font-bold">{candidate.business_name}</div>
                      <div className="mt-1 text-[11px] text-slate-400">{candidate.address || "주소 미등록"}</div>
                      <div className="mt-1 text-[11px] text-violet-300">
                        기준점에서 약 {candidate.distanceKm?.toFixed(1)}km
                      </div>
                      {candidate.measurement_date && (
                        <div className="mt-1 text-[11px] text-amber-300">
                          다른 일정 예정: {candidate.measurement_date}
                        </div>
                      )}
                      <div className="mt-2 text-right">
                        <button
                          type="button"
                          onClick={() => addCandidate(candidate.id)}
                          className="rounded bg-violet-700 px-2.5 py-1 text-[11px] font-bold hover:bg-violet-600"
                        >
                          동선에 추가
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {candidateTotal > 0 && (
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                  <button
                    type="button"
                    disabled={candidatePage === 0}
                    onClick={() => setCandidatePage((page) => Math.max(0, page - 1))}
                    className="rounded bg-slate-800 px-2.5 py-1.5 disabled:opacity-40"
                  >
                    이전 10개
                  </button>
                  <span>
                    {candidatePage * NEARBY_PAGE_SIZE + 1}–
                    {Math.min((candidatePage + 1) * NEARBY_PAGE_SIZE, candidateTotal)} / {candidateTotal}
                  </span>
                  <button
                    type="button"
                    disabled={(candidatePage + 1) * NEARBY_PAGE_SIZE >= candidateTotal}
                    onClick={() => setCandidatePage((page) => page + 1)}
                    className="rounded bg-slate-800 px-2.5 py-1.5 disabled:opacity-40"
                  >
                    다음 10개
                  </button>
                </div>
              )}

              <div className="mt-5 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={calculateRoute}
                  disabled={optimizing}
                  className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold hover:bg-emerald-500 disabled:opacity-50"
                >
                  {optimizing ? "자동차 경로 계산 중..." : "최적 동선 계산"}
                </button>
                {routeError && <p className="mt-2 rounded-lg bg-red-950/40 p-3 text-xs text-red-300">{routeError}</p>}
                {routeResult && (
                  <section className="mt-3 rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-3">
                    <div className="text-xs text-slate-400">
                      포함 {routeResult.orderedBusinesses.length}개 · 제외 {excludedBusinesses.length}개
                    </div>
                    <div className="mt-1 text-sm font-bold">
                      출발지: {routeResult.orderedBusinesses[0]?.business_name}
                    </div>
                    <ol className="mt-3 space-y-2">
                      {routeResult.segments.map((segment, index) => {
                        const longSegment =
                          segment.isLongSegment ||
                          segment.duration >= LONG_SEGMENT_WARNING_MINUTES * 60;
                        return (
                          <li
                            key={`${segment.fromName}-${segment.toName}-${index}`}
                            className={`rounded-lg p-2 text-xs ${
                              longSegment ? "bg-amber-500/15 text-amber-200" : "bg-slate-950/60"
                            }`}
                          >
                            <div className="font-semibold">
                              {index + 1}. {segment.fromName} → {segment.toName}
                            </div>
                            <div className="mt-1 text-slate-400">
                              {segment.formattedDistance} / {segment.formattedDuration}
                            </div>
                            {longSegment && <span className="mt-1 inline-block rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold">장거리 구간</span>}
                          </li>
                        );
                      })}
                    </ol>
                    <div className="mt-3 border-t border-emerald-800/40 pt-3 text-sm">
                      <div>총 이동거리: <b>{routeResult.formattedTotalDistance}</b></div>
                      <div>총 이동시간: <b>{routeResult.formattedTotalDuration}</b></div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
