import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  MapPin,
  PenLine,
  Phone,
  Search,
  Trash2,
} from 'lucide-react';
import { MeterRequest, formatLatLngString, getStatusMeta } from '../types/meter';
import { StatusSymbol } from './StatusSymbol';
import {
  ExportFilterContext,
  ExportScope,
  computeExportAnalytics,
  describeActiveFilters,
  exportFilteredToExcel,
  exportFilteredToPdf,
} from '../services/exportService';

interface RequestsTableProps {
  records: MeterRequest[];
  totalCount: number;
  isLoading: boolean;
  isAdmin: boolean;
  embedded?: boolean;
  searchQuery: string;
  filterContext: ExportFilterContext;
  onSearchChange: (q: string) => void;
  onFocusRecord: (record: MeterRequest) => void;
  onEditRecord: (record: MeterRequest) => void;
  onDeleteRecord: (record: MeterRequest) => void;
  onExportFeedback?: (
    message: string,
    tone: 'info' | 'success' | 'warning' | 'error'
  ) => void;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export const RequestsTable: React.FC<RequestsTableProps> = ({
  records,
  totalCount,
  isLoading,
  isAdmin,
  embedded = false,
  searchQuery,
  filterContext,
  onSearchChange,
  onFocusRecord,
  onEditRecord,
  onDeleteRecord,
  onExportFeedback,
}) => {
  const [exportScope, setExportScope] = useState<ExportScope>('all');
  const [isExporting, setIsExporting] = useState<'excel' | 'pdf' | null>(null);
  const [showSummaryStrip, setShowSummaryStrip] = useState(true);
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const analytics = useMemo(() => computeExportAnalytics(records), [records]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    pageSize,
    searchQuery,
    filterContext.status,
    filterContext.location,
    filterContext.province,
    filterContext.district,
    filterContext.subdistrict,
    filterContext.moo,
    filterContext.month,
    filterContext.dateFrom,
    filterContext.dateTo,
  ]);

  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, records.length);

  const paginatedRecords = useMemo(
    () => records.slice(startIndex, startIndex + pageSize),
    [records, startIndex, pageSize]
  );

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: Array<number | 'ellipsis-left' | 'ellipsis-right'> = [1];
    const left = Math.max(2, safeCurrentPage - 1);
    const right = Math.min(totalPages - 1, safeCurrentPage + 1);
    if (left > 2) pages.push('ellipsis-left');
    for (let p = left; p <= right; p += 1) {
      pages.push(p);
    }
    if (right < totalPages - 1) pages.push('ellipsis-right');
    pages.push(totalPages);
    return pages;
  }, [totalPages, safeCurrentPage]);
  const activeFilterText = useMemo(
    () => describeActiveFilters(filterContext),
    [filterContext]
  );

  const formatDate = (iso: string) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleExportExcel = async () => {
    if (records.length === 0 || isExporting) return;
    setIsExporting('excel');
    try {
      const filename = await exportFilteredToExcel(records, filterContext, exportScope);
      onExportFeedback?.(
        `ส่งออกไฟล์ Excel (${filename}) สำเร็จแล้ว (${records.length} รายการ)`,
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถสร้างไฟล์ Excel ได้';
      onExportFeedback?.(`ส่งออก Excel ไม่สำเร็จ: ${msg}`, 'error');
    } finally {
      setIsExporting(null);
    }
  };

  const handleExportPdf = async () => {
    if (records.length === 0 || isExporting) return;
    setIsExporting('pdf');
    try {
      const filename = await exportFilteredToPdf(records, filterContext, exportScope);
      onExportFeedback?.(
        `ส่งออกไฟล์ PDF (${filename}) สำเร็จแล้ว (${records.length} รายการ)`,
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถสร้างไฟล์ PDF ได้';
      onExportFeedback?.(`ส่งออก PDF ไม่สำเร็จ: ${msg}`, 'error');
    } finally {
      setIsExporting(null);
    }
  };

  const topAreas = analytics.areaBreakdown.slice(0, 4);
  const maxAreaCount = Math.max(...topAreas.map((a) => a.count), 1);

  return (
    <section
      id={embedded ? undefined : 'table-section'}
      className={
        embedded
          ? 'transition-colors'
          : 'bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl overflow-hidden shadow-xs transition-colors'
      }
    >
      {/* Header & Search + Export Toolbar */}
      <div className="px-3.5 sm:px-5 py-3.5 sm:py-4 border-b border-[#DCE6F3] dark:border-[#1D3350] flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-xl bg-[#0B4DA2] dark:bg-[#256EC2] text-white flex items-center justify-center shadow-xs shrink-0">
            <ListChecks className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">
              รายการคำขอติดตั้ง / ย้ายมาตรวัดน้ำ
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
              <span className="tabular-nums">
                แสดง {records.length.toLocaleString('th-TH')} จากทั้งหมด{' '}
                {totalCount.toLocaleString('th-TH')} รายการ
              </span>
              <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">·</span>
              <span className="text-[#0B4DA2] dark:text-[#66B2FF] font-medium truncate max-w-full sm:max-w-[360px]">
                {activeFilterText}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="relative w-full sm:w-56 md:w-64">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="ค้นหาเลขที่ RQ, ชื่อ-สกุล, ตำบล..."
              className="w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-xl py-2 pl-9 pr-3 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:bg-white dark:focus:bg-[#132238] focus:border-[#0B4DA2] dark:focus:border-[#3B8CE2] transition-colors"
            />
          </div>

          <select
            aria-label="เลือกรูปแบบส่วนข้อมูลสำหรับส่งออก"
            value={exportScope}
            onChange={(e) => setExportScope(e.target.value as ExportScope)}
            className="w-full sm:w-auto max-w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-xl py-2 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 outline-none focus:border-[#0B4DA2] dark:focus:border-[#3B8CE2] transition-colors"
          >
            <option value="all">ทั้งหมด (แดชบอร์ด + ตาราง)</option>
            <option value="by_status">แยกตามสถานะคำขอ</option>
            <option value="by_area">แยกตามตำบล / พื้นที่</option>
          </select>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={records.length === 0 || isExporting !== null}
            title="ส่งออกรายการที่กรองพร้อมภาพแดชบอร์ดสรุปเป็น Excel (.xlsx)"
            className="px-2.5 sm:px-3 py-2 bg-[#059669] hover:bg-[#047857] dark:bg-[#0D9488] dark:hover:bg-[#0F766E] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-xs transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {isExporting === 'excel' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5" />
            )}
            <span>ส่งออก Excel</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            disabled={records.length === 0 || isExporting !== null}
            title="ส่งออกรายการที่กรองพร้อมภาพแดชบอร์ดสรุปเป็น PDF (.pdf)"
            className="px-2.5 sm:px-3 py-2 bg-[#0F62BD] hover:bg-[#0B4DA2] dark:bg-[#2B7CD3] dark:hover:bg-[#2266B5] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-xs transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {isExporting === 'pdf' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            <span>ส่งออก PDF</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSummaryStrip((prev) => !prev)}
            className="px-2.5 py-2 bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] hover:bg-[#E7F0FC] dark:hover:bg-[#15253D] text-slate-700 dark:text-slate-200 text-xs font-medium rounded-xl transition-colors inline-flex items-center gap-1 whitespace-nowrap"
            title={showSummaryStrip ? 'ซ่อนภาพแดชบอร์ดสรุปในตาราง' : 'แสดงภาพแดชบอร์ดสรุปในตาราง'}
          >
            <BarChart2 className="w-3.5 h-3.5 text-[#0B4DA2] dark:text-[#66B2FF]" />
            <span className="hidden sm:inline">สรุป</span>
            {showSummaryStrip ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Inline Visual Summary Dashboard inside Table Section */}
      {showSummaryStrip && (
        <div className="bg-[#F4F8FD] dark:bg-[#0A1424] border-b border-[#DCE6F3] dark:border-[#1D3350] p-3.5 sm:p-5 space-y-3.5 sm:space-y-4 transition-colors">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-4 rounded-full bg-[#2271B3] dark:bg-[#5EA6E0]" />
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                ภาพแดชบอร์ดสรุปข้อมูลในตาราง (ตามรายการที่กรอง)
              </h3>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              ข้อมูลชุดเดียวกับที่จะส่งออกเป็นรายงาน Excel และ PDF
            </span>
          </div>

          {/* 2-Column Visual Breakdown: Status Proportion Bar + Top Areas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Left: Status Proportion */}
            <div className="bg-white dark:bg-[#111C2B] border border-slate-200/90 dark:border-[#213145] rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  สัดส่วนสถานะคำขอ
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {analytics.statusBreakdown.length} สถานะ
                </span>
              </div>

              <div className="h-3 w-full rounded-full bg-slate-100 dark:bg-[#1B2B40] overflow-hidden flex">
                {analytics.total > 0 &&
                  analytics.statusBreakdown.map((st) => (
                    <div
                      key={st.status}
                      title={`${st.label}: ${st.count} รายการ (${st.pct}%)`}
                      style={{
                        width: `${(st.count / analytics.total) * 100}%`,
                        backgroundColor: st.color,
                      }}
                      className="h-full transition-all duration-300"
                    />
                  ))}
              </div>

              {analytics.statusBreakdown.length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 py-2">
                  ไม่มีข้อมูลในตัวกรองปัจจุบัน
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {analytics.statusBreakdown.map((st) => (
                    <div
                      key={st.status}
                      className="flex items-center justify-between text-[11px] py-0.5"
                    >
                      <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200 truncate">
                        <StatusSymbol status={st.status} size="sm" />
                        <span className="truncate">{st.label}</span>
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100 tabular-nums shrink-0 ml-2">
                        {st.count} ({st.pct}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Top Areas / Subdistricts */}
            <div className="bg-white dark:bg-[#111C2B] border border-slate-200/90 dark:border-[#213145] rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  ปริมาณคำขอแยกตามตำบล / พื้นที่ (สูงสุด 4 อันดับ)
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  รวม {analytics.areaBreakdown.length} พื้นที่
                </span>
              </div>

              {topAreas.length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 py-2">
                  ไม่มีข้อมูลพื้นที่ในตัวกรองปัจจุบัน
                </p>
              ) : (
                <div className="space-y-2">
                  {topAreas.map((area) => {
                    const widthPct = Math.max(Math.round((area.count / maxAreaCount) * 100), 6);
                    return (
                      <div key={area.area} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-medium text-slate-700 dark:text-slate-200 truncate pr-2">
                            {area.area}
                          </span>
                          <span className="text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                            <strong className="text-[#2271B3] dark:text-[#5EA6E0]">
                              {area.count.toLocaleString('th-TH')}
                            </strong>{' '}
                            ราย
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-[#1B2B40] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#2271B3] dark:bg-[#3584C7] transition-all duration-300"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detailed Table */}
      <div className="overflow-x-auto max-h-[560px]">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-[#0B3B82] dark:bg-[#122E57] text-white border-b border-[#092F6A] dark:border-[#1E4478] z-10">
            <tr className="text-[11px] font-semibold tracking-wide text-white/95">
              <th className="py-3 px-4 whitespace-nowrap">เลขที่ RQ</th>
              <th className="py-3 px-4 whitespace-nowrap">วันที่ยื่นคำร้อง</th>
              <th className="py-3 px-4 whitespace-nowrap">ชื่อ - สกุล</th>
              <th className="py-3 px-4 whitespace-nowrap">ที่อยู่ / หมู่ที่ / พื้นที่</th>
              <th className="py-3 px-4 whitespace-nowrap">เบอร์โทร</th>
              <th className="py-3 px-4 text-right whitespace-nowrap">ราคา (บาท)</th>
              <th className="py-3 px-4 whitespace-nowrap">สถานะ</th>
              <th className="py-3 px-4 whitespace-nowrap">พิกัด (lat/long)</th>
              {isAdmin && (
                <th className="py-3 px-4 text-center whitespace-nowrap">จัดการ</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#1B2B40] text-xs text-slate-700 dark:text-slate-300">
            {isLoading && records.length === 0 ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <tr key={idx}>
                  <td colSpan={isAdmin ? 9 : 8} className="py-4 px-4">
                    <div className="h-4 bg-slate-100 dark:bg-[#1B2B40] rounded animate-pulse w-full" />
                  </td>
                </tr>
              ))
            ) : records.length === 0 ? (
              <tr>
                <td
                  colSpan={isAdmin ? 9 : 8}
                  className="py-12 px-4 text-center text-slate-400 dark:text-slate-500"
                >
                  ไม่พบรายการคำขอที่ตรงกับเงื่อนไขการค้นหา
                </td>
              </tr>
            ) : (
              paginatedRecords.map((rec) => {
                const statusMeta = getStatusMeta(rec.status);
                const coordsStr = formatLatLngString(rec.latitude, rec.longitude);

                return (
                  <tr
                    key={rec.uid}
                    className="hover:bg-[#EDF5FC]/45 dark:hover:bg-[#162336] transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                      {rec.rqNumber || `#${rec.rowIndex}`}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400">
                      {formatDate(rec.requestDate)}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {rec.fullName || '-'}
                    </td>
                    <td className="py-3 px-4 max-w-[260px]">
                      <div className="text-slate-800 dark:text-slate-200 truncate">
                        {rec.houseNo ? `บ้านเลขที่ ${rec.houseNo} · ` : ''}
                        {rec.moo ? `หมู่ที่ ${rec.moo}` : '-'}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {rec.locationSummary || '-'}
                      </div>
                      {rec.housePhotoUrl && /^https?:\/\//i.test(rec.housePhotoUrl) && (
                        <a
                          href={rec.housePhotoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#2271B3] dark:text-[#5EA6E0] hover:underline"
                          title="เปิดดูรูปหน้าบ้านใน Google Drive"
                        >
                          <ImageIcon className="w-3 h-3 shrink-0" />
                          <span>ดูรูปหน้าบ้าน</span>
                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        </a>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-mono tabular-nums">
                      {rec.phone ? (
                        <a
                          href={`tel:${rec.phone}`}
                          className="text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-1"
                        >
                          <Phone className="w-3 h-3" />
                          <span>{rec.phone}</span>
                        </a>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-600">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap tabular-nums">
                      {rec.price.toLocaleString('th-TH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                        <StatusSymbol status={rec.status} size="sm" />
                        <span>{statusMeta.label}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] tabular-nums">
                      {coordsStr ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onFocusRecord(rec)}
                            className="text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-1"
                            title="ดูตำแหน่งบนแผนที่"
                          >
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span>{coordsStr}</span>
                          </button>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${rec.latitude},${rec.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 dark:text-slate-500 hover:text-[#2271B3] dark:hover:text-[#5EA6E0]"
                            title="เปิดใน Google Maps"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">ยังไม่ระบุพิกัด</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditRecord(rec)}
                            className="px-2.5 py-1 bg-white dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] hover:border-[#2271B3] dark:hover:border-[#5EA6E0] hover:bg-[#EDF5FC] dark:hover:bg-[#2271B3]/20 text-[#2271B3] dark:text-[#5EA6E0] rounded-md font-medium inline-flex items-center gap-1 transition-colors"
                          >
                            <PenLine className="w-3 h-3" />
                            <span>แก้ไข</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteRecord(rec)}
                            className="px-2.5 py-1 bg-white dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] hover:border-rose-300 dark:hover:border-rose-500/50 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-md font-medium inline-flex items-center gap-1 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>ลบ</span>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          {records.length > 0 && (
            <tfoot className="sticky bottom-0 bg-[#EBF3FD] dark:bg-[#10243F] border-t-2 border-[#0F62BD]/30 dark:border-[#2B7CD3]/40 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <tr>
                <td colSpan={5} className="py-2.5 px-4 text-right text-[#0A3A82] dark:text-[#8CC5F2]">
                  รวมรายการตามเงื่อนไขที่กรอง ({analytics.total.toLocaleString('th-TH')} รายการ)
                </td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#0B4DA2] dark:text-[#66B2FF]">
                  {analytics.totalAmount.toLocaleString('th-TH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
                <td colSpan={isAdmin ? 3 : 2} className="py-2.5 px-4 text-left text-slate-500 dark:text-slate-400 font-normal">
                  บาท
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination Bar (10 / 20 / 50 / 100 rows per page) */}
      {records.length > 0 && (
        <div className="px-3.5 sm:px-5 py-3 bg-[#F4F8FD] dark:bg-[#0A1424] border-t border-[#DCE6F3] dark:border-[#1D3350] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-slate-600 dark:text-slate-300 tabular-nums">
              แสดง{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {(startIndex + 1).toLocaleString('th-TH')}–{endIndex.toLocaleString('th-TH')}
              </strong>{' '}
              จาก{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {records.length.toLocaleString('th-TH')}
              </strong>{' '}
              รายการ
            </span>

            <div className="inline-flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                แสดงต่อหน้า:
              </span>
              <div
                role="group"
                aria-label="จำนวนรายการต่อหน้า"
                className="inline-flex items-center bg-white dark:bg-[#0F1B2E] p-0.5 rounded-lg border border-[#D5E3F4] dark:border-[#1D3350]"
              >
                {PAGE_SIZE_OPTIONS.map((size) => {
                  const active = pageSize === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setPageSize(size)}
                      aria-pressed={active}
                      className={`px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-semibold tabular-nums transition-colors ${
                        active
                          ? 'bg-[#0F62BD] dark:bg-[#2B7CD3] text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-[#EDF5FD] dark:hover:bg-[#15253D]'
                      }`}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, Math.min(p, totalPages) - 1))}
              disabled={safeCurrentPage <= 1}
              aria-label="หน้าก่อนหน้า"
              className="px-2.5 py-1.5 rounded-lg border border-[#D5E3F4] dark:border-[#1D3350] bg-white dark:bg-[#0F1B2E] text-slate-700 dark:text-slate-200 hover:bg-[#EDF5FD] dark:hover:bg-[#15253D] disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center gap-1 font-medium transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>ก่อนหน้า</span>
            </button>

            <div className="inline-flex items-center gap-1">
              {pageNumbers.map((item) =>
                typeof item === 'number' ? (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCurrentPage(item)}
                    aria-current={item === safeCurrentPage ? 'page' : undefined}
                    className={`min-w-[30px] h-7 px-2 rounded-lg text-[11px] font-semibold tabular-nums border transition-colors ${
                      item === safeCurrentPage
                        ? 'bg-[#0F62BD] dark:bg-[#2B7CD3] border-[#0F62BD] dark:border-[#2B7CD3] text-white shadow-xs'
                        : 'bg-white dark:bg-[#0F1B2E] border-[#D5E3F4] dark:border-[#1D3350] text-slate-700 dark:text-slate-200 hover:bg-[#EDF5FD] dark:hover:bg-[#15253D]'
                    }`}
                  >
                    {item}
                  </button>
                ) : (
                  <span
                    key={item}
                    className="px-1 text-slate-400 dark:text-slate-500 select-none"
                  >
                    ...
                  </span>
                )
              )}
            </div>

            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, Math.min(p, totalPages) + 1))}
              disabled={safeCurrentPage >= totalPages}
              aria-label="หน้าถัดไป"
              className="px-2.5 py-1.5 rounded-lg border border-[#D5E3F4] dark:border-[#1D3350] bg-white dark:bg-[#0F1B2E] text-slate-700 dark:text-slate-200 hover:bg-[#EDF5FD] dark:hover:bg-[#15253D] disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center gap-1 font-medium transition-colors"
            >
              <span>ถัดไป</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

