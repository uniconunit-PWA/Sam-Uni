import React, { useState } from 'react';
import { Eye, EyeOff, ShieldCheck, X } from 'lucide-react';
import {
  type AdminSessionPayload,
  authenticateAdmin,
} from '../services/adminAuthService';

export type { AdminSessionPayload };

interface AdminLoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (session: AdminSessionPayload) => void;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) {
      setError('กรุณาระบุชื่อผู้ใช้และรหัสผ่าน');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const result = await authenticateAdmin(u, p);
      if (result.ok === false) {
        setError(result.message);
        return;
      }

      setError('');
      setUsername('');
      setPassword('');
      setShowPassword(false);
      onSuccess(result.session);
      onClose();
    } catch {
      setError('ไม่สามารถตรวจสอบสิทธิ์ผู้ดูแลระบบได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2400] flex items-center justify-center bg-slate-900/60 dark:bg-black/70 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-login-title"
    >
      <div className="bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#0A3A82] dark:border-[#1D3350] flex items-center justify-between bg-gradient-to-r from-[#0A3A82] to-[#0F62BD] dark:from-[#0C254B] dark:to-[#133B70] text-white">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-white/95" />
            <h3 id="admin-login-title" className="font-semibold text-base">
              เข้าสู่ระบบผู้ดูแล (Admin)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-lg transition-colors"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            เข้าสู่ระบบผู้ดูแลเพื่อเปิดใช้งานฟอร์ม <strong className="text-slate-700 dark:text-slate-200">บันทึกคำขอใหม่</strong> แก้ไข และลบรายการคำขอมาตรวัดน้ำ
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              ชื่อผู้ใช้ (Username)
            </label>
            <input
              type="text"
              required
              autoFocus
              disabled={isSubmitting}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ระบุชื่อผู้ใช้"
              className="w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1E3350] rounded-lg py-2 px-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:bg-white dark:focus:bg-[#0F1E33] focus:border-[#0F62BD] dark:focus:border-[#4EA3FF] focus:ring-2 focus:ring-[#0F62BD]/20"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              รหัสผ่าน (Password)
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                disabled={isSubmitting}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="ระบุรหัสผ่าน"
                className="w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1E3350] rounded-lg py-2 pl-3 pr-10 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:bg-white dark:focus:bg-[#0F1E33] focus:border-[#0F62BD] dark:focus:border-[#4EA3FF] focus:ring-2 focus:ring-[#0F62BD]/20"
              />
              <button
                type="button"
                tabIndex={-1}
                disabled={isSubmitting}
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 rounded transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-lg hover:bg-[#EDF5FD] dark:hover:bg-[#15253D] transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#0B4DA2] hover:bg-[#083A7E] dark:bg-[#2B7CD3] dark:hover:bg-[#1F69BC] disabled:opacity-60 rounded-lg transition-colors shadow-xs"
            >
              {isSubmitting ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
