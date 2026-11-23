import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import {
  CompletedBatch,
  CompletedBatchRecord,
  MeterRequest,
  formatLatLngString,
  getStatusMeta,
  isNoPipeCancelledStatus,
} from '../types/meter';

export type ExportScope = 'all' | 'by_status' | 'by_area';

export interface ExportFilterContext {
  status: string;
  location: string;
  province?: string;
  district?: string;
  subdistrict?: string;
  moo?: string;
  month: string;
  dateFrom?: string;
  dateTo?: string;
  searchQuery: string;
  totalUnfilteredCount: number;
}

export interface StatusAnalyticsItem {
  status: string;
  label: string;
  color: string;
  count: number;
  pct: number;
  amount: number;
}

export interface AreaAnalyticsItem {
  area: string;
  count: number;
  completed: number;
  inProgress: number;
  unpaid: number;
  amount: number;
}

export interface ExportAnalytics {
  total: number;
  completed: number;
  inProgress: number;
  unpaid: number;
  cancelled: number;
  totalAmount: number;
  avgAmount: number;
  mappedCount: number;
  completionRate: number;
  statusBreakdown: StatusAnalyticsItem[];
  areaBreakdown: AreaAnalyticsItem[];
}

const RAL_PRIMARY = '#2271B3';
const RAL_DEEP = '#1A5A8F';
const RAL_SOFT = '#EDF5FC';
const EXPORT_EXCEL_FONT_NAME = 'TH Sarabun PSK';
const EXPORT_PDF_FONT_FAMILY = '"TH Sarabun PSK", "Sarabun", sans-serif';
// A4 canvases are rendered at 8 px/mm. Since 1 typographic pt = 25.4/72 mm,
// 1 pt = 2.8222 px -> 29pt = 82px, 20pt = 56px, 18pt = 51px, 16pt = 45px, 14pt = 40px, 12pt = 34px.
const SARABUN_PT_29_PX = 82;
const SARABUN_PT_20_PX = 56;
const SARABUN_PT_18_PX = 51;
const SARABUN_PT_16_PX = 45;
const SARABUN_PT_14_PX = 40;
const SARABUN_PT_12_PX = 34;

let cachedThSarabunPskPromise: Promise<void> | null = null;
async function ensureThSarabunPskLoaded(): Promise<void> {
  if (typeof document === 'undefined') return;
  if (!cachedThSarabunPskPromise) {
    cachedThSarabunPskPromise = (async () => {
      try {
        if (typeof FontFace !== 'undefined' && document.fonts) {
          const variants = [
            { weight: '400', url: '/fonts/THSarabunPSK-Regular.ttf' },
            { weight: '500', url: '/fonts/THSarabunPSK-Regular.ttf' },
            { weight: '600', url: '/fonts/THSarabunPSK-Bold.ttf' },
            { weight: '700', url: '/fonts/THSarabunPSK-Bold.ttf' },
          ];
          await Promise.all(
            variants.map(async ({ weight, url }) => {
              const ff = new FontFace('TH Sarabun PSK', `url(${url})`, {
                weight,
                style: 'normal',
              });
              const loaded = await ff.load();
              document.fonts.add(loaded);
            })
          );
        }
      } catch {
        // Fallback gracefully if font fails to load
      }
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    })();
  }
  await cachedThSarabunPskPromise;
}
const PREFERRED_STATUS_ORDER = [
  'ติดตั้งเสร็จสิ้น',
  'อยู่ระหว่างติดตั้ง',
  'รอชำระเงิน',
  'รับคำร้องแล้ว(รอสำรวจ)',
  'ไม่มีเส้นท่อ/ยกเลิก',
];

export function computeExportAnalytics(records: MeterRequest[]): ExportAnalytics {
  const total = records.length;
  let completed = 0;
  let inProgress = 0;
  let unpaid = 0;
  let cancelled = 0;
  let totalAmount = 0;
  let mappedCount = 0;

  const statusMap = new Map<string, { count: number; amount: number }>();
  const areaMap = new Map<
    string,
    { count: number; completed: number; inProgress: number; unpaid: number; amount: number }
  >();

  records.forEach((r) => {
    const rawSt = (r.status || '').trim();
    const st = !rawSt || rawSt === 'รอตรวจสอบ' ? 'รับคำร้องแล้ว(รอสำรวจ)' : rawSt;
    const price = Number.isFinite(r.price) ? r.price : 0;
    totalAmount += price;
    if (r.latitude !== null && r.longitude !== null) {
      mappedCount += 1;
    }

    const isDone = st === 'ติดตั้งเสร็จสิ้น' || st === 'เสร็จสิ้น' || st === 'ดำเนินการแล้ว';
    const isProg =
      st === 'อยู่ระหว่างติดตั้ง' ||
      st === 'รับคำร้องแล้ว(รอสำรวจ)' ||
      st === 'รอตรวจสอบ' ||
      st === 'กำลังดำเนินการ' ||
      st === 'รอดำเนินการ';
    const isUnpaid = st === 'รอชำระเงิน' || st === 'ค้างชำระ';
    const isCancelled = st === 'ไม่มีเส้นท่อ/ยกเลิก' || st === 'ยกเลิก';

    if (isDone) completed += 1;
    else if (isUnpaid) unpaid += 1;
    else if (isCancelled) cancelled += 1;
    else if (isProg) inProgress += 1;

    const prevSt = statusMap.get(st) || { count: 0, amount: 0 };
    statusMap.set(st, { count: prevSt.count + 1, amount: prevSt.amount + price });

    const areaKey =
      (r.subdistrict && r.subdistrict.trim()) ||
      (r.locationSummary ? r.locationSummary.split(' ')[0].trim() : '') ||
      'ไม่ระบุตำบล';
    const prevArea = areaMap.get(areaKey) || {
      count: 0,
      completed: 0,
      inProgress: 0,
      unpaid: 0,
      amount: 0,
    };
    areaMap.set(areaKey, {
      count: prevArea.count + 1,
      completed: prevArea.completed + (isDone ? 1 : 0),
      inProgress: prevArea.inProgress + (isProg ? 1 : 0),
      unpaid: prevArea.unpaid + (isUnpaid ? 1 : 0),
      amount: prevArea.amount + price,
    });
  });

  const statusBreakdown: StatusAnalyticsItem[] = Array.from(statusMap.entries())
    .sort(([a], [b]) => {
      const ia = PREFERRED_STATUS_ORDER.indexOf(a);
      const ib = PREFERRED_STATUS_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b, 'th');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map(([status, val]) => {
      const meta = getStatusMeta(status);
      return {
        status,
        label: meta.label,
        color: meta.color,
        count: val.count,
        pct: total > 0 ? Math.round((val.count / total) * 100) : 0,
        amount: val.amount,
      };
    });

  const areaBreakdown: AreaAnalyticsItem[] = Array.from(areaMap.entries())
    .sort((a, b) => b[1].count - a[1].count || b[1].amount - a[1].amount)
    .map(([area, val]) => ({
      area,
      ...val,
    }));

  return {
    total,
    completed,
    inProgress,
    unpaid,
    cancelled,
    totalAmount,
    avgAmount: total > 0 ? totalAmount / total : 0,
    mappedCount,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    statusBreakdown,
    areaBreakdown,
  };
}

export function describeActiveFilters(ctx: ExportFilterContext): string {
  const parts: string[] = [];
  if (ctx.status) parts.push(`สถานะ: ${ctx.status}`);

  const areaParts: string[] = [];
  if (ctx.moo) areaParts.push(`หมู่ที่ ${ctx.moo}`);
  if (ctx.subdistrict) areaParts.push(ctx.subdistrict);
  if (ctx.district) areaParts.push(ctx.district);
  if (ctx.province) areaParts.push(ctx.province);
  if (areaParts.length > 0) {
    parts.push(`พื้นที่: ${areaParts.join(' ')}`);
  } else if (ctx.location) {
    parts.push(`พื้นที่: ${ctx.location}`);
  }

  if (ctx.dateFrom && ctx.dateTo) {
    parts.push(`ช่วงวันที่: ${formatThaiDate(ctx.dateFrom)} - ${formatThaiDate(ctx.dateTo)}`);
  } else if (ctx.dateFrom) {
    parts.push(`ตั้งแต่วันที่: ${formatThaiDate(ctx.dateFrom)}`);
  } else if (ctx.dateTo) {
    parts.push(`ถึงวันที่: ${formatThaiDate(ctx.dateTo)}`);
  } else if (ctx.month) {
    parts.push(`เดือน/ปี: ${ctx.month}`);
  }

  if (ctx.searchQuery.trim()) parts.push(`คำค้น: "${ctx.searchQuery.trim()}"`);
  if (parts.length === 0) return 'ทั้งหมด (ไม่มีตัวกรอง)';
  return parts.join('  |  ');
}

function scopeLabel(scope: ExportScope): string {
  if (scope === 'by_status') return 'สรุปและรายการแยกตามสถานะคำขอ';
  if (scope === 'by_area') return 'สรุปและรายการแยกตามตำบล / พื้นที่';
  return 'รายงานภาพรวมทั้งหมด (แดชบอร์ดสรุป + ตารางคำขอ)';
}

function formatThaiDate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatBaht(value: number): string {
  return value.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildFilename(ext: 'xlsx' | 'pdf', scope: ExportScope): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const tag =
    scope === 'by_status'
      ? 'แยกตามสถานะ'
      : scope === 'by_area'
      ? 'แยกตามพื้นที่'
      : 'ภาพรวมและตาราง';
  return `รายงานคำขอมาตรวัดน้ำ_${tag}_${y}${m}${d}_${hh}${mm}.${ext}`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawNoPipeWarningCanvasIcon(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number
): void {
  const s = size / 32;
  const ox = centerX - size / 2;
  const oy = centerY - size / 2;
  const pt = (x: number, y: number): [number, number] => [ox + x * s, oy + y * s];

  ctx.save();
  ctx.fillStyle = '#EF4444';

  // Radiating left & right rays (rounded outer tips tapering inward)
  const drawRay = (tipX: number, tipY: number, outerX: number, outerY: number) => {
    const [tx, ty] = pt(tipX, tipY);
    const [oxp, oyp] = pt(outerX, outerY);
    const dx = oxp - tx;
    const dy = oyp - ty;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (1.0 * s);
    const ny = (dx / len) * (1.0 * s);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(oxp + nx, oyp + ny);
    ctx.arc(oxp, oyp, 1.0 * s, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
    ctx.closePath();
    ctx.fill();
  };

  drawRay(10.8, 10.2, 6.5, 5.9);
  drawRay(9.5, 13.3, 3.0, 10.6);
  drawRay(8.2, 16.5, 2.5, 16.5);
  drawRay(21.2, 10.2, 25.5, 5.9);
  drawRay(22.5, 13.3, 29.0, 10.6);
  drawRay(23.8, 16.5, 29.5, 16.5);

  // Rounded red triangle
  ctx.beginPath();
  ctx.moveTo(...pt(16, 5.2));
  ctx.bezierCurveTo(...pt(16.75, 5.2), ...pt(17.4, 5.6), ...pt(17.8, 6.35));
  ctx.lineTo(...pt(26.5, 23.6));
  ctx.bezierCurveTo(...pt(27.15, 24.9), ...pt(26.2, 26.5), ...pt(24.7, 26.5));
  ctx.lineTo(...pt(7.3, 26.5));
  ctx.bezierCurveTo(...pt(5.8, 26.5), ...pt(4.85, 24.9), ...pt(5.5, 23.6));
  ctx.lineTo(...pt(14.2, 6.35));
  ctx.bezierCurveTo(...pt(14.6, 5.6), ...pt(15.25, 5.2), ...pt(16, 5.2));
  ctx.closePath();
  ctx.fill();

  // White exclamation mark
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(...pt(16, 11.1));
  ctx.bezierCurveTo(...pt(16.9, 11.1), ...pt(17.45, 11.75), ...pt(17.35, 12.7));
  ctx.lineTo(...pt(16.75, 19.35));
  ctx.bezierCurveTo(...pt(16.7, 19.95), ...pt(16.38, 20.35), ...pt(16, 20.35));
  ctx.bezierCurveTo(...pt(15.62, 20.35), ...pt(15.3, 19.95), ...pt(15.25, 19.35));
  ctx.lineTo(...pt(14.65, 12.7));
  ctx.bezierCurveTo(...pt(14.55, 11.75), ...pt(15.1, 11.1), ...pt(16, 11.1));
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(...pt(16, 23.25), 1.45 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

/**
 * Draws the standardized Visual Dashboard Summary block (4 KPI Cards + Status Donut + Area Bar Chart)
 * onto an existing 2D canvas region. Reused by both Excel embedded chart image & PDF Page 1.
 */
function drawDashboardSummaryBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  analytics: ExportAnalytics
): number {
  const kpiGap = 18;
  const kpiW = (w - kpiGap * 2) / 3;
  const kpiH = 112;

  const kpis = [
    {
      label: 'คำขอที่กรองทั้งหมด',
      value: `${analytics.total.toLocaleString('th-TH')} รายการ`,
      sub: `ครอบคลุม ${analytics.areaBreakdown.length} ตำบล / พื้นที่`,
      accent: RAL_PRIMARY,
      soft: '#EDF5FC',
    },
    {
      label: 'ติดตั้งเสร็จสิ้น',
      value: `${analytics.completed.toLocaleString('th-TH')} รายการ`,
      sub: `อัตราสำเร็จ ${analytics.completionRate}%`,
      accent: '#10B981',
      soft: '#ECFDF5',
    },
    {
      label: 'ดำเนินการ / รอชำระเงิน',
      value: `${(analytics.inProgress + analytics.unpaid).toLocaleString('th-TH')} รายการ`,
      sub: `รอชำระเงิน ${analytics.unpaid} รายการ`,
      accent: '#D97706',
      soft: '#FFFBEB',
    },
  ];

  kpis.forEach((item, idx) => {
    const kx = x + idx * (kpiW + kpiGap);
    ctx.fillStyle = '#FFFFFF';
    drawRoundedRect(ctx, kx, y, kpiW, kpiH, 12);
    ctx.fill();
    ctx.strokeStyle = '#DCE4EE';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Left accent pill bar
    ctx.fillStyle = item.accent;
    drawRoundedRect(ctx, kx + 14, y + 18, 6, kpiH - 36, 3);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748B';
    ctx.font = `700 32px ${EXPORT_PDF_FONT_FAMILY}`;
    ctx.fillText(truncateText(ctx, item.label, kpiW - 44), kx + 30, y + 34);

    ctx.fillStyle = item.accent;
    ctx.font = `700 45px ${EXPORT_PDF_FONT_FAMILY}`;
    ctx.fillText(truncateText(ctx, item.value, kpiW - 44), kx + 30, y + 72);

    ctx.fillStyle = '#64748B';
    ctx.font = `400 28px ${EXPORT_PDF_FONT_FAMILY}`;
    ctx.fillText(truncateText(ctx, item.sub, kpiW - 44), kx + 30, y + 99);
  });

  // 2-Column Visual Charts Row
  const chartsY = y + kpiH + 18;
  const chartGap = 20;
  const chartW = (w - chartGap) / 2;
  const chartH = 318;

  // --- Left Chart: Status Donut + Breakdown ---
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, x, chartsY, chartW, chartH, 14);
  ctx.fill();
  ctx.strokeStyle = '#DCE4EE';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#0F172A';
  ctx.font = `700 36px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText('สัดส่วนความคืบหน้าและสถานะคำขอ', x + 24, chartsY + 38);

  const cx = x + 130;
  const cy = chartsY + 180;
  const outerR = 88;
  const innerR = 54;

  if (analytics.total === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, (outerR + innerR) / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = outerR - innerR;
    ctx.stroke();
  } else {
    let startAngle = -Math.PI / 2;
    analytics.statusBreakdown.forEach((st) => {
      const sliceAngle = (st.count / analytics.total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, (outerR + innerR) / 2, startAngle, startAngle + sliceAngle);
      ctx.strokeStyle = st.color;
      ctx.lineWidth = outerR - innerR;
      ctx.stroke();
      startAngle += sliceAngle;
    });
  }

  ctx.fillStyle = '#0F172A';
  ctx.textAlign = 'center';
  ctx.font = `700 45px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText(String(analytics.total), cx, cy + 6);
  ctx.fillStyle = '#64748B';
  ctx.font = `400 28px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText('รายการ', cx, cy + 32);
  ctx.textAlign = 'left';

  // Status Legend List on Right Half of Donut Card
  const legX = x + 248;
  const legW = chartW - 270;
  let legY = chartsY + 62;
  analytics.statusBreakdown.slice(0, 6).forEach((st) => {
    ctx.fillStyle = '#F8FAFD';
    drawRoundedRect(ctx, legX, legY, legW, 36, 7);
    ctx.fill();

    if (isNoPipeCancelledStatus(st.status)) {
      drawNoPipeWarningCanvasIcon(ctx, legX + 16, legY + 18, 18);
    } else {
      ctx.fillStyle = st.color;
      drawRoundedRect(ctx, legX + 10, legY + 12, 12, 12, 3);
      ctx.fill();
    }

    ctx.fillStyle = '#1E293B';
    ctx.font = `700 30px ${EXPORT_PDF_FONT_FAMILY}`;
    ctx.fillText(truncateText(ctx, st.label, legW - 155), legX + 30, legY + 26);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#0F172A';
    ctx.font = `700 30px ${EXPORT_PDF_FONT_FAMILY}`;
    ctx.fillText(`${st.count} (${st.pct}%)`, legX + legW - 12, legY + 26);
    ctx.textAlign = 'left';

    legY += 41;
  });

  // --- Right Chart: Area / Subdistrict Bar Chart ---
  const rx = x + chartW + chartGap;
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, rx, chartsY, chartW, chartH, 14);
  ctx.fill();
  ctx.strokeStyle = '#DCE4EE';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#0F172A';
  ctx.font = `700 36px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText('ปริมาณคำขอแยกตามตำบล / พื้นที่ (สูงสุด 6 อันดับ)', rx + 24, chartsY + 38);

  const topAreas = analytics.areaBreakdown.slice(0, 6);
  if (topAreas.length === 0) {
    ctx.fillStyle = '#94A3B8';
    ctx.font = `400 34px ${EXPORT_PDF_FONT_FAMILY}`;
    ctx.fillText('ไม่พบข้อมูลพื้นที่', rx + 24, chartsY + 160);
  } else {
    const maxCount = Math.max(...topAreas.map((a) => a.count), 1);
    let barY = chartsY + 60;
    const innerW = chartW - 48;
    topAreas.forEach((area) => {
      ctx.fillStyle = '#1E293B';
      ctx.font = `700 30px ${EXPORT_PDF_FONT_FAMILY}`;
      ctx.fillText(truncateText(ctx, area.area, innerW - 120), rx + 24, barY + 18);

      ctx.textAlign = 'right';
      ctx.fillStyle = RAL_DEEP;
      ctx.font = `700 29px ${EXPORT_PDF_FONT_FAMILY}`;
      ctx.fillText(
        `${area.count.toLocaleString('th-TH')} ราย`,
        rx + chartW - 24,
        barY + 18
      );
      ctx.textAlign = 'left';

      const trackY = barY + 25;
      ctx.fillStyle = '#EBF1F7';
      drawRoundedRect(ctx, rx + 24, trackY, innerW, 11, 5);
      ctx.fill();

      const fillW = Math.max((area.count / maxCount) * innerW, 10);
      ctx.fillStyle = RAL_PRIMARY;
      drawRoundedRect(ctx, rx + 24, trackY, fillW, 11, 5);
      ctx.fill();

      barY += 41;
    });
  }

  return chartsY + chartH;
}

/**
 * Generates an executive PNG data URL of the Visual Dashboard Summary
 * so Excel (.xlsx) can embed it directly on the Dashboard Summary sheet.
 */
async function renderDashboardImageBase64(
  records: MeterRequest[],
  analytics: ExportAnalytics,
  filterCtx: ExportFilterContext
): Promise<string> {
  await ensureThSarabunPskLoaded();

  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 565;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#F3F6FA';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Header strip
  ctx.fillStyle = RAL_PRIMARY;
  ctx.fillRect(0, 0, canvas.width, 6);

  ctx.fillStyle = '#0F172A';
  ctx.font = `700 ${SARABUN_PT_18_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText(
    `ภาพแดชบอร์ดสรุปข้อมูลคำขอมาตรวัดน้ำ (${records.length} รายการที่กรอง)`,
    28,
    46
  );

  ctx.fillStyle = '#475569';
  ctx.font = `400 34px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText(`เงื่อนไขตัวกรอง: ${describeActiveFilters(filterCtx)}`, 28, 78);

  drawDashboardSummaryBlock(ctx, 28, 96, canvas.width - 56, analytics);

  return canvas.toDataURL('image/png');
}

function groupRecordsForScope(
  records: MeterRequest[],
  scope: ExportScope
): Array<{ groupTitle: string; items: MeterRequest[]; subtotal: number }> {
  if (scope === 'all') {
    const subtotal = records.reduce((s, r) => s + (Number.isFinite(r.price) ? r.price : 0), 0);
    return [{ groupTitle: '', items: records, subtotal }];
  }

  const map = new Map<string, MeterRequest[]>();
  records.forEach((r) => {
    const key =
      scope === 'by_status'
        ? !r.status || r.status.trim() === 'รอตรวจสอบ'
          ? 'รับคำร้องแล้ว(รอสำรวจ)'
          : r.status.trim()
        : (r.subdistrict && r.subdistrict.trim()) ||
          (r.locationSummary ? r.locationSummary.split(' ')[0].trim() : '') ||
          'ไม่ระบุตำบล';
    const arr = map.get(key) || [];
    arr.push(r);
    map.set(key, arr);
  });

  const keys = Array.from(map.keys()).sort((a, b) => {
    if (scope === 'by_status') {
      const ia = PREFERRED_STATUS_ORDER.indexOf(a);
      const ib = PREFERRED_STATUS_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
    } else {
      const lenDiff = (map.get(b)?.length || 0) - (map.get(a)?.length || 0);
      if (lenDiff !== 0) return lenDiff;
    }
    return a.localeCompare(b, 'th');
  });

  return keys.map((k) => {
    const items = map.get(k) || [];
    const subtotal = items.reduce((s, r) => s + (Number.isFinite(r.price) ? r.price : 0), 0);
    return { groupTitle: k, items, subtotal };
  });
}

function populateDetailSheet(
  ws: ExcelJS.Worksheet,
  title: string,
  filterSummary: string,
  groups: Array<{ groupTitle: string; items: MeterRequest[]; subtotal: number }>,
  totalRecords: number,
  totalAmount: number
): void {
  const columnsCount = 12;
  ws.mergeCells(1, 1, 1, columnsCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2271B3' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 36;

  ws.mergeCells(2, 1, 2, columnsCount);
  const metaCell = ws.getCell(2, 1);
  metaCell.value = `ตัวกรอง: ${filterSummary}   |   วันที่ออกรายงาน: ${new Date().toLocaleString('th-TH')}`;
  metaCell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF334155' } };
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF5FC' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 26;

  const headers = [
    'ลำดับ',
    'เลขที่ RQ',
    'วันที่ยื่นคำร้อง',
    'ชื่อ - สกุล',
    'บ้านเลขที่',
    'หมู่ที่',
    'ตำบล / อำเภอ / จังหวัด',
    'เบอร์โทร',
    'ราคา (บาท)',
    'สถานะคำขอ',
    'พิกัด (lat, long)',
    'หมายเหตุ',
  ];

  const headerRow = ws.getRow(4);
  headerRow.values = headers;
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5A8F' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF1A5A8F' } },
      bottom: { style: 'thin', color: { argb: 'FF1A5A8F' } },
      left: { style: 'thin', color: { argb: 'FF2E6FA3' } },
      right: { style: 'thin', color: { argb: 'FF2E6FA3' } },
    };
  });

  ws.views = [{ state: 'frozen', ySplit: 4 }];
  if (groups.length === 1 && !groups[0].groupTitle) {
    ws.autoFilter = { from: 'A4', to: 'L4' };
  }

  const colWidths = [9, 18, 18, 28, 14, 11, 35, 18, 17, 23, 26, 28];
  colWidths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  let rowCursor = 5;
  let seq = 1;

  groups.forEach((grp) => {
    if (grp.groupTitle) {
      ws.mergeCells(rowCursor, 1, rowCursor, columnsCount);
      const gCell = ws.getCell(rowCursor, 1);
      gCell.value = `กลุ่ม: ${grp.groupTitle}   (${grp.items.length} รายการ  ·  ยอดรวม ${formatBaht(grp.subtotal)} บาท)`;
      gCell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FF1A5A8F' } };
      gCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E7F6' } };
      gCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      gCell.border = {
        top: { style: 'thin', color: { argb: 'FF9EC4E6' } },
        bottom: { style: 'thin', color: { argb: 'FF9EC4E6' } },
      };
      ws.getRow(rowCursor).height = 26;
      rowCursor += 1;
    }

    grp.items.forEach((rec, idx) => {
      const r = ws.getRow(rowCursor);
      const statusMeta = getStatusMeta(rec.status);
      r.values = [
        seq++,
        rec.rqNumber || `#${rec.rowIndex}`,
        formatThaiDate(rec.requestDate),
        rec.fullName || '-',
        rec.houseNo || '-',
        rec.moo ? `หมู่ที่ ${rec.moo}` : '-',
        rec.locationSummary || '-',
        rec.phone || '-',
        Number.isFinite(rec.price) ? rec.price : 0,
        statusMeta.label,
        formatLatLngString(rec.latitude, rec.longitude) || 'ยังไม่ระบุพิกัด',
        rec.note || '-',
      ];
      r.height = 24;
      const zebra = idx % 2 === 1;
      r.eachCell((cell, colNumber) => {
        cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF1E293B' } };
        if (zebra) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFD' } };
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
        if (colNumber === 1 || colNumber === 2 || colNumber === 6) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (colNumber === 9) {
          cell.numFmt = '#,##0.00';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FF0F172A' } };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
      });

      const statusCell = r.getCell(10);
      statusCell.font = {
        name: EXPORT_EXCEL_FONT_NAME,
        size: 16,
        bold: true,
        color: { argb: `FF${statusMeta.color.replace('#', '').toUpperCase()}` },
      };

      rowCursor += 1;
    });

    if (grp.groupTitle) {
      const subRow = ws.getRow(rowCursor);
      ws.mergeCells(rowCursor, 1, rowCursor, 8);
      subRow.getCell(1).value = `รวมย่อย (${grp.groupTitle}): ${grp.items.length} รายการ`;
      subRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'right' };
      subRow.getCell(9).value = grp.subtotal;
      subRow.getCell(9).numFmt = '#,##0.00';
      subRow.getCell(9).alignment = { vertical: 'middle', horizontal: 'right' };
      ws.mergeCells(rowCursor, 10, rowCursor, columnsCount);
      subRow.height = 25;
      for (let c = 1; c <= columnsCount; c++) {
        const cell = subRow.getCell(c);
        cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FF1A5A8F' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6FB' } };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
      }
      rowCursor += 1;
    }
  });

  // Grand Total row
  const totalRow = ws.getRow(rowCursor);
  ws.mergeCells(rowCursor, 1, rowCursor, 8);
  totalRow.getCell(1).value = `รวมทั้งหมดตามเงื่อนไขการกรอง (${totalRecords.toLocaleString('th-TH')} รายการ)`;
  totalRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'right' };
  totalRow.getCell(9).value = totalAmount;
  totalRow.getCell(9).numFmt = '#,##0.00';
  totalRow.getCell(9).alignment = { vertical: 'middle', horizontal: 'right' };
  ws.mergeCells(rowCursor, 10, rowCursor, columnsCount);
  totalRow.getCell(10).value = 'บาท';
  totalRow.getCell(10).alignment = { vertical: 'middle', horizontal: 'left' };
  totalRow.height = 28;
  for (let c = 1; c <= columnsCount; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2271B3' } };
  }
}

export async function exportFilteredToExcel(
  records: MeterRequest[],
  filterCtx: ExportFilterContext,
  scope: ExportScope = 'all'
): Promise<string> {
  const analytics = computeExportAnalytics(records);
  const filterSummary = describeActiveFilters(filterCtx);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ระบบติดตามคำขอติดตั้ง/ย้ายมาตรวัดน้ำ';
  workbook.created = new Date();

  // Sheet 1: ภาพแดชบอร์ดสรุป (Executive Summary Dashboard + Embedded Chart PNG)
  const summaryWs = workbook.addWorksheet('ภาพแดชบอร์ดสรุป', {
    views: [{ showGridLines: true }],
  });
  summaryWs.columns = [
    { width: 30 },
    { width: 18 },
    { width: 18 },
    { width: 20 },
    { width: 22 },
    { width: 20 },
    { width: 20 },
  ];

  summaryWs.mergeCells('A1:G1');
  const sTitle = summaryWs.getCell('A1');
  sTitle.value = 'ภาพแดชบอร์ดสรุปข้อมูลคำขอติดตั้ง / ย้ายมาตรวัดน้ำ';
  sTitle.font = { name: EXPORT_EXCEL_FONT_NAME, size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
  sTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2271B3' } };
  sTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  summaryWs.getRow(1).height = 36;

  summaryWs.mergeCells('A2:G2');
  const sMeta = summaryWs.getCell('A2');
  sMeta.value = `ตัวกรอง: ${filterSummary}   |   รูปแบบ: ${scopeLabel(scope)}   |   วันที่ออกรายงาน: ${new Date().toLocaleString('th-TH')}`;
  sMeta.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF334155' } };
  sMeta.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF5FC' } };
  sMeta.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  summaryWs.getRow(2).height = 26;

  // Render & embed visual Dashboard Summary image
  const dashboardPng = await renderDashboardImageBase64(records, analytics, filterCtx);
  let nextRow = 4;
  if (dashboardPng) {
    const imgId = workbook.addImage({
      base64: dashboardPng,
      extension: 'png',
    });
    summaryWs.addImage(imgId, {
      tl: { col: 0, row: 3 },
      ext: { width: 920, height: 325 },
    });
    nextRow = 21;
  }

  // Structured KPI + Status Summary Table
  summaryWs.mergeCells(nextRow, 1, nextRow, 4);
  const stHeaderTitle = summaryWs.getCell(nextRow, 1);
  stHeaderTitle.value = 'ตารางสรุปตามสถานะคำขอ';
  stHeaderTitle.font = { name: EXPORT_EXCEL_FONT_NAME, size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  stHeaderTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2271B3' } };
  stHeaderTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  summaryWs.getRow(nextRow).height = 30;
  nextRow += 1;

  const stCols = summaryWs.getRow(nextRow);
  stCols.values = ['สถานะคำขอ', 'จำนวน (รายการ)', 'สัดส่วน (%)', 'ยอดรวม (บาท)'];
  stCols.height = 26;
  for (let c = 1; c <= 4; c++) {
    const cell = stCols.getCell(c);
    cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FF1A5A8F' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF5FC' } };
    cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'right' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  }
  nextRow += 1;

  analytics.statusBreakdown.forEach((st) => {
    const r = summaryWs.getRow(nextRow);
    r.values = [st.label, st.count, st.pct / 100, st.amount];
    r.height = 24;
    r.getCell(1).font = {
      name: EXPORT_EXCEL_FONT_NAME,
      size: 16,
      bold: true,
      color: { argb: `FF${st.color.replace('#', '').toUpperCase()}` },
    };
    r.getCell(2).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF1E293B' } };
    r.getCell(2).numFmt = '#,##0';
    r.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
    r.getCell(3).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF1E293B' } };
    r.getCell(3).numFmt = '0%';
    r.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    r.getCell(4).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF1E293B' } };
    r.getCell(4).numFmt = '#,##0.00';
    r.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    for (let c = 1; c <= 4; c++) {
      r.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    }
    nextRow += 1;
  });

  const stTotalRow = summaryWs.getRow(nextRow);
  stTotalRow.values = ['รวมทั้งสิ้น', analytics.total, 1, analytics.totalAmount];
  stTotalRow.height = 26;
  for (let c = 1; c <= 4; c++) {
    const cell = stTotalRow.getCell(c);
    cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FF0F172A' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } }, bottom: { style: 'double', color: { argb: 'FF94A3B8' } } };
  }
  stTotalRow.getCell(2).numFmt = '#,##0';
  stTotalRow.getCell(3).numFmt = '0%';
  stTotalRow.getCell(4).numFmt = '#,##0.00';

  nextRow += 2;

  // Structured Area Summary Table
  summaryWs.mergeCells(nextRow, 1, nextRow, 6);
  const arHeaderTitle = summaryWs.getCell(nextRow, 1);
  arHeaderTitle.value = 'ตารางสรุปแยกตามตำบล / พื้นที่';
  arHeaderTitle.font = { name: EXPORT_EXCEL_FONT_NAME, size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  arHeaderTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2271B3' } };
  arHeaderTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  summaryWs.getRow(nextRow).height = 30;
  nextRow += 1;

  const arCols = summaryWs.getRow(nextRow);
  arCols.values = [
    'ตำบล / พื้นที่',
    'คำขอทั้งหมด',
    'ติดตั้งเสร็จสิ้น',
    'อยู่ระหว่างดำเนินการ',
    'รอชำระเงิน',
    'ยอดรวม (บาท)',
  ];
  arCols.height = 26;
  for (let c = 1; c <= 6; c++) {
    const cell = arCols.getCell(c);
    cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FF1A5A8F' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF5FC' } };
    cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'right' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  }
  nextRow += 1;

  analytics.areaBreakdown.forEach((ar) => {
    const r = summaryWs.getRow(nextRow);
    r.values = [ar.area, ar.count, ar.completed, ar.inProgress, ar.unpaid, ar.amount];
    r.height = 24;
    r.getCell(1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FF1E293B' } };
    for (let c = 2; c <= 5; c++) {
      r.getCell(c).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF1E293B' } };
      r.getCell(c).numFmt = '#,##0';
      r.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
    }
    r.getCell(6).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF1E293B' } };
    r.getCell(6).numFmt = '#,##0.00';
    r.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };
    for (let c = 1; c <= 6; c++) {
      r.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    }
    nextRow += 1;
  });

  // Sheet 2+: Filtered detailed tables (flat or grouped by requested section)
  if (scope === 'all') {
    const mainWs = workbook.addWorksheet('รายการคำขอ (ที่กรอง)');
    populateDetailSheet(
      mainWs,
      'รายการคำขอติดตั้ง / ย้ายมาตรวัดน้ำ (ตามเงื่อนไขที่กรอง)',
      filterSummary,
      groupRecordsForScope(records, 'all'),
      analytics.total,
      analytics.totalAmount
    );

    const byStatusWs = workbook.addWorksheet('แยกตามสถานะคำขอ');
    populateDetailSheet(
      byStatusWs,
      'รายการคำขอแยกตามสถานะ (ที่กรอง)',
      filterSummary,
      groupRecordsForScope(records, 'by_status'),
      analytics.total,
      analytics.totalAmount
    );

    const byAreaWs = workbook.addWorksheet('แยกตามตำบล-พื้นที่');
    populateDetailSheet(
      byAreaWs,
      'รายการคำขอแยกตามตำบล / พื้นที่ (ที่กรอง)',
      filterSummary,
      groupRecordsForScope(records, 'by_area'),
      analytics.total,
      analytics.totalAmount
    );
  } else {
    const sheetTitle = scope === 'by_status' ? 'แยกตามสถานะคำขอ' : 'แยกตามตำบล-พื้นที่';
    const detailWs = workbook.addWorksheet(sheetTitle);
    populateDetailSheet(
      detailWs,
      `${scopeLabel(scope)} (ที่กรอง)`,
      filterSummary,
      groupRecordsForScope(records, scope),
      analytics.total,
      analytics.totalAmount
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = buildFilename('xlsx', scope);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return filename;
}

type PdfRowItem =
  | { kind: 'group'; title: string; count: number }
  | { kind: 'record'; seq: number; rec: MeterRequest };

export async function exportFilteredToPdf(
  records: MeterRequest[],
  filterCtx: ExportFilterContext,
  scope: ExportScope = 'all'
): Promise<string> {
  await ensureThSarabunPskLoaded();

  const analytics = computeExportAnalytics(records);
  const filterSummary = describeActiveFilters(filterCtx);
  const groups = groupRecordsForScope(records, scope);

  const flatRows: PdfRowItem[] = [];
  let seq = 1;
  groups.forEach((grp) => {
    if (grp.groupTitle) {
      flatRows.push({
        kind: 'group',
        title: grp.groupTitle,
        count: grp.items.length,
      });
    }
    grp.items.forEach((rec) => {
      flatRows.push({ kind: 'record', seq: seq++, rec });
    });
  });

  // A4 Landscape 297mm x 210mm rendered at 8 px/mm -> 2376 x 1680 px
  const PAGE_W = 2376;
  const PAGE_H = 1680;
  const MARGIN_X = 52;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;
  const FOOTER_Y = PAGE_H - 42;

  const colDefs = [
    { label: 'ลำดับ', width: 90, align: 'center' as const },
    { label: 'เลขที่ RQ', width: 180, align: 'center' as const },
    { label: 'วันที่ยื่นคำร้อง', width: 210, align: 'center' as const },
    { label: 'ชื่อ - สกุล', width: 400, align: 'left' as const },
    { label: 'ที่อยู่ / หมู่ที่ / พื้นที่', width: 822, align: 'left' as const },
    { label: 'เบอร์โทร', width: 210, align: 'center' as const },
    {
      label: 'สถานะ',
      width: CONTENT_W - (90 + 180 + 210 + 400 + 822 + 210),
      align: 'left' as const,
    },
  ];

  const ROW_H = 40;
  const HEADER_H = 46;

  const pages: HTMLCanvasElement[] = [];

  const createPageCanvas = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    // Top RAL 5015 strip
    ctx.fillStyle = RAL_PRIMARY;
    ctx.fillRect(0, 0, PAGE_W, 10);
    return { canvas, ctx };
  };

  const drawTableHeader = (ctx: CanvasRenderingContext2D, y: number): number => {
    ctx.fillStyle = RAL_PRIMARY;
    drawRoundedRect(ctx, MARGIN_X, y, CONTENT_W, HEADER_H, 8);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${SARABUN_PT_12_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
    let cx = MARGIN_X;
    colDefs.forEach((col, idx) => {
      if (idx > 0) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, y + 9);
        ctx.lineTo(cx, y + HEADER_H - 9);
        ctx.stroke();
      }
      ctx.fillStyle = '#FFFFFF';
      if (col.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(col.label, cx + col.width / 2, y + 32);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(col.label, cx + 16, y + 32);
      }
      cx += col.width;
    });
    ctx.textAlign = 'left';
    return y + HEADER_H;
  };

  const drawRowItem = (
    ctx: CanvasRenderingContext2D,
    item: PdfRowItem,
    y: number,
    zebraIndex: number
  ): number => {
    if (item.kind === 'group') {
      ctx.fillStyle = RAL_SOFT;
      ctx.fillRect(MARGIN_X, y, CONTENT_W, ROW_H);
      ctx.strokeStyle = '#BFD8EE';
      ctx.lineWidth = 1;
      ctx.strokeRect(MARGIN_X, y, CONTENT_W, ROW_H);

      ctx.textAlign = 'left';
      ctx.fillStyle = RAL_DEEP;
      ctx.font = `700 ${SARABUN_PT_12_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
      ctx.fillText(
        `ส่วนข้อมูล: ${item.title}   (${item.count.toLocaleString('th-TH')} รายการ)`,
        MARGIN_X + 16,
        y + 28
      );
      return y + ROW_H;
    }

    // Standard record row
    if (zebraIndex % 2 === 1) {
      ctx.fillStyle = '#F8FAFD';
      ctx.fillRect(MARGIN_X, y, CONTENT_W, ROW_H);
    }
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, y);
    ctx.lineTo(MARGIN_X, y + ROW_H);
    ctx.lineTo(MARGIN_X + CONTENT_W, y + ROW_H);
    ctx.lineTo(MARGIN_X + CONTENT_W, y);
    ctx.stroke();

    const { rec, seq: rowSeq } = item;
    const statusMeta = getStatusMeta(rec.status);
    const areaTxt = [
      rec.houseNo ? `บ้านเลขที่ ${rec.houseNo}` : '',
      rec.moo ? `หมู่ที่ ${rec.moo}` : '',
      rec.locationSummary || '',
    ]
      .filter(Boolean)
      .join(' ');

    const values = [
      String(rowSeq),
      rec.rqNumber || `#${rec.rowIndex}`,
      formatThaiDate(rec.requestDate),
      rec.fullName || '-',
      areaTxt || '-',
      rec.phone || '-',
      statusMeta.label,
    ];

    let cx = MARGIN_X;
    values.forEach((val, idx) => {
      const col = colDefs[idx];
      if (idx > 0) {
        ctx.strokeStyle = '#EEF2F7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(cx, y + ROW_H);
        ctx.stroke();
      }

      ctx.fillStyle = idx === 3 ? '#0F172A' : '#334155';
      ctx.font =
        idx === 3
          ? `700 ${SARABUN_PT_12_PX}px ${EXPORT_PDF_FONT_FAMILY}`
          : `400 ${SARABUN_PT_12_PX}px ${EXPORT_PDF_FONT_FAMILY}`;

      if (idx === 6) {
        // Status symbol + label (explicit left align so text never overlaps previous column)
        if (isNoPipeCancelledStatus(rec.status)) {
          drawNoPipeWarningCanvasIcon(ctx, cx + 22, y + ROW_H / 2, 18);
        } else {
          ctx.fillStyle = statusMeta.color;
          ctx.beginPath();
          ctx.arc(cx + 22, y + ROW_H / 2, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = '#1E293B';
        ctx.font = `700 ${SARABUN_PT_12_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
        ctx.fillText(truncateText(ctx, val, col.width - 48), cx + 36, y + 28);
      } else if (col.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(truncateText(ctx, val, col.width - 16), cx + col.width / 2, y + 28);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(truncateText(ctx, val, col.width - 32), cx + 16, y + 28);
      }
      cx += col.width;
    });
    ctx.textAlign = 'left';
    return y + ROW_H;
  };

  // --- Page 1: Executive Header + Visual Dashboard Summary + Initial Rows ---
  let page = createPageCanvas();
  pages.push(page.canvas);
  let ctx = page.ctx;

  // Report Header Card
  ctx.fillStyle = '#0F172A';
  ctx.font = `700 ${SARABUN_PT_20_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText('รายงานสรุปและติดตามคำขอติดตั้ง / ย้ายมาตรวัดน้ำ', MARGIN_X, 66);

  ctx.fillStyle = '#475569';
  ctx.font = `400 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText(
    `${scopeLabel(scope)}  ·  แสดง ${analytics.total.toLocaleString('th-TH')} จากทั้งหมด ${filterCtx.totalUnfilteredCount.toLocaleString('th-TH')} รายการ`,
    MARGIN_X,
    108
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#64748B';
  ctx.font = `400 ${SARABUN_PT_14_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText(
    `ออกรายงานเมื่อ ${new Date().toLocaleString('th-TH')}`,
    PAGE_W - MARGIN_X,
    62
  );
  ctx.fillStyle = RAL_DEEP;
  ctx.font = `700 ${SARABUN_PT_14_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText(
    truncateText(ctx, `ตัวกรอง: ${filterSummary}`, 1080),
    PAGE_W - MARGIN_X,
    104
  );
  ctx.textAlign = 'left';

  // Dashboard Summary Canvas Container
  const dashBoxY = 128;
  ctx.fillStyle = '#F3F6FA';
  drawRoundedRect(ctx, MARGIN_X - 12, dashBoxY, CONTENT_W + 24, 482, 16);
  ctx.fill();
  const dashBottom = drawDashboardSummaryBlock(
    ctx,
    MARGIN_X + 6,
    dashBoxY + 18,
    CONTENT_W - 12,
    analytics
  );

  // Table Section Title on Page 1
  let curY = Math.max(dashBottom + 44, 642);
  ctx.fillStyle = '#0F172A';
  ctx.font = `700 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.fillText('รายละเอียดรายการคำขอตามเงื่อนไขที่กรอง', MARGIN_X, curY);
  curY += 16;
  curY = drawTableHeader(ctx, curY);

  let rowIdx = 0;
  let zebra = 0;
  const maxBodyY = FOOTER_Y - 38;

  while (rowIdx < flatRows.length) {
    const item = flatRows[rowIdx];
    const neededH = ROW_H;

    if (curY + neededH > maxBodyY) {
      page = createPageCanvas();
      pages.push(page.canvas);
      ctx = page.ctx;

      // Continuation page compact header
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 ${SARABUN_PT_18_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
      ctx.fillText('รายงานรายการคำขอติดตั้ง / ย้ายมาตรวัดน้ำ (ต่อ)', MARGIN_X, 62);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#64748B';
      ctx.font = `400 ${SARABUN_PT_14_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
      ctx.fillText(
        truncateText(ctx, `ตัวกรอง: ${filterSummary}`, 1080),
        PAGE_W - MARGIN_X,
        62
      );
      ctx.textAlign = 'left';

      curY = drawTableHeader(ctx, 88);
    }

    if (item.kind === 'group') {
      zebra = 0;
    }
    curY = drawRowItem(ctx, item, curY, zebra);
    if (item.kind === 'record') {
      zebra += 1;
    }
    rowIdx += 1;
  }

  // Stamp standard page footers & build PDF
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const totalPages = pages.length;
  pages.forEach((canvas, idx) => {
    const pCtx = canvas.getContext('2d')!;
    pCtx.strokeStyle = '#E2E8F0';
    pCtx.lineWidth = 1;
    pCtx.beginPath();
    pCtx.moveTo(MARGIN_X, FOOTER_Y - 18);
    pCtx.lineTo(PAGE_W - MARGIN_X, FOOTER_Y - 18);
    pCtx.stroke();

    pCtx.fillStyle = '#64748B';
    pCtx.font = `400 ${SARABUN_PT_14_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
    pCtx.fillText(
      'ระบบวิเคราะห์และติดตามคำขอติดตั้ง/ย้ายมาตรวัดน้ำ · เชื่อมโยง Google Sheets / AppSheet แบบเรียลไทม์',
      MARGIN_X,
      FOOTER_Y + 14
    );
    pCtx.textAlign = 'right';
    pCtx.fillStyle = RAL_DEEP;
    pCtx.font = `700 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
    pCtx.fillText(`หน้า ${idx + 1} / ${totalPages}`, PAGE_W - MARGIN_X, FOOTER_Y + 14);
    pCtx.textAlign = 'left';

    if (idx > 0) {
      doc.addPage('a4', 'landscape');
    }
    const imgData = canvas.toDataURL('image/png');
    doc.addImage(imgData, 'PNG', 0, 0, 297, 210, undefined, 'FAST');
  });

  const filename = buildFilename('pdf', scope);
  doc.save(filename);
  return filename;
}

function buildBatchFilename(ext: 'xlsx' | 'pdf', batchCode: string): string {
  const safeCode = (batchCode || 'ชุดติดตั้งเสร็จสิ้น').replace(/[^\w\u0E00-\u0E7F-]+/g, '_');
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(
    now.getMinutes()
  ).padStart(2, '0')}`;
  return `ชุดติดตั้งเสร็จสิ้น_${safeCode}_${stamp}.${ext}`;
}

function splitBatchAreaFields(r: CompletedBatch['records'][number]): {
  subdistrict: string;
  district: string;
  province: string;
} {
  let subdistrict = (r.subdistrict || '').trim();
  let district = (r.district || '').trim();
  let province = (r.province || '').trim();
  if ((!subdistrict || !district || !province) && r.locationSummary) {
    const t = r.locationSummary.match(/ต\.([^\s]+)/);
    const a = r.locationSummary.match(/อ\.([^\s]+)/);
    const j = r.locationSummary.match(/จ\.([^\s(]+)/);
    if (!subdistrict && t) subdistrict = `ต.${t[1]}`;
    if (!district && a) district = `อ.${a[1]}`;
    if (!province && j) province = `จ.${j[1]}`;
  }
  return {
    subdistrict: subdistrict || '-',
    district: district || '-',
    province: province || '-',
  };
}

function cleanBatchTemplateFields(rec: CompletedBatchRecord) {
  const area = splitBatchAreaFields(rec);
  const rawMoo = (rec.moo || '')
    .trim()
    .replace(/^(หมู่ที่|หมู่\.?|ม\.)\s*/i, '')
    .trim();
  const rawSub = (area.subdistrict || '').trim().replace(/^ต\.\s*/i, '').trim();
  const rawDist = (area.district || '').trim().replace(/^อ\.\s*/i, '').trim();
  const houseNo = (rec.houseNo || '').trim() || '-';
  const jobNo = (rec.jobNumber ?? rec.rqNumber ?? '').trim() || '-';
  const meterNo = (rec.meterNumber ?? '').trim() || '-';
  const meterSize = (rec.meterSize ?? '').trim() || '-';
  const waterNo = (rec.waterUserNo ?? '').trim() || '-';
  const priceNum = Number.isFinite(Number(rec.price)) ? Number(rec.price) : 0;
  const note = (rec.note || '').trim();
  return {
    fullName: (rec.fullName || '').trim() || '-',
    houseNo,
    moo: rawMoo || '-',
    subdistrict: rawSub && rawSub !== '-' ? rawSub : '-',
    district: rawDist && rawDist !== '-' ? rawDist : '-',
    jobNo,
    meterNo,
    meterSize,
    waterNo,
    price: priceNum,
    note,
  };
}

const THAI_LONG_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

function formatThaiOfficialDate(iso: string): string {
  const raw = (iso || '').trim();
  if (!raw) return '....................';
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const year = Number.parseInt(match[1], 10);
    const monthIdx = Number.parseInt(match[2], 10) - 1;
    const day = Number.parseInt(match[3], 10);
    if (monthIdx >= 0 && monthIdx < 12 && day >= 1 && day <= 31) {
      const beYear = year > 2400 ? year : year + 543;
      return `${day} ${THAI_LONG_MONTHS[monthIdx]} ${beYear}`;
    }
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getDate()} ${THAI_LONG_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
  }
  return raw;
}

function resolveBatchFinancials(batch: CompletedBatch) {
  const subtotal = batch.records.reduce(
    (sum, r) => sum + (Number.isFinite(Number(r.price)) ? Number(r.price) : 0),
    0
  );
  const includeTax = batch.includeTax !== false;
  const vatAmount = includeTax ? Math.round(subtotal * 0.07 * 100) / 100 : 0;
  const grandTotal = Math.round((subtotal + vatAmount) * 100) / 100;
  const taxNote = includeTax ? 'รวมภาษีมูลค่าเพิ่ม' : 'ไม่รวมภาษีมูลค่าเพิ่ม';
  return { subtotal, includeTax, vatAmount, grandTotal, taxNote };
}

function resolveMemoSigners(batch: CompletedBatch) {
  const s = batch.memoSigners || {};
  return {
    docNo: (batch.batchCode || '').trim() || 'มท55120-183/',
    approvalDateText: formatThaiOfficialDate(batch.completedDate),
    meterSizeText: (s.meterSizeText || '').trim() || '1/2"',
    proposerName: (s.proposerName || '').trim() || 'นายคมกฤช ปัญญา',
    proposerTitle:
      (s.proposerTitle || '').trim() || 'หัวหน้างาน 8 งานบริการและควบคุมน้ำสูญเสีย',
    managerName: (s.managerName || '').trim() || 'นายปริญญา กัตฐะ',
    managerTitle:
      (s.managerTitle || '').trim() ||
      'ผู้จัดการการประปาส่วนภูมิภาคสาขาขาณุวรลักษบุรี',
    adminHeadName: (s.adminHeadName || '').trim() || 'นางชฎาภัทร์ แจ่มสว่าง',
    adminHeadTitle: (s.adminHeadTitle || '').trim() || 'หัวหน้างาน 8 งานอำนวยการ',
    inspectorName: (batch.inspectorName || '').trim() || 'นายสามารถ บุญกัน',
    inspectorTitle: (s.inspectorTitle || '').trim() || 'นายช่างโยธา 6',
  };
}

function segmentThaiWords(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof (Intl as any).Segmenter === 'function') {
    const seg = new (Intl as any).Segmenter('th', { granularity: 'word' });
    return Array.from(seg.segment(text), (item: any) => String(item.segment));
  }
  return text.split(/(\s+)/);
}

function drawWrappedThaiParagraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  startY: number,
  maxWidth: number,
  lineHeight: number,
  firstLineIndent = 0
): number {
  const tokens = segmentThaiWords(text);
  let line = '';
  let y = startY;
  let isFirst = true;

  for (const token of tokens) {
    const allowedW = isFirst ? maxWidth - firstLineIndent : maxWidth;
    const candidate = line + token;
    if (line && ctx.measureText(candidate).width > allowedW) {
      const drawX = isFirst ? x + firstLineIndent : x;
      ctx.fillText(line.trimEnd(), drawX, y);
      y += lineHeight;
      line = token.trimStart();
      isFirst = false;
    } else {
      line = candidate;
    }
  }

  if (line) {
    const drawX = isFirst ? x + firstLineIndent : x;
    ctx.fillText(line.trimEnd(), drawX, y);
    y += lineHeight;
  }

  return y;
}

function drawPwaOfficialSeal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number
): void {
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';

  // Outer double rings
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 7, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 26, 0, Math.PI * 2);
  ctx.stroke();

  // Inner stylized water droplet & wave motif
  ctx.beginPath();
  ctx.moveTo(cx, cy - 28);
  ctx.bezierCurveTo(cx + 18, cy - 8, cx + 20, cy + 8, cx, cy + 20);
  ctx.bezierCurveTo(cx - 20, cy + 8, cx - 18, cy - 8, cx, cy - 28);
  ctx.lineWidth = 2;
  ctx.stroke();

  // Stylized waves beneath droplet
  ctx.lineWidth = 1.6;
  [-1, 1].forEach((dir) => {
    ctx.beginPath();
    ctx.moveTo(cx - 24, cy + 24 + dir * 4);
    ctx.quadraticCurveTo(cx - 12, cy + 18 + dir * 4, cx, cy + 24 + dir * 4);
    ctx.quadraticCurveTo(cx + 12, cy + 30 + dir * 4, cx + 24, cy + 24 + dir * 4);
    ctx.stroke();
  });

  // Curved text along bottom arc: การประปาส่วนภูมิภาค
  const sealLabel = 'การประปาส่วนภูมิภาค';
  ctx.font = `700 16px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textRadius = radius - 16.5;
  const totalAngle = Math.PI * 0.92;
  const startAngle = Math.PI / 2 + totalAngle / 2;
  const chars = Array.from(sealLabel);
  chars.forEach((ch, idx) => {
    const ratio = chars.length > 1 ? idx / (chars.length - 1) : 0.5;
    const angle = startAngle - ratio * totalAngle;
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * textRadius, cy + Math.sin(angle) * textRadius);
    ctx.rotate(angle - Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });

  ctx.restore();
}

const PWA_SEAL_ASSET_URL = '/assets/aistudio/image_601d835b.png';
let cachedBwSealCanvasPromise: Promise<HTMLCanvasElement | null> | null = null;

function loadBlackAndWhitePwaSealCanvas(): Promise<HTMLCanvasElement | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  if (cachedBwSealCanvasPromise) return cachedBwSealCanvasPromise;

  cachedBwSealCanvasPromise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(null);
          return;
        }

        const tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = h;
        const tctx = tmp.getContext('2d');
        if (!tctx) {
          resolve(null);
          return;
        }
        tctx.drawImage(img, 0, 0, w, h);
        const srcData = tctx.getImageData(0, 0, w, h);
        const data = srcData.data;

        const lumAt = (idx: number) => {
          const p = idx * 4;
          if (data[p + 3] < 20) return 255;
          return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        };

        // Flood-fill dark pixels touching the outer perimeter to strip the rectangular frame
        const isOuterFrame = new Uint8Array(w * h);
        const queue = new Int32Array(w * h);
        let qHead = 0;
        let qTail = 0;

        const trySeed = (x: number, y: number) => {
          const idx = y * w + x;
          if (!isOuterFrame[idx] && lumAt(idx) < 215) {
            isOuterFrame[idx] = 1;
            queue[qTail++] = idx;
          }
        };

        for (let x = 0; x < w; x++) {
          trySeed(x, 0);
          trySeed(x, h - 1);
        }
        for (let y = 0; y < h; y++) {
          trySeed(0, y);
          trySeed(w - 1, y);
        }

        while (qHead < qTail) {
          const idx = queue[qHead++];
          const x = idx % w;
          const y = (idx - x) / w;
          if (x > 0) trySeed(x - 1, y);
          if (x + 1 < w) trySeed(x + 1, y);
          if (y > 0) trySeed(x, y - 1);
          if (y + 1 < h) trySeed(x, y + 1);
        }

        // Find tight bounding box of the circular seal interior
        let minX = w;
        let minY = h;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            if (!isOuterFrame[idx] && lumAt(idx) < 210) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (maxX <= minX || maxY <= minY) {
          resolve(null);
          return;
        }

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const radius = Math.max(maxX - minX, maxY - minY) / 2;
        const pad = 4;
        const outSize = Math.ceil(radius * 2) + pad * 2;

        const out = document.createElement('canvas');
        out.width = outSize;
        out.height = outSize;
        const octx = out.getContext('2d');
        if (!octx) {
          resolve(null);
          return;
        }

        const outImg = octx.createImageData(outSize, outSize);
        const od = outImg.data;
        const outCenter = outSize / 2;
        const maxR2 = (radius + 2) * (radius + 2);

        for (let oy = 0; oy < outSize; oy++) {
          const sy = Math.round(cy + (oy - outCenter));
          if (sy < 0 || sy >= h) continue;
          for (let ox = 0; ox < outSize; ox++) {
            const sx = Math.round(cx + (ox - outCenter));
            if (sx < 0 || sx >= w) continue;
            const dx = ox - outCenter;
            const dy = oy - outCenter;
            if (dx * dx + dy * dy > maxR2) continue;

            const sIdx = sy * w + sx;
            if (isOuterFrame[sIdx]) continue;

            const lum = lumAt(sIdx);
            const oP = (oy * outSize + ox) * 4;
            if (lum >= 232) {
              od[oP] = 255;
              od[oP + 1] = 255;
              od[oP + 2] = 255;
              od[oP + 3] = 0;
            } else {
              // Pure high-contrast black & white grayscale
              const gray = Math.max(0, Math.min(255, Math.round((lum - 28) * 1.15)));
              const alpha = Math.max(0, Math.min(255, Math.round((242 - lum) * 2.4)));
              od[oP] = gray;
              od[oP + 1] = gray;
              od[oP + 2] = gray;
              od[oP + 3] = alpha;
            }
          }
        }

        octx.putImageData(outImg, 0, 0);
        resolve(out);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = PWA_SEAL_ASSET_URL;
  });

  return cachedBwSealCanvasPromise;
}

export async function exportCompletedBatchToExcel(batch: CompletedBatch): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ระบบติดตามคำขอติดตั้ง/ย้ายมาตรวัดน้ำ';
  workbook.created = new Date();

  const { subtotal, includeTax, vatAmount, grandTotal, taxNote } =
    resolveBatchFinancials(batch);
  const memo = resolveMemoSigners(batch);

  const thinBlackBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
  };
  const bottomThinBorder: Partial<ExcelJS.Borders> = {
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
  };

  // Sheet 1: บันทึกข้อความ (อยู่แผ่นก่อนรายการสรุปตาราง)
  const memoWs = workbook.addWorksheet('บันทึกข้อความ');
  memoWs.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: {
      left: 0.7,
      right: 0.65,
      top: 0.6,
      bottom: 0.6,
      header: 0.2,
      footer: 0.2,
    },
  };
  [12, 18, 14, 10, 10, 12, 18, 18].forEach((w, idx) => {
    memoWs.getColumn(idx + 1).width = w;
  });

  const bwSealCanvas = await loadBlackAndWhitePwaSealCanvas();

  memoWs.mergeCells(1, 1, 2, 8);
  const memoTitleCell = memoWs.getCell(1, 1);
  memoTitleCell.value = 'บันทึกข้อความ';
  memoTitleCell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 29, bold: true, color: { argb: 'FF000000' } };
  memoTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  memoWs.getRow(1).height = 40;
  memoWs.getRow(2).height = 40;

  if (bwSealCanvas) {
    const sealBase64 = bwSealCanvas.toDataURL('image/png');
    const sealImageId = workbook.addImage({
      base64: sealBase64,
      extension: 'png',
    });
    memoWs.addImage(sealImageId, {
      tl: { col: 0.18, row: 0.12 },
      ext: { width: 84, height: 84 },
    });
  }

  // Row 3: หน่วยงาน (หัวข้อ 20pt ตัวหนา, ข้อความ 16pt ตามมาตรฐานงานสารบรรณ)
  memoWs.getRow(3).height = 28;
  memoWs.getCell(3, 1).value = 'หน่วยงาน';
  memoWs.getCell(3, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 20, bold: true, color: { argb: 'FF000000' } };
  memoWs.mergeCells(3, 2, 3, 8);
  memoWs.getCell(3, 2).value = 'การประปาส่วนภูมิภาคสาขาขาณุวรลักษบุรี งานบริการและควบคุมน้ำสูญเสีย';
  memoWs.getCell(3, 2).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  for (let c = 2; c <= 8; c++) memoWs.getCell(3, c).border = bottomThinBorder;

  // Row 4: ที่ ... วันที่ ... (หัวข้อ 20pt ตัวหนา, ข้อความ 16pt)
  memoWs.getRow(4).height = 28;
  memoWs.getCell(4, 1).value = 'ที่';
  memoWs.getCell(4, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 20, bold: true, color: { argb: 'FF000000' } };
  memoWs.mergeCells(4, 2, 4, 4);
  memoWs.getCell(4, 2).value = memo.docNo;
  memoWs.getCell(4, 2).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  for (let c = 2; c <= 4; c++) memoWs.getCell(4, c).border = bottomThinBorder;

  memoWs.getCell(4, 5).value = 'วันที่';
  memoWs.getCell(4, 5).font = { name: EXPORT_EXCEL_FONT_NAME, size: 20, bold: true, color: { argb: 'FF000000' } };
  memoWs.getCell(4, 5).alignment = { vertical: 'middle', horizontal: 'right' };
  memoWs.mergeCells(4, 6, 4, 8);
  memoWs.getCell(4, 6).value = memo.approvalDateText;
  memoWs.getCell(4, 6).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  for (let c = 6; c <= 8; c++) memoWs.getCell(4, c).border = bottomThinBorder;

  // Row 5: เรื่อง (หัวข้อ 20pt ตัวหนา, ข้อความ 16pt)
  memoWs.getRow(5).height = 28;
  memoWs.getCell(5, 1).value = 'เรื่อง';
  memoWs.getCell(5, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 20, bold: true, color: { argb: 'FF000000' } };
  memoWs.mergeCells(5, 2, 5, 8);
  memoWs.getCell(5, 2).value = 'ขออนุมัติจ้างเหมา งานติดตั้งวางท่อประปาและมาตรวัดน้ำให้ผู้ใช้น้ำรายใหม่';
  memoWs.getCell(5, 2).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  for (let c = 2; c <= 8; c++) memoWs.getCell(5, c).border = bottomThinBorder;

  // Row 6: เรียน (16pt ตามงานสารบรรณ)
  memoWs.getRow(6).height = 26;
  memoWs.getCell(6, 1).value = 'เรียน';
  memoWs.getCell(6, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.mergeCells(6, 2, 6, 8);
  memoWs.getCell(6, 2).value = 'ผู้จัดการการประปาส่วนภูมิภาคสาขาขาณุวรลักษบุรี';
  memoWs.getCell(6, 2).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };

  memoWs.getRow(7).height = 10;

  // Row 8: Paragraph 1
  memoWs.mergeCells(8, 1, 8, 8);
  const p1Cell = memoWs.getCell(8, 1);
  p1Cell.value =
    `        ด้วยงานบริการและควบคุมน้ำสูญเสีย มีความจำเป็นเร่งด่วนต้องดำเนินการติดตั้งวางท่อประปาและมาตรวัดน้ำให้ผู้ใช้น้ำรายใหม่ ` +
    `เพื่อให้ผู้ใช้น้ำได้รับการบริการรวดเร็วในการติดตั้งวางท่อประปาและมาตรวัดน้ำ ขนาด ${memo.meterSizeText} ` +
    `ซึ่งมีความสำคัญในการเพิ่มจำนวนผู้ใช้น้ำและเป็นการให้บริการอย่างรวดเร็วเพื่อให้ทันต่อความต้องการของผู้ใช้น้ำ`;
  p1Cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  p1Cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  memoWs.getRow(8).height = 84;

  // Row 9: Paragraph 2
  memoWs.mergeCells(9, 1, 9, 8);
  const p2Cell = memoWs.getCell(9, 1);
  p2Cell.value =
    `        ดังนั้น งานบริการและควบคุมน้ำสูญเสีย จึงขออนุมัติจ้างเหมางานติดตั้งวางท่อประปาและมาตรวัดน้ำให้ผู้ใช้น้ำรายใหม่ ` +
    `จำนวน ${batch.records.length} ราย เป็นเงินทั้งสิ้น ${formatBaht(grandTotal)} -บาท (${taxNote}) ดังรายละเอียดที่แนบมาพร้อมบันทึกนี้`;
  p2Cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  p2Cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  memoWs.getRow(9).height = 62;

  // Row 10: Paragraph 3
  memoWs.mergeCells(10, 1, 10, 8);
  const p3Cell = memoWs.getCell(10, 1);
  p3Cell.value = '        จึงเรียนมาเพื่อโปรดทราบและพิจารณาอนุมัติ';
  p3Cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  p3Cell.alignment = { vertical: 'middle', horizontal: 'left' };
  memoWs.getRow(10).height = 26;

  memoWs.getRow(11).height = 28;

  // Rows 12-13: Proposer Block (Right side)
  memoWs.mergeCells(12, 5, 12, 8);
  memoWs.getCell(12, 5).value = `(${memo.proposerName})`;
  memoWs.getCell(12, 5).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.getCell(12, 5).alignment = { vertical: 'middle', horizontal: 'center' };
  memoWs.getRow(12).height = 24;

  memoWs.mergeCells(13, 5, 13, 8);
  memoWs.getCell(13, 5).value = memo.proposerTitle;
  memoWs.getCell(13, 5).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.getCell(13, 5).alignment = { vertical: 'middle', horizontal: 'center' };
  memoWs.getRow(13).height = 24;

  // Approval block (Left side)
  memoWs.mergeCells(14, 1, 14, 4);
  memoWs.getCell(14, 1).value = 'อนุมัติ';
  memoWs.getCell(14, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FF000000' } };
  memoWs.getRow(14).height = 24;

  memoWs.mergeCells(15, 2, 15, 5);
  memoWs.getCell(15, 2).value = 'เรียน  หัวหน้างานอำนวยการ';
  memoWs.getCell(15, 2).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.getRow(15).height = 24;

  memoWs.getRow(16).height = 28;

  memoWs.mergeCells(17, 1, 17, 4);
  memoWs.getCell(17, 1).value = `(${memo.managerName})`;
  memoWs.getCell(17, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.getCell(17, 1).alignment = { vertical: 'middle', horizontal: 'center' };
  memoWs.getRow(17).height = 24;

  memoWs.mergeCells(18, 1, 18, 4);
  memoWs.getCell(18, 1).value = memo.managerTitle;
  memoWs.getCell(18, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.getCell(18, 1).alignment = { vertical: 'middle', horizontal: 'center' };
  memoWs.getRow(18).height = 24;

  memoWs.mergeCells(19, 1, 19, 4);
  memoWs.getCell(19, 1).value = 'วันที่.......................................';
  memoWs.getCell(19, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.getCell(19, 1).alignment = { vertical: 'middle', horizontal: 'center' };
  memoWs.getRow(19).height = 24;

  memoWs.getRow(20).height = 16;

  // Admin head forwarding block (Bottom left)
  memoWs.mergeCells(21, 1, 21, 4);
  memoWs.getCell(21, 1).value = 'เรียน  พนักงานพัสดุ';
  memoWs.getCell(21, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, bold: true, color: { argb: 'FF000000' } };
  memoWs.getRow(21).height = 24;

  memoWs.mergeCells(22, 2, 22, 5);
  memoWs.getCell(22, 2).value = 'เพื่อทราบและดำเนินการต่อไป';
  memoWs.getCell(22, 2).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.getRow(22).height = 24;

  memoWs.getRow(23).height = 28;

  memoWs.mergeCells(24, 1, 24, 4);
  memoWs.getCell(24, 1).value = `(${memo.adminHeadName})`;
  memoWs.getCell(24, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.getCell(24, 1).alignment = { vertical: 'middle', horizontal: 'center' };
  memoWs.getRow(24).height = 24;

  memoWs.mergeCells(25, 1, 25, 4);
  memoWs.getCell(25, 1).value = memo.adminHeadTitle;
  memoWs.getCell(25, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.getCell(25, 1).alignment = { vertical: 'middle', horizontal: 'center' };
  memoWs.getRow(25).height = 24;

  memoWs.mergeCells(26, 1, 26, 4);
  memoWs.getCell(26, 1).value = 'วันที่.......................................';
  memoWs.getCell(26, 1).font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  memoWs.getCell(26, 1).alignment = { vertical: 'middle', horizontal: 'center' };
  memoWs.getRow(26).height = 24;

  // Sheet 2: แบบฟอร์มมาตรฐาน กปภ. (12 คอลัมน์ A–L รวมขนาดมาตร)
  const ws = workbook.addWorksheet('รายชื่อติดตั้งมาตรวัดน้ำ');
  const colsCount = 12;

  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.35,
      right: 0.35,
      top: 0.4,
      bottom: 0.4,
      header: 0.2,
      footer: 0.2,
    },
  };

  [9, 26, 12, 8, 15, 15, 22, 22, 13, 18, 16, 20].forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  // Title Rows 1 & 2 (centered, bold black text on white background, no borders)
  ws.mergeCells(1, 1, 1, colsCount);
  const title1 = ws.getCell(1, 1);
  title1.value = 'รายชื่อติดตั้งวางท่อประปาและมาตรวัดน้ำ';
  title1.font = { name: EXPORT_EXCEL_FONT_NAME, size: 20, bold: true, color: { argb: 'FF000000' } };
  title1.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, colsCount);
  const title2 = ws.getCell(2, 1);
  title2.value = 'งานบริการและควบคุมน้ำสูญเสีย การประปาส่วนภูมิภาคสาขาขาณุวรลักษบุรี';
  title2.font = { name: EXPORT_EXCEL_FONT_NAME, size: 18, bold: true, color: { argb: 'FF000000' } };
  title2.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 28;

  // Row 3: Table Header (12 columns A–L)
  const headerRow = ws.getRow(3);
  headerRow.values = [
    'ลำดับที่',
    'ชื่อผู้ใช้น้ำ',
    'บ้านเลขที่',
    'หมู่',
    'ตำบล',
    'อำเภอ',
    'งานเลขที่',
    'หมายเลขมาตร',
    'ขนาดมาตร',
    'เลขที่ผู้ใช้น้ำ',
    'วงเงินที่จะจ้าง',
    'หมายเหตุ',
  ];
  headerRow.height = 26;
  for (let c = 1; c <= colsCount; c++) {
    const cell = headerRow.getCell(c);
    cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 14, bold: true, color: { argb: 'FF000000' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBlackBorder;
  }

  // Body Rows (data rows + padded blank bordered form rows)
  const bodyRowCount = Math.max(batch.records.length + 3, 18);
  const startBodyRow = 4;
  let computedTotal = 0;

  for (let i = 0; i < bodyRowCount; i++) {
    const rowIdx = startBodyRow + i;
    const r = ws.getRow(rowIdx);
    r.height = 22;

    if (i < batch.records.length) {
      const f = cleanBatchTemplateFields(batch.records[i]);
      computedTotal += f.price;
      r.values = [
        i + 1,
        f.fullName,
        f.houseNo,
        f.moo,
        f.subdistrict,
        f.district,
        f.jobNo,
        f.meterNo,
        f.meterSize,
        f.waterNo,
        f.price,
        f.note,
      ];
    } else {
      r.values = ['', '', '', '', '', '', '', '', '', '', '', ''];
    }

    for (let c = 1; c <= colsCount; c++) {
      const cell = r.getCell(c);
      cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 14, color: { argb: 'FF000000' } };
      cell.border = thinBlackBorder;
      if (c === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      } else if (c === 12) {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
      if (c === 11 && i < batch.records.length) {
        cell.numFmt = '#,##0.00';
      }
    }
  }

  // Total Row ("รวมเป็นเงิน")
  const lastBodyRow = startBodyRow + bodyRowCount - 1;
  const totalRowIdx = lastBodyRow + 1;
  const totRow = ws.getRow(totalRowIdx);
  totRow.height = 23;

  ws.mergeCells(totalRowIdx, 1, totalRowIdx, 2);
  totRow.getCell(1).value = 'รวมเป็นเงิน';
  for (let c = 1; c <= colsCount; c++) {
    const cell = totRow.getCell(c);
    cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 14, bold: false, color: { argb: 'FF000000' } };
    cell.border = thinBlackBorder;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  const sumCell = totRow.getCell(11);
  sumCell.value = {
    formula: `SUM(K${startBodyRow}:K${lastBodyRow})`,
    result: computedTotal,
  };
  sumCell.numFmt = '#,##0.00';
  sumCell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 14, bold: false, color: { argb: 'FF000000' } };
  sumCell.alignment = { vertical: 'middle', horizontal: 'center' };

  let afterTotalsRowIdx = totalRowIdx;
  if (includeTax) {
    const vatRowIdx = totalRowIdx + 1;
    const vatRow = ws.getRow(vatRowIdx);
    vatRow.height = 23;
    ws.mergeCells(vatRowIdx, 1, vatRowIdx, 2);
    vatRow.getCell(1).value = 'ภาษีมูลค่าเพิ่ม 7%';
    for (let c = 1; c <= colsCount; c++) {
      const cell = vatRow.getCell(c);
      cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 14, bold: false, color: { argb: 'FF000000' } };
      cell.border = thinBlackBorder;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
    const vatCell = vatRow.getCell(11);
    vatCell.value = {
      formula: `ROUND(K${totalRowIdx}*0.07,2)`,
      result: vatAmount,
    };
    vatCell.numFmt = '#,##0.00';

    const grandRowIdx = vatRowIdx + 1;
    const grandRow = ws.getRow(grandRowIdx);
    grandRow.height = 23;
    ws.mergeCells(grandRowIdx, 1, grandRowIdx, 2);
    grandRow.getCell(1).value = 'รวมเป็นเงินทั้งสิ้น';
    for (let c = 1; c <= colsCount; c++) {
      const cell = grandRow.getCell(c);
      cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 14, bold: true, color: { argb: 'FF000000' } };
      cell.border = thinBlackBorder;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
    const grandCell = grandRow.getCell(11);
    grandCell.value = {
      formula: `K${totalRowIdx}+K${vatRowIdx}`,
      result: grandTotal,
    };
    grandCell.numFmt = '#,##0.00';
    afterTotalsRowIdx = grandRowIdx;
  }

  // Signature Block (right-aligned under columns J–L)
  ws.getRow(afterTotalsRowIdx + 1).height = 14;

  const sigRow1 = afterTotalsRowIdx + 2;
  ws.mergeCells(sigRow1, 10, sigRow1, 12);
  const sigCell1 = ws.getCell(sigRow1, 10);
  sigCell1.value = 'ลงชื่อ........................................ผู้ควบคุมงาน';
  sigCell1.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  sigCell1.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(sigRow1).height = 24;

  const sigRow2 = afterTotalsRowIdx + 3;
  ws.mergeCells(sigRow2, 10, sigRow2, 12);
  const sigCell2 = ws.getCell(sigRow2, 10);
  sigCell2.value = `(${memo.inspectorName})`;
  sigCell2.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  sigCell2.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(sigRow2).height = 24;

  const sigRow3 = afterTotalsRowIdx + 4;
  ws.mergeCells(sigRow3, 10, sigRow3, 12);
  const sigCell3 = ws.getCell(sigRow3, 10);
  sigCell3.value = memo.inspectorTitle;
  sigCell3.font = { name: EXPORT_EXCEL_FONT_NAME, size: 16, color: { argb: 'FF000000' } };
  sigCell3.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(sigRow3).height = 24;

  // Sheet 3: ตารางตามชีท (A-K) สำหรับวางเข้า Google Sheets โดยตรง
  const sheetWs = workbook.addWorksheet('ตารางตามชีท (A-K)');
  const ajHeaders = [
    'เลขที่ งาน',
    'เลขที่ผู้ใช้น้ำ',
    'ชื่อ-สกุล',
    'หมู่ที่',
    'ตำบล',
    'อำเภอ',
    'จังหวัด',
    'เบอร์โทร',
    'สถานะ',
    'หมายเลขมาตร',
    'ขนาดมาตร',
  ];
  const ajHeaderRow = sheetWs.getRow(1);
  ajHeaderRow.values = ajHeaders;
  ajHeaderRow.height = 26;
  ajHeaderRow.eachCell((cell) => {
    cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2271B3' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  sheetWs.views = [{ state: 'frozen', ySplit: 1 }];
  [20, 20, 28, 12, 20, 22, 20, 18, 22, 24, 15].forEach((w, idx) => {
    sheetWs.getColumn(idx + 1).width = w;
  });

  batch.records.forEach((rec, idx) => {
    const area = splitBatchAreaFields(rec);
    const r = sheetWs.getRow(idx + 2);
    r.values = [
      (rec.jobNumber ?? rec.rqNumber ?? '').trim(),
      (rec.waterUserNo ?? '').trim(),
      rec.fullName || '',
      rec.moo ? `หมู่ที่ ${rec.moo}` : '',
      area.subdistrict === '-' ? '' : area.subdistrict,
      area.district === '-' ? '' : area.district,
      area.province === '-' ? '' : area.province,
      rec.phone || '',
      rec.status || 'ติดตั้งเสร็จสิ้น',
      (rec.meterNumber ?? '').trim(),
      (rec.meterSize ?? '').trim(),
    ];
    r.height = 22;
    r.eachCell((cell) => {
      cell.font = { name: EXPORT_EXCEL_FONT_NAME, size: 14, color: { argb: 'FF1E293B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = buildBatchFilename('xlsx', batch.batchCode);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return filename;
}

export async function exportCompletedBatchToPdf(batch: CompletedBatch): Promise<string> {
  await ensureThSarabunPskLoaded();

  const { subtotal, includeTax, vatAmount, grandTotal, taxNote } =
    resolveBatchFinancials(batch);
  const memo = resolveMemoSigners(batch);

  // Page 1: บันทึกข้อความ (Portrait A4: 1680 x 2376 px)
  const MEMO_W = 1680;
  const MEMO_H = 2376;
  const memoCanvas = document.createElement('canvas');
  memoCanvas.width = MEMO_W;
  memoCanvas.height = MEMO_H;
  const mctx = memoCanvas.getContext('2d')!;
  mctx.fillStyle = '#FFFFFF';
  mctx.fillRect(0, 0, MEMO_W, MEMO_H);

  const bwSealCanvas = await loadBlackAndWhitePwaSealCanvas();
  if (bwSealCanvas) {
    const sealSize = 200;
    mctx.drawImage(bwSealCanvas, 150, 88, sealSize, sealSize);
  } else {
    drawPwaOfficialSeal(mctx, 250, 188, 86);
  }

  // ตามระเบียบงานสารบรรณ: บันทึกข้อความ 29pt ตัวหนา (82px @ 8px/mm)
  mctx.fillStyle = '#000000';
  mctx.font = `700 ${SARABUN_PT_29_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  mctx.textAlign = 'center';
  mctx.fillText('บันทึกข้อความ', MEMO_W / 2 + 30, 212);

  // Official Memo Header Lines (หัวข้อ หน่วยงาน/ที่/วันที่/เรื่อง 20pt ตัวหนา = 56px, ข้อความ 16pt = 45px)
  const ML = 150;
  const MR = 1530;
  let my = 345;

  const drawUnderlinedField = (
    label: string,
    val: string,
    startX: number,
    endX: number,
    yPos: number
  ) => {
    mctx.textAlign = 'left';
    mctx.font = `700 ${SARABUN_PT_20_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
    mctx.fillText(label, startX, yPos);
    const labelW = mctx.measureText(label).width + 14;
    mctx.font = `400 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
    mctx.fillText(val, startX + labelW + 8, yPos);

    mctx.strokeStyle = '#000000';
    mctx.lineWidth = 1.4;
    mctx.beginPath();
    mctx.moveTo(startX + labelW, yPos + 10);
    mctx.lineTo(endX, yPos + 10);
    mctx.stroke();
  };

  drawUnderlinedField(
    'หน่วยงาน',
    'การประปาส่วนภูมิภาคสาขาขาณุวรลักษบุรี งานบริการและควบคุมน้ำสูญเสีย',
    ML,
    MR,
    my
  );
  my += 62;
  drawUnderlinedField('ที่', memo.docNo, ML, 820, my);
  drawUnderlinedField('วันที่', memo.approvalDateText, 850, MR, my);
  my += 62;
  drawUnderlinedField(
    'เรื่อง',
    'ขออนุมัติจ้างเหมา งานติดตั้งวางท่อประปาและมาตรวัดน้ำให้ผู้ใช้น้ำรายใหม่',
    ML,
    MR,
    my
  );
  my += 68;

  // คำขึ้นต้น "เรียน" และเนื้อความทั้งหมด 16pt (45px @ 8px/mm)
  mctx.textAlign = 'left';
  mctx.font = `400 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  mctx.fillText('เรียน', ML, my);
  const deanLabelW = mctx.measureText('เรียน').width + 18;
  mctx.fillText('ผู้จัดการการประปาส่วนภูมิภาคสาขาขาณุวรลักษบุรี', ML + deanLabelW, my);
  my += 72;

  // Body Paragraphs (16pt = 45px, ระยะย่อหน้า 2.5 ซม. ประมาณ 115px จากขอบข้อความ, ระยะบรรทัด 58px)
  mctx.font = `400 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  const BODY_W = MR - ML;
  const LINE_H = 58;
  const INDENT = 115;

  const para1 =
    `ด้วยงานบริการและควบคุมน้ำสูญเสีย มีความจำเป็นเร่งด่วนต้องดำเนินการติดตั้งวางท่อประปาและมาตรวัดน้ำให้ผู้ใช้น้ำรายใหม่ ` +
    `เพื่อให้ผู้ใช้น้ำได้รับการบริการรวดเร็วในการติดตั้งวางท่อประปาและมาตรวัดน้ำ ขนาด ${memo.meterSizeText} ` +
    `ซึ่งมีความสำคัญในการเพิ่มจำนวนผู้ใช้น้ำและเป็นการให้บริการอย่างรวดเร็วเพื่อให้ทันต่อความต้องการของผู้ใช้น้ำ`;
  my = drawWrappedThaiParagraph(mctx, para1, ML, my, BODY_W, LINE_H, INDENT);
  my += 18;

  const para2 =
    `ดังนั้น งานบริการและควบคุมน้ำสูญเสีย จึงขออนุมัติจ้างเหมางานติดตั้งวางท่อประปาและมาตรวัดน้ำให้ผู้ใช้น้ำรายใหม่ ` +
    `จำนวน ${batch.records.length} ราย เป็นเงินทั้งสิ้น ${formatBaht(grandTotal)} -บาท (${taxNote}) ดังรายละเอียดที่แนบมาพร้อมบันทึกนี้`;
  my = drawWrappedThaiParagraph(mctx, para2, ML, my, BODY_W, LINE_H, INDENT);
  my += 18;

  const para3 = 'จึงเรียนมาเพื่อโปรดทราบและพิจารณาอนุมัติ';
  my = drawWrappedThaiParagraph(mctx, para3, ML, my, BODY_W, LINE_H, INDENT);

  // Proposer Signature (Right) - 16pt (45px)
  const proposerCenterX = 1160;
  let sigY = Math.max(my + 130, 1230);
  mctx.font = `400 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  mctx.textAlign = 'center';
  mctx.fillText(`(${memo.proposerName})`, proposerCenterX, sigY);
  mctx.fillText(memo.proposerTitle, proposerCenterX, sigY + 54);

  // Approval Block (Left) - 16pt (45px)
  const leftBlockX = 225;
  const leftSigCenterX = 520;
  let appY = sigY + 115;
  mctx.textAlign = 'left';
  mctx.font = `700 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  mctx.fillText('อนุมัติ', leftBlockX, appY);
  mctx.font = `400 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  mctx.fillText('เรียน  หัวหน้างานอำนวยการ', leftBlockX + 100, appY + 56);

  appY += 170;
  mctx.textAlign = 'center';
  mctx.fillText(`(${memo.managerName})`, leftSigCenterX, appY);
  mctx.fillText(memo.managerTitle, leftSigCenterX, appY + 54);
  mctx.fillText('วันที่..............................................', leftSigCenterX, appY + 108);

  // Forwarding to Procurement Block (Bottom Left) - 16pt (45px)
  let fwdY = appY + 190;
  mctx.textAlign = 'left';
  mctx.font = `700 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  mctx.fillText('เรียน  พนักงานพัสดุ', leftBlockX, fwdY);
  mctx.font = `400 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  mctx.fillText('เพื่อทราบและดำเนินการต่อไป', leftBlockX + 100, fwdY + 56);

  fwdY += 170;
  mctx.textAlign = 'center';
  mctx.fillText(`(${memo.adminHeadName})`, leftSigCenterX, fwdY);
  mctx.fillText(memo.adminHeadTitle, leftSigCenterX, fwdY + 54);
  mctx.fillText('วันที่..............................................', leftSigCenterX, fwdY + 108);
  mctx.textAlign = 'left';

  // Page 2+: รายชื่อติดตั้งวางท่อประปาและมาตรวัดน้ำ (Landscape A4: 2376 x 1680 px)
  const PAGE_W = 2376;
  const PAGE_H = 1680;
  const MARGIN_X = 52;

  const colDefs: Array<{ label: string; width: number; align: 'left' | 'center' }> = [
    { label: 'ลำดับที่', width: 110, align: 'center' },
    { label: 'ชื่อผู้ใช้น้ำ', width: 335, align: 'left' },
    { label: 'บ้านเลขที่', width: 125, align: 'center' },
    { label: 'หมู่', width: 70, align: 'center' },
    { label: 'ตำบล', width: 165, align: 'center' },
    { label: 'อำเภอ', width: 180, align: 'center' },
    { label: 'งานเลขที่', width: 245, align: 'center' },
    { label: 'หมายเลขมาตร', width: 255, align: 'center' },
    { label: 'ขนาดมาตร', width: 135, align: 'center' },
    { label: 'เลขที่ผู้ใช้น้ำ', width: 205, align: 'center' },
    { label: 'วงเงินที่จะจ้าง', width: 205, align: 'center' },
    { label: 'หมายเหตุ', width: 242, align: 'left' },
  ];

  const HEADER_H = 56;
  const ROW_H = 52;
  const TABLE_START_Y = 168;
  const MAX_TABLE_BOTTOM_WITHOUT_SIG = PAGE_H - 72;
  const SIG_AREA_NEEDED = includeTax ? 375 : 265;

  const createPageCanvas = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    return { canvas, ctx };
  };

  const drawFormTitleAndHeader = (
    ctx: CanvasRenderingContext2D,
    pageNumber: number
  ): number => {
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.font = `700 ${SARABUN_PT_20_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
    ctx.fillText(
      pageNumber > 1
        ? 'รายชื่อติดตั้งวางท่อประปาและมาตรวัดน้ำ (ต่อ)'
        : 'รายชื่อติดตั้งวางท่อประปาและมาตรวัดน้ำ',
      PAGE_W / 2,
      78
    );
    ctx.font = `700 ${SARABUN_PT_18_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
    ctx.fillText(
      'งานบริการและควบคุมน้ำสูญเสีย การประปาส่วนภูมิภาคสาขาขาณุวรลักษบุรี',
      PAGE_W / 2,
      132
    );

    const y = TABLE_START_Y;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.6;
    ctx.font = `700 ${SARABUN_PT_14_PX}px ${EXPORT_PDF_FONT_FAMILY}`;

    let cx = MARGIN_X;
    colDefs.forEach((col) => {
      ctx.strokeRect(cx, y, col.width, HEADER_H);
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.fillText(col.label, cx + col.width / 2, y + 39);
      cx += col.width;
    });
    ctx.textAlign = 'left';
    return y + HEADER_H;
  };

  const drawDataRow = (
    ctx: CanvasRenderingContext2D,
    y: number,
    vals: string[] | null
  ): number => {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.4;
    ctx.font = `400 ${SARABUN_PT_14_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
    ctx.fillStyle = '#000000';

    let cx = MARGIN_X;
    colDefs.forEach((col, colIdx) => {
      ctx.strokeRect(cx, y, col.width, ROW_H);
      if (vals) {
        const val = vals[colIdx] || '';
        if (val) {
          if (col.align === 'center') {
            ctx.textAlign = 'center';
            ctx.fillText(truncateText(ctx, val, col.width - 12), cx + col.width / 2, y + 36);
          } else {
            ctx.textAlign = 'left';
            ctx.fillText(truncateText(ctx, val, col.width - 20), cx + 10, y + 36);
          }
        }
      }
      cx += col.width;
    });
    ctx.textAlign = 'left';
    return y + ROW_H;
  };

  const drawSummaryLineRow = (
    ctx: CanvasRenderingContext2D,
    y: number,
    label: string,
    amountText: string,
    bold = false
  ): number => {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.6;
    const abWidth = colDefs[0].width + colDefs[1].width;
    ctx.strokeRect(MARGIN_X, y, abWidth, ROW_H);
    ctx.fillStyle = '#000000';
    ctx.font = `${bold ? '700' : '400'} ${SARABUN_PT_14_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, MARGIN_X + abWidth / 2, y + 36);

    let cx = MARGIN_X + abWidth;
    for (let colIdx = 2; colIdx < colDefs.length; colIdx++) {
      const col = colDefs[colIdx];
      ctx.strokeRect(cx, y, col.width, ROW_H);
      if (colIdx === 10) {
        ctx.font = `${bold ? '700' : '400'} ${SARABUN_PT_14_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.fillText(amountText, cx + col.width / 2, y + 36);
      }
      cx += col.width;
    }
    return y + ROW_H;
  };

  const pages: HTMLCanvasElement[] = [];
  let page = createPageCanvas();
  pages.push(page.canvas);
  let ctx = page.ctx;
  let curY = drawFormTitleAndHeader(ctx, 1);

  batch.records.forEach((rec, idx) => {
    if (curY + ROW_H > MAX_TABLE_BOTTOM_WITHOUT_SIG) {
      page = createPageCanvas();
      pages.push(page.canvas);
      ctx = page.ctx;
      curY = drawFormTitleAndHeader(ctx, pages.length);
    }
    const f = cleanBatchTemplateFields(rec);
    const vals = [
      String(idx + 1),
      f.fullName,
      f.houseNo,
      f.moo,
      f.subdistrict,
      f.district,
      f.jobNo,
      f.meterNo,
      f.meterSize,
      f.waterNo,
      formatBaht(f.price),
      f.note,
    ];
    curY = drawDataRow(ctx, curY, vals);
  });

  if (curY + SIG_AREA_NEEDED > PAGE_H - 36) {
    page = createPageCanvas();
    pages.push(page.canvas);
    ctx = page.ctx;
    curY = drawFormTitleAndHeader(ctx, pages.length);
  }

  const targetRowsSinglePage = Math.max(batch.records.length + 3, 15);
  const blankRowsNeeded =
    pages.length === 1
      ? Math.max(3, targetRowsSinglePage - batch.records.length)
      : 3;

  for (let b = 0; b < blankRowsNeeded; b++) {
    if (curY + ROW_H + SIG_AREA_NEEDED > PAGE_H - 36) break;
    curY = drawDataRow(ctx, curY, null);
  }

  curY = drawSummaryLineRow(ctx, curY, 'รวมเป็นเงิน', formatBaht(subtotal), false);
  if (includeTax) {
    curY = drawSummaryLineRow(ctx, curY, 'ภาษีมูลค่าเพิ่ม 7%', formatBaht(vatAmount), false);
    curY = drawSummaryLineRow(ctx, curY, 'รวมเป็นเงินทั้งสิ้น', formatBaht(grandTotal), true);
  }

  // Signature Block centered under columns J–L (indices 9, 10, 11) - 16pt (45px)
  const jlStartX =
    MARGIN_X +
    colDefs.slice(0, 9).reduce((s, c) => s + c.width, 0);
  const jlWidth = colDefs[9].width + colDefs[10].width + colDefs[11].width;
  const sigCenterX = jlStartX + jlWidth / 2;

  ctx.fillStyle = '#000000';
  ctx.font = `400 ${SARABUN_PT_16_PX}px ${EXPORT_PDF_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.fillText('ลงชื่อ........................................ผู้ควบคุมงาน', sigCenterX, curY + 64);
  ctx.fillText(`(${memo.inspectorName})`, sigCenterX, curY + 114);
  ctx.fillText(memo.inspectorTitle, sigCenterX, curY + 164);
  ctx.textAlign = 'left';

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  // First page: บันทึกข้อความ (Portrait A4: 210 x 297 mm)
  doc.addImage(memoCanvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');

  // Following pages: Summary table (Landscape A4: 297 x 210 mm)
  pages.forEach((canvas) => {
    doc.addPage('a4', 'landscape');
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210, undefined, 'FAST');
  });

  const filename = buildBatchFilename('pdf', batch.batchCode);
  doc.save(filename);
  return filename;
}


