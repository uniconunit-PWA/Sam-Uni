import React, { useState } from 'react';
import { ArrowRight, Droplets, MousePointerClick } from 'lucide-react';

interface WelcomeSplashPageProps {
  onEnter: () => void;
  isDark?: boolean;
}

const WELCOME_POSTER_SRC = '/assets/aistudio/__________________________________1__5ac2f92c.png';

export const WelcomeSplashPage: React.FC<WelcomeSplashPageProps> = ({
  onEnter,
  isDark = false,
}) => {
  const [imageError, setImageError] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const handleEnterClick = () => {
    if (isLeaving) return;
    setIsLeaving(true);
    window.setTimeout(() => {
      onEnter();
    }, 160);
  };

  return (
    <div
      className={`relative min-h-dvh w-full overflow-hidden flex flex-col items-center justify-center p-2.5 sm:p-5 lg:p-6 select-none transition-opacity duration-150 motion-reduce:transition-none ${
        isLeaving ? 'opacity-0' : 'opacity-100'
      } ${
        isDark
          ? 'bg-gradient-to-b from-[#041229] via-[#082552] to-[#0C3873]'
          : 'bg-gradient-to-b from-[#072C68] via-[#0B5BB8] to-[#1184CE]'
      }`}
    >
      {/* Ambient blurred backdrop so desktop widescreen, tablet, and mobile viewports blend seamlessly */}
      {!imageError && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <img
            src={WELCOME_POSTER_SRC}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover scale-110 blur-2xl opacity-30 saturate-125"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#051B42]/45 via-[#072B66]/25 to-[#04173A]/70" />
        </div>
      )}

      {/* Main clickable poster adapted cleanly to Desktop, Tablet, and Mobile */}
      <main className="relative z-10 w-full max-w-[1200px] flex flex-col items-center justify-center">
        <button
          type="button"
          onClick={handleEnterClick}
          aria-label="กดที่รูปภาพเพื่อเข้าสู่ระบบติดตามคำขอติดตั้ง / ย้ายมาตรวัดน้ำ"
          className="group relative flex flex-col items-center justify-center w-fit max-w-full cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 transition-transform duration-200 motion-reduce:transition-none hover:scale-[1.01] active:scale-[0.99]"
        >
          {!imageError ? (
            <div className="relative flex items-center justify-center max-w-full rounded-xl sm:rounded-2xl overflow-hidden shadow-[0_24px_60px_-12px_rgba(2,18,52,0.7)] ring-1 ring-white/30 bg-[#0A4CA3]">
              <img
                src={WELCOME_POSTER_SRC}
                alt="การประปาส่วนภูมิภาค ระบบติดตามคำขอ ติดตั้ง / ย้ายมาตรวัดน้ำ — กดที่รูปภาพเพื่อเข้าหน้าถัดไป"
                referrerPolicy="no-referrer"
                onError={() => setImageError(true)}
                className="block w-auto h-auto max-w-[min(100%,calc(100vw-1.25rem))] sm:max-w-[min(92vw,760px)] lg:max-w-[min(90vw,960px)] max-h-[calc(100dvh-4.25rem)] sm:max-h-[calc(100dvh-5.25rem)] lg:max-h-[calc(100dvh-5.75rem)] object-contain"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/15 group-hover:bg-white/[0.03] transition-colors duration-200"
              />
            </div>
          ) : (
            <div className="w-full max-w-xl rounded-2xl border border-white/25 bg-gradient-to-br from-[#0A3D8A] via-[#0E64C2] to-[#1798C8] p-8 sm:p-12 text-center text-white shadow-2xl space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-white text-[#0A3D8A] flex items-center justify-center shadow-md">
                <Droplets className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs sm:text-sm text-sky-100 font-medium">
                  การประปาส่วนภูมิภาค · Provincial Waterworks Authority
                </p>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                  ระบบติดตามคำขอติดตั้ง / ย้ายมาตรวัดน้ำ
                </h1>
                <p className="text-xs sm:text-sm text-sky-100/90">
                  ตรวจสอบสถานะได้ทุกที่ ทุกเวลา
                </p>
              </div>
            </div>
          )}

          {/* Clean single-line prompt below the image (never overlapping poster artwork) */}
          <div className="mt-2.5 sm:mt-3.5 inline-flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold text-white/95 group-hover:text-white tracking-wide drop-shadow-sm whitespace-nowrap min-h-[32px]">
            <MousePointerClick className="w-4 h-4 text-sky-200 shrink-0" />
            <span>แตะหรือคลิกที่รูปภาพเพื่อเข้าหน้าถัดไป</span>
            <ArrowRight className="w-4 h-4 text-sky-200 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
          </div>
        </button>
      </main>
    </div>
  );
};
