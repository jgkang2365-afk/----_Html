"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { X, Edit2, Trash2, Globe, Lock, MessageSquare } from "lucide-react";

interface Memo {
    id: string;
    content: string;
    is_shared: boolean;
    user_id: string;
    user_name: string;
    created_at: string;
    updated_at: string;
}

interface QuotaMemoPanelProps {
    isOpen: boolean;
    onClose: () => void;
    currentUserId?: string; // 현재 접속자 ID (수정/삭제 권한 확인용)
}

export function QuotaMemoPanel({ isOpen, onClose, currentUserId }: QuotaMemoPanelProps) {
    const [memos, setMemos] = useState<Memo[]>([]);
    const [loading, setLoading] = useState(false);
    const [content, setContent] = useState("");
    const [isShared, setIsShared] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    
    // 수정 모드 상태
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState("");
    const [editIsShared, setEditIsShared] = useState(true);

    const fetchMemos = async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/admin/quotas/memos");
            const data = await res.json();
            if (data.success) {
                setMemos(data.data);
            }
        } catch (error) {
            console.error("메모 조회 실패:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchMemos();
            // 입력창 초기화
            setContent("");
            setIsShared(true);
            setEditingId(null);
        }
    }, [isOpen]);

    const handleSubmit = async () => {
        if (!content.trim()) return;
        
        try {
            setSubmitting(true);
            const res = await fetch("/api/admin/quotas/memos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content, is_shared: isShared })
            });
            const data = await res.json();
            
            if (data.success) {
                setContent("");
                fetchMemos();
            } else {
                alert(data.error || "등록 실패");
            }
        } catch (error) {
            console.error("메모 등록 실패:", error);
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdate = async (id: string) => {
        if (!editContent.trim()) return;
        
        try {
            const res = await fetch("/api/admin/quotas/memos", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, content: editContent, is_shared: editIsShared })
            });
            const data = await res.json();
            
            if (data.success) {
                setEditingId(null);
                fetchMemos();
            } else {
                alert(data.error || "수정 실패");
            }
        } catch (error) {
            console.error("메모 수정 실패:", error);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("정말 이 메모를 삭제하시겠습니까?")) return;
        
        try {
            const res = await fetch(`/api/admin/quotas/memos?id=${id}`, {
                method: "DELETE"
            });
            const data = await res.json();
            
            if (data.success) {
                fetchMemos();
            } else {
                alert(data.error || "삭제 실패");
            }
        } catch (error) {
            console.error("메모 삭제 실패:", error);
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        }).format(date);
    };

    return (
        <>
            {/* Backdrop */}
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-slate-900/50 transition-opacity z-40"
                    onClick={onClose}
                />
            )}
            
            {/* Slide-over panel */}
            <div className={`fixed inset-y-0 right-0 z-50 w-full max-w-md bg-slate-50 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? "translate-x-0" : "translate-x-full"}`}>
                
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200">
                    <div className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-primary-600" />
                        <h2 className="text-lg font-bold text-slate-900">지청 메모장</h2>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {loading ? (
                        <div className="flex justify-center py-10">
                            <LoadingSpinner />
                        </div>
                    ) : memos.length === 0 ? (
                        <div className="text-center py-10 text-slate-500 text-sm">
                            등록된 메모가 없습니다.
                        </div>
                    ) : (
                        memos.map(memo => (
                            <div key={memo.id} className={`bg-white p-4 rounded-xl border shadow-sm ${memo.is_shared ? 'border-slate-200' : 'border-amber-200 bg-amber-50/30'}`}>
                                
                                {editingId === memo.id ? (
                                    // 수정 모드
                                    <div className="space-y-3">
                                        <Textarea 
                                            value={editContent}
                                            onChange={e => setEditContent(e.target.value)}
                                            className="text-sm min-h-[80px] resize-none"
                                        />
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <input 
                                                    type="checkbox" 
                                                    id={`edit-share-${memo.id}`}
                                                    checked={editIsShared}
                                                    onChange={e => setEditIsShared(e.target.checked)}
                                                    className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                                                />
                                                <label htmlFor={`edit-share-${memo.id}`} className="text-xs text-slate-600 flex items-center gap-1 cursor-pointer">
                                                    {editIsShared ? <Globe className="w-3 h-3 text-blue-500" /> : <Lock className="w-3 h-3 text-amber-500" />}
                                                    {editIsShared ? "전체 공유" : "나만 보기"}
                                                </label>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button size="sm" variant="secondary" onClick={() => setEditingId(null)} className="h-7 text-xs px-2">취소</Button>
                                                <Button size="sm" variant="primary" onClick={() => handleUpdate(memo.id)} className="h-7 text-xs px-2">저장</Button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    // 일반 뷰 모드
                                    <>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-sm text-slate-800">{memo.user_name}</span>
                                                <span className="text-xs text-slate-400">{formatDate(memo.created_at)}</span>
                                            </div>
                                            
                                            <div className="flex items-center gap-1">
                                                {memo.is_shared ? (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-600 border border-blue-100">
                                                        <Globe className="w-3 h-3" /> 공유
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-600 border border-amber-100">
                                                        <Lock className="w-3 h-3" /> 개인
                                                    </span>
                                                )}

                                                {/* 작성자 본인만 수정/삭제 버튼 표시 (currentUserId가 없어도 동작은 API에서 방어하지만 UI에서 가려줌) */}
                                                {(!currentUserId || currentUserId === memo.user_id) && (
                                                    <div className="flex ml-1">
                                                        <button 
                                                            onClick={() => {
                                                                setEditingId(memo.id);
                                                                setEditContent(memo.content);
                                                                setEditIsShared(memo.is_shared);
                                                            }}
                                                            className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                                            title="수정"
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button 
                                                            onClick={() => handleDelete(memo.id)}
                                                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                            title="삭제"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
                                            {memo.content}
                                        </div>
                                    </>
                                )}
                            </div>
                        ))
                    )}
                </div>

                {/* Input Area */}
                <div className="p-4 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                    <Textarea 
                        value={content}
                        onChange={e => setContent(e.target.value)}
                        placeholder="메모를 입력하세요..."
                        className="text-sm min-h-[80px] mb-3 resize-none border-slate-300 focus:border-primary-500"
                    />
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 px-1">
                            <input 
                                type="checkbox" 
                                id="memo-share"
                                checked={isShared}
                                onChange={e => setIsShared(e.target.checked)}
                                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 w-4 h-4"
                            />
                            <label htmlFor="memo-share" className="text-sm text-slate-700 flex items-center gap-1.5 cursor-pointer font-medium">
                                {isShared ? <Globe className="w-4 h-4 text-blue-500" /> : <Lock className="w-4 h-4 text-amber-500" />}
                                {isShared ? "전체 공유" : "개인용 (나만 보기)"}
                            </label>
                        </div>
                        <Button 
                            variant="primary" 
                            onClick={handleSubmit} 
                            disabled={!content.trim() || submitting}
                            className="px-6 shadow-sm"
                        >
                            {submitting ? "등록 중..." : "설정"}
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}
