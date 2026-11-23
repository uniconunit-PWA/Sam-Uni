import React, { useCallback, useState } from 'react';
import {
  Compass,
  ExternalLink,
  Layers,
  LocateFixed,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  Scan,
  X,
} from 'lucide-react';
import { MapLayerType, MeterRequest, RouteSummary, isNoPipeCancelledStatus } from '../types/meter';
import { GoogleMapsView } from './GoogleMapsView';
import { FallbackLeafletMap } from './FallbackLeafletMap';
import { NoPipeWarningIcon } from './StatusSymbol';

interface MapWorkspaceProps {
  records: MeterRequest[];
  isAdmin: boolean;
  isDark?: boolean;
  apiKeyOverride?: string;
  pickedCoords: { lat: number; lng: number } | null;
  focusedRecord: MeterRequest | null;
  userLocation: { lat: number; lng: number } | null;
  onLocateUser: () => void;
  onMapClickCoords: (lat: number, lng: number) => void;
  onEditRecord: (record: MeterRequest) => void;
}

const LAYER_OPTIONS: Array<{ id: MapLayerType; label: string }> = [
  { id: 'roadmap', label: 'แผนที่' },
  { id: 'satellite', label: 'ดาวเทียม' },
  { id: 'hybrid', label: 'ไฮบริด' },
  { id: 'terrain', label: 'ภูมิประเทศ' },
];

const LEGEND_ITEMS = [
  { label: 'ติดตั้งเสร็จสิ้น', color: '#10b981' },
  { label: 'อยู่ระหว่างติดตั้ง', color: '#d97706' },
  { label: 'รอชำระเงิน', color: '#e11d48' },
  { label: 'รับคำร้องแล้ว(รอสำรวจ)', color: '#2271b3' },
  { label: 'ไม่มีเส้นท่อ/ยกเลิก', color: '#ef4444' },
];

export const MapWorkspace: React.FC<MapWorkspaceProps> = ({
  records,
  isAdmin,
  isDark = false,
  apiKeyOverride = '',
  pickedCoords,
  focusedRecord,
  userLocation,
  onLocateUser,
  onMapClickCoords,
  onEditRecord,
}) => {
  const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || apiKeyOverride || '';
  const [layerType, setLayerType] = useState<MapLayerType>('hybrid');
  const [selectedRecord, setSelectedRecord] = useState<MeterRequest | null>(null);
  const [routeTarget, setRouteTarget] = useState<MeterRequest | null>(null);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeError, setRouteError] = useState<string>('');
  const [streetViewTarget, setStreetViewTarget] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [streetViewNotice, setStreetViewNotice] = useState<string>('');
  const [fitAllTrigger, setFitAllTrigger] = useState(0);
  const [isMapExpanded, setIsMapExpanded] = useState(false);

  const resolveStreetViewPoint = useCallback((): { lat: number; lng: number } => {
    if (selectedRecord?.latitude != null && selectedRecord?.longitude != null) {
      return { lat: selectedRecord.latitude, lng: selectedRecord.longitude };
    }
    if (focusedRecord?.latitude != null && focusedRecord?.longitude != null) {
      return { lat: focusedRecord.latitude, lng: focusedRecord.longitude };
    }
    if (pickedCoords) {
      return pickedCoords;
    }
    if (userLocation) {
      return userLocation;
    }
    const firstMapped = records.find(
      (r) => r.latitude !== null && r.longitude !== null
    );
    if (firstMapped?.latitude != null && firstMapped?.longitude != null) {
      return { lat: firstMapped.latitude, lng: firstMapped.longitude };
    }
    return { lat: 16.0633, lng: 99.8605 };
  }, [selectedRecord, focusedRecord, pickedCoords, userLocation, records]);

  const handleToggleStreetView = useCallback(() => {
    setStreetViewNotice('');
    if (streetViewTarget) {
      setStreetViewTarget(null);
      return;
    }
    const point = resolveStreetViewPoint();
    setStreetViewTarget(point);
  }, [streetViewTarget, resolveStreetViewPoint]);

  const handleRouteComputed = useCallback(
    (summary: RouteSummary | null, error?: string) => {
      setRouteSummary(summary);
      setRouteError(error || '');
    },
    []
  );

  const handleRequestRoute = useCallback(
    (record: MeterRequest) => {
      if (!userLocation) {
        onLocateUser();
      }
      setRouteError('');
      setRouteTarget(record);
    },
    [userLocation, onLocateUser]
  );

  const validCoordsCount = records.filter(
    (r) => r.latitude !== null && r.longitude !== null
  ).length;

  return (
    <section
      id="map-section"
      className="bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl shadow-xs overflow-hidden flex flex-col h-full transition-colors min-w-0"
    >
      {/* Map Toolbar Header */}
      <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-[#DCE6F3] dark:border-[#1D3350] flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2.5 bg-white dark:bg-[#0F1B2E]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#0B4DA2] dark:bg-[#256EC2] text-white flex items-center justify-center shadow-xs shrink-0">
            <MapPin className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              แผนที่พิกัดคำขอติดตั้ง/ย้ายมาตรวัดน้ำ
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
              มีพิกัด {validCoordsCount} / {records.length} รายการ
              {isAdmin ? ' · คลิกบนแผนที่เพื่อปักหมุด' : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Layer Switcher (Roadmap / Satellite / Hybrid / Terrain) */}
          <div className="inline-flex items-center bg-[#F4F8FD] dark:bg-[#091322] p-0.5 rounded-lg border border-[#D5E3F4] dark:border-[#1D3350]">
            <Layers className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 mx-1.5 hidden md:block" />
            {LAYER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setLayerType(opt.id)}
                className={`px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  layerType === opt.id
                    ? 'bg-[#0B4DA2] dark:bg-[#2B7CD3] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onLocateUser}
            className="px-2.5 sm:px-3 py-1.5 bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] hover:bg-[#E7F0FC] dark:hover:bg-[#15253D] text-slate-700 dark:text-slate-200 rounded-lg text-[11px] sm:text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors"
          >
            <LocateFixed className="w-3.5 h-3.5 text-[#0B4DA2] dark:text-[#66B2FF]" />
            <span>ตำแหน่งฉัน</span>
          </button>

          <button
            type="button"
            onClick={() => setFitAllTrigger((c) => c + 1)}
            className="px-2.5 sm:px-3 py-1.5 bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] hover:bg-[#E7F0FC] dark:hover:bg-[#15253D] text-slate-700 dark:text-slate-200 rounded-lg text-[11px] sm:text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors"
          >
            <Scan className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
            <span>ดูทั้งหมด</span>
          </button>

          <button
            type="button"
            onClick={() => setIsMapExpanded((prev) => !prev)}
            title={isMapExpanded ? 'ย่อขนาดแผนที่' : 'ขยายขนาดแผนที่'}
            className="px-2.5 sm:px-3 py-1.5 bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] hover:bg-[#E7F0FC] dark:hover:bg-[#15253D] text-slate-700 dark:text-slate-200 rounded-lg text-[11px] sm:text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors"
          >
            {isMapExpanded ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                <span>ย่อแผนที่</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                <span>ขยายแผนที่</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleToggleStreetView}
            title={
              streetViewTarget
                ? 'กลับไปหน้าแผนที่ปกติ'
                : 'เปิดดูภาพถนน Street View 360°'
            }
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
              streetViewTarget
                ? 'bg-[#2271B3] hover:bg-[#1A5A8F] text-white shadow-xs'
                : 'bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] hover:bg-[#E7F0FC] dark:hover:bg-[#15253D] text-slate-700 dark:text-slate-200'
            }`}
          >
            <Compass
              className={`w-3.5 h-3.5 ${
                streetViewTarget
                  ? 'text-white'
                  : 'text-[#0B4DA2] dark:text-[#66B2FF]'
              }`}
            />
            <span>{streetViewTarget ? 'ออกจาก Street View' : 'Street View'}</span>
          </button>
        </div>
      </div>

      {/* Street View unavailable notice or fallback Street View launcher */}
      {(streetViewNotice || (!mapsApiKey && streetViewTarget)) && (
        <div className="px-3 sm:px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
          <span>
            {streetViewNotice ||
              `พิกัด ${streetViewTarget?.lat.toFixed(5)}, ${streetViewTarget?.lng.toFixed(5)} พร้อมเปิดภาพ Street View 360°`}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {!mapsApiKey && streetViewTarget && (
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${streetViewTarget.lat},${streetViewTarget.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#0B4DA2] dark:text-[#66B2FF] hover:underline inline-flex items-center gap-1"
              >
                <span>เปิด Google Street View</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                setStreetViewNotice('');
                if (!mapsApiKey) setStreetViewTarget(null);
              }}
              className="text-amber-700 dark:text-amber-300 hover:underline inline-flex items-center gap-0.5"
            >
              <X className="w-3.5 h-3.5" />
              <span>ปิด</span>
            </button>
          </div>
        </div>
      )}

      {/* Non-blocking info notice when Google Maps Platform key hasn't been configured yet (Admin Only) */}
      {isAdmin && !mapsApiKey && (
        <div className="px-3 sm:px-4 py-2 bg-[#EDF5FC] dark:bg-[#16283D] border-b border-[#D6E7F6] dark:border-[#234161] text-[11px] text-[#1A5A8F] dark:text-[#A9D1F2] flex flex-wrap items-center justify-between gap-2">
          <span className="leading-relaxed">
            กำลังแสดงแผนที่โหมดมาตรฐาน (ดาวเทียม / ไฮบริด / ถนน / ค้นหาสถานที่)
          </span>
          {selectedRecord?.latitude && selectedRecord?.longitude && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${selectedRecord.latitude},${selectedRecord.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-1 shrink-0"
            >
              <span>เปิดจุดที่เลือกใน Google Maps</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Active Route Banner */}
      {(routeSummary || routeError) && (
        <div className="px-3 sm:px-4 py-2 bg-[#173A58] dark:bg-[#0D1E31] text-white text-xs flex flex-wrap items-center justify-between gap-2.5 border-b border-[#2271B3]/40">
          {routeSummary ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#8CC5F2]">
                <Navigation className="w-3.5 h-3.5" />
                <span>เส้นทาง: {routeSummary.destinationName}</span>
              </span>
              <span className="font-mono tabular-nums text-slate-200 text-[11px]">
                {(routeSummary.distanceMeters / 1000).toFixed(2)} กม. · ~
                {Math.max(1, Math.round(routeSummary.durationMillis / 60000))} นาที
                {routeSummary.isEstimate ? ' (ประมาณการ)' : ''}
              </span>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${routeSummary.destinationLat},${routeSummary.destinationLng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#8CC5F2] hover:text-white underline inline-flex items-center gap-1 text-[11px]"
              >
                <span>นำทาง Turn-by-Turn</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ) : (
            <span className="text-rose-300">{routeError}</span>
          )}

          <button
            type="button"
            onClick={() => {
              setRouteTarget(null);
              setRouteSummary(null);
              setRouteError('');
            }}
            className="text-slate-300 hover:text-white inline-flex items-center gap-1 text-[11px]"
          >
            <X className="w-3.5 h-3.5" />
            <span>ปิดเส้นทาง</span>
          </button>
        </div>
      )}

      {/* Map Viewport (flex-fills parent height to align cleanly beside the form) */}
      <div
        className={`w-full flex-1 relative bg-slate-100 dark:bg-[#0F1826] transition-[min-height] duration-200 ${
          isMapExpanded
            ? 'min-h-[520px] sm:min-h-[600px] lg:min-h-[680px]'
            : 'min-h-[420px] sm:min-h-[480px] lg:min-h-[540px]'
        }`}
      >
        <div className="absolute inset-0">
          {mapsApiKey ? (
            <GoogleMapsView
              apiKey={mapsApiKey}
              records={records}
              isAdmin={isAdmin}
              isDark={isDark}
              layerType={layerType}
              pickedCoords={pickedCoords}
              userLocation={userLocation}
              focusedRecord={focusedRecord}
              routeTarget={routeTarget}
              streetViewTarget={streetViewTarget}
              fitAllTrigger={fitAllTrigger}
              onMapClickCoords={onMapClickCoords}
              onSelectRecord={setSelectedRecord}
              onEditRecord={onEditRecord}
              onRequestRoute={handleRequestRoute}
              onOpenStreetView={(lat, lng) => {
                setStreetViewNotice('');
                setStreetViewTarget({ lat, lng });
              }}
              onCloseStreetView={() => setStreetViewTarget(null)}
              onStreetViewError={(msg) => setStreetViewNotice(msg)}
              onRouteComputed={handleRouteComputed}
            />
          ) : (
            <FallbackLeafletMap
              records={records}
              isAdmin={isAdmin}
              isDark={isDark}
              layerType={layerType}
              pickedCoords={pickedCoords}
              userLocation={userLocation}
              focusedRecord={focusedRecord}
              routeTarget={routeTarget}
              fitAllTrigger={fitAllTrigger}
              onMapClickCoords={onMapClickCoords}
              onSelectRecord={setSelectedRecord}
              onEditRecord={onEditRecord}
              onRequestRoute={handleRequestRoute}
              onRouteComputed={handleRouteComputed}
            />
          )}
        </div>
      </div>

      {/* Legend Bar */}
      <div className="px-3 sm:px-4 py-2 bg-[#F4F8FD] dark:bg-[#0A1424] border-t border-[#DCE6F3] dark:border-[#1D3350] flex flex-wrap items-center gap-x-3.5 sm:gap-x-5 gap-y-1 text-[11px] sm:text-xs text-slate-600 dark:text-slate-300">
        <span className="font-semibold text-slate-700 dark:text-slate-200">สัญลักษณ์:</span>
        {LEGEND_ITEMS.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5">
            {isNoPipeCancelledStatus(item.label) ? (
              <NoPipeWarningIcon className="w-4 h-4 shrink-0" />
            ) : (
              <span
                className="w-2.5 h-2.5 rounded-full inline-block border border-white dark:border-[#111C2B] shadow-xs"
                style={{ backgroundColor: item.color }}
              />
            )}
            <span>{item.label}</span>
          </span>
        ))}
      </div>
    </section>
  );
};
