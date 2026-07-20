"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/Table";

interface User {
  id: number;
  name: string;
  role: "관리자" | "사용자";
  job?: string;
  survey_code?: string | null;
  mobile?: string | null;
  email?: string | null;
  is_journal_manager: boolean;
  is_national_support_manager: boolean;
  is_designated_office_report_manager: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 사용자 생성 모달
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    role: "사용자" as "관리자" | "사용자",
    job: "측정",
    password: "",
    survey_code: "",
    mobile: "",
    email: "",
    is_journal_manager: false,
    is_national_support_manager: false,
    is_designated_office_report_manager: false,
  });

  // 비밀번호 리셋 모달
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetForm, setResetForm] = useState({
    userName: "",
    newPassword: "",
  });

  // 사용자 수정 모달
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    id: 0,
    name: "",
    role: "사용자" as "관리자" | "사용자",
    job: "측정",
    survey_code: "",
    mobile: "",
    email: "",
    is_journal_manager: false,
    is_national_support_manager: false,
    is_designated_office_report_manager: false,
    is_active: true,
  });

  // 삭제 확인 모달
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  // 국고 일괄 조회를 위한 상태 정의
  const [bulkYear, setBulkYear] = useState("2026");
  const [bulkPeriod, setBulkPeriod] = useState("상반기");
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkProcessed, setBulkProcessed] = useState(0);
  const [bulkSuccessCount, setBulkSuccessCount] = useState(0);
  const [bulkCrawlerCount, setBulkCrawlerCount] = useState(0);
  const [bulkFailedCount, setBulkFailedCount] = useState(0);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkLogs, setBulkLogs] = useState<string[]>([]);

  useEffect(() => {
    fetchUsers();
  }, []);

  // 국고 일괄 조회 실행 핸들러
  const handleStartBulkProcess = async () => {
    if (isBulkProcessing) return;

    setError(null);
    setSuccess(null);

    try {
      // 일괄 조회 대상 요약 정보 및 대기 큐 로드
      const response = await fetch(`/api/businesses/national-support/status-summary?year=${bulkYear}&period=${encodeURIComponent(bulkPeriod)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "일괄 대상 목록을 수집하는 데 실패했습니다.");
      }

      const queue = data.queue || [];
      if (queue.length === 0) {
        alert("해당 년도/주기에 일괄 처리 가능한 미완료 대상 사업장이 없습니다.");
        return;
      }

      const confirmMsg = `${bulkYear}년 ${bulkPeriod} 주기의 미완료 대상 ${queue.length}건에 대해 국고 일괄 조회를 시작하시겠습니까?\n\n(건강디딤돌 신청결과가 디비에 있는 항목은 즉시 반영되고, 매칭 결과가 없으면 백그라운드 크롤러가 구동됩니다)`;
      if (!confirm(confirmMsg)) {
        return;
      }

      // 상태값 초기화 및 시작
      setIsBulkProcessing(true);
      setBulkTotal(queue.length);
      setBulkProcessed(0);
      setBulkSuccessCount(0);
      setBulkCrawlerCount(0);
      setBulkFailedCount(0);
      setBulkLogs([`[시작] 총 ${queue.length}건에 대한 국고 일괄 처리를 시작합니다.`]);
      setShowBulkModal(true);

      // 동시 처리 제한 (동시 최대 2개씩 순차 처리)
      const limit = 2;
      let currentIndex = 0;

      const runNext = async () => {
        if (currentIndex >= queue.length) return;
        const item = queue[currentIndex++];

        try {
          const res = await fetch("/api/businesses/national-support/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              target_id: item.id,
              sanjae: item.sanjae,
              commencement: item.commencement,
              representative: item.representative,
              contact_name: item.manager_name || "담당자",
              contact_phone: item.manager_mobile || "010-0000-0000",
              period: item.period,
              code: item.code,
              year: item.year
            })
          });

          const resJson = await res.json();
          if (res.ok) {
            if (resJson.instantSync) {
              setBulkSuccessCount(prev => prev + 1);
              setBulkLogs(prev => [`[즉시반영] ${item.business_name}: 기존 결과 매핑 완료`, ...prev]);
            } else {
              setBulkCrawlerCount(prev => prev + 1);
              setBulkLogs(prev => [`[백그라운드 기동] ${item.business_name}: 공단 조회 기동`, ...prev]);
            }
          } else {
            setBulkFailedCount(prev => prev + 1);
            setBulkLogs(prev => [`[조회 실패] ${item.business_name}: ${resJson.error || "알 수 없는 오류"}`, ...prev]);
          }
        } catch (err: any) {
          setBulkFailedCount(prev => prev + 1);
          setBulkLogs(prev => [`[네트워크 오류] ${item.business_name}: ${err.message || "연결 오류"}`, ...prev]);
        } finally {
          setBulkProcessed(prev => prev + 1);
          // 공단 부하 방지를 위해 각 호출 사이 500ms의 대기 시간 부여
          await new Promise(resolve => setTimeout(resolve, 500));
          await runNext();
        }
      };

      // 초기 실행 세팅
      const workers = [];
      for (let i = 0; i < Math.min(limit, queue.length); i++) {
        workers.push(runNext());
      }
      await Promise.all(workers);

      setBulkLogs(prev => [`[완료] 국고 일괄 처리가 최종 종료되었습니다.`, ...prev]);
      alert("국고 일괄 처리가 완료되었습니다.");

    } catch (err: any) {
      alert(err.message || "일괄 처리 기동 중 오류가 발생했습니다.");
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/users");
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "사용자 목록을 불러오는데 실패했습니다.");
      }
      const data = await response.json();
      setUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!createForm.name.trim()) {
      setError("이름을 입력해주세요.");
      return;
    }

    // 비밀번호가 제공된 경우에만 검증
    if (createForm.password && createForm.password.length < 4) {
      setError("비밀번호는 최소 4자 이상이어야 합니다.");
      return;
    }

    setError(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "사용자 생성에 실패했습니다.");
      }

      setSuccess("사용자가 생성되었습니다.");
      setShowCreateModal(false);
      setCreateForm({ 
        name: "", 
        role: "사용자", 
        job: "측정", 
        password: "", 
        survey_code: "",
        mobile: "",
        email: "",
        is_journal_manager: false,
        is_national_support_manager: false,
        is_designated_office_report_manager: false,
      });
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  };

  const handleResetPassword = async () => {
    if (!resetForm.userName || !resetForm.newPassword) {
      setError("사용자 이름과 새 비밀번호를 입력해주세요.");
      return;
    }

    if (resetForm.newPassword.length < 4) {
      setError("비밀번호는 최소 4자 이상이어야 합니다.");
      return;
    }

    setError(null);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resetForm),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "비밀번호 리셋에 실패했습니다.");
      }

      setSuccess(data.message || "비밀번호가 리셋되었습니다.");
      setShowResetModal(false);
      setResetForm({ userName: "", newPassword: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  };

  const handleEditUser = async () => {
    if (!editForm.name.trim()) {
      setError("이름을 입력해주세요.");
      return;
    }

    setError(null);
    try {
      const response = await fetch(`/api/users/${editForm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: editForm.role,
          job: editForm.job,
          survey_code: editForm.survey_code || null,
          mobile: editForm.mobile || null,
          email: editForm.email || null,
          is_journal_manager: !!editForm.is_journal_manager,
          is_national_support_manager: !!editForm.is_national_support_manager,
          is_designated_office_report_manager: !!editForm.is_designated_office_report_manager,
          is_active: !!editForm.is_active,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "사용자 수정에 실패했습니다.");
      }

      setSuccess("사용자 정보가 수정되었습니다.");
      setShowEditModal(false);
      setEditForm({ 
        id: 0, 
        name: "", 
        role: "사용자", 
        job: "측정", 
        survey_code: "",
        mobile: "",
        email: "",
        is_journal_manager: false,
        is_national_support_manager: false,
        is_designated_office_report_manager: false,
        is_active: true,
      });
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    setError(null);
    try {
      const response = await fetch(`/api/users/${userToDelete.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "사용자 삭제에 실패했습니다.");
      }

      setSuccess(data.message || "사용자가 삭제되었습니다.");
      setShowDeleteModal(false);
      setUserToDelete(null);
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-900">사용자 관리</h1>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          사용자 추가
        </Button>
      </div>

      {error && (
        <Alert variant="error">
          {error}
        </Alert>
      )}

      {success && (
        <Alert variant="success">
          {success}
        </Alert>
      )}

      {/* 사용자 목록 카드 */}
      <Card className="p-0 overflow-hidden shadow-sm border-slate-200">
        <div className="overflow-x-auto custom-scrollbar">
          <Table className="min-w-[1120px]">
            <TableHeader className="bg-slate-50 border-b border-slate-200 z-20 text-slate-700 font-bold">
            <TableRow className="border-b border-sky-200">
              <TableHead className="text-black">이름</TableHead>
              <TableHead className="text-black">상태</TableHead>
              <TableHead className="text-black">역활</TableHead>
              <TableHead className="text-black">직무</TableHead>
              <TableHead className="text-center text-black">일지담당</TableHead>
              <TableHead className="text-center text-black">국고일괄</TableHead>
              <TableHead className="text-center text-black">지정기관신고서</TableHead>
              <TableHead className="text-black">연락처</TableHead>
              <TableHead className="text-black">이메일</TableHead>
              <TableHead className="text-black">공시료 코드</TableHead>
              <TableHead className="text-black">생성일</TableHead>
              <TableHead className="text-right text-black">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-text-500 py-8">
                  등록된 사용자가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id} className={`hover:bg-blue-50/40 group relative growable-row transition-colors border-b border-slate-100 ${!user.is_active ? "bg-slate-50 text-slate-400" : ""}`}>
                  <TableCell className="w-[100px] font-medium pl-2.5 relative">
                    {/* 표준 블루 인디케이터 바 */}
                    <div className={`absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none ${!user.is_active ? "bg-slate-400" : ""}`} />
                    {user.name}
                  </TableCell>
                  <TableCell>
                    {user.is_active ? (
                      <span className="text-green-600 font-medium">활성</span>
                    ) : (
                      <span className="text-slate-400">중지</span>
                    )}
                  </TableCell>
                  <TableCell>{user.role}</TableCell>
                  <TableCell>{user.job || "-"}</TableCell>
                  <TableCell>
                    {user.is_journal_manager ? (
                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold">담당</span>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="text-center">
                    {user.is_national_support_manager ? (
                      <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">권한</span>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="text-center">
                    {user.is_designated_office_report_manager ? (
                      <span className="bg-cyan-100 text-cyan-700 px-2 py-1 rounded text-xs font-bold">담당</span>
                    ) : "-"}
                  </TableCell>
                  <TableCell>{user.mobile || "-"}</TableCell>
                  <TableCell>{user.email || "-"}</TableCell>
                  <TableCell>{user.survey_code || "-"}</TableCell>
                  <TableCell>
                    {new Date(user.created_at).toLocaleDateString("ko-KR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setEditForm({ 
                            id: user.id, 
                            name: user.name, 
                            role: user.role, 
                            job: user.job || "측정", 
                            survey_code: user.survey_code || "",
                            mobile: user.mobile || "",
                            email: user.email || "",
                            is_journal_manager: !!user.is_journal_manager,
                            is_national_support_manager: !!user.is_national_support_manager,
                            is_designated_office_report_manager: !!user.is_designated_office_report_manager,
                            is_active: user.is_active !== false,
                          });
                          setShowEditModal(true);
                        }}
                      >
                        수정
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setResetForm({ userName: user.name, newPassword: "" });
                          setShowResetModal(true);
                        }}
                      >
                        비밀번호 리셋
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setUserToDelete(user);
                          setShowDeleteModal(true);
                        }}
                      >
                        삭제
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>

      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setCreateForm({ 
            name: "", 
            role: "사용자", 
            job: "측정", 
            password: "", 
            survey_code: "",
            mobile: "",
            email: "",
            is_journal_manager: false,
            is_national_support_manager: false,
            is_designated_office_report_manager: false,
          });
          setError(null);
        }}
        title="사용자 추가"
        size="lg"
      >
        <div className="space-y-6">
          {error && (
            <Alert variant="error" className="mb-2">
              {error}
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <Input
              label="이름"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              placeholder="사용자 이름"
              required
            />
            <Input
              label="비밀번호 (선택사항)"
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              placeholder="미입력 시 최초 로그인 시 설정"
            />
            <Select
              label="역할"
              value={createForm.role}
              onChange={(e) =>
                setCreateForm({ ...createForm, role: e.target.value as "관리자" | "사용자" })
              }
              options={[
                { value: "사용자", label: "사용자" },
                { value: "관리자", label: "관리자" },
              ]}
              required
            />
            <Select
              label="직무"
              value={createForm.job}
              onChange={(e) =>
                setCreateForm({ ...createForm, job: e.target.value })
              }
              options={[
                { value: "측정", label: "측정" },
                { value: "분석", label: "분석" },
              ]}
            />
            <Input
              label="휴대폰 번호 (선택사항)"
              value={createForm.mobile}
              onChange={(e) => setCreateForm({ ...createForm, mobile: e.target.value })}
              placeholder="010-0000-0000"
            />
            <Input
              label="이메일 주소 (선택사항)"
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              placeholder="example@company.com"
            />
            <Input
              label="공시료 코드 (선택사항)"
              value={createForm.survey_code}
              onChange={(e) => setCreateForm({ ...createForm, survey_code: e.target.value })}
              placeholder="공시료 코드 입력"
              maxLength={10}
            />
            <div className="flex flex-col justify-end pb-1">
              <div className="flex items-center gap-2 px-1 py-2 bg-slate-50 rounded-lg border border-slate-100">
                <input
                  type="checkbox"
                  id="create-is-journal-manager"
                  checked={createForm.is_journal_manager}
                  onChange={(e) => setCreateForm({ ...createForm, is_journal_manager: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="create-is-journal-manager" className="text-sm font-bold text-text-900">
                  측정일지 담당자로 지정
                </label>
              </div>
            </div>
            <div className="flex flex-col justify-end pb-1">
              <div className="flex items-center gap-2 px-1 py-2 bg-slate-50 rounded-lg border border-slate-100">
                <input
                  type="checkbox"
                  id="create-is-national-support-manager"
                  checked={createForm.is_national_support_manager}
                  onChange={(e) => setCreateForm({ ...createForm, is_national_support_manager: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="create-is-national-support-manager" className="text-sm font-bold text-text-900">
                  국고 일괄 권한 부여
                </label>
              </div>
            </div>
            <div className="flex flex-col justify-end pb-1">
              <div className="flex items-center gap-2 px-1 py-2 bg-slate-50 rounded-lg border border-slate-100">
                <input
                  type="checkbox"
                  id="create-is-designated-office-report-manager"
                  checked={createForm.is_designated_office_report_manager}
                  onChange={(e) => setCreateForm({ ...createForm, is_designated_office_report_manager: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="create-is-designated-office-report-manager" className="text-sm font-bold text-text-900">
                  지정기관신고서 담당 권한
                </label>
              </div>
            </div>
          </div>

          <p className="text-xs text-text-500 px-1 italic">
            * 비밀번호를 입력하지 않으면 사용자가 최초 로그인 시 직접 설정합니다.
          </p>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <Button
              variant="secondary"
              onClick={() => {
                setShowCreateModal(false);
                setCreateForm({ 
                  name: "", 
                  role: "사용자", 
                  job: "측정", 
                  password: "", 
                  survey_code: "",
                  mobile: "",
                  email: "",
                  is_journal_manager: false,
                  is_national_support_manager: false,
                  is_designated_office_report_manager: false,
                });
                setError(null);
              }}
            >
              취소
            </Button>
            <Button variant="primary" onClick={handleCreateUser}>
              추가
            </Button>
          </div>
        </div>
      </Modal>

      {/* 비밀번호 리셋 모달 */}
      <Modal
        isOpen={showResetModal}
        onClose={() => {
          setShowResetModal(false);
          setResetForm({ userName: "", newPassword: "" });
          setError(null);
        }}
        title="비밀번호 리셋"
      >
        <div className="space-y-4">
          <Input
            label="사용자 이름"
            value={resetForm.userName}
            onChange={(e) => setResetForm({ ...resetForm, userName: e.target.value })}
            placeholder="사용자 이름"
            required
            readOnly
            className="bg-surface-50"
          />
          <Input
            label="새 비밀번호"
            type="password"
            value={resetForm.newPassword}
            onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
            placeholder="최소 4자 이상"
            required
          />
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowResetModal(false);
                setResetForm({ userName: "", newPassword: "" });
                setError(null);
              }}
            >
              취소
            </Button>
            <Button variant="primary" onClick={handleResetPassword}>
              리셋
            </Button>
          </div>
        </div>
      </Modal>

      {/* 사용자 수정 모달 */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditForm({ 
            id: 0, 
            name: "", 
            role: "사용자", 
            job: "측정", 
            survey_code: "",
            mobile: "",
            email: "",
            is_journal_manager: false,
            is_national_support_manager: false,
            is_designated_office_report_manager: false,
            is_active: true,
          });
          setError(null);
        }}
        title="사용자 수정"
        size="lg"
      >
        <div className="space-y-6">
          {error && (
            <Alert variant="error" className="mb-2">
              {error}
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Input
                label="이름"
                value={editForm.name}
                readOnly
                className="bg-surface-50 cursor-not-allowed"
              />
              <p className="text-xs text-slate-500 mt-1">이름은 수정할 수 없습니다.</p>
            </div>
            <Select
              label="역할"
              value={editForm.role}
              onChange={(e) =>
                setEditForm({ ...editForm, role: e.target.value as "관리자" | "사용자" })
              }
              options={[
                { value: "사용자", label: "사용자" },
                { value: "관리자", label: "관리자" },
              ]}
            />
            <Select
              label="직무"
              value={editForm.job}
              onChange={(e) =>
                setEditForm({ ...editForm, job: e.target.value })
              }
              options={[
                { value: "측정", label: "측정" },
                { value: "분석", label: "분석" },
              ]}
            />
            <div className="flex flex-col justify-end pb-1">
              <div className="flex items-center gap-2 px-1 py-2 bg-slate-50 rounded-lg border border-slate-100">
                <input
                  type="checkbox"
                  id="edit-is-journal-manager"
                  checked={editForm.is_journal_manager}
                  onChange={(e) => setEditForm({ ...editForm, is_journal_manager: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="edit-is-journal-manager" className="text-sm font-bold text-text-900">
                  측정일지 담당자로 지정
                </label>
              </div>
            </div>
            <div className="flex flex-col justify-end pb-1">
              <div className="flex items-center gap-2 px-1 py-2 bg-slate-50 rounded-lg border border-slate-100">
                <input
                  type="checkbox"
                  id="edit-is-national-support-manager"
                  checked={editForm.is_national_support_manager}
                  onChange={(e) => setEditForm({ ...editForm, is_national_support_manager: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="edit-is-national-support-manager" className="text-sm font-bold text-text-900">
                  국고 일괄 권한 부여
                </label>
              </div>
            </div>
            <div className="flex flex-col justify-end pb-1">
              <div className="flex items-center gap-2 px-1 py-2 bg-slate-50 rounded-lg border border-slate-100">
                <input
                  type="checkbox"
                  id="edit-is-designated-office-report-manager"
                  checked={editForm.is_designated_office_report_manager}
                  onChange={(e) => setEditForm({ ...editForm, is_designated_office_report_manager: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="edit-is-designated-office-report-manager" className="text-sm font-bold text-text-900">
                  지정기관신고서 담당 권한
                </label>
              </div>
            </div>
            <Input
              label="휴대폰 번호 (선택사항)"
              value={editForm.mobile}
              onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })}
              placeholder="010-0000-0000"
            />
            <Input
              label="이메일 주소 (선택사항)"
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              placeholder="example@company.com"
            />
            <Input
              label="공시료 코드 (선택사항)"
              value={editForm.survey_code}
              onChange={(e) => setEditForm({ ...editForm, survey_code: e.target.value })}
              placeholder="공시료 코드 입력"
              maxLength={10}
            />
            <div className="flex flex-col justify-end pb-1">
              <div className="flex items-center gap-2 px-1 py-2 bg-blue-50/50 rounded-lg border border-blue-100">
                <input
                  type="checkbox"
                  id="edit-is-active"
                  checked={editForm.is_active}
                  onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="edit-is-active" className="text-sm font-bold text-text-900">
                  계정 활성화 상태
                </label>
                <span className={`text-[10px] ml-auto px-1.5 py-0.5 rounded-full font-bold ${editForm.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                  {editForm.is_active ? "활성" : "차단됨"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <Button
              variant="secondary"
              onClick={() => {
                setShowEditModal(false);
                setEditForm({ 
                  id: 0, 
                  name: "", 
                  role: "사용자", 
                  job: "측정", 
                  survey_code: "",
                  mobile: "",
                  email: "",
                  is_journal_manager: false,
                  is_national_support_manager: false,
                  is_designated_office_report_manager: false,
                  is_active: true,
                });
                setError(null);
              }}
            >
              취소
            </Button>
            <Button variant="primary" onClick={handleEditUser}>
              수정
            </Button>
          </div>
        </div>
      </Modal>

      {/* 삭제 확인 모달 */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setUserToDelete(null);
          setError(null);
        }}
        title="사용자 삭제"
      >
        <div className="space-y-4">
          <p className="text-text-700">
            정말 <strong>{userToDelete?.name}</strong> 사용자를 삭제하시겠습니까?
            <br />
            이 작업은 되돌릴 수 없습니다.
          </p>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowDeleteModal(false);
                setUserToDelete(null);
                setError(null);
              }}
            >
              취소
            </Button>
            <Button variant="danger" onClick={handleDeleteUser}>
              삭제
            </Button>
          </div>
        </div>
      </Modal>

      {/* 국고 일괄 처리 진행 현황 모달 */}
      <Modal
        isOpen={showBulkModal}
        onClose={() => {
          if (isBulkProcessing) {
            if (!confirm("현재 일괄 조회가 진행 중입니다. 정말 닫으시겠습니까?\n(창을 닫아도 백엔드 요청은 계속 진행될 수 있습니다)")) {
              return;
            }
          }
          setShowBulkModal(false);
        }}
        title={`국고 일괄 처리 진행 현황 (${bulkYear}년 ${bulkPeriod})`}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="bg-slate-50 p-2 rounded border border-slate-100">
              <div className="text-slate-500 font-medium">전체 대상</div>
              <div className="text-lg font-bold text-text-900 mt-1">{bulkTotal}건</div>
            </div>
            <div className="bg-green-50 p-2 rounded border border-green-100">
              <div className="text-green-600 font-medium">즉시 반영</div>
              <div className="text-lg font-bold text-green-700 mt-1">{bulkSuccessCount}건</div>
            </div>
            <div className="bg-blue-50 p-2 rounded border border-blue-100">
              <div className="text-blue-600 font-medium">조회 기동</div>
              <div className="text-lg font-bold text-blue-700 mt-1">{bulkCrawlerCount}건</div>
            </div>
            <div className="bg-red-50 p-2 rounded border border-red-100">
              <div className="text-red-600 font-medium">실패 건</div>
              <div className="text-lg font-bold text-red-700 mt-1">{bulkFailedCount}건</div>
            </div>
          </div>

          {/* 프로그레스 바 */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-slate-500 font-medium">
              <span>진행률</span>
              <span>{bulkProcessed} / {bulkTotal} 건 ({bulkTotal > 0 ? Math.round((bulkProcessed / bulkTotal) * 100) : 0}%)</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3.5 overflow-hidden">
              <div
                className="bg-primary-600 h-3.5 rounded-full transition-all duration-300"
                style={{ width: `${bulkTotal > 0 ? (bulkProcessed / bulkTotal) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* 진행 로그 창 */}
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-500">실시간 처리 로그</label>
            <div className="h-48 overflow-y-auto border border-slate-200 rounded p-2.5 bg-slate-900 text-slate-200 text-xs font-mono space-y-1 custom-scrollbar">
              {bulkLogs.map((log, idx) => (
                <div key={idx} className={
                  log.includes("[즉시반영]") ? "text-green-400" :
                  log.includes("[백그라운드 기동]") ? "text-blue-400" :
                  log.includes("[조회 실패]") || log.includes("[네트워크 오류]") ? "text-red-400" : "text-slate-300"
                }>
                  {log}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              variant="secondary"
              onClick={() => setShowBulkModal(false)}
              disabled={isBulkProcessing}
            >
              닫기
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
