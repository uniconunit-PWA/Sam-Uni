import React, { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';

interface AdminLoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const ADMIN_USERS: Array<{ u: string; p: string }> = [
  { u: 'Admin', p: '123456' },
  { u: '13367', p: '13367' },
  { u: '16479', p: '16479' },
  { u: '15563', p: '15563' },
  { u: '14356', p: '14356' },
  { u: '15687', p: '15687' },
  { u: '17191', p: '17191' },
  { u: '15676', p: '15676' },
];

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    const p = password.trim();
    const matched = ADMIN_USERS.some((acc) => acc.u === u && acc.p === p);
    if (matched) {
      setError('');
      setUsername('');
      setPassword('');
      onSuccess();
      onClose();
    } else {
      setError('ชื่อผู้ใช้หรือรหัสผ่านผู้ดูแลระบบไม่ถูกต้อง');
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
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ระบุชื่อผู้ใช้ (เช่น Admin)"
              className="w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1E3350] rounded-lg py-2 px-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:bg-white dark:focus:bg-[#0F1E33] focus:border-[#0F62BD] dark:focus:border-[#4EA3FF] focus:ring-2 focus:ring-[#0F62BD]/20"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              รหัสผ่าน (Password)
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="ระบุรหัสผ่าน"
              className="w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1E3350] rounded-lg py-2 px-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:bg-white dark:focus:bg-[#0F1E33] focus:border-[#0F62BD] dark:focus:border-[#4EA3FF] focus:ring-2 focus:ring-[#0F62BD]/20"
            />
          </div>

          {error && (
            <div className="text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-lg hover:bg-[#EDF5FD] dark:hover:bg-[#15253D] transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#0B4DA2] hover:bg-[#083A7E] dark:bg-[#2B7CD3] dark:hover:bg-[#1F69BC] rounded-lg transition-colors shadow-xs"
            >
              เข้าสู่ระบบ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
