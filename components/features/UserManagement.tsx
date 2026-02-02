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
  });

  // 삭제 확인 모달
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

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
      setCreateForm({ name: "", role: "사용자", job: "측정", password: "", survey_code: "" });
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
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "사용자 수정에 실패했습니다.");
      }

      setSuccess("사용자 정보가 수정되었습니다.");
      setShowEditModal(false);
      setEditForm({ id: 0, name: "", role: "사용자", job: "측정", survey_code: "" });
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

      <Card className="p-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>역할</TableHead>
              <TableHead>직무</TableHead>
              <TableHead>공시료 코드</TableHead>
              <TableHead>생성일</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-text-500 py-8">
                  등록된 사용자가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.role}</TableCell>
                  <TableCell>{user.job || "-"}</TableCell>
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
                          setEditForm({ id: user.id, name: user.name, role: user.role, job: user.job || "측정", survey_code: user.survey_code || "" });
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
      </Card>

      {/* 사용자 생성 모달 */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setCreateForm({ name: "", role: "사용자", job: "측정", password: "", survey_code: "" });
          setError(null);
        }}
        title="사용자 추가"
      >
        <div className="space-y-4">
          {error && (
            <Alert variant="error">
              {error}
            </Alert>
          )}
          <Input
            label="이름"
            value={createForm.name}
            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            placeholder="사용자 이름"
            required
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
            label="비밀번호 (선택사항)"
            type="password"
            value={createForm.password}
            onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            placeholder="비워두면 최초 로그인 시 설정 (최소 4자 이상)"
          />
          <p className="text-xs text-text-500 -mt-2">
            비밀번호를 입력하지 않으면 사용자가 최초 로그인 시 비밀번호를 설정합니다.
          </p>
          <Input
            label="공시료 코드 (선택사항)"
            value={createForm.survey_code}
            onChange={(e) => setCreateForm({ ...createForm, survey_code: e.target.value })}
            placeholder="예: A01, B02 등"
            maxLength={10}
          />
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowCreateModal(false);
                setCreateForm({ name: "", role: "사용자", job: "측정", password: "", survey_code: "" });
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
          setEditForm({ id: 0, name: "", role: "사용자", job: "측정", survey_code: "" });
          setError(null);
        }}
        title="사용자 수정"
      >
        <div className="space-y-4">
          {error && (
            <Alert variant="error">
              {error}
            </Alert>
          )}
          <Input
            label="이름"
            value={editForm.name}
            readOnly
            className="bg-surface-50"
          />
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
          <Input
            label="공시료 코드 (선택사항)"
            value={editForm.survey_code}
            onChange={(e) => setEditForm({ ...editForm, survey_code: e.target.value })}
            placeholder="예: A01, B02 등"
            maxLength={10}
          />
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowEditModal(false);
                setEditForm({ id: 0, name: "", role: "사용자", job: "측정", survey_code: "" });
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
    </div>
  );
};
