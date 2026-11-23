/// <reference types="google.maps" />
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  AdvancedMarkerProps,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
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
  getStatusMeta,
  isNoPipeCancelledStatus,
  parseLatLngPair,
} from '../types/meter';
import { HousePhotoPreview } from './HousePhotoPreview';
import { NoPipeWarningIcon } from './StatusSymbol';

const DEFAULT_CENTER = { lat: 16.0633, lng: 99.8605 };

function isQuotaExceededError(err: any): boolean {
  const msg = String(err?.message || err?.status || err || '');
  return (
    err?.status === 'RESOURCE_EXHAUSTED' ||
    err?.code === 429 ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('QuotaExceededError') ||
    msg.includes('OverQuotaMapError')
  );
}

interface GoogleMapsViewProps {
  apiKey: string;
  records: MeterRequest[];
  isAdmin: boolean;
  isDark?: boolean;
  layerType: MapLayerType;
  pickedCoords: { lat: number; lng: number } | null;
  userLocation: { lat: number; lng: number } | null;
  focusedRecord: MeterRequest | null;
  routeTarget: MeterRequest | null;
  streetViewTarget: { lat: number; lng: number } | null;
  fitAllTrigger: number;
  onMapClickCoords: (lat: number, lng: number) => void;
  onSelectRecord: (record: MeterRequest | null) => void;
  onEditRecord: (record: MeterRequest) => void;
  onRequestRoute: (record: MeterRequest) => void;
  onOpenStreetView: (lat: number, lng: number) => void;
  onCloseStreetView: () => void;
  onStreetViewError?: (message: string) => void;
  onRouteComputed: (summary: RouteSummary | null, error?: string) => void;
}

interface AdvancedMarkerWithRefProps extends AdvancedMarkerProps {
  onMarkerClick: (marker: google.maps.marker.AdvancedMarkerElement) => void;
}

const AdvancedMarkerWithRef: React.FC<AdvancedMarkerWithRefProps> = ({
  children,
  onMarkerClick,
  ...rest
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  return (
    <AdvancedMarker
      ref={markerRef}
      onClick={() => {
        if (marker) onMarkerClick(marker);
      }}
      {...rest}
    >
      {children}
    </AdvancedMarker>
  );
};

interface GoogleSearchBoxProps {
  onSelectLocation: (lat: number, lng: number, label: string) => void;
}

const GooglePlacesSearchControl: React.FC<GoogleSearchBoxProps> = ({
  onSelectLocation,
}) => {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<
    google.maps.places.AutocompleteSuggestion[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!placesLib || !query.trim()) {
      setSuggestions([]);
      return;
    }

    // Check if user pasted direct coordinates "16.05, 99.80"
    const parsed = parseLatLngPair(query);
    if (parsed.lat !== null && parsed.lng !== null) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new AutocompleteSessionToken();
      }
      setIsSearching(true);
      AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        sessionToken: sessionTokenRef.current,
        includedRegionCodes: ['th'],
        language: 'th',
      })
        .then((res) => {
          setSuggestions(res.suggestions || []);
        })
        .catch((err) => {
          if (isQuotaExceededError(err)) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
          setSuggestions([]);
        })
        .finally(() => {
          setIsSearching(false);
        });
    }, 220);

    return () => clearTimeout(timer);
  }, [placesLib, query]);

  const handleSelectSuggestion = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    if (!placesLib || !suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'viewport'],
      });
      if (place.location) {
        const lat = place.location.lat();
        const lng = place.location.lng();
        if (map) {
          if (place.viewport) {
            map.fitBounds(place.viewport);
          } else {
            map.panTo({ lat, lng });
            map.setZoom(16);
          }
        }
        onSelectLocation(
          lat,
          lng,
          place.displayName || place.formattedAddress || query
        );
      }
      setQuery(suggestion.placePrediction.text.text);
      setSuggestions([]);
      sessionTokenRef.current = null;
    } catch (err) {
      if (isQuotaExceededError(err)) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseLatLngPair(query);
    if (parsed.lat !== null && parsed.lng !== null) {
      if (map) {
        map.panTo({ lat: parsed.lat, lng: parsed.lng });
        map.setZoom(16);
      }
      onSelectLocation(parsed.lat, parsed.lng, `${parsed.lat}, ${parsed.lng}`);
      setSuggestions([]);
    }
  };

  return (
    <div className="absolute top-2.5 left-2.5 right-14 sm:right-auto sm:w-72 md:w-80 z-20">
      <form
        onSubmit={handleSubmit}
        className="flex items-center bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-lg shadow-md overflow-hidden"
      >
        <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 ml-3 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาสถานที่ ตำบล หรือพิกัด lat, lng..."
          className="w-full py-2 px-2.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none bg-transparent"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setSuggestions([]);
            }}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            aria-label="ล้างคำค้นหา"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </form>

      {(suggestions.length > 0 || isSearching) && (
        <ul className="mt-1 bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-lg shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1B2B40] text-xs">
          {isSearching && suggestions.length === 0 && (
            <li className="px-3 py-2 text-slate-400 dark:text-slate-500">กำลังค้นหาสถานที่...</li>
          )}
          {suggestions.map((s, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => handleSelectSuggestion(s)}
                className="w-full text-left px-3 py-2 hover:bg-[#EDF5FC] dark:hover:bg-[#162336] text-slate-700 dark:text-slate-200 transition-colors"
              >
                {s.placePrediction?.text.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

interface RouteControllerProps {
  origin: { lat: number; lng: number } | null;
  destinationRecord: MeterRequest | null;
  onRouteComputed: (summary: RouteSummary | null, error?: string) => void;
}

const GoogleRouteController: React.FC<RouteControllerProps> = ({
  origin,
  destinationRecord,
  onRouteComputed,
}) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (
      !map ||
      !routesLib ||
      !destinationRecord ||
      destinationRecord.latitude === null ||
      destinationRecord.longitude === null
    ) {
      return;
    }

    const startPoint = origin || DEFAULT_CENTER;
    const destLat = destinationRecord.latitude;
    const destLng = destinationRecord.longitude;

    let cancelled = false;

    const request = {
      origin: { lat: startPoint.lat, lng: startPoint.lng },
      destination: { lat: destLat, lng: destLng },
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    };

    (routesLib.Route as any)
      .computeRoutes(request)
      .then(({ routes }: { routes: any[] }) => {
        if (cancelled) return;
        if (!routes || routes.length === 0) {
          onRouteComputed(null, 'ไม่พบเส้นทางระหว่างจุดเริ่มต้นกับหมุดที่เลือก');
          return;
        }
        const primaryRoute = routes[0];
        const newPolylines = primaryRoute.createPolylines();
        newPolylines.forEach((pl: google.maps.Polyline) => {
          pl.setOptions({
            strokeColor: '#2271B3',
            strokeWeight: 5,
            strokeOpacity: 0.9,
          });
          pl.setMap(map);
        });
        polylinesRef.current = newPolylines;

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport);
        }

        onRouteComputed({
          destinationName: destinationRecord.fullName || destinationRecord.rqNumber,
          destinationLat: destLat,
          destinationLng: destLng,
          distanceMeters: primaryRoute.distanceMeters ?? 0,
          durationMillis: primaryRoute.durationMillis ?? 0,
        });
      })
      .catch((err: any) => {
        if (cancelled) return;
        if (isQuotaExceededError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onRouteComputed(
          null,
          err?.message || 'ไม่สามารถคำนวณเส้นทางได้ กรุณาลองใหม่'
        );
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routesLib, origin, destinationRecord, onRouteComputed]);

  return null;
};

function computeBearingDeg(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const phi1 = toRad(fromLat);
  const phi2 = toRad(toLat);
  const dLambda = toRad(toLng - fromLng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}

interface MapEffectsProps {
  focusedRecord: MeterRequest | null;
  records: MeterRequest[];
  fitAllTrigger: number;
  streetViewTarget: { lat: number; lng: number } | null;
  onOpenStreetView: (lat: number, lng: number) => void;
  onCloseStreetView: () => void;
  onStreetViewError?: (message: string) => void;
}

const GoogleMapEffects: React.FC<MapEffectsProps> = ({
  focusedRecord,
  records,
  fitAllTrigger,
  streetViewTarget,
  onOpenStreetView,
  onCloseStreetView,
  onStreetViewError,
}) => {
  const map = useMap();
  const streetViewLib = useMapsLibrary('streetView');
  const apiStatus = useApiLoadingStatus();
  const hasAutoFitRef = useRef(false);
  const streetViewTargetRef = useRef(streetViewTarget);
  streetViewTargetRef.current = streetViewTarget;

  useEffect(() => {
    if (apiStatus === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  }, [apiStatus]);

  useEffect(() => {
    if (
      map &&
      focusedRecord &&
      focusedRecord.latitude !== null &&
      focusedRecord.longitude !== null
    ) {
      map.panTo({
        lat: focusedRecord.latitude,
        lng: focusedRecord.longitude,
      });
      map.setZoom(16);
    }
  }, [map, focusedRecord]);

  useEffect(() => {
    if (!map) return;
    const valid = records.filter(
      (r) => r.latitude !== null && r.longitude !== null
    );
    if (valid.length === 0) return;

    const shouldAutoFit = !hasAutoFitRef.current;
    if (!shouldAutoFit && fitAllTrigger === 0) return;
    hasAutoFitRef.current = true;

    if (valid.length === 1) {
      map.panTo({ lat: valid[0].latitude!, lng: valid[0].longitude! });
      map.setZoom(16);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    valid.forEach((r) => {
      bounds.extend({ lat: r.latitude!, lng: r.longitude! });
    });
    map.fitBounds(bounds, 56);
  }, [map, fitAllTrigger, records]);

  // Keep React state in sync when user enters/exits Street View via Pegman or native close button
  useEffect(() => {
    if (!map) return;
    const panorama = map.getStreetView();
    if (!panorama) return;

    const listener = panorama.addListener('visible_changed', () => {
      const visible = panorama.getVisible();
      if (!visible && streetViewTargetRef.current) {
        onCloseStreetView();
      } else if (visible && !streetViewTargetRef.current) {
        const pos = panorama.getPosition();
        if (pos) {
          onOpenStreetView(pos.lat(), pos.lng());
        }
      }
    });

    return () => listener.remove();
  }, [map, onOpenStreetView, onCloseStreetView]);

  // Open nearest Street View panorama and aim camera toward target coordinate
  useEffect(() => {
    if (!map) return;
    const panorama = map.getStreetView();
    if (!panorama) return;

    if (!streetViewTarget) {
      if (panorama.getVisible()) {
        panorama.setVisible(false);
      }
      return;
    }

    let cancelled = false;

    const openAtExactTarget = () => {
      panorama.setPosition(streetViewTarget);
      panorama.setPov({ heading: 0, pitch: 0 });
      panorama.setVisible(true);
    };

    if (!streetViewLib?.StreetViewService) {
      openAtExactTarget();
      return () => {
        cancelled = true;
      };
    }

    const sv = new streetViewLib.StreetViewService();
    const preference = streetViewLib.StreetViewPreference?.NEAREST;

    const findNearestPanorama = async () => {
      for (const radius of [120, 500]) {
        try {
          const res = await sv.getPanorama({
            location: streetViewTarget,
            radius,
            ...(preference ? { preference } : {}),
          });
          if (cancelled) return;
          const loc = res?.data?.location;
          if (loc?.pano) {
            const camLatLng = loc.latLng;
            const heading = camLatLng
              ? computeBearingDeg(
                  camLatLng.lat(),
                  camLatLng.lng(),
                  streetViewTarget.lat,
                  streetViewTarget.lng
                )
              : 0;
            panorama.setPano(loc.pano);
            panorama.setPov({ heading, pitch: 0 });
            panorama.setVisible(true);
            return;
          }
        } catch {
          // Try wider radius before reporting unavailable
        }
      }

      if (!cancelled) {
        panorama.setVisible(false);
        onStreetViewError?.(
          'ไม่พบภาพ Street View ในรัศมี 500 เมตรจากจุดนี้ กรุณาเลือกหมุดใกล้ถนน หรือลากไอคอนคนสีเหลือง (Pegman) ไปวางบนถนน'
        );
        onCloseStreetView();
      }
    };

    findNearestPanorama();

    return () => {
      cancelled = true;
    };
  }, [map, streetViewLib, streetViewTarget, onCloseStreetView, onStreetViewError]);

  return null;
};

export const GoogleMapsView: React.FC<GoogleMapsViewProps> = ({
  apiKey,
  records,
  isAdmin,
  isDark = false,
  layerType,
  pickedCoords,
  userLocation,
  focusedRecord,
  routeTarget,
  streetViewTarget,
  fitAllTrigger,
  onMapClickCoords,
  onSelectRecord,
  onEditRecord,
  onRequestRoute,
  onOpenStreetView,
  onCloseStreetView,
  onStreetViewError,
  onRouteComputed,
}) => {
  const [selectedAnchor, setSelectedAnchor] =
    useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [activeRecord, setActiveRecord] = useState<MeterRequest | null>(null);
  const [searchedPin, setSearchedPin] = useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (focusedRecord) {
      setActiveRecord(focusedRecord);
    }
  }, [focusedRecord]);

  const handleMarkerClick = useCallback(
    (rec: MeterRequest, marker: google.maps.marker.AdvancedMarkerElement) => {
      setSelectedAnchor(marker);
      setActiveRecord(rec);
      onSelectRecord(rec);
    },
    [onSelectRecord]
  );

  const handleMapClick = useCallback(
    (e: any) => {
      const latLng = e?.detail?.latLng;
      if (!latLng) return;
      if (isAdmin) {
        onMapClickCoords(latLng.lat, latLng.lng);
      }
      setActiveRecord(null);
      setSelectedAnchor(null);
      onSelectRecord(null);
    },
    [isAdmin, onMapClickCoords, onSelectRecord]
  );

  return (
    <APIProvider
      apiKey={apiKey}
      language="th"
      region="TH"
      libraries={['places', 'marker', 'routes', 'streetView']}
    >
      <div className="relative w-full h-full">
        <GooglePlacesSearchControl
          onSelectLocation={(lat, lng, label) => {
            setSearchedPin({ lat, lng, label });
            if (isAdmin) {
              onMapClickCoords(lat, lng);
            }
          }}
        />

        {!streetViewTarget && (pickedCoords || searchedPin) && (
          <div className="absolute bottom-3 left-2.5 z-20 flex items-center gap-1.5 bg-white/95 dark:bg-[#111C2B]/95 backdrop-blur-xs border border-slate-200 dark:border-[#263850] rounded-lg shadow-md px-2.5 py-1.5 text-xs">
            <button
              type="button"
              onClick={() => {
                const target = pickedCoords || searchedPin;
                if (target) onOpenStreetView(target.lat, target.lng);
              }}
              className="inline-flex items-center gap-1.5 font-medium text-[#0B4DA2] dark:text-[#66B2FF] hover:underline"
            >
              <Compass className="w-3.5 h-3.5" />
              <span>ดู Street View จุดที่ปักหมุด</span>
            </button>
          </div>
        )}

        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={14}
          mapTypeId={layerType}
          colorScheme={isDark ? 'DARK' : 'LIGHT'}
          gestureHandling="greedy"
          streetViewControl={true}
          fullscreenControl={true}
          mapTypeControl={false}
          onClick={handleMapClick}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
        >
          <GoogleMapEffects
            focusedRecord={focusedRecord}
            records={records}
            fitAllTrigger={fitAllTrigger}
            streetViewTarget={streetViewTarget}
            onOpenStreetView={onOpenStreetView}
            onCloseStreetView={onCloseStreetView}
            onStreetViewError={onStreetViewError}
          />

          <GoogleRouteController
            origin={userLocation}
            destinationRecord={routeTarget}
            onRouteComputed={onRouteComputed}
          />

          {records
            .filter((r) => r.latitude !== null && r.longitude !== null)
            .map((rec) => {
              const meta = getStatusMeta(rec.status);
              const isSelected = activeRecord?.uid === rec.uid;
              const isNoPipe = isNoPipeCancelledStatus(rec.status);
              return (
                <AdvancedMarkerWithRef
                  key={rec.uid}
                  position={{ lat: rec.latitude!, lng: rec.longitude! }}
                  zIndex={isSelected ? 1000 : 10}
                  onMarkerClick={(marker) => handleMarkerClick(rec, marker)}
                >
                  {isNoPipe ? (
                    <div
                      className={`cursor-pointer transition-transform ${
                        isSelected ? 'scale-125' : 'hover:scale-110'
                      }`}
                    >
                      <NoPipeWarningIcon className="w-7 h-7" withHalo />
                    </div>
                  ) : (
                    <Pin
                      background={meta.color}
                      borderColor="#ffffff"
                      glyphColor="#ffffff"
                      scale={isSelected ? 1.25 : 1}
                    />
                  )}
                </AdvancedMarkerWithRef>
              );
            })}

          {/* Admin draggable pin for new/edited coordinates */}
          {isAdmin && pickedCoords && (
            <AdvancedMarker
              position={pickedCoords}
              draggable={true}
              zIndex={1200}
              onDragEnd={(e) => {
                if (e.latLng) {
                  onMapClickCoords(e.latLng.lat(), e.latLng.lng());
                }
              }}
            >
              <Pin
                background="#2271B3"
                borderColor="#ffffff"
                glyphColor="#ffffff"
                scale={1.25}
              />
            </AdvancedMarker>
          )}

          {/* User live GPS position marker */}
          {userLocation && (
            <AdvancedMarker position={userLocation} zIndex={900}>
              <div className="w-4 h-4 rounded-full bg-[#2271B3] border-2 border-white shadow-md" />
            </AdvancedMarker>
          )}

          {/* Searched place marker */}
          {searchedPin && (
            <AdvancedMarker
              position={{ lat: searchedPin.lat, lng: searchedPin.lng }}
              zIndex={800}
            >
              <Pin
                background="#1e293b"
                borderColor="#ffffff"
                glyphColor="#ffffff"
              />
            </AdvancedMarker>
          )}

          {activeRecord &&
            selectedAnchor &&
            activeRecord.latitude !== null &&
            activeRecord.longitude !== null && (
              <InfoWindow
                anchor={selectedAnchor}
                onCloseClick={() => {
                  setActiveRecord(null);
                  setSelectedAnchor(null);
                  onSelectRecord(null);
                }}
              >
                <div className="p-1 min-w-[205px] max-w-[245px] sm:max-w-[280px] max-h-[210px] sm:max-h-[260px] overflow-y-auto space-y-2 text-xs text-black">
                  <div className="border-b border-slate-200 pb-1.5">
                    <p className="font-bold text-sm text-black">
                      {activeRecord.fullName || 'ไม่ระบุชื่อ'}
                    </p>
                    <p className="text-[11px] font-mono text-slate-700">
                      {activeRecord.rqNumber
                        ? `เลขที่ RQ: ${activeRecord.rqNumber}`
                        : `แถวที่ ${activeRecord.rowIndex}`}
                    </p>
                  </div>

                  <div className="space-y-1 text-black">
                    <div>
                      <span className="text-slate-700 font-medium">ที่อยู่: </span>
                      <span className="text-black">
                        {activeRecord.houseNo ? `บ้านเลขที่ ${activeRecord.houseNo} ` : ''}
                        หมู่ที่ {activeRecord.moo || '-'} {activeRecord.locationSummary || ''}
                      </span>
                    </div>
                    {activeRecord.phone && (
                      <div className="flex items-center gap-1">
                        <span className="text-slate-700 font-medium">เบอร์โทร:</span>
                        <a
                          href={`tel:${activeRecord.phone}`}
                          className="text-[#1A5A8F] hover:underline font-mono font-medium inline-flex items-center gap-1"
                        >
                          <Phone className="w-3 h-3" />
                          <span>{activeRecord.phone}</span>
                        </a>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-700 font-medium">ราคา: </span>
                      <span className="font-semibold tabular-nums text-black">
                        {activeRecord.price.toLocaleString('th-TH', {
                          minimumFractionDigits: 2,
                        })}{' '}
                        ฿
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-700 font-medium">สถานะ:</span>
                      {isNoPipeCancelledStatus(activeRecord.status) && (
                        <NoPipeWarningIcon className="w-4 h-4 shrink-0" />
                      )}
                      <span
                        className="font-semibold"
                        style={{ color: getStatusMeta(activeRecord.status).color }}
                      >
                        {getStatusMeta(activeRecord.status).label}
                      </span>
                    </div>

                    <HousePhotoPreview
                      url={activeRecord.housePhotoUrl}
                      alt={
                        activeRecord.fullName
                          ? `รูปหน้าบ้าน ${activeRecord.fullName}`
                          : 'รูปหน้าบ้าน'
                      }
                      lightSurface
                      heightClass="h-24 sm:h-28"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => onRequestRoute(activeRecord)}
                      className="px-2 py-1.5 bg-[#2271B3] hover:bg-[#1A5A8F] text-white rounded-md font-medium inline-flex items-center justify-center gap-1"
                    >
                      <Navigation className="w-3 h-3" />
                      <span>นำทาง</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenStreetView(
                          activeRecord.latitude!,
                          activeRecord.longitude!
                        )
                      }
                      className="px-2 py-1.5 rounded-md font-medium inline-flex items-center justify-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-900"
                    >
                      <Compass className="w-3 h-3" />
                      <span>Street View</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${activeRecord.latitude},${activeRecord.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-medium text-[#1A5A8F] hover:underline inline-flex items-center gap-1"
                    >
                      <span>เปิดแอป Google Maps</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => onEditRecord(activeRecord)}
                        className="text-[11px] font-semibold inline-flex items-center gap-1 text-amber-700 hover:text-amber-800"
                      >
                        <PenLine className="w-3 h-3" />
                        <span>แก้ไข</span>
                      </button>
                    )}
                  </div>
                </div>
              </InfoWindow>
            )}
        </GoogleMap>
      </div>
    </APIProvider>
  );
};
