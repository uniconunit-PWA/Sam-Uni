import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Image as ImageIcon } from 'lucide-react';
import { getDriveImagePreviewUrls } from '../services/driveService';

interface HousePhotoPreviewProps {
  url?: string | null;
  alt?: string;
  /** Force light-card styling (used inside Google Maps white InfoWindow regardless of dark mode) */
  lightSurface?: boolean;
  /** Tailwind height class for thumbnail, e.g. 'h-32' */
  heightClass?: string;
}

export const HousePhotoPreview: React.FC<HousePhotoPreviewProps> = ({
  url,
  alt = 'รูปหน้าบ้าน',
  lightSurface = false,
  heightClass = 'h-32',
}) => {
  const cleanUrl = (url || '').trim();
  const isValidHttp = /^https?:\/\//i.test(cleanUrl);
  const candidates = useMemo(() => getDriveImagePreviewUrls(cleanUrl), [cleanUrl]);
  const [attemptIdx, setAttemptIdx] = useState(0);

  useEffect(() => {
    setAttemptIdx(0);
  }, [cleanUrl]);

  if (!isValidHttp) return null;

  const activeImgSrc = candidates[attemptIdx] || null;

  return (
    <div className="space-y-1.5 pt-1">
      {activeImgSrc && (
        <a
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="คลิกเพื่อเปิดดูรูปเต็มใน Google Drive"
          className={`block w-full ${heightClass} rounded-lg overflow-hidden border transition-opacity hover:opacity-95 ${
            lightSurface
              ? 'border-slate-200 bg-slate-100'
              : 'border-slate-200 dark:border-[#213145] bg-slate-100 dark:bg-[#0F1826]'
          }`}
        >
          <img
            src={activeImgSrc}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setAttemptIdx((idx) => idx + 1)}
            className="w-full h-full object-cover"
          />
        </a>
      )}

      <a
        href={cleanUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 text-[11px] font-medium hover:underline ${
          lightSurface
            ? 'text-[#1A5A8F]'
            : 'text-[#2271B3] dark:text-[#5EA6E0]'
        }`}
      >
        <ImageIcon className="w-3 h-3 shrink-0" />
        <span>ดูรูปหน้าบ้าน (Google Drive)</span>
        <ExternalLink className="w-2.5 h-2.5 shrink-0" />
      </a>
    </div>
  );
};
