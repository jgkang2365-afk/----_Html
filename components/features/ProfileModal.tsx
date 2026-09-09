"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { toast } from "sonner";
import { Loader2, User } from "lucide-react";

interface ProfileModalProps {
    isOpen: boolean;
    onClose: () => void;
    user: any;
    onUpdate: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
    isOpen,
    onClose,
    user,
    onUpdate,
}) => {
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        job: user?.job || "측정",
        survey_code: user?.survey_code || "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const res = await fetch("/api/users/me", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            if (res.ok) {
                toast.success("내 정보가 성공적으로 수정되었습니다.");
                onUpdate();
                onClose();
            } else {
                const error = await res.json();
                toast.error(error.error || "수정에 실패했습니다.");
            }
        } catch (error) {
            toast.error("서버 통신 중 오류가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="내 정보 수정">
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-lg mb-4">
                    <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600">
                        <User size={20} />
                    </div>
                    <div>
                        <div className="text-sm font-bold text-text-900">{user?.name}</div>
                        <div className="text-xs text-text-500">{user?.role}</div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <Select
                        label="직무"
                        value={formData.job}
                        onChange={(e) => setFormData({ ...formData, job: e.target.value })}
                        options={[
                            { value: "측정", label: "측정" },
                            { value: "분석", label: "분석" },
                        ]}
                    />
                    <Input
                        label="공시료 코드"
                        placeholder="A01 등"
                        value={formData.survey_code}
                        onChange={(e) => setFormData({ ...formData, survey_code: e.target.value })}
                    />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                    <Button variant="secondary" onClick={onClose} disabled={loading} type="button">
                        취소
                    </Button>
                    <Button variant="primary" type="submit" disabled={loading}>
                        {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        저장하기
                    </Button>
                </div>
            </form>
        </Modal>
    );
};
