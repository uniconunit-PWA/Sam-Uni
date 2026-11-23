import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Crosshair,
  ExternalLink,
  FilePlus2,
  Image as ImageIcon,
  LocateFixed,
  PenLine,
  RotateCcw,
  Save,
  Settings,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { MeterFormPayload, MeterRequest, formatLatLngString, parseLatLngPair } from '../types/meter';
import {
  HousePhotoPayload,
  buildDriveFolderUrl,
  prepareHousePhotoFile,
} from '../services/driveService';

interface AdminRequestFormProps {
  editingRecord: MeterRequest | null;
  pickedCoords: { lat: number; lng: number } | null;
  isGoogleConnected: boolean;
  isGoogleSigningIn: boolean;
  hasAppsScript: boolean;
  serviceAccountConfigured: boolean;
  googleUserEmail: string | null;
  googleAuthError: string;
  isSubmitting: boolean;
  pendingSyncCount: number;
  isFlushingPending: boolean;
  driveFolderId?: string;
  resetTrigger?: number;
  onConnectGoogle: () => void;
  onConnectGoogleForDrive?: () => void;
  onOpenSheetSettings: () => void;
  onFlushPending: () => void;
  onCaptureCurrentGps: () => void;
  onCoordsManualChange: (lat: number | null, lng: number | null) => void;
  onCancelEdit: () => void;
  onSubmit: (
    payload: MeterFormPayload,
    editingRowIndex: number | null,
    photoFile: HousePhotoPayload | null
  ) => void;
}

const AREA_PRESETS = [
  { label: 'ต.สลกบาตร · อ.ขาณุวรลักษบุรี · จ.กำแพงเพชร', subdistrict: 'ต.สลกบาตร', district: 'อ.ขาณุวรลักษบุรี', province: 'จ.กำแพงเพชร' },
  { label: 'ต.แสนตอ · อ.ขาณุวรลักษบุรี · จ.กำแพงเพชร', subdistrict: 'ต.แสนตอ', district: 'อ.ขาณุวรลักษบุรี', province: 'จ.กำแพงเพชร' },
  { label: 'ต.ป่าพุทรา · อ.ขาณุวรลักษบุรี · จ.กำแพงเพชร', subdistrict: 'ต.ป่าพุทรา', district: 'อ.ขาณุวรลักษบุรี', province: 'จ.กำแพงเพชร' },
  { label: 'ต.ยางสูง · อ.ขาณุวรลักษบุรี · จ.กำแพงเพชร', subdistrict: 'ต.ยางสูง', district: 'อ.ขาณุวรลักษบุรี', province: 'จ.กำแพงเพชร' },
  { label: 'ต.คลองขลุง · อ.คลองขลุง · จ.กำแพงเพชร', subdistrict: 'ต.คลองขลุง', district: 'อ.คลองขลุง', province: 'จ.กำแพงเพชร' },
  { label: 'ต.ท่าพุทรา · อ.คลองขลุง · จ.กำแพงเพชร', subdistrict: 'ต.ท่าพุทรา', district: 'อ.คลองขลุง', province: 'จ.กำแพงเพชร' },
  { label: 'ต.ท่ามะเขือ · อ.คลองขลุง · จ.กำแพงเพชร', subdistrict: 'ต.ท่ามะเขือ', district: 'อ.คลองขลุง', province: 'จ.กำแพงเพชร' },
  { label: 'ต.ทุ่งทราย · อ.ทรายทองวัฒนา · จ.กำแพงเพชร', subdistrict: 'ต.ทุ่งทราย', district: 'อ.ทรายทองวัฒนา', province: 'จ.กำแพงเพชร' },
  { label: 'ต.บางแก้ว · อ.บรรพตพิสัย · จ.นครสวรรค์', subdistrict: 'ต.บางแก้ว', district: 'อ.บรรพตพิสัย', province: 'จ.นครสวรรค์' },
  { label: 'ต.บ้านแดน · อ.บรรพตพิสัย · จ.นครสวรรค์', subdistrict: 'ต.บ้านแดน', district: 'อ.บรรพตพิสัย', province: 'จ.นครสวรรค์' },
];

const todayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const AdminRequestForm: React.FC<AdminRequestFormProps> = ({
  editingRecord,
  pickedCoords,
  isGoogleConnected,
  isGoogleSigningIn,
  hasAppsScript,
  serviceAccountConfigured,
  googleUserEmail,
  googleAuthError,
  isSubmitting,
  pendingSyncCount,
  isFlushingPending,
  driveFolderId,
  resetTrigger,
  onConnectGoogle,
  onConnectGoogleForDrive,
  onOpenSheetSettings,
  onFlushPending,
  onCaptureCurrentGps,
  onCoordsManualChange,
  onCancelEdit,
  onSubmit,
}) => {
  const [rqNumber, setRqNumber] = useState('');
  const [requestDate, setRequestDate] = useState(todayIso());
  const [fullName, setFullName] = useState('');
  const [houseNo, setHouseNo] = useState('');
  const [moo, setMoo] = useState('');
  const [subdistrict, setSubdistrict] = useState('');
  const [district, setDistrict] = useState('');
  const [province, setProvince] = useState('');
  const [phone, setPhone] = useState('');
  const [price, setPrice] = useState('0');
  const [status, setStatus] = useState('รับคำร้องแล้ว(รอสำรวจ)');
  const [latLngText, setLatLngText] = useState('');
  const [note, setNote] = useState('');
  const [pendingPhoto, setPendingPhoto] = useState<HousePhotoPayload | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [isPreparingPhoto, setIsPreparingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const resetPhotoInputs = () => {
    if (photoInputRef.current) {
      photoInputRef.current.value = '';
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }
  };

  const resetFields = () => {
    setRqNumber('');
    setRequestDate(todayIso());
    setFullName('');
    setHouseNo('');
    setMoo('');
    setSubdistrict('');
    setDistrict('');
    setProvince('');
    setPhone('');
    setPrice('0');
    setStatus('รับคำร้องแล้ว(รอสำรวจ)');
    setLatLngText('');
    setNote('');
    setPendingPhoto(null);
    setExistingPhotoUrl('');
    setPhotoError('');
    resetPhotoInputs();
  };

  // Load editing record into form
  useEffect(() => {
    if (editingRecord) {
      setRqNumber(editingRecord.rqNumber || '');
      setRequestDate(editingRecord.requestDate || todayIso());
      setFullName(editingRecord.fullName || '');
      setHouseNo(editingRecord.houseNo || '');
      setMoo(editingRecord.moo || '');
      setSubdistrict(editingRecord.subdistrict || '');
      setDistrict(editingRecord.district || '');
      setProvince(editingRecord.province || '');
      setPhone(editingRecord.phone || '');
      setPrice(String(editingRecord.price ?? 0));
      const normalizedStatus = (editingRecord.status || '').trim();
      setStatus(
        !normalizedStatus || normalizedStatus === 'รอตรวจสอบ'
          ? 'รับคำร้องแล้ว(รอสำรวจ)'
          : normalizedStatus
      );
      setLatLngText(formatLatLngString(editingRecord.latitude, editingRecord.longitude));
      setNote(editingRecord.note || '');
      setExistingPhotoUrl(editingRecord.housePhotoUrl || '');
      setPendingPhoto(null);
      setPhotoError('');
      resetPhotoInputs();
    } else {
      resetFields();
    }
  }, [editingRecord]);

  useEffect(() => {
    if (resetTrigger && resetTrigger > 0) {
      resetFields();
    }
  }, [resetTrigger]);

  // Sync map-picked coordinates into lat/long field
  useEffect(() => {
    if (pickedCoords) {
      setLatLngText(formatLatLngString(pickedCoords.lat, pickedCoords.lng));
    }
  }, [pickedCoords]);

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoError('');
    setIsPreparingPhoto(true);
    try {
      const prepared = await prepareHousePhotoFile(file);
      setPendingPhoto(prepared);
    } catch (err: any) {
      setPhotoError(err?.message || 'ไม่สามารถโหลดรูปภาพที่เลือกได้');
    } finally {
      setIsPreparingPhoto(false);
    }
  };

  const handleClearPhoto = () => {
    setPendingPhoto(null);
    setExistingPhotoUrl('');
    setPhotoError('');
    resetPhotoInputs();
  };

  const handlePresetChange = (idxStr: string) => {
    const idx = Number.parseInt(idxStr, 10);
    if (Number.isNaN(idx) || !AREA_PRESETS[idx]) return;
    const preset = AREA_PRESETS[idx];
    setSubdistrict(preset.subdistrict);
    setDistrict(preset.district);
    setProvince(preset.province);
  };

  const handleLatLngBlur = () => {
    const { lat, lng } = parseLatLngPair(latLngText);
    onCoordsManualChange(lat, lng);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { lat, lng } = parseLatLngPair(latLngText);
    onSubmit(
      {
        rqNumber: rqNumber.trim(),
        requestDate,
        fullName: fullName.trim(),
        houseNo: houseNo.trim(),
        moo: moo.trim(),
        subdistrict: subdistrict.trim(),
        district: district.trim(),
        province: province.trim(),
        phone: phone.trim(),
        price: Number.parseFloat(price) || 0,
        status,
        latitude: lat,
        longitude: lng,
        note: note.trim(),
        housePhotoUrl: existingPhotoUrl.trim(),
      },
      editingRecord ? editingRecord.rowIndex : null,
      pendingPhoto
    );
  };

  const hasDirectSheetWrite =
    hasAppsScript || serviceAccountConfigured || isGoogleConnected;

  const inputCls =
    'w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-xl py-1.5 px-2.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:bg-white dark:focus:bg-[#132238] focus:border-[#0B4DA2] dark:focus:border-[#3B8CE2] transition-colors';
  const labelCls = 'block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1';

  return (
    <aside className="bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl shadow-xs overflow-hidden flex flex-col h-full transition-colors">
      <div className="px-4 sm:px-5 py-3 border-b border-[#08306E]/30 dark:border-[#1D3350] bg-gradient-to-r from-[#0A3A82] to-[#0F62BD] dark:from-[#0C254B] dark:to-[#133B70] text-white flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {editingRecord ? (
            <PenLine className="w-4 h-4 text-amber-300 shrink-0" />
          ) : (
            <FilePlus2 className="w-4 h-4 text-white/90 shrink-0" />
          )}
          <h2 className="font-semibold text-sm truncate">
            {editingRecord
              ? editingRecord.rowIndex > 0
                ? `แก้ไขคำขอ (แถวที่ ${editingRecord.rowIndex})`
                : 'แก้ไขคำขอ'
              : 'บันทึกคำขอใหม่'}
          </h2>
        </div>

        {editingRecord && (
          <button
            type="button"
            onClick={() => {
              resetFields();
              onCancelEdit();
            }}
            className="text-xs px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white transition-colors inline-flex items-center gap-1 shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>ยกเลิกแก้ไข</span>
          </button>
        )}
      </div>

      {/* Transparent Sheet Write Sync Status */}
      {hasDirectSheetWrite ? (
        <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/35 border-b border-emerald-200 dark:border-emerald-800/50 space-y-1.5 text-xs text-emerald-900 dark:text-emerald-200 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="truncate font-medium">
              {hasAppsScript
                ? 'เชื่อมต่อ Apps Script แล้ว · บันทึกเข้า Google Sheet อัตโนมัติ'
                : serviceAccountConfigured
                ? 'เชื่อมต่อ Service Account แล้ว · บันทึกเข้า Google Sheet อัตโนมัติ'
                : `เชื่อมต่อ Google Sheets API (${googleUserEmail || 'Google Account'})`}
            </span>
          </div>
          {pendingSyncCount > 0 && (
            <button
              type="button"
              disabled={isFlushingPending}
              onClick={onFlushPending}
              className="w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-lg text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>
                {isFlushingPending
                  ? 'กำลังส่งข้อมูลเข้าชีท...'
                  : `ส่งรายการที่แก้ไขค้างไว้ (${pendingSyncCount}) เข้า Google Sheet`}
              </span>
            </button>
          )}
        </div>
      ) : (
        <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800/50 space-y-2.5 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="leading-snug space-y-0.5">
              <p className="font-semibold">
                บันทึกบนระบบเว็บแล้ว · ยังไม่มีสิทธิ์เขียนลงไฟล์ Google Sheet โดยตรง
              </p>
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                ยืนยันสิทธิ์เจ้าของชีทครั้งเดียวเพื่อเขียนเข้า Google Sheet อัตโนมัติ (หรือวางลิงก์ Apps Script)
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isGoogleSigningIn}
              onClick={onConnectGoogle}
              className="py-1.5 px-3 bg-[#2271B3] hover:bg-[#1A5A8F] dark:bg-[#3584C7] dark:hover:bg-[#2271B3] disabled:opacity-60 text-white rounded-lg text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{isGoogleSigningIn ? 'กำลังเชื่อมต่อ...' : 'เชื่อมสิทธิ์ Google คลิกเดียว'}</span>
            </button>
            <button
              type="button"
              onClick={onOpenSheetSettings}
              className="py-1.5 px-3 bg-white dark:bg-[#0F1826] hover:bg-amber-100 dark:hover:bg-[#162336] border border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 rounded-lg text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>ตั้งค่า Apps Script</span>
            </button>
          </div>
        </div>
      )}

      {googleAuthError && (
        <div className="mx-5 mt-3 text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg px-3 py-2 leading-snug space-y-1.5">
          <p className="break-words">{googleAuthError}</p>
          {typeof window !== 'undefined' &&
            (googleAuthError.includes('origin_mismatch') ||
              googleAuthError.includes('Authorized')) && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-rose-200/70 dark:border-rose-800/50">
                <code className="px-1.5 py-0.5 rounded bg-white/80 dark:bg-[#0F1826] text-[10px] font-mono text-rose-900 dark:text-rose-200 break-all">
                  {window.location.origin}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(window.location.origin).catch(() => {});
                  }}
                  className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-medium shrink-0"
                >
                  คัดลอก URL นี้
                </button>
              </div>
            )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-4 flex-1 flex flex-col justify-between gap-3 overflow-y-auto">
        <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelCls}>
              เลขที่ RQ
            </label>
            <input
              type="text"
              value={rqNumber}
              onChange={(e) => setRqNumber(e.target.value)}
              placeholder="เช่น RQ-2026-001"
              className={`${inputCls} font-mono`}
            />
          </div>
          <div>
            <label className={labelCls}>
              วันที่ยื่นคำร้อง
            </label>
            <input
              type="date"
              required
              value={requestDate}
              onChange={(e) => setRequestDate(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>
            ชื่อ - สกุล ผู้ยื่นคำขอ *
          </label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="ระบุชื่อ-นามสกุล"
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelCls}>
              หมู่ที่ (ถ้ามี)
            </label>
            <select
              value={moo}
              onChange={(e) => setMoo(e.target.value)}
              className={inputCls}
            >
              <option value="">เลือกหมู่ที่ (ถ้ามี)</option>
              {Array.from({ length: 25 }, (_, i) => String(i + 1)).map((m) => (
                <option key={m} value={m}>
                  หมู่ที่ {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              บ้านเลขที่ (ถ้ามี)
            </label>
            <input
              type="text"
              value={houseNo}
              onChange={(e) => setHouseNo(e.target.value)}
              placeholder="เช่น 123/4"
              className={inputCls}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <label className={labelCls}>
              เลือกพื้นที่ด่วน (หรือกรอกด้านล่าง)
            </label>
            <select
              defaultValue=""
              onChange={(e) => handlePresetChange(e.target.value)}
              className={inputCls}
            >
              <option value="">-- เลือกตำบล-อำเภอ-จังหวัด ด่วน --</option>
              {AREA_PRESETS.map((p, idx) => (
                <option key={p.label} value={String(idx)}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                ตำบล
              </label>
              <input
                type="text"
                value={subdistrict}
                onChange={(e) => setSubdistrict(e.target.value)}
                placeholder="ต.สลกบาตร"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                อำเภอ
              </label>
              <input
                type="text"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="อ.ขาณุฯ"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                จังหวัด
              </label>
              <input
                type="text"
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                placeholder="จ.กำแพงเพชร"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelCls}>
              เบอร์โทร (ถ้ามี)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="08xxxxxxxx"
              className={`${inputCls} font-mono`}
            />
          </div>
          <div>
            <label className={labelCls}>
              ราคา / ยอดชำระ (บาท)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${inputCls} font-mono`}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>
            สถานะคำขอ
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={inputCls}
          >
            <option value="รับคำร้องแล้ว(รอสำรวจ)">รับคำร้องแล้ว(รอสำรวจ)</option>
            <option value="รอชำระเงิน">รอชำระเงิน</option>
            <option value="อยู่ระหว่างติดตั้ง">อยู่ระหว่างติดตั้ง</option>
            <option value="ติดตั้งเสร็จสิ้น">ติดตั้งเสร็จสิ้น</option>
            <option value="ไม่มีเส้นท่อ/ยกเลิก">ไม่มีเส้นท่อ/ยกเลิก</option>
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
              พิกัด (lat/long)
            </label>
            <button
              type="button"
              onClick={onCaptureCurrentGps}
              className="text-[11px] font-medium text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-1"
            >
              <LocateFixed className="w-3 h-3" />
              <span>ดึงจาก GPS ปัจจุบัน</span>
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              value={latLngText}
              onChange={(e) => setLatLngText(e.target.value)}
              onBlur={handleLatLngBlur}
              placeholder="คลิกจุดบนแผนที่ หรือพิมพ์ lat, long"
              className={`${inputCls} pl-8 font-mono`}
            />
            <Crosshair className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-2" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-[#2271B3] dark:text-[#5EA6E0]" />
              <span>รูปหน้าบ้าน (1 รูป)</span>
            </label>
            <a
              href={buildDriveFolderUrl(driveFolderId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-medium text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-1"
            >
              <span>ดูโฟลเดอร์ Drive</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoFileChange}
            className="hidden"
          />
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoFileChange}
            className="hidden"
          />

          {pendingPhoto ? (
            <div className="rounded-lg border border-slate-200 dark:border-[#263850] bg-slate-50 dark:bg-[#0F1826] p-2.5 space-y-2">
              <div className="flex items-start gap-2.5">
                <img
                  src={pendingPhoto.previewDataUrl}
                  alt="ตัวอย่างรูปหน้าบ้าน"
                  className="w-20 h-16 object-cover rounded-lg border border-slate-200 dark:border-[#263850] shrink-0 bg-white dark:bg-[#162336]"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">
                    {pendingPhoto.name}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    พร้อมอัปโหลด · {Math.max(1, Math.round(pendingPhoto.sizeBytes / 1024))} KB
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      disabled={isPreparingPhoto || isSubmitting}
                      onClick={() => cameraInputRef.current?.click()}
                      className="px-2 py-1 text-[11px] font-medium rounded-md bg-white dark:bg-[#162336] border border-slate-200 dark:border-[#263850] hover:border-[#2271B3] text-[#2271B3] dark:text-[#5EA6E0] inline-flex items-center gap-1 transition-colors"
                    >
                      <Camera className="w-3 h-3" />
                      <span>ถ่ายรูปใหม่</span>
                    </button>
                    <button
                      type="button"
                      disabled={isPreparingPhoto || isSubmitting}
                      onClick={() => photoInputRef.current?.click()}
                      className="px-2 py-1 text-[11px] font-medium rounded-md bg-white dark:bg-[#162336] border border-slate-200 dark:border-[#263850] hover:border-[#2271B3] text-[#2271B3] dark:text-[#5EA6E0] inline-flex items-center gap-1 transition-colors"
                    >
                      <ImageIcon className="w-3 h-3" />
                      <span>เลือกไฟล์ใหม่</span>
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handleClearPhoto}
                      className="px-2 py-1 text-[11px] font-medium rounded-md bg-white dark:bg-[#162336] border border-slate-200 dark:border-[#263850] hover:border-rose-300 text-rose-600 dark:text-rose-400 inline-flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>ลบรูป</span>
                    </button>
                  </div>
                </div>
              </div>
              {!isGoogleConnected && !hasAppsScript && (
                <div className="pt-2 border-t border-slate-200 dark:border-[#213145] flex items-center justify-between gap-2 text-[11px] text-amber-800 dark:text-amber-300">
                  <span>ต้องเชื่อมสิทธิ์ Google เพื่ออัปโหลดรูปเข้า Drive</span>
                  <button
                    type="button"
                    disabled={isGoogleSigningIn}
                    onClick={() => (onConnectGoogleForDrive ? onConnectGoogleForDrive() : onConnectGoogle())}
                    className="px-2.5 py-1 bg-[#2271B3] hover:bg-[#1A5A8F] text-white rounded-md font-semibold shrink-0 transition-colors"
                  >
                    เชื่อมสิทธิ์ Drive
                  </button>
                </div>
              )}
            </div>
          ) : existingPhotoUrl ? (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/70 dark:bg-emerald-950/25 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={existingPhotoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-1.5 min-w-0 truncate"
                >
                  <ImageIcon className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="truncate">ดูรูปหน้าบ้านที่บันทึกไว้</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleClearPhoto}
                  className="px-2 py-1 text-[11px] font-medium rounded-md bg-white dark:bg-[#162336] border border-slate-200 dark:border-[#263850] text-rose-600 dark:text-rose-400 shrink-0"
                >
                  ลบรูป
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={isPreparingPhoto || isSubmitting}
                  onClick={() => cameraInputRef.current?.click()}
                  className="px-2 py-1 text-[11px] font-medium rounded-md bg-white dark:bg-[#162336] border border-slate-200 dark:border-[#263850] hover:border-[#2271B3] text-[#2271B3] dark:text-[#5EA6E0] inline-flex items-center justify-center gap-1 transition-colors"
                >
                  <Camera className="w-3 h-3" />
                  <span>ถ่ายรูปใหม่</span>
                </button>
                <button
                  type="button"
                  disabled={isPreparingPhoto || isSubmitting}
                  onClick={() => photoInputRef.current?.click()}
                  className="px-2 py-1 text-[11px] font-medium rounded-md bg-white dark:bg-[#162336] border border-slate-200 dark:border-[#263850] hover:border-[#2271B3] text-[#2271B3] dark:text-[#5EA6E0] inline-flex items-center justify-center gap-1 transition-colors"
                >
                  <ImageIcon className="w-3 h-3" />
                  <span>เลือกไฟล์ใหม่</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isPreparingPhoto || isSubmitting}
                  onClick={() => cameraInputRef.current?.click()}
                  className="py-2 px-2.5 rounded-xl border border-dashed border-[#C5D8EE] dark:border-[#243B59] bg-[#F4F8FD] dark:bg-[#091322] hover:bg-[#E7F0FC] dark:hover:bg-[#15253D] hover:border-[#0B4DA2] dark:hover:border-[#3B8CE2] text-slate-700 dark:text-slate-200 transition-colors flex items-center justify-center gap-1.5 text-xs"
                >
                  <Camera className="w-3.5 h-3.5 text-[#0B4DA2] dark:text-[#66B2FF] shrink-0" />
                  <span className="font-medium truncate">
                    {isPreparingPhoto ? 'กำลังเตรียมรูป...' : 'ถ่ายรูป (มือถือ)'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isPreparingPhoto || isSubmitting}
                  onClick={() => photoInputRef.current?.click()}
                  className="py-2 px-2.5 rounded-xl border border-dashed border-[#C5D8EE] dark:border-[#243B59] bg-[#F4F8FD] dark:bg-[#091322] hover:bg-[#E7F0FC] dark:hover:bg-[#15253D] hover:border-[#0B4DA2] dark:hover:border-[#3B8CE2] text-slate-700 dark:text-slate-200 transition-colors flex items-center justify-center gap-1.5 text-xs"
                >
                  <UploadCloud className="w-3.5 h-3.5 text-[#0B4DA2] dark:text-[#66B2FF] shrink-0" />
                  <span className="font-medium truncate">
                    {isPreparingPhoto ? 'กำลังเตรียมรูป...' : 'เลือกจากไฟล์ภาพ'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {photoError && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{photoError}</p>
          )}
        </div>

        <div>
          <label className={labelCls}>
            หมายเหตุเพิ่มเติม
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="รายละเอียดจุดติดตั้งหรือหมายเหตุ..."
            rows={2}
            className={`${inputCls} resize-none`}
          />
        </div>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-[#1B2B40] shrink-0">
          <button
            type="submit"
            disabled={isSubmitting || isPreparingPhoto}
            className="w-full py-2.5 px-4 bg-[#0B4DA2] hover:bg-[#083A7E] dark:bg-[#2B7CD3] dark:hover:bg-[#2266B5] disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-semibold text-sm rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>
              {isSubmitting
                ? 'กำลังบันทึกข้อมูล...'
                : editingRecord
                ? 'บันทึกการแก้ไขคำขอ'
                : 'บันทึกข้อมูลคำขอ'}
            </span>
          </button>
        </div>
      </form>
    </aside>
  );
};
