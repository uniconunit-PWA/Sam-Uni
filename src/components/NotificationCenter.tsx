import React, { useState, useRef, useEffect } from 'react';
import {
  Bell,
  BellOff,
  CheckCheck,
  MapPin,
  PlusCircle,
  RefreshCw,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { DataChangeEvent } from '../types/meter';

interface NotificationCenterProps {
  events: DataChangeEvent[];
  desktopNotifyEnabled: boolean;
  soundEnabled: boolean;
  onToggleDesktopNotify: () => void;
  onToggleSound: () => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onSelectEvent: (event: DataChangeEvent) => void;
}

export function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(660, now);
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.14);
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.26);
  } catch {
    // Ignore audio context restriction errors
  }
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  events,
  desktopNotifyEnabled,
  soundEnabled,
  onToggleDesktopNotify,
  onToggleSound,
  onMarkAllRead,
  onClearAll,
  onSelectEvent,
}) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const unreadCount = events.filter((e) => !e.read).length;

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const renderTypeIcon = (type: DataChangeEvent['type']) => {
    if (type === 'added') {
      return <PlusCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />;
    }
    if (type === 'deleted') {
      return <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />;
    }
    return <RefreshCw className="w-4 h-4 text-[#0B4DA2] dark:text-[#66B2FF] shrink-0 mt-0.5" />;
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative px-3 py-2 bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] hover:bg-[#E7F0FB] dark:hover:bg-[#15253D] text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
        aria-label="ศูนย์แจ้งเตือนการเปลี่ยนแปลงข้อมูล"
        aria-expanded={open}
      >
        <Bell className="w-4 h-4 text-[#0B4DA2] dark:text-[#66B2FF]" />
        <span>แจ้งเตือน</span>
        {unreadCount > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums bg-rose-600 text-white rounded-md leading-none">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile backdrop so the framed notification card stands out cleanly */}
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px] z-[1790] sm:hidden"
          />

          <div
            role="dialog"
            aria-label="รายการแจ้งเตือนการเปลี่ยนแปลงข้อมูลเรียลไทม์"
            className="fixed inset-x-3 top-1/2 -translate-y-1/2 sm:translate-y-0 sm:inset-auto sm:absolute sm:right-0 sm:top-full sm:mt-2 w-auto sm:w-96 max-h-[78vh] sm:max-h-none flex flex-col bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl shadow-2xl z-[1800] overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[#DCE6F3] dark:border-[#1D3350] flex items-start sm:items-center justify-between gap-2 bg-[#F4F8FD] dark:bg-[#0A1424] shrink-0">
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                  การเปลี่ยนแปลงข้อมูลเรียลไทม์
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                  ตรวจจับอัตโนมัติจาก Google Sheets / AppSheet
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={onToggleSound}
                  title={soundEnabled ? 'ปิดเสียงแจ้งเตือน' : 'เปิดเสียงแจ้งเตือน'}
                  className={`p-1.5 rounded-lg border text-xs transition-colors ${
                    soundEnabled
                      ? 'bg-[#E7F0FB] dark:bg-[#132948] border-[#0F62BD]/30 dark:border-[#4EA3FF]/40 text-[#0B4DA2] dark:text-[#66B2FF]'
                      : 'bg-white dark:bg-[#0F1B2E] border-[#D5E3F4] dark:border-[#1D3350] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={onToggleDesktopNotify}
                  title={
                    desktopNotifyEnabled
                      ? 'ปิดแจ้งเตือนบนเดสก์ท็อป'
                      : 'เปิดแจ้งเตือนบนเดสก์ท็อป'
                  }
                  className={`p-1.5 rounded-lg border text-xs transition-colors ${
                    desktopNotifyEnabled
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-300'
                      : 'bg-white dark:bg-[#0F1B2E] border-[#D5E3F4] dark:border-[#1D3350] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {desktopNotifyEnabled ? (
                    <Bell className="w-3.5 h-3.5" />
                  ) : (
                    <BellOff className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="ปิดหน้าต่างแจ้งเตือน"
                  className="sm:hidden p-1.5 rounded-lg border bg-white dark:bg-[#0F1B2E] border-[#D5E3F4] dark:border-[#1D3350] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 max-h-[55vh] sm:max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-[#192A43]">
              {events.length === 0 ? (
                <div className="py-10 px-5 text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  ยังไม่มีประวัติการเปลี่ยนแปลงข้อมูลในเซสชันนี้ ระบบกำลังติดตามแบบเรียลไทม์อย่างต่อเนื่อง
                </div>
              ) : (
                events.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => {
                      onSelectEvent(ev);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 hover:bg-[#F4F8FD] dark:hover:bg-[#15253D] transition-colors flex items-start gap-3 ${
                      ev.read
                        ? 'bg-white dark:bg-[#0F1B2E]'
                        : 'bg-[#EDF5FD] dark:bg-[#132948]/60'
                    }`}
                  >
                    {renderTypeIcon(ev.type)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start sm:items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 break-words sm:truncate">
                          {ev.fullName}
                          {ev.rqNumber ? ` (${ev.rqNumber})` : ''}
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
                          {formatTime(ev.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed break-words">
                        {ev.summary}
                      </p>
                      {ev.diffs.length > 0 && (
                        <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {ev.diffs.slice(0, 3).map((d, idx) => (
                            <div key={idx} className="break-words sm:truncate leading-snug">
                              {d.field}: {d.from} →{' '}
                              <span className="text-slate-800 dark:text-slate-200 font-medium">
                                {d.to}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {ev.latitude !== null && ev.longitude !== null && (
                        <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[#0B4DA2] dark:text-[#66B2FF] font-medium">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span>คลิกเพื่อดูตำแหน่งบนแผนที่</span>
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            {events.length > 0 && (
              <div className="px-4 py-2.5 bg-[#F4F8FD] dark:bg-[#0A1424] border-t border-[#DCE6F3] dark:border-[#1D3350] flex items-center justify-between text-xs shrink-0">
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="text-[#0B4DA2] dark:text-[#66B2FF] hover:underline font-medium inline-flex items-center gap-1"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>อ่านแล้วทั้งหมด</span>
                </button>
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                >
                  ล้างประวัติ
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
