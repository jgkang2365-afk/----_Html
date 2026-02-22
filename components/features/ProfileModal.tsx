"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { toast } from "sonner";
import { Loader2, User, Key, Briefcase, Hash } from "lucide-react";

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
        k2b_id: user?.k2b_id || "",
        k2b_pw: "", // 보안상 PW는 매번 새로 입력하도록 하거나, 마스킹된 상태로 관리
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

                <div className="border-t pt-4 mt-2">
                    <h4 className="text-sm font-bold text-text-800 mb-3 flex items-center gap-2">
                        <Key size={16} className="text-primary-500" />
                        K2B 계정 설정
                    </h4>
                    <div className="space-y-3">
                        <Input
                            label="K2B 아이디"
                            placeholder="K2B ID 입력"
                            value={formData.k2b_id}
                            onChange={(e) => setFormData({ ...formData, k2b_id: e.target.value })}
                        />
                        <Input
                            label="K2B 비밀번호"
                            type="password"
                            placeholder="변경할 경우에만 입력하세요"
                            value={formData.k2b_pw}
                            onChange={(e) => setFormData({ ...formData, k2b_pw: e.target.value })}
                        />
                        <p className="text-[10px] text-text-400">
                            * K2B 비밀번호는 저장 시 암호화되어 안전하게 보관됩니다.
                        </p>
                    </div>
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
