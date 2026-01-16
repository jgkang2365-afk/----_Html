"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
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

interface BusinessCategory {
  id: number;
  name: string;
  display_order: number;
  created_at: string;
}

export const BusinessCategoryManagement: React.FC = () => {
  const [categories, setCategories] = useState<BusinessCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 업종분류 생성 모달
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    display_order: 0,
  });

  // 업종분류 수정 모달
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<BusinessCategory | null>(null);

  // 삭제 확인 모달
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<BusinessCategory | null>(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/business-categories");
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "업종분류 목록을 불러오는데 실패했습니다.");
      }
      const data = await response.json();
      setCategories(data.categories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!createForm.name.trim()) {
      setError("업종분류명을 입력해주세요.");
      return;
    }

    setError(null);
    try {
      const response = await fetch("/api/business-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "업종분류 생성에 실패했습니다.");
      }

      setSuccess("업종분류가 생성되었습니다.");
      setShowCreateModal(false);
      setCreateForm({ name: "", display_order: 0 });
      fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  };

  const handleEditCategory = async () => {
    if (!editForm) return;

    if (!editForm.name.trim()) {
      setError("업종분류명을 입력해주세요.");
      return;
    }

    setError(null);
    try {
      const response = await fetch(`/api/business-categories/${editForm.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          display_order: editForm.display_order,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "업종분류 수정에 실패했습니다.");
      }

      setSuccess("업종분류가 수정되었습니다.");
      setShowEditModal(false);
      setEditForm(null);
      fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  };

  const handleDeleteCategory = async () => {
    if (!categoryToDelete) return;

    setError(null);
    try {
      const response = await fetch(`/api/business-categories/${categoryToDelete.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "업종분류 삭제에 실패했습니다.");
      }

      setSuccess(data.message || "업종분류가 삭제되었습니다.");
      setShowDeleteModal(false);
      setCategoryToDelete(null);
      fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  };

  // display_order 자동 계산 (최대값 + 1)
  useEffect(() => {
    if (showCreateModal && categories.length > 0) {
      const maxOrder = Math.max(...categories.map((c) => c.display_order));
      setCreateForm((prev) => ({ ...prev, display_order: maxOrder + 1 }));
    }
  }, [showCreateModal, categories]);

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
        <h1 className="text-2xl font-bold text-text-900">업종분류 관리</h1>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          업종분류 추가
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
              <TableHead>순서</TableHead>
              <TableHead>업종분류명</TableHead>
              <TableHead>생성일</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-text-500 py-8">
                  등록된 업종분류가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              categories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell>{category.display_order}</TableCell>
                  <TableCell className="font-medium">{category.name}</TableCell>
                  <TableCell>
                    {new Date(category.created_at).toLocaleDateString("ko-KR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setEditForm({ ...category });
                          setShowEditModal(true);
                        }}
                      >
                        수정
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setCategoryToDelete(category);
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

      {/* 업종분류 생성 모달 */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setCreateForm({ name: "", display_order: 0 });
          setError(null);
        }}
        title="업종분류 추가"
      >
        <div className="space-y-4">
          {error && (
            <Alert variant="error">
              {error}
            </Alert>
          )}
          <Input
            label="업종분류명"
            value={createForm.name}
            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            placeholder="예: 건설, 제조, 교육 등"
            required
          />
          <Input
            label="표시 순서"
            type="number"
            value={createForm.display_order}
            onChange={(e) =>
              setCreateForm({ ...createForm, display_order: parseInt(e.target.value) || 0 })
            }
            placeholder="숫자가 작을수록 앞에 표시됩니다"
            required
          />
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowCreateModal(false);
                setCreateForm({ name: "", display_order: 0 });
                setError(null);
              }}
            >
              취소
            </Button>
            <Button variant="primary" onClick={handleCreateCategory}>
              추가
            </Button>
          </div>
        </div>
      </Modal>

      {/* 업종분류 수정 모달 */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditForm(null);
          setError(null);
        }}
        title="업종분류 수정"
      >
        <div className="space-y-4">
          {error && (
            <Alert variant="error">
              {error}
            </Alert>
          )}
          {editForm && (
            <>
              <Input
                label="업종분류명"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="예: 건설, 제조, 교육 등"
                required
              />
              <Input
                label="표시 순서"
                type="number"
                value={editForm.display_order}
                onChange={(e) =>
                  setEditForm({ ...editForm, display_order: parseInt(e.target.value) || 0 })
                }
                placeholder="숫자가 작을수록 앞에 표시됩니다"
                required
              />
            </>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowEditModal(false);
                setEditForm(null);
                setError(null);
              }}
            >
              취소
            </Button>
            <Button variant="primary" onClick={handleEditCategory}>
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
          setCategoryToDelete(null);
          setError(null);
        }}
        title="업종분류 삭제"
      >
        <div className="space-y-4">
          <p className="text-text-700">
            정말 <strong>{categoryToDelete?.name}</strong> 업종분류를 삭제하시겠습니까?
            <br />
            이 업종분류를 사용 중인 측정일지가 있다면 문제가 발생할 수 있습니다.
            <br />
            이 작업은 되돌릴 수 없습니다.
          </p>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowDeleteModal(false);
                setCategoryToDelete(null);
                setError(null);
              }}
            >
              취소
            </Button>
            <Button variant="danger" onClick={handleDeleteCategory}>
              삭제
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
