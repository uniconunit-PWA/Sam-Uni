import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Laptop,
  Share,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallControl: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok) return;
    }
    setShowGuideModal(true);
  };

  const currentUrl =
    typeof window !== 'undefined' ? window.location.origin + '/' : '';
  const isEmbeddedIframe =
    typeof window !== 'undefined' && window.self !== window.top;

  const handleCopyAppUrl = () => {
    if (!currentUrl) return;
    navigator.clipboard
      ?.writeText(currentUrl)
      .then(() => {
        setCopiedUrl(true);
        window.setTimeout(() => setCopiedUrl(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <>
      <button
        type="button"
        onClick={handleAction}
        title="ติดตั้งแอปและทางลัดบน Chrome / มือถือ"
        className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-white/15 hover:bg-white/25 dark:bg-[#081529]/60 dark:hover:bg-[#102648] border border-white/25 dark:border-[#244A7A] text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
      >
        <Download className="w-3.5 h-3.5 text-sky-200 dark:text-[#7CC4FF]" />
        <span className="hidden sm:inline">
          {isInstallable ? 'ติดตั้งแอป Chrome' : 'ติดตั้ง / ทางลัด'}
        </span>
      </button>

      {showGuideModal && (
        <div
          className="fixed inset-0 z-[2600] flex items-center justify-center bg-slate-900/60 dark:bg-black/70 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl w-full max-w-md shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-[#DCE6F3] dark:border-[#1D3350] bg-gradient-to-r from-[#0A3A82] to-[#0F62BD] dark:from-[#0C254B] dark:to-[#133B70] text-white flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-white/15 text-white flex items-center justify-center shrink-0">
                  <Download className="w-4 h-4" />
                </span>
                <h3
                  id="pwa-install-title"
                  className="font-semibold text-sm sm:text-base text-white truncate"
                >
                  ติดตั้งแอปและสร้างทางลัด Chrome
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15"
                aria-label="ปิดหน้าต่าง"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto text-xs text-slate-700 dark:text-slate-300">
              {isInstallable && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await install();
                    if (ok) setShowGuideModal(false);
                  }}
                  className="w-full py-2.5 px-4 bg-[#2271B3] hover:bg-[#1A5A8F] text-white rounded-lg font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>กดติดตั้งแอปบน Chrome ทันที</span>
                </button>
              )}

              {isEmbeddedIframe && currentUrl && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">
                    เปิดลิงก์ในแท็บ Chrome หลักเพื่อติดตั้งแอปและสร้างทางลัด
                  </p>
                  <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                    หากกำลังเปิดอยู่ในหน้าต่างตัวอย่าง (Preview) แนะนำให้เปิดลิงก์แอปในแท็บใหม่ของ Chrome แล้วกดติดตั้งจากแถบที่อยู่ด้านบน
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={currentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 bg-[#2271B3] hover:bg-[#1A5A8F] text-white rounded-md text-[11px] font-semibold inline-flex items-center gap-1"
                    >
                      <span>เปิดในแท็บ Chrome ใหม่</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyAppUrl}
                      className="px-2.5 py-1.5 bg-white dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md text-[11px] font-medium inline-flex items-center gap-1"
                    >
                      {copiedUrl ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span>คัดลอกลิงก์แล้ว</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>คัดลอกลิงก์แอป</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 dark:border-[#213145] bg-slate-50 dark:bg-[#0F1826] p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                  <Laptop className="w-4 h-4 text-[#2271B3] dark:text-[#5EA6E0]" />
                  <span>Google Chrome บนคอมพิวเตอร์ (Windows / Mac)</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  <li>
                    คลิกไอคอน <strong>ติดตั้ง (Install)</strong> ที่มุมขวาของแถบ URL ใน Chrome
                  </li>
                  <li>
                    หรือกดเมนูจุดสามจุด <strong>⋮ &gt; Cast, save, and share &gt; Install page as app...</strong> หรือ <strong>Create shortcut...</strong> (ติ๊ก <em>Open as window</em>)
                  </li>
                  <li>
                    คลิกขวาที่ไอคอนแอปที่ติดตั้งแล้วจะพบ <strong>ทางลัดด่วน</strong> (แผนที่พิกัด, จัดการคำขอ, สถิติภาพรวม, ตั้งค่าชีท)
                  </li>
                </ol>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-[#213145] bg-slate-50 dark:bg-[#0F1826] p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                  <Smartphone className="w-4 h-4 text-[#2271B3] dark:text-[#5EA6E0]" />
                  <span>Chrome บนมือถือ Android</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  <li>
                    กดเมนู <strong>⋮</strong> มุมขวาบนของ Chrome
                  </li>
                  <li>
                    เลือก <strong>เพิ่มลงในหน้าจอหลัก (Add to Home screen)</strong> หรือ <strong>ติดตั้งแอป (Install app)</strong>
                  </li>
                  <li>
                    กดค้างที่ไอคอนบนหน้าจอมือถือเพื่อเข้าถึงทางลัดไปหน้าแผนที่หรือฟอร์มบันทึกคำขอได้ทันที
                  </li>
                </ol>
              </div>

              {isIOS && (
                <div className="rounded-lg border border-slate-200 dark:border-[#213145] bg-slate-50 dark:bg-[#0F1826] p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                    <Share className="w-4 h-4 text-[#2271B3] dark:text-[#5EA6E0]" />
                    <span>iPhone / iPad (Safari / Chrome iOS)</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    <li>
                      กดปุ่ม <strong>แชร์ (Share)</strong> ที่แถบเครื่องมือ
                    </li>
                    <li>
                      เลื่อนลงและเลือก <strong>เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)</strong>
                    </li>
                  </ol>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                {!isEmbeddedIframe && currentUrl ? (
                  <button
                    type="button"
                    onClick={handleCopyAppUrl}
                    className="px-3 py-1.5 bg-slate-100 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-lg text-[11px] font-medium inline-flex items-center gap-1.5"
                  >
                    {copiedUrl ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>คัดลอกลิงก์แล้ว</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>คัดลอกลิงก์แอป</span>
                      </>
                    )}
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => setShowGuideModal(false)}
                  className="px-4 py-1.5 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-xs font-medium"
                >
                  ปิด
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[2800] flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>โหมดออฟไลน์ — กำลังแสดงข้อมูลที่บันทึกไว้ในเครื่อง</span>
    </div>
  );
};
