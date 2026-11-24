import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Compass,
  ExternalLink,
  Navigation,
  PenLine,
  Phone,
  Search,
  X,
} from 'lucide-react';
import {
  MapLayerType,
  MeterRequest,
  RouteSummary,
  getNoPipeWarningSvgMarkup,
  getStatusMeta,
  isNoPipeCancelledStatus,
  parseLatLngPair,
} from '../types/meter';
import { HousePhotoPreview } from './HousePhotoPreview';
import { NoPipeWarningIcon } from './StatusSymbol';

const DEFAULT_CENTER: [number, number] = [16.0633, 99.8605];

interface FallbackLeafletMapProps {
  records: MeterRequest[];
  isAdmin: boolean;
  isDark?: boolean;
  layerType: MapLayerType;
  onChangeLayerType?: (layer: MapLayerType) => void;
  pickedCoords: { lat: number; lng: number } | null;
  userLocation: { lat: number; lng: number } | null;
  focusedRecord: MeterRequest | null;
  routeTarget: MeterRequest | null;
  fitAllTrigger: number;
  onMapClickCoords: (lat: number, lng: number) => void;
  onSelectRecord: (record: MeterRequest | null) => void;
  onEditRecord: (record: MeterRequest) => void;
  onRequestRoute: (record: MeterRequest) => void;
  onOpenStreetView?: (lat: number, lng: number) => void;
  onRouteComputed: (summary: RouteSummary | null, error?: string) => void;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const FallbackLeafletMap: React.FC<FallbackLeafletMapProps> = ({
  records,
  isAdmin,
  isDark = false,
  layerType,
  onChangeLayerType,
  pickedCoords,
  userLocation,
  focusedRecord,
  routeTarget,
  fitAllTrigger,
  onMapClickCoords,
  onSelectRecord,
  onEditRecord,
  onRequestRoute,
  onOpenStreetView,
  onRouteComputed,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const selectionMarkerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const hasAutoFitRef = useRef(false);
  const prevFitAllTriggerRef = useRef(fitAllTrigger);

  const [selectedPopupRecord, setSelectedPopupRecord] = useState<MeterRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isPegmanPickMode, setIsPegmanPickMode] = useState(false);

  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;
  const onMapClickRef = useRef(onMapClickCoords);
  onMapClickRef.current = onMapClickCoords;
  const isPegmanPickModeRef = useRef(isPegmanPickMode);
  isPegmanPickModeRef.current = isPegmanPickMode;
  const onOpenStreetViewRef = useRef(onOpenStreetView);
  onOpenStreetViewRef.current = onOpenStreetView;

  // Initialize Leaflet map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 14,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    tileLayerGroupRef.current = L.layerGroup().addTo(map);
    markersGroupRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (isPegmanPickModeRef.current) {
        setIsPegmanPickMode(false);
        onOpenStreetViewRef.current?.(e.latlng.lat, e.latlng.lng);
        return;
      }
      if (isAdminRef.current) {
        onMapClickRef.current(e.latlng.lat, e.latlng.lng);
      }
      setSelectedPopupRecord(null);
      onSelectRecord(null);
    });

    mapRef.current = map;

    const ro =
      typeof ResizeObserver !== 'undefined' && containerRef.current
        ? new ResizeObserver(() => {
            map.invalidateSize();
          })
        : null;
    if (ro && containerRef.current) {
      ro.observe(containerRef.current);
    }

    return () => {
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [onSelectRecord]);

  // Update map base layers (Roadmap / Satellite / Hybrid / Terrain — no Carto watermark tiles)
  useEffect(() => {
    const map = mapRef.current;
    const group = tileLayerGroupRef.current;
    if (!map || !group) return;
    group.clearLayers();

    const tilePane = map.getPane('tilePane');
    if (tilePane) {
      tilePane.style.filter =
        layerType === 'roadmap' && isDark
          ? 'invert(92%) hue-rotate(180deg) brightness(95%) contrast(90%)'
          : '';
    }

    if (layerType === 'satellite' || layerType === 'hybrid') {
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri',
          maxZoom: 19,
        }
      ).addTo(group);

      if (layerType === 'hybrid') {
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Roads &copy; Esri',
            maxZoom: 19,
          }
        ).addTo(group);
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Labels &copy; Esri',
            maxZoom: 19,
          }
        ).addTo(group);
      }
    } else if (layerType === 'terrain') {
      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenTopoMap',
        maxZoom: 17,
      }).addTo(group);
    } else {
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(group);
    }
  }, [layerType, isDark]);

  // Render meter request markers
  useEffect(() => {
    const group = markersGroupRef.current;
    if (!group) return;
    group.clearLayers();

    records.forEach((rec) => {
      if (rec.latitude === null || rec.longitude === null) return;
      const meta = getStatusMeta(rec.status);
      const isSelected = selectedPopupRecord?.uid === rec.uid;
      const isNoPipe = isNoPipeCancelledStatus(rec.status);

      const marker: L.Layer = isNoPipe
        ? L.marker([rec.latitude, rec.longitude], {
            icon: L.divIcon({
              className: 'custom-nopipe-warning-marker',
              html: getNoPipeWarningSvgMarkup(isSelected ? 34 : 26, true),
              iconSize: isSelected ? [34, 34] : [26, 26],
              iconAnchor: isSelected ? [17, 17] : [13, 13],
            }),
          })
        : L.circleMarker([rec.latitude, rec.longitude], {
            radius: isSelected ? 10 : 8,
            fillColor: meta.color,
            color: '#ffffff',
            weight: isSelected ? 3 : 2,
            opacity: 1,
            fillOpacity: 0.95,
          });

      marker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        setSelectedPopupRecord(rec);
        onSelectRecord(rec);
      });

      marker.bindTooltip(`${rec.fullName || rec.rqNumber || 'คำขอ'} · ${meta.label}`, {
        direction: 'top',
        offset: [0, -6],
      });

      group.addLayer(marker);
    });
  }, [records, selectedPopupRecord, onSelectRecord]);

  // Admin draggable selection marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectionMarkerRef.current) {
      map.removeLayer(selectionMarkerRef.current);
      selectionMarkerRef.current = null;
    }

    if (isAdmin && pickedCoords) {
      const pinIcon = L.divIcon({
        className: 'custom-admin-pin',
        html: `<div style="width:24px;height:24px;border-radius:9999px;background:#2271B3;border:3px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.35);"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([pickedCoords.lat, pickedCoords.lng], {
        draggable: true,
        icon: pinIcon,
      }).addTo(map);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onMapClickRef.current(pos.lat, pos.lng);
      });

      selectionMarkerRef.current = marker;
    }
  }, [isAdmin, pickedCoords]);

  // GPS User location marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (userMarkerRef.current) {
      map.removeLayer(userMarkerRef.current);
      userMarkerRef.current = null;
    }

    if (userLocation) {
      const m = L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 7,
        fillColor: '#2271B3',
        color: '#ffffff',
        weight: 3,
        fillOpacity: 1,
      })
        .bindTooltip('ตำแหน่งปัจจุบันของคุณ')
        .addTo(map);
      userMarkerRef.current = m;
      map.setView([userLocation.lat, userLocation.lng], 15);
    }
  }, [userLocation]);

  // Focus on record
  useEffect(() => {
    const map = mapRef.current;
    if (
      map &&
      focusedRecord &&
      focusedRecord.latitude !== null &&
      focusedRecord.longitude !== null
    ) {
      map.setView([focusedRecord.latitude, focusedRecord.longitude], 16, {
        animate: true,
      });
      setSelectedPopupRecord(focusedRecord);
    }
  }, [focusedRecord]);

  // Fit all markers (auto-fit once on initial load + whenever user clicks ดูทั้งหมด)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const triggeredByButton = fitAllTrigger !== prevFitAllTriggerRef.current;
    prevFitAllTriggerRef.current = fitAllTrigger;

    const valid = records.filter(
      (r) => r.latitude !== null && r.longitude !== null
    );
    if (valid.length === 0) return;

    const shouldAutoFit = !hasAutoFitRef.current;
    if (!shouldAutoFit && !triggeredByButton) return;
    hasAutoFitRef.current = true;

    if (valid.length === 1) {
      map.setView([valid[0].latitude!, valid[0].longitude!], 16);
      return;
    }

    const bounds = L.latLngBounds(
      valid.map((r) => [r.latitude!, r.longitude!] as [number, number])
    );
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
  }, [fitAllTrigger, records]);

  // Route line estimation in fallback mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (routeLineRef.current) {
      map.removeLayer(routeLineRef.current);
      routeLineRef.current = null;
    }

    if (
      !routeTarget ||
      routeTarget.latitude === null ||
      routeTarget.longitude === null
    ) {
      return;
    }

    const origin = userLocation || { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };
    const destLat = routeTarget.latitude;
    const destLng = routeTarget.longitude;

    const line = L.polyline(
      [
        [origin.lat, origin.lng],
        [destLat, destLng],
      ],
      {
        color: '#2271B3',
        weight: 4,
        dashArray: '8 6',
      }
    ).addTo(map);

    routeLineRef.current = line;
    map.fitBounds(line.getBounds(), { padding: [60, 60] });

    const straightDist = haversineMeters(origin.lat, origin.lng, destLat, destLng);
    const approxRoadDist = straightDist * 1.25;
    const approxMillis = (approxRoadDist / 1000 / 45) * 3600 * 1000;

    onRouteComputed({
      destinationName: routeTarget.fullName || routeTarget.rqNumber,
      destinationLat: destLat,
      destinationLng: destLng,
      distanceMeters: approxRoadDist,
      durationMillis: approxMillis,
      isEstimate: true,
    });
  }, [routeTarget, userLocation, onRouteComputed]);

  // Place & Coordinate Search via Nominatim
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const parsed = parseLatLngPair(q);
    if (parsed.lat !== null && parsed.lng !== null) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&countrycodes=th&accept-language=th&limit=5&q=${encodeURIComponent(
            q
          )}`
        );
        if (res.ok) {
          const data: NominatimResult[] = await res.json();
          setSearchResults(data || []);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseLatLngPair(searchQuery);
    if (parsed.lat !== null && parsed.lng !== null && mapRef.current) {
      mapRef.current.setView([parsed.lat, parsed.lng], 16);
      if (isAdmin) {
        onMapClickCoords(parsed.lat, parsed.lng);
      }
      setSearchResults([]);
    } else if (searchResults.length > 0 && mapRef.current) {
      const first = searchResults[0];
      const lat = Number.parseFloat(first.lat);
      const lng = Number.parseFloat(first.lon);
      mapRef.current.setView([lat, lng], 15);
      if (isAdmin) {
        onMapClickCoords(lat, lng);
      }
      setSearchResults([]);
    }
  };

  return (
    <div className="relative w-full h-full">
      {/* Floating Place / Coordinate Search */}
      <div className="absolute top-2.5 left-2.5 right-2.5 sm:right-auto sm:w-72 md:w-80 z-[500]">
        <form
          onSubmit={handleSearchSubmit}
          className="flex items-center bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-lg shadow-md overflow-hidden"
        >
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 ml-3 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาสถานที่ ตำบล หรือพิกัด lat, lng..."
            className="w-full py-2 px-2.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none bg-transparent"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSearchResults([]);
              }}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="ล้างคำค้นหา"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </form>

        {(searchResults.length > 0 || isSearching) && (
          <ul className="mt-1 bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-lg shadow-lg max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1B2B40] text-xs">
            {isSearching && searchResults.length === 0 && (
              <li className="px-3 py-2 text-slate-400 dark:text-slate-500">กำลังค้นหาสถานที่...</li>
            )}
            {searchResults.map((item, idx) => (
              <li key={idx}>
                <button
                  type="button"
                  onClick={() => {
                    const lat = Number.parseFloat(item.lat);
                    const lng = Number.parseFloat(item.lon);
                    mapRef.current?.setView([lat, lng], 15);
                    if (isAdmin) {
                      onMapClickCoords(lat, lng);
                    }
                    setSearchQuery(item.display_name);
                    setSearchResults([]);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-[#EDF5FC] dark:hover:bg-[#162336] text-slate-700 dark:text-slate-200 transition-colors"
                >
                  {item.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Selected Marker Info Card (Google Maps style floating sheet) */}
      {selectedPopupRecord &&
        selectedPopupRecord.latitude !== null &&
        selectedPopupRecord.longitude !== null && (
          <div className="absolute bottom-2.5 left-2.5 right-12 sm:right-auto sm:w-80 max-h-[calc(100%-56px)] overflow-y-auto bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-xl shadow-xl z-[500] p-3 sm:p-4 space-y-2 text-xs">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-[#1B2B40] pb-1.5">
              <div>
                <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  {selectedPopupRecord.fullName || 'ไม่ระบุชื่อ'}
                </h4>
                <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {selectedPopupRecord.rqNumber
                    ? `เลขที่ RQ: ${selectedPopupRecord.rqNumber}`
                    : `แถวที่ ${selectedPopupRecord.rowIndex}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPopupRecord(null);
                  onSelectRecord(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded"
                aria-label="ปิดรายละเอียด"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1 text-slate-700 dark:text-slate-300">
              <p>
                <span className="text-slate-500 dark:text-slate-400">ที่อยู่: </span>
                {selectedPopupRecord.houseNo
                  ? `บ้านเลขที่ ${selectedPopupRecord.houseNo} `
                  : ''}
                หมู่ที่ {selectedPopupRecord.moo || '-'}{' '}
                {selectedPopupRecord.locationSummary || ''}
              </p>
              {selectedPopupRecord.phone && (
                <p className="flex items-center gap-1.5">
                  <span className="text-slate-500 dark:text-slate-400">เบอร์โทร:</span>
                  <a
                    href={`tel:${selectedPopupRecord.phone}`}
                    className="text-[#2271B3] dark:text-[#5EA6E0] hover:underline font-mono inline-flex items-center gap-1"
                  >
                    <Phone className="w-3 h-3" />
                    <span>{selectedPopupRecord.phone}</span>
                  </a>
                </p>
              )}
              <p>
                <span className="text-slate-500 dark:text-slate-400">ราคา: </span>
                <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {selectedPopupRecord.price.toLocaleString('th-TH', {
                    minimumFractionDigits: 2,
                  })}{' '}
                  ฿
                </span>
              </p>
              <p className="flex items-center gap-1.5">
                <span className="text-slate-500 dark:text-slate-400">สถานะ:</span>
                {isNoPipeCancelledStatus(selectedPopupRecord.status) && (
                  <NoPipeWarningIcon className="w-4 h-4 shrink-0" />
                )}
                <span
                  className="font-semibold"
                  style={{
                    color: getStatusMeta(selectedPopupRecord.status).color,
                  }}
                >
                  {getStatusMeta(selectedPopupRecord.status).label}
                </span>
              </p>
              <HousePhotoPreview
                url={selectedPopupRecord.housePhotoUrl}
                alt={
                  selectedPopupRecord.fullName
                    ? `รูปหน้าบ้าน ${selectedPopupRecord.fullName}`
                    : 'รูปหน้าบ้าน'
                }
                heightClass="h-24 sm:h-28"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => onRequestRoute(selectedPopupRecord)}
                className="px-2.5 py-1.5 bg-[#2271B3] hover:bg-[#1A5A8F] dark:bg-[#3584C7] dark:hover:bg-[#2271B3] text-white rounded-lg font-medium inline-flex items-center justify-center gap-1 transition-colors"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>คำนวณเส้นทาง</span>
              </button>
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${selectedPopupRecord.latitude},${selectedPopupRecord.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 bg-slate-100 dark:bg-[#162336] hover:bg-slate-200 dark:hover:bg-[#1E3049] text-slate-800 dark:text-slate-200 rounded-lg font-medium inline-flex items-center justify-center gap-1 transition-colors"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Street View</span>
              </a>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-[#1B2B40]">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${selectedPopupRecord.latitude},${selectedPopupRecord.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-1"
              >
                <span>นำทางด้วย Google Maps</span>
                <ExternalLink className="w-3 h-3" />
              </a>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => onEditRecord(selectedPopupRecord)}
                  className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 inline-flex items-center gap-1"
                >
                  <PenLine className="w-3 h-3" />
                  <span>แก้ไขคำขอ</span>
                </button>
              )}
            </div>
          </div>
        )}

      {/* Bottom-Right Pegman & Imagery Dock (matching Google Maps Street View dock) */}
      <div className="absolute bottom-6 right-12 z-[500] flex items-center gap-1.5 bg-[#1C2128]/90 backdrop-blur-md border border-white/15 rounded-lg p-1 shadow-xl text-white select-none">
        <button
          type="button"
          onClick={() => {
            if (isPegmanPickMode) {
              setIsPegmanPickMode(false);
              const target =
                selectedPopupRecord?.latitude != null &&
                selectedPopupRecord?.longitude != null
                  ? {
                      lat: selectedPopupRecord.latitude,
                      lng: selectedPopupRecord.longitude,
                    }
                  : mapRef.current
                  ? {
                      lat: mapRef.current.getCenter().lat,
                      lng: mapRef.current.getCenter().lng,
                    }
                  : { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };
              onOpenStreetView?.(target.lat, target.lng);
              return;
            }
            setIsPegmanPickMode(true);
          }}
          title="เรียกดูภาพ Street View (คลิกเพื่อจิ้มจุดบนถนน)"
          aria-pressed={isPegmanPickMode}
          className={`group relative flex items-center justify-center w-7 h-7 rounded-md border transition-colors ${
            isPegmanPickMode
              ? 'bg-amber-400 text-slate-950 border-amber-200 shadow-sm'
              : 'bg-white/10 hover:bg-amber-400/20 border-white/10 hover:border-amber-300/60'
          }`}
        >
          <Compass
            className={`w-4 h-4 ${isPegmanPickMode ? 'text-slate-950' : 'text-amber-300'}`}
          />
          <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute -top-9 right-0 whitespace-nowrap bg-[#11161D] text-white text-[11px] font-medium px-2.5 py-1 rounded-md shadow-lg border border-white/15">
            {isPegmanPickMode ? 'คลิกจุดบนถนนเพื่อดู Street View' : 'เรียกดูภาพ Street View'}
          </span>
        </button>

        {onChangeLayerType && (
          <>
            <div className="w-px h-5 bg-white/20" aria-hidden="true" />
            <div className="flex items-center gap-1">
              {(
                [
                  {
                    id: 'roadmap' as MapLayerType,
                    label: 'ถนน',
                    bg: 'linear-gradient(135deg, #e2e8f0 0%, #f8fafc 45%, #cbd5e1 46%, #93c5fd 48%, #f1f5f9 52%, #e2e8f0 100%)',
                  },
                  {
                    id: 'satellite' as MapLayerType,
                    label: 'ดาว',
                    bg: 'radial-gradient(circle at 30% 35%, #3f6212 0%, #166534 45%, #14532d 75%, #064e3b 100%)',
                  },
                  {
                    id: 'hybrid' as MapLayerType,
                    label: 'ผสม',
                    bg: 'linear-gradient(125deg, #166534 0%, #365314 44%, #facc15 46%, #14532d 50%, #1e3a8a 100%)',
                  },
                ]
              ).map((item) => {
                const active = layerType === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChangeLayerType(item.id)}
                    title={item.label}
                    aria-pressed={active}
                    className={`relative w-7 h-7 rounded-[5px] overflow-hidden border transition-all ${
                      active
                        ? 'border-[#66B2FF] ring-2 ring-[#66B2FF]/70 scale-105'
                        : 'border-white/30 hover:border-white/80 opacity-85 hover:opacity-100'
                    }`}
                    style={{ background: item.bg }}
                  >
                    <span className="absolute inset-x-0 bottom-0 bg-black/60 text-[8px] leading-tight text-center text-white/95 font-medium px-0.5">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {isPegmanPickMode && (
        <div className="absolute top-14 right-2.5 z-[500] bg-[#11161D]/90 text-amber-200 border border-amber-400/40 rounded-lg px-3 py-1.5 text-[11px] font-medium shadow-lg">
          คลิกตำแหน่งบนถนนในแผนที่ เพื่อเปิดภาพ Street View
        </div>
      )}

      <div
        ref={containerRef}
        className={`w-full h-full z-10 ${isPegmanPickMode ? 'cursor-crosshair' : ''}`}
      />
    </div>
  );
};
