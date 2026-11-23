import React from 'react';
import { AlertTriangle, CheckCircle2, Trash2, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  details?: Array<{ label: string; value: string }>;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  isProcessing?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  details = [],
  confirmLabel = 'ยืนยันดำเนินการ',
  cancelLabel = 'ยกเลิก',
  variant = 'primary',
  isProcessing = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  const isDanger = variant === 'danger';

  return (
    <div
      className="fixed inset-0 z-[2500] flex items-center justify-center bg-slate-900/60 dark:bg-black/70 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#213145] rounded-xl w-full max-w-md shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-[#213145] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                isDanger
                  ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400'
                  : 'bg-[#EDF5FC] dark:bg-[#2271B3]/20 text-[#2271B3] dark:text-[#5EA6E0]'
              }`}
            >
              {isDanger ? <Trash2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            </div>
            <h3 id="confirm-dialog-title" className="font-semibold text-slate-900 dark:text-slate-100 text-base">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{description}</p>

          {details.length > 0 && (
            <div className="bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#213145] rounded-lg p-3 space-y-1.5 text-xs">
              {details.map((item, idx) => (
                <div key={idx} className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400 shrink-0">{item.label}</span>
                  <span className="text-slate-900 dark:text-slate-100 font-medium text-right break-all">
                    {item.value || '-'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 dark:bg-[#0F1826] border-t border-slate-200 dark:border-[#213145] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#111C2B] border border-slate-300 dark:border-[#263850] rounded-lg hover:bg-slate-50 dark:hover:bg-[#162336] transition-colors whitespace-nowrap"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isProcessing}
            className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400'
                : 'bg-[#2271B3] hover:bg-[#1A5A8F] dark:bg-[#3584C7] dark:hover:bg-[#2271B3] disabled:opacity-60'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{isProcessing ? 'กำลังบันทึก...' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
