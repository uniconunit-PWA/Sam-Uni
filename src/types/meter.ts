export type MeterStatus =
  | 'รอชำระเงิน'
  | 'อยู่ระหว่างติดตั้ง'
  | 'ติดตั้งเสร็จสิ้น'
  | 'ไม่มีเส้นท่อ/ยกเลิก'
  | 'รับคำร้องแล้ว(รอสำรวจ)'
  | string;

export interface MeterRequest {
  /** 1-based row index in Google Sheets (row 1 is header, data starts at row 2) */
  rowIndex: number;
  /** Stable key for diffing across real-time syncs */
  uid: string;
  /** เลขที่ RQ หรือ เลขที่งาน */
  rqNumber: string;
  /** วันที่ยื่นคำร้อง / วันที่ (ISO YYYY-MM-DD or raw sheet date) */
  requestDate: string;
  /** ชื่อ - สกุล */
  fullName: string;
  /** บ้านเลขที่ (ถ้ามี) */
  houseNo: string;
  /** หมู่ที่ */
  moo: string;
  /** ตำบล */
  subdistrict: string;
  /** อำเภอ */
  district: string;
  /** จังหวัด */
  province: string;
  /** พื้นที่รวม (ตำบล-อำเภอ-จังหวัด) */
  locationSummary: string;
  /** เบอร์โทร */
  phone: string;
  /** ราคา / ยอดชำระ (บาท) */
  price: number;
  /** สถานะ */
  status: MeterStatus;
  /** พิกัด Latitude */
  latitude: number | null;
  /** พิกัด Longitude */
  longitude: number | null;
  /** หมายเหตุ */
  note: string;
  /** ลิงก์รูปหน้าบ้านใน Google Drive */
  housePhotoUrl?: string;
  /** Raw values keyed by exact sheet column header */
  raw: Record<string, string>;
}

export interface MeterFormPayload {
  rqNumber: string;
  requestDate: string;
  fullName: string;
  houseNo: string;
  moo: string;
  subdistrict: string;
  district: string;
  province: string;
  phone: string;
  price: number;
  status: string;
  latitude: number | null;
  longitude: number | null;
  note: string;
  housePhotoUrl?: string;
}

export interface SheetTabInfo {
  sheetId: number;
  title: string;
  rowCount?: number;
}

export interface SheetConfig {
  spreadsheetId: string;
  spreadsheetTitle?: string;
  sheetName: string;
  sheetId?: number;
  availableTabs: SheetTabInfo[];
  pollIntervalMs: number;
  appsScriptUrl?: string;
  driveFolderId?: string;
}

export type ConnectionMode = 'oauth' | 'apps_script' | 'public_csv' | 'disconnected' | 'error';

export type ChangeType = 'added' | 'updated' | 'deleted';

export interface FieldChangeDiff {
  field: string;
  from: string;
  to: string;
}

export interface DataChangeEvent {
  id: string;
  timestamp: number;
  type: ChangeType;
  recordUid: string;
  rqNumber: string;
  fullName: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  summary: string;
  diffs: FieldChangeDiff[];
  read: boolean;
}

export type MapLayerType = 'roadmap' | 'satellite' | 'hybrid' | 'terrain';

export interface RouteSummary {
  destinationName: string;
  destinationLat: number;
  destinationLng: number;
  distanceMeters: number;
  durationMillis: number;
  isEstimate?: boolean;
}

export interface CompletedBatchRecord {
  uid: string;
  rowIndex: number;
  rqNumber: string;
  jobNumber: string;
  waterUserNo: string;
  meterNumber: string;
  meterSize?: string;
  requestDate: string;
  fullName: string;
  houseNo: string;
  moo: string;
  subdistrict: string;
  district: string;
  province: string;
  locationSummary: string;
  phone: string;
  price: number;
  status: string;
  latitude: number | null;
  longitude: number | null;
  note: string;
}

export interface BatchMemoSigners {
  meterSizeText?: string;
  proposerName?: string;
  proposerTitle?: string;
  managerName?: string;
  managerTitle?: string;
  adminHeadName?: string;
  adminHeadTitle?: string;
  inspectorTitle?: string;
}

export interface CompletedBatch {
  id: string;
  spreadsheetId: string;
  batchCode: string;
  title: string;
  completedDate: string;
  inspectorName: string;
  note: string;
  exportFormats: Array<'excel' | 'pdf'>;
  statusUpdatedInSheet: boolean;
  includeTax?: boolean;
  memoSigners?: BatchMemoSigners;
  recordCount: number;
  totalAmount: number;
  mappedCount: number;
  records: CompletedBatchRecord[];
  createdAt: number;
}

export function parseLatLngPair(
  combined?: string | null,
  latStr?: string | null,
  lngStr?: string | null
): { lat: number | null; lng: number | null } {
  if (latStr && lngStr) {
    const lat = Number.parseFloat(String(latStr).trim());
    const lng = Number.parseFloat(String(lngStr).trim());
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }

  if (combined) {
    const cleaned = String(combined).trim();
    if (cleaned) {
      const match = cleaned.match(/(-?\d+(?:\.\d+)?)\s*[,\s;/]+\s*(-?\d+(?:\.\d+)?)/);
      if (match) {
        const lat = Number.parseFloat(match[1]);
        const lng = Number.parseFloat(match[2]);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return { lat, lng };
        }
      }
    }
  }

  return { lat: null, lng: null };
}

export function formatLatLngString(lat: number | null, lng: number | null): string {
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return '';
  }
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function getStatusMeta(status: string): {
  label: string;
  color: string;
  textColor: string;
  dotClass: string;
  bgSoftClass: string;
  borderClass: string;
} {
  const s = (status || '').trim();
  if (s === 'ติดตั้งเสร็จสิ้น' || s === 'เสร็จสิ้น' || s === 'ดำเนินการแล้ว') {
    return {
      label: s || 'ติดตั้งเสร็จสิ้น',
      color: '#10b981',
      textColor: 'text-emerald-700 dark:text-emerald-400',
      dotClass: 'bg-emerald-500',
      bgSoftClass: 'bg-emerald-50 dark:bg-emerald-950/50',
      borderClass: 'border-emerald-200 dark:border-emerald-800/50',
    };
  }
  if (s === 'อยู่ระหว่างติดตั้ง' || s === 'กำลังดำเนินการ' || s === 'รอดำเนินการ') {
    return {
      label: s || 'อยู่ระหว่างติดตั้ง',
      color: '#d97706',
      textColor: 'text-amber-700 dark:text-amber-400',
      dotClass: 'bg-amber-500',
      bgSoftClass: 'bg-amber-50 dark:bg-amber-950/50',
      borderClass: 'border-amber-200 dark:border-amber-800/50',
    };
  }
  if (s === 'รอชำระเงิน' || s === 'ค้างชำระ') {
    return {
      label: s || 'รอชำระเงิน',
      color: '#e11d48',
      textColor: 'text-rose-700 dark:text-rose-400',
      dotClass: 'bg-rose-500',
      bgSoftClass: 'bg-rose-50 dark:bg-rose-950/50',
      borderClass: 'border-rose-200 dark:border-rose-800/50',
    };
  }
  if (s === 'ไม่มีเส้นท่อ/ยกเลิก' || s === 'ยกเลิก') {
    return {
      label: s || 'ไม่มีเส้นท่อ/ยกเลิก',
      color: '#ef4444',
      textColor: 'text-red-600 dark:text-red-400',
      dotClass: 'bg-red-500',
      bgSoftClass: 'bg-red-50 dark:bg-red-950/50',
      borderClass: 'border-red-200 dark:border-red-800/50',
    };
  }
  if (s === 'รับคำร้องแล้ว(รอสำรวจ)' || s === 'รอตรวจสอบ' || s === '') {
    return {
      label: 'รับคำร้องแล้ว(รอสำรวจ)',
      color: '#2271b3',
      textColor: 'text-[#2271B3] dark:text-[#5EA6E0]',
      dotClass: 'bg-[#2271B3]',
      bgSoftClass: 'bg-[#EDF5FC] dark:bg-[#2271B3]/15',
      borderClass: 'border-[#D6E7F6] dark:border-[#2271B3]/35',
    };
  }
  return {
    label: s,
    color: '#2271b3',
    textColor: 'text-[#2271B3] dark:text-[#5EA6E0]',
    dotClass: 'bg-[#2271B3]',
    bgSoftClass: 'bg-[#EDF5FC] dark:bg-[#2271B3]/15',
    borderClass: 'border-[#D6E7F6] dark:border-[#2271B3]/35',
  };
}

export function isNoPipeCancelledStatus(status: string): boolean {
  const s = (status || '').trim();
  return s === 'ไม่มีเส้นท่อ/ยกเลิก' || s === 'ยกเลิก';
}

export function isCompletedMeterStatus(status?: string): boolean {
  const s = (status || '').trim();
  return s === 'ติดตั้งเสร็จสิ้น' || s === 'เสร็จสิ้น' || s === 'ดำเนินการแล้ว';
}

export function getNoPipeWarningSvgMarkup(size = 24, withHalo = false): string {
  const styleAttr = withHalo
    ? ' style="filter:drop-shadow(0 0 2px rgba(255,255,255,0.96)) drop-shadow(0 2px 4px rgba(0,0,0,0.45));display:block;"'
    : ' style="display:block;"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none"${styleAttr}><path d="M10.8 10.2 L5.9 6.6 A0.95 0.95 0 1 1 7.2 5.2 Z" fill="#EF4444"/><path d="M9.5 13.3 L2.6 11.6 A1.05 1.05 0 1 1 3.3 9.6 Z" fill="#EF4444"/><path d="M8.2 16.5 L2.5 17.3 A0.85 0.85 0 1 1 2.5 15.6 Z" fill="#EF4444"/><path d="M21.2 10.2 L26.1 6.6 A0.95 0.95 0 1 0 24.8 5.2 Z" fill="#EF4444"/><path d="M22.5 13.3 L29.4 11.6 A1.05 1.05 0 1 0 28.7 9.6 Z" fill="#EF4444"/><path d="M23.8 16.5 L29.5 17.3 A0.85 0.85 0 1 0 29.5 15.6 Z" fill="#EF4444"/><path d="M16 5.2 C16.75 5.2 17.4 5.6 17.8 6.35 L26.5 23.6 C27.15 24.9 26.2 26.5 24.7 26.5 L7.3 26.5 C5.8 26.5 4.85 24.9 5.5 23.6 L14.2 6.35 C14.6 5.6 15.25 5.2 16 5.2 Z" fill="#EF4444"/><path d="M16 11.1 C16.9 11.1 17.45 11.75 17.35 12.7 L16.75 19.35 C16.7 19.95 16.38 20.35 16 20.35 C15.62 20.35 15.3 19.95 15.25 19.35 L14.65 12.7 C14.55 11.75 15.1 11.1 16 11.1 Z" fill="#FFFFFF"/><circle cx="16" cy="23.25" r="1.45" fill="#FFFFFF"/></svg>`;
}

