import React, { useMemo, useState } from 'react';
import { BarChart3, PieChart } from 'lucide-react';
import { MeterRequest, getStatusMeta } from '../types/meter';
import { StatusSymbol } from './StatusSymbol';

interface AnalyticsChartsProps {
  records: MeterRequest[];
  activeStatusFilter: string;
  onFilterByStatus: (status: string) => void;
  isDark?: boolean;
}

export const AnalyticsCharts: React.FC<AnalyticsChartsProps> = ({
  records,
  activeStatusFilter,
  onFilterByStatus,
  isDark = false,
}) => {
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null);

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    records.forEach((r) => {
      const raw = (r.status || '').trim();
      const key = !raw || raw === 'รอตรวจสอบ' ? 'รับคำร้องแล้ว(รอสำรวจ)' : raw;
      counts[key] = (counts[key] || 0) + 1;
    });

    const preferredOrder = [
      'ติดตั้งเสร็จสิ้น',
      'อยู่ระหว่างติดตั้ง',
      'รอชำระเงิน',
      'รับคำร้องแล้ว(รอสำรวจ)',
      'ไม่มีเส้นท่อ/ยกเลิก',
    ];

    const entries = Object.entries(counts).sort(([a], [b]) => {
      const ia = preferredOrder.indexOf(a);
      const ib = preferredOrder.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b, 'th');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const total = records.length;
    return entries.map(([status, count]) => ({
      status,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      meta: getStatusMeta(status),
    }));
  }, [records]);

  const areaBreakdown = useMemo(() => {
    const preferredOrder = [
      'ติดตั้งเสร็จสิ้น',
      'อยู่ระหว่างติดตั้ง',
      'รอชำระเงิน',
      'รับคำร้องแล้ว(รอสำรวจ)',
      'ไม่มีเส้นท่อ/ยกเลิก',
    ];

    const areaMap: Record<
      string,
      {
        count: number;
        statuses: Record<string, { statusKey: string; count: number; meta: ReturnType<typeof getStatusMeta> }>;
      }
    > = {};

    records.forEach((r) => {
      const area =
        r.subdistrict ||
        (r.locationSummary ? r.locationSummary.split(' ')[0] : '') ||
        'ไม่ระบุตำบล';
      if (!areaMap[area]) {
        areaMap[area] = { count: 0, statuses: {} };
      }
      areaMap[area].count += 1;

      const raw = (r.status || '').trim();
      const rawStatus =
        !raw || raw === 'รอตรวจสอบ' ? 'รับคำร้องแล้ว(รอสำรวจ)' : raw;
      const meta = getStatusMeta(rawStatus);
      const bucketKey = meta.label;
      if (!areaMap[area].statuses[bucketKey]) {
        areaMap[area].statuses[bucketKey] = {
          statusKey: rawStatus,
          count: 0,
          meta,
        };
      }
      areaMap[area].statuses[bucketKey].count += 1;
    });

    return Object.entries(areaMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([area, info]) => {
        const segments = Object.values(info.statuses).sort((a, b) => {
          const ia = preferredOrder.indexOf(a.meta.label);
          const ib = preferredOrder.indexOf(b.meta.label);
          if (ia === -1 && ib === -1) return b.count - a.count;
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        });
        return {
          area,
          count: info.count,
          segments,
        };
      });
  }, [records]);

  const maxAreaCount = Math.max(...areaBreakdown.map((a) => a.count), 1);

  // Donut SVG Geometry
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  let cumulativeOffset = 0;

  return (
    <section
      id="analytics-section"
      className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6"
    >
      {/* Status Breakdown Donut */}
      <div className="bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl p-4 sm:p-5 min-w-0 shadow-xs transition-colors">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-[#0B4DA2] dark:bg-[#256EC2] text-white flex items-center justify-center shadow-xs shrink-0">
              <PieChart className="w-4 h-4" />
            </span>
            <h3 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
              สัดส่วนความคืบหน้าและสถานะคำขอ
            </h3>
          </div>
          {activeStatusFilter && (
            <button
              type="button"
              onClick={() => onFilterByStatus('')}
              className="text-xs text-[#0B4DA2] dark:text-[#66B2FF] hover:underline font-medium shrink-0"
            >
              แสดงทั้งหมด
            </button>
          )}
        </div>

        {records.length === 0 ? (
          <div className="h-44 sm:h-52 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">
            ยังไม่มีข้อมูลสำหรับแสดงสัดส่วนสถานะ
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <div className="relative w-36 h-36 sm:w-40 sm:h-40 shrink-0">
              <svg viewBox="0 0 150 150" className="w-full h-full -rotate-90">
                <circle
                  cx="75"
                  cy="75"
                  r={radius}
                  fill="none"
                  stroke={isDark ? '#1B2B40' : '#EDF2F7'}
                  strokeWidth="18"
                />
                {statusBreakdown.map((item) => {
                  const fraction = item.count / records.length;
                  const strokeDasharray = `${fraction * circumference} ${circumference}`;
                  const strokeDashoffset = -cumulativeOffset;
                  cumulativeOffset += fraction * circumference;
                  const isDimmed =
                    (hoveredStatus && hoveredStatus !== item.status) ||
                    (activeStatusFilter && activeStatusFilter !== item.status);

                  return (
                    <circle
                      key={item.status}
                      cx="75"
                      cy="75"
                      r={radius}
                      fill="none"
                      stroke={item.meta.color}
                      strokeWidth="18"
                      strokeDasharray={strokeDasharray}
                      strokeDashoffset={strokeDashoffset}
                      className="cursor-pointer transition-opacity duration-150"
                      style={{ opacity: isDimmed ? 0.3 : 1 }}
                      onMouseEnter={() => setHoveredStatus(item.status)}
                      onMouseLeave={() => setHoveredStatus(null)}
                      onClick={() =>
                        onFilterByStatus(
                          activeStatusFilter === item.status ? '' : item.status
                        )
                      }
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {hoveredStatus
                    ? statusBreakdown.find((s) => s.status === hoveredStatus)?.count ?? 0
                    : records.length}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[100px]">
                  {hoveredStatus || 'รายการทั้งหมด'}
                </span>
              </div>
            </div>

            <div className="flex-1 w-full space-y-2">
              {statusBreakdown.map((item) => {
                const isActive = activeStatusFilter === item.status;
                return (
                  <button
                    key={item.status}
                    type="button"
                    onMouseEnter={() => setHoveredStatus(item.status)}
                    onMouseLeave={() => setHoveredStatus(null)}
                    onClick={() =>
                      onFilterByStatus(isActive ? '' : item.status)
                    }
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs border transition-colors ${
                      isActive
                        ? 'bg-[#E8F1FC] dark:bg-[#152B4A] border-[#0B4DA2]/40 dark:border-[#3B8CE2]/50 text-slate-900 dark:text-white'
                        : 'bg-[#F8FBFF] dark:bg-[#0A1424] border-[#DCE6F3] dark:border-[#1D3350] hover:bg-[#EDF5FD] dark:hover:bg-[#15253D] text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium truncate">
                      <StatusSymbol status={item.status} size="md" shape="square" />
                      <span className="truncate">{item.meta.label}</span>
                    </span>
                    <span className="tabular-nums font-semibold text-slate-900 dark:text-slate-100 shrink-0 ml-2">
                      {item.count}{' '}
                      <span className="text-slate-400 dark:text-slate-500 font-normal">
                        ({item.percentage}%)
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Subdistrict / Area Status-Colored Stacked Horizontal Bar Chart */}
      <div className="bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl p-4 sm:p-5 min-w-0 shadow-xs transition-colors">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-[#0B4DA2] dark:bg-[#256EC2] text-white flex items-center justify-center shadow-xs shrink-0">
              <BarChart3 className="w-4 h-4" />
            </span>
            <h3 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
              ปริมาณคำขอแยกตามตำบล / พื้นที่ (สูงสุด 8 อันดับ)
            </h3>
          </div>
          <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums shrink-0">
            {areaBreakdown.length} พื้นที่
          </span>
        </div>

        {areaBreakdown.length === 0 ? (
          <div className="h-44 sm:h-52 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">
            ยังไม่มีข้อมูลพื้นที่สำหรับแสดงกราฟ
          </div>
        ) : (
          <div className="space-y-3">
            {areaBreakdown.map((row) => {
              const widthPct = Math.max((row.count / maxAreaCount) * 100, 4);
              return (
                <div key={row.area} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="text-slate-800 dark:text-slate-200 font-semibold truncate">
                      {row.area}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                      {row.count} รายการ
                    </span>
                  </div>

                  {/* Stacked Status-Colored Bar */}
                  <div className="h-3 w-full bg-[#EAF1FA] dark:bg-[#132238] rounded-md overflow-hidden">
                    <div
                      className="h-full flex rounded-md overflow-hidden divide-x divide-white/45 dark:divide-[#0F1B2E]/60 transition-all duration-300"
                      style={{ width: `${widthPct}%` }}
                    >
                      {row.segments.map((seg) => {
                        const segPct = (seg.count / row.count) * 100;
                        const isDimmed =
                          (hoveredStatus && hoveredStatus !== seg.statusKey) ||
                          (activeStatusFilter && activeStatusFilter !== seg.statusKey);
                        return (
                          <div
                            key={seg.meta.label}
                            title={`${row.area} · ${seg.meta.label}: ${seg.count} รายการ`}
                            onMouseEnter={() => setHoveredStatus(seg.statusKey)}
                            onMouseLeave={() => setHoveredStatus(null)}
                            onClick={() =>
                              onFilterByStatus(
                                activeStatusFilter === seg.statusKey ? '' : seg.statusKey
                              )
                            }
                            className="h-full cursor-pointer transition-opacity duration-150"
                            style={{
                              width: `${segPct}%`,
                              backgroundColor: seg.meta.color,
                              opacity: isDimmed ? 0.3 : 1,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Status Breakdown Legend per Area */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                    {row.segments.map((seg) => {
                      const isActive = activeStatusFilter === seg.statusKey;
                      return (
                        <button
                          key={seg.meta.label}
                          type="button"
                          onMouseEnter={() => setHoveredStatus(seg.statusKey)}
                          onMouseLeave={() => setHoveredStatus(null)}
                          onClick={() =>
                            onFilterByStatus(isActive ? '' : seg.statusKey)
                          }
                          className={`inline-flex items-center gap-1.5 transition-colors hover:text-slate-900 dark:hover:text-white ${
                            isActive ? 'font-semibold underline underline-offset-2' : ''
                          }`}
                        >
                          <StatusSymbol status={seg.statusKey} size="sm" shape="square" />
                          <span>{seg.meta.label}</span>
                          <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                            {seg.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
