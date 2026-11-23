import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ClipboardList,
  Database,
  Droplets,
  ExternalLink,
  Filter,
  FolderOpen,
  LogOut,
  Moon,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import {
  CompletedBatch,
  ConnectionMode,
  DataChangeEvent,
  MeterFormPayload,
  MeterRequest,
  SheetConfig,
  formatLatLngString,
} from './types/meter';
import {
  clearAccessToken,
  getAccessToken,
  googleSignIn,
  initAuth,
  logoutGoogle,
  trySilentAccessToken,
} from './services/firebaseAuth';
import {
  DEFAULT_SPREADSHEET_ID,
  LEGACY_SPREADSHEET_ID,
  SheetsApiError,
  appendSheetRecord,
  deleteSheetRecord,
  detectRecordChanges,
  fetchServerConfig,
  fetchSheetRecords,
  isInsideGoogleAppsScript,
  saveServerConfig,
  updateSheetRecord,
} from './services/sheetsService';
import {
  addOverlayRecord,
  deleteOverlayRecord,
  fetchOverlayState,
  mergeSheetWithOverlay,
  resetOverlayState,
  updateOverlayRecord,
} from './services/overlayService';
import {
  NotificationCenter,
  playNotificationChime,
} from './components/NotificationCenter';
import { MapWorkspace } from './components/MapWorkspace';
import { AdminRequestForm } from './components/AdminRequestForm';
import { AnalyticsCharts } from './components/AnalyticsCharts';
import { RequestsTable } from './components/RequestsTable';
import { AdminBatchWorkspace } from './components/AdminBatchWorkspace';
import { AdminLoginModal, type AdminSessionPayload } from './components/AdminLoginModal';
import { SheetSettingsModal } from './components/SheetSettingsModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PWAInstallControl, OfflineIndicator } from './components/PWAInstallControl';
import {
  fetchCompletedBatches,
  getEligibleCompletedUnbatchedRecords,
} from './services/batchService';
import {
  DriveAuthError,
  HOUSE_PHOTO_FOLDER_ID,
  HousePhotoPayload,
  LEGACY_DRIVE_FOLDER_ID,
  buildDriveFolderUrl,
  uploadHousePhotoToDrive,
} from './services/driveService';

interface ToastBanner {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  focusCoords?: { lat: number; lng: number; uid: string } | null;
}

interface PendingConfirmState {
  mode: 'update' | 'delete';
  rowIndex: number;
  payload?: MeterFormPayload;
  photoFile?: HousePhotoPayload | null;
  record?: MeterRequest;
}

const DEFAULT_CONFIG: SheetConfig = {
  spreadsheetId: DEFAULT_SPREADSHEET_ID,
  sheetName: '',
  availableTabs: [],
  pollIntervalMs: 10000, // 10-second real-time sync
  appsScriptUrl: '',
  driveFolderId: HOUSE_PHOTO_FOLDER_ID,
};

function normalizeSheetConfig(raw: Partial<SheetConfig>): SheetConfig {
  const rawSheetId = (raw.spreadsheetId || '').trim();
  const isMigratedSheet = rawSheetId === LEGACY_SPREADSHEET_ID;
  const rawFolderId = (raw.driveFolderId || '').trim();
  const isMigratedFolder = !rawFolderId || rawFolderId === LEGACY_DRIVE_FOLDER_ID;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    spreadsheetId: !rawSheetId || isMigratedSheet ? DEFAULT_SPREADSHEET_ID : rawSheetId,
    sheetName: isMigratedSheet ? '' : raw.sheetName || '',
    sheetId: isMigratedSheet ? undefined : raw.sheetId,
    availableTabs: isMigratedSheet
      ? []
      : Array.isArray(raw.availableTabs)
        ? raw.availableTabs
        : [],
    driveFolderId: isMigratedFolder ? HOUSE_PHOTO_FOLDER_ID : rawFolderId,
  };
}

export default function App() {
  // Day / Night Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('water_meter_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const isDark = theme === 'dark';

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('water_meter_theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme, isDark]);

  // Auth & Role states
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [canManageSheetConfig, setCanManageSheetConfig] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [googleUserEmail, setGoogleUserEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState('');

  // Sheet Connection & Real-time Data states
  const [sheetConfig, setSheetConfig] = useState<SheetConfig>(() => {
    try {
      const saved = localStorage.getItem('water_meter_sheet_config_v1');
      if (saved) {
        return normalizeSheetConfig(JSON.parse(saved));
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_CONFIG;
  });
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [records, setRecords] = useState<MeterRequest[]>([]);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('disconnected');
  const [connectionError, setConnectionError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMoo, setFilterMoo] = useState('');
  const [filterSubdistrict, setFilterSubdistrict] = useState('');
  const [filterDistrict, setFilterDistrict] = useState('');
  const [filterProvince, setFilterProvince] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Map & Admin Form Interaction states
  const [editingRecord, setEditingRecord] = useState<MeterRequest | null>(null);
  const [pickedCoords, setPickedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [focusedRecord, setFocusedRecord] = useState<MeterRequest | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Notifications & Confirmations
  const [changeEvents, setChangeEvents] = useState<DataChangeEvent[]>([]);
  const [desktopNotifyEnabled, setDesktopNotifyEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [toast, setToast] = useState<ToastBanner | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);
  const [serviceAccountConfigured, setServiceAccountConfigured] = useState(false);
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null);
  const [pendingOverlayCount, setPendingOverlayCount] = useState(0);
  const [isFlushingPending, setIsFlushingPending] = useState(false);
  const [adminWorkspaceTab, setAdminWorkspaceTab] = useState<
    'table' | 'batch_builder' | 'batch_archive'
  >('table');
  const [completedBatches, setCompletedBatches] = useState<CompletedBatch[]>([]);
  const [serverMapsApiKey, setServerMapsApiKey] = useState<string>('');
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [formResetTrigger, setFormResetTrigger] = useState(0);

  const prevRecordsRef = useRef<MeterRequest[]>([]);
  const hasLoadedOnceRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (
      message: string,
      tone: ToastBanner['tone'] = 'info',
      focusCoords?: ToastBanner['focusCoords']
    ) => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      setToast({ id: Date.now(), message, tone, focusCoords });
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 4500);
    },
    []
  );

  // Handle Chrome PWA App Shortcuts (?view=map|admin|analytics|settings)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');
      if (!view) return;

      const timer = window.setTimeout(() => {
        if (view === 'map') {
          document.getElementById('map-section')?.scrollIntoView({ behavior: 'smooth' });
        } else if (view === 'analytics') {
          document.getElementById('analytics-section')?.scrollIntoView({ behavior: 'smooth' });
        } else if (view === 'admin') {
          if (!isAdmin) {
            setAuthModalOpen(true);
            showToast('กรุณาเข้าสู่ระบบ Admin เพื่อจัดการคำขอ', 'info');
          } else {
            document.getElementById('map-section')?.scrollIntoView({ behavior: 'smooth' });
          }
        } else if (view === 'settings') {
          if (isAdmin && canManageSheetConfig) {
            setSettingsModalOpen(true);
          } else if (isAdmin) {
            showToast('เฉพาะผู้ใช้ 15563 เท่านั้นที่สามารถเปิดหน้าตั้งค่าชีทได้', 'warning');
          } else {
            setAuthModalOpen(true);
            showToast('กรุณาเข้าสู่ระบบ Admin เพื่อเปิดหน้าตั้งค่าชีท', 'info');
          }
        }
      }, 280);

      return () => window.clearTimeout(timer);
    } catch {
      return undefined;
    }
  }, [isAdmin, canManageSheetConfig, showToast]);

  // Initialize Firebase Auth listener (with silent token refresh if already consented)
  useEffect(() => {
    const unsubscribe = initAuth(
      (email, token) => {
        setGoogleUserEmail(email);
        setAccessToken(token);
        setGoogleAuthError('');
      },
      async (email) => {
        setGoogleUserEmail(email);
        const existing = getAccessToken();
        if (existing) {
          setAccessToken(existing);
          return;
        }
        setAccessToken(null);
        if (email) {
          const silentToken = await trySilentAccessToken(email);
          if (silentToken) {
            setAccessToken(silentToken);
            setGoogleAuthError('');
          }
        }
      }
    );
    return () => unsubscribe();
  }, []);

  // Load shared server config (persisted Apps Script URL & Service Account status)
  useEffect(() => {
    let active = true;
    fetchServerConfig().then((cfg) => {
      if (!active || !cfg) return;
      if (cfg.serviceAccountConfigured) {
        setServiceAccountConfigured(true);
        setServiceAccountEmail(cfg.serviceAccountEmail || null);
      }
      if (cfg.googleMapsApiKey && cfg.googleMapsApiKey.trim()) {
        setServerMapsApiKey(cfg.googleMapsApiKey.trim());
      }
      setSheetConfig((prev) =>
        normalizeSheetConfig({
          ...prev,
          appsScriptUrl: prev.appsScriptUrl?.trim() || cfg.appsScriptUrl?.trim() || '',
          spreadsheetId: cfg.spreadsheetId?.trim() || prev.spreadsheetId,
          sheetName: cfg.sheetName !== undefined ? cfg.sheetName : prev.sheetName,
          driveFolderId: cfg.driveFolderId?.trim() || prev.driveFolderId || HOUSE_PHOTO_FOLDER_ID,
        })
      );
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  // Persist sheet configuration (non-secret metadata)
  useEffect(() => {
    try {
      localStorage.setItem('water_meter_sheet_config_v1', JSON.stringify(sheetConfig));
    } catch {
      // ignore
    }
  }, [sheetConfig]);

  // Core Real-time Sync Function
  const syncSheetData = useCallback(
    async (options?: { silent?: boolean; forceToken?: string | null }) => {
      const silent = options?.silent ?? false;
      const tokenToUse =
        options?.forceToken !== undefined ? options.forceToken : accessToken;

      if (!silent) {
        setIsSyncing(true);
      }

      try {
        const [result, overlay] = await Promise.all([
          fetchSheetRecords(sheetConfig, tokenToUse),
          fetchOverlayState(sheetConfig.spreadsheetId),
        ]);
        const overlayCount =
          Object.keys(overlay.updates || {}).length +
          (overlay.additions || []).length +
          (overlay.deletions || []).length;
        setPendingOverlayCount(overlayCount);

        const mergedRecords = mergeSheetWithOverlay(result.records, overlay);

        setSheetHeaders(result.headers);
        setConnectionMode(result.mode);
        setConnectionError('');
        setLastSyncedAt(result.fetchedAt);

        // Update discovered tab info if returned by Sheets API
        if (
          result.mode === 'oauth' &&
          (result.sheetName !== sheetConfig.sheetName ||
            result.availableTabs.length !== sheetConfig.availableTabs.length ||
            result.spreadsheetTitle !== sheetConfig.spreadsheetTitle)
        ) {
          setSheetConfig((prev) => ({
            ...prev,
            spreadsheetTitle: result.spreadsheetTitle ?? prev.spreadsheetTitle,
            sheetName: result.sheetName || prev.sheetName,
            sheetId: result.sheetId ?? prev.sheetId,
            availableTabs:
              result.availableTabs.length > 0
                ? result.availableTabs
                : prev.availableTabs,
          }));
        }

        // Detect Real-time Data Changes compared to previous snapshot
        if (hasLoadedOnceRef.current) {
          const detected = detectRecordChanges(
            prevRecordsRef.current,
            mergedRecords
          );
          if (detected.length > 0) {
            setChangeEvents((prev) => [...detected, ...prev].slice(0, 50));

            const latest = detected[0];
            showToast(
              detected.length === 1
                ? latest.summary
                : `ตรวจพบการเปลี่ยนแปลงข้อมูล ${detected.length} รายการ`,
              latest.type === 'deleted' ? 'warning' : 'success',
              latest.latitude !== null && latest.longitude !== null
                ? {
                    lat: latest.latitude,
                    lng: latest.longitude,
                    uid: latest.recordUid,
                  }
                : null
            );

            if (soundEnabled) {
              playNotificationChime();
            }

            if (
              desktopNotifyEnabled &&
              typeof Notification !== 'undefined' &&
              Notification.permission === 'granted'
            ) {
              new Notification('อัปเดตข้อมูลมาตรวัดน้ำ (Real-time)', {
                body:
                  detected.length === 1
                    ? latest.summary
                    : `มีการเปลี่ยนแปลงข้อมูล ${detected.length} รายการ`,
              });
            }
          }
        } else {
          hasLoadedOnceRef.current = true;
        }

        prevRecordsRef.current = mergedRecords;
        setRecords(mergedRecords);
      } catch (err: any) {
        if (err instanceof SheetsApiError && err.status === 401) {
          clearAccessToken();
          setAccessToken(null);
        }
        setConnectionMode('error');
        const msg = err?.message || 'ไม่สามารถเชื่อมต่อข้อมูล Google Sheets ได้';
        setConnectionError(msg);
        if (!silent) {
          showToast(msg, 'error');
        }
      } finally {
        setIsLoading(false);
        setIsSyncing(false);
      }
    },
    [
      accessToken,
      sheetConfig,
      soundEnabled,
      desktopNotifyEnabled,
      showToast,
    ]
  );

  // Initial fetch & re-fetch when config/token changes
  useEffect(() => {
    syncSheetData({ silent: true });
  }, [sheetConfig.spreadsheetId, sheetConfig.sheetName, accessToken]);

  // Continuous Real-time Polling + Instant Tab-Focus Sync
  useEffect(() => {
    if (!sheetConfig.pollIntervalMs || sheetConfig.pollIntervalMs <= 0) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncSheetData({ silent: true });
      }
    }, sheetConfig.pollIntervalMs);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncSheetData({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [sheetConfig.pollIntervalMs, syncSheetData]);

  const handleGoogleSignIn = async (forceConsent = false) => {
    setIsGoogleSigningIn(true);
    setGoogleAuthError('');
    try {
      const { email, accessToken: newToken } = await googleSignIn(forceConsent);
      setGoogleUserEmail(email);
      setAccessToken(newToken);
      setGoogleAuthError('');
      showToast('เชื่อมต่อบัญชี Google (Sheets & Drive) สำเร็จ', 'success');
      if (pendingOverlayCount > 0) {
        await flushPendingOverlayToSheet(sheetConfig, newToken);
      } else {
        await syncSheetData({ silent: false, forceToken: newToken });
      }
    } catch (err: any) {
      const msg = err?.message || 'การเข้าสู่ระบบด้วย Google ถูกยกเลิก';
      setGoogleAuthError(msg);
      showToast(msg, 'warning');
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await logoutGoogle();
    setAccessToken(null);
    setGoogleUserEmail(null);
    setGoogleAuthError('');
    showToast('ตัดการเชื่อมต่อบัญชี Google แล้ว', 'info');
  };

  const handleToggleDesktopNotify = async () => {
    if (desktopNotifyEnabled) {
      setDesktopNotifyEnabled(false);
      return;
    }
    if (typeof Notification === 'undefined') {
      showToast('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนเดสก์ท็อป', 'warning');
      return;
    }
    if (Notification.permission === 'granted') {
      setDesktopNotifyEnabled(true);
      showToast('เปิดแจ้งเตือนบนเดสก์ท็อปแล้ว', 'success');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      setDesktopNotifyEnabled(true);
      showToast('เปิดแจ้งเตือนบนเดสก์ท็อปแล้ว', 'success');
    } else {
      showToast('ไม่ได้รับอนุญาตแจ้งเตือนจากเบราว์เซอร์', 'warning');
    }
  };

  const extractAreaParts = useCallback((rec: MeterRequest) => {
    const rawProvince = (rec.province || '').trim() || (rec.locationSummary?.match(/จ\.([^\s(]+)/)?.[1] ? `จ.${rec.locationSummary.match(/จ\.([^\s(]+)/)![1]}` : '');
    const rawDistrict = (rec.district || '').trim() || (rec.locationSummary?.match(/อ\.([^\s]+)/)?.[1] ? `อ.${rec.locationSummary.match(/อ\.([^\s]+)/)![1]}` : '');
    const rawSubdistrict = (rec.subdistrict || '').trim() || (rec.locationSummary?.match(/ต\.([^\s]+)/)?.[1] ? `ต.${rec.locationSummary.match(/ต\.([^\s]+)/)![1]}` : '');
    const rawMoo = (rec.moo || '').trim();

    const province = rawProvince ? (rawProvince.startsWith('จ.') ? rawProvince : `จ.${rawProvince}`) : '';
    const district = rawDistrict ? (rawDistrict.startsWith('อ.') ? rawDistrict : `อ.${rawDistrict}`) : '';
    const subdistrict = rawSubdistrict ? (rawSubdistrict.startsWith('ต.') ? rawSubdistrict : `ต.${rawSubdistrict}`) : '';
    const moo = rawMoo.replace(/^(?:หมู่ที่|หมู่|ม\.)\s*/i, '').trim();

    return { moo, subdistrict, district, province };
  }, []);

  const extractIsoDate = useCallback((rawDate: string): string => {
    const s = (rawDate || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) {
      const day = dmy[1].padStart(2, '0');
      const month = dmy[2].padStart(2, '0');
      let year = Number.parseInt(dmy[3], 10);
      if (year > 2400) year -= 543;
      return `${year}-${month}-${day}`;
    }
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return '';
  }, []);

  // Filtered records
  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records.filter((rec) => {
      const matchStatus = !filterStatus || rec.status === filterStatus;

      const area = extractAreaParts(rec);
      const matchProvince = !filterProvince || area.province === filterProvince;
      const matchDistrict = !filterDistrict || area.district === filterDistrict;
      const matchSubdistrict = !filterSubdistrict || area.subdistrict === filterSubdistrict;
      const matchMoo = !filterMoo || area.moo === filterMoo;

      let matchDate = true;
      if (filterDateFrom || filterDateTo) {
        const recIso = extractIsoDate(rec.requestDate);
        if (!recIso) {
          matchDate = false;
        } else {
          if (filterDateFrom && recIso < filterDateFrom) matchDate = false;
          if (filterDateTo && recIso > filterDateTo) matchDate = false;
        }
      }

      let matchQuery = true;
      if (q) {
        matchQuery =
          rec.fullName.toLowerCase().includes(q) ||
          rec.rqNumber.toLowerCase().includes(q) ||
          rec.phone.toLowerCase().includes(q) ||
          rec.locationSummary.toLowerCase().includes(q) ||
          rec.moo.toLowerCase().includes(q);
      }

      return (
        matchStatus &&
        matchProvince &&
        matchDistrict &&
        matchSubdistrict &&
        matchMoo &&
        matchDate &&
        matchQuery
      );
    });
  }, [
    records,
    filterStatus,
    filterProvince,
    filterDistrict,
    filterSubdistrict,
    filterMoo,
    filterDateFrom,
    filterDateTo,
    searchQuery,
    extractAreaParts,
    extractIsoDate,
  ]);

  // Dynamic filter dropdown options derived from real Sheet data
  const statusOptions = useMemo(() => {
    const base = [
      'รับคำร้องแล้ว(รอสำรวจ)',
      'รอชำระเงิน',
      'อยู่ระหว่างติดตั้ง',
      'ติดตั้งเสร็จสิ้น',
      'ไม่มีเส้นท่อ/ยกเลิก',
    ];
    const extras = new Set<string>(base);
    records.forEach((r) => {
      if (r.status) extras.add(r.status);
    });
    return Array.from(extras);
  }, [records]);

  const { provinceOptions, districtOptions, subdistrictOptions, mooOptions } = useMemo(() => {
    const provinces = new Set<string>();
    const districts = new Set<string>();
    const subdistricts = new Set<string>();
    const moos = new Set<string>();

    records.forEach((r) => {
      const area = extractAreaParts(r);
      if (area.province) provinces.add(area.province);
      if (area.district && (!filterProvince || area.province === filterProvince)) {
        districts.add(area.district);
      }
      if (
        area.subdistrict &&
        (!filterProvince || area.province === filterProvince) &&
        (!filterDistrict || area.district === filterDistrict)
      ) {
        subdistricts.add(area.subdistrict);
      }
      if (
        area.moo &&
        (!filterProvince || area.province === filterProvince) &&
        (!filterDistrict || area.district === filterDistrict) &&
        (!filterSubdistrict || area.subdistrict === filterSubdistrict)
      ) {
        moos.add(area.moo);
      }
    });

    return {
      provinceOptions: Array.from(provinces).sort((a, b) => a.localeCompare(b, 'th')),
      districtOptions: Array.from(districts).sort((a, b) => a.localeCompare(b, 'th')),
      subdistrictOptions: Array.from(subdistricts).sort((a, b) => a.localeCompare(b, 'th')),
      mooOptions: Array.from(moos).sort((a, b) => {
        const na = Number.parseInt(a, 10);
        const nb = Number.parseInt(b, 10);
        if (!Number.isNaN(na) && !Number.isNaN(nb) && String(na) === a && String(nb) === b) {
          return na - nb;
        }
        return a.localeCompare(b, 'th');
      }),
    };
  }, [records, filterProvince, filterDistrict, filterSubdistrict, extractAreaParts]);

  const completedEligibleUnbatchedCount = useMemo(
    () => getEligibleCompletedUnbatchedRecords(records, completedBatches).eligible.length,
    [records, completedBatches]
  );

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetchCompletedBatches(sheetConfig.spreadsheetId, {
      accessToken,
      driveFolderId: sheetConfig.driveFolderId,
    }).then((list) => {
      if (active) setCompletedBatches(list);
    });
    return () => {
      active = false;
    };
  }, [isAdmin, sheetConfig.spreadsheetId, accessToken, sheetConfig.driveFolderId]);

  // Geolocation helper
  const handleLocateUser = useCallback(() => {
    if (!navigator.geolocation) {
      showToast('อุปกรณ์นี้ไม่รองรับ GPS', 'warning');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(coords);
        showToast('พบตำแหน่ง GPS ปัจจุบันของคุณแล้ว', 'success');
      },
      () => {
        showToast('ไม่สามารถเข้าถึงตำแหน่ง GPS ได้ กรุณาอนุญาตสิทธิ์ตำแหน่ง', 'warning');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [showToast]);

  const handleCaptureGpsForForm = useCallback(() => {
    if (!navigator.geolocation) {
      showToast('อุปกรณ์นี้ไม่รองรับ GPS', 'warning');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(coords);
        setPickedCoords(coords);
        showToast('ดึงพิกัด GPS ปัจจุบันใส่แบบฟอร์มเรียบร้อย', 'success');
      },
      () => {
        showToast('ไม่สามารถอ่านตำแหน่ง GPS ได้', 'warning');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [showToast]);

  const flushPendingOverlayToSheet = useCallback(
    async (overrideConfig?: SheetConfig, overrideToken?: string | null) => {
      const activeConfig = overrideConfig || sheetConfig;
      const activeToken = overrideToken !== undefined ? overrideToken : accessToken;
      const canWriteToSheet = Boolean(
        activeConfig.appsScriptUrl?.trim() || serviceAccountConfigured || activeToken
      );
      if (!canWriteToSheet) {
        showToast(
          'กรุณาเชื่อมต่อ Apps Script URL หรือบัญชี Google ก่อนส่งข้อมูลเข้าชีท',
          'warning'
        );
        return;
      }

      setIsFlushingPending(true);
      try {
        const [sheetRes, overlay] = await Promise.all([
          fetchSheetRecords(activeConfig, activeToken),
          fetchOverlayState(activeConfig.spreadsheetId),
        ]);

        const updates = Object.values(overlay.updates || {});
        const additions = overlay.additions || [];
        const deletions = overlay.deletions || [];

        if (updates.length === 0 && additions.length === 0 && deletions.length === 0) {
          setPendingOverlayCount(0);
          return;
        }

        // 1. Apply updates to matching sheet rows
        for (const upd of updates) {
          const matched = sheetRes.records.find((r) => r.uid === upd.uid);
          if (!matched) continue;
          await updateSheetRecord(
            activeConfig,
            activeToken,
            matched.rowIndex,
            sheetRes.headers,
            {
              rqNumber: upd.rqNumber,
              requestDate: upd.requestDate,
              fullName: upd.fullName,
              houseNo: upd.houseNo,
              moo: upd.moo,
              subdistrict: upd.subdistrict,
              district: upd.district,
              province: upd.province,
              phone: upd.phone,
              price: upd.price,
              status: upd.status,
              latitude: upd.latitude,
              longitude: upd.longitude,
              note: upd.note,
              housePhotoUrl: upd.housePhotoUrl || '',
            },
            matched.raw,
            serviceAccountConfigured
          );
        }

        // 2. Append new records
        for (const add of additions) {
          await appendSheetRecord(
            activeConfig,
            activeToken,
            sheetRes.headers,
            {
              rqNumber: add.rqNumber,
              requestDate: add.requestDate,
              fullName: add.fullName,
              houseNo: add.houseNo,
              moo: add.moo,
              subdistrict: add.subdistrict,
              district: add.district,
              province: add.province,
              phone: add.phone,
              price: add.price,
              status: add.status,
              latitude: add.latitude,
              longitude: add.longitude,
              note: add.note,
              housePhotoUrl: add.housePhotoUrl || '',
            },
            serviceAccountConfigured
          );
        }

        // 3. Delete rows in descending rowIndex order
        const rowsToDelete = deletions
          .map((uid) => sheetRes.records.find((r) => r.uid === uid)?.rowIndex)
          .filter((idx): idx is number => typeof idx === 'number' && idx >= 2)
          .sort((a, b) => b - a);

        for (const rowIdx of rowsToDelete) {
          await deleteSheetRecord(
            activeConfig,
            activeToken,
            rowIdx,
            serviceAccountConfigured
          );
        }

        await resetOverlayState(activeConfig.spreadsheetId);
        setPendingOverlayCount(0);
        showToast('ส่งข้อมูลที่แก้ไขค้างไว้เข้า Google Sheet จริงครบเรียบร้อยแล้ว', 'success');
        await syncSheetData({ silent: true, forceToken: activeToken });
      } catch (err: any) {
        showToast(
          `ส่งเข้า Google Sheet ไม่สำเร็จ: ${err?.message || 'ตรวจสอบการตั้งค่า Apps Script'}`,
          'error'
        );
      } finally {
        setIsFlushingPending(false);
      }
    },
    [sheetConfig, serviceAccountConfigured, accessToken, showToast, syncSheetData]
  );

  const resolvePayloadWithUploadedPhoto = async (
    payload: MeterFormPayload,
    photoFile?: HousePhotoPayload | null
  ): Promise<MeterFormPayload> => {
    if (!photoFile) return payload;
    showToast('กำลังอัปโหลดรูปหน้าบ้านเข้า Google Drive...', 'info');
    try {
      const uploaded = await uploadHousePhotoToDrive({
        photo: photoFile,
        rqNumber: payload.rqNumber,
        fullName: payload.fullName,
        accessToken,
        appsScriptUrl: sheetConfig.appsScriptUrl,
        folderId: sheetConfig.driveFolderId,
      });
      return {
        ...payload,
        housePhotoUrl: uploaded.webViewLink,
      };
    } catch (err: any) {
      if (err instanceof DriveAuthError) {
        if (err.code === 'unauthorized') {
          clearAccessToken();
          setAccessToken(null);
        }
        if (
          err.code === 'unauthorized' ||
          err.code === 'insufficient_scope' ||
          err.code === 'missing_auth'
        ) {
          setGoogleAuthError(err.message);
        }
      }
      throw err;
    }
  };

  // Admin Form Submit (Never forces Google Login popup automatically)
  const handleFormSubmit = async (
    payload: MeterFormPayload,
    editingRowIndex: number | null,
    photoFile: HousePhotoPayload | null
  ) => {
    if (editingRowIndex !== null) {
      // Mandatory user confirmation dialog before mutating existing data
      setPendingConfirm({
        mode: 'update',
        rowIndex: editingRowIndex,
        payload,
        photoFile,
        record: editingRecord || undefined,
      });
      return;
    }

    // Insert new record (Upload house photo to Drive first if provided)
    setIsMutating(true);
    try {
      const finalPayload = await resolvePayloadWithUploadedPhoto(payload, photoFile);
      const hasAppsScript = Boolean(
        sheetConfig.appsScriptUrl?.trim() || isInsideGoogleAppsScript()
      );
      if (hasAppsScript || serviceAccountConfigured) {
        await appendSheetRecord(
          sheetConfig,
          null,
          sheetHeaders,
          finalPayload,
          !hasAppsScript && serviceAccountConfigured
        );
        showToast(
          photoFile
            ? 'เพิ่มคำขอใหม่และบันทึกรูปหน้าบ้านเข้า Google Drive เรียบร้อยแล้ว'
            : 'เพิ่มคำขอใหม่เข้า Google Sheet จริงเรียบร้อยแล้ว',
          'success'
        );
      } else if (accessToken) {
        try {
          await appendSheetRecord(sheetConfig, accessToken, sheetHeaders, finalPayload);
          showToast(
            photoFile
              ? 'เพิ่มคำขอใหม่และบันทึกรูปหน้าบ้านเข้า Google Drive เรียบร้อยแล้ว'
              : 'เพิ่มคำขอใหม่เข้า Google Sheet จริงเรียบร้อยแล้ว',
            'success'
          );
        } catch (err: any) {
          if (err instanceof SheetsApiError && err.status === 401) {
            clearAccessToken();
            setAccessToken(null);
            await addOverlayRecord(sheetConfig.spreadsheetId, finalPayload);
            showToast(
              'บันทึกบนหน้าเว็บแล้ว (สิทธิ์ Google หมดอายุ — ยังไม่เข้าไฟล์ Google Sheet)',
              'warning'
            );
          } else {
            throw err;
          }
        }
      } else {
        await addOverlayRecord(sheetConfig.spreadsheetId, finalPayload);
        showToast(
          photoFile
            ? 'อัปโหลดรูปเข้า Drive และบันทึกคำขอลงระบบเว็บแล้ว (กด "ตั้งค่าชีท" เพื่อซิงค์เข้า Google Sheet)'
            : 'บันทึกบนหน้าเว็บแล้ว (ยังไม่เข้าไฟล์ Google Sheet — กด "ตั้งค่าชีท" เพื่อเชื่อม Apps Script)',
          'warning'
        );
      }

      setEditingRecord(null);
      setPickedCoords(null);
      setFormResetTrigger((n) => n + 1);
      await syncSheetData({ silent: true });
    } catch (err: any) {
      showToast(`บันทึกข้อมูลไม่สำเร็จ: ${err?.message || 'เกิดข้อผิดพลาด'}`, 'error');
    } finally {
      setIsMutating(false);
    }
  };

  // Confirm Update or Delete automatically without Google Login popup
  const executeConfirmedMutation = async () => {
    if (!pendingConfirm) return;
    setIsMutating(true);

    try {
      const hasAppsScript = Boolean(
        sheetConfig.appsScriptUrl?.trim() || isInsideGoogleAppsScript()
      );
      const targetRecord = pendingConfirm.record;
      const targetUid = targetRecord?.uid || `row:${pendingConfirm.rowIndex}`;
      const isLocalOnlyRecord = Boolean(
        pendingConfirm.rowIndex <= 0 || targetUid.startsWith('local:')
      );

      if (pendingConfirm.mode === 'update' && pendingConfirm.payload) {
        const finalPayload = await resolvePayloadWithUploadedPhoto(
          pendingConfirm.payload,
          pendingConfirm.photoFile
        );
        if ((hasAppsScript || serviceAccountConfigured) && !isLocalOnlyRecord) {
          await updateSheetRecord(
            sheetConfig,
            null,
            pendingConfirm.rowIndex,
            sheetHeaders,
            finalPayload,
            targetRecord?.raw,
            !hasAppsScript && serviceAccountConfigured
          );
          showToast(
            pendingConfirm.photoFile
              ? 'อัปเดตข้อมูลและบันทึกรูปหน้าบ้านเข้า Google Drive เรียบร้อยแล้ว'
              : 'อัปเดตข้อมูลเข้า Google Sheet จริงเรียบร้อยแล้ว',
            'success'
          );
        } else if (accessToken && !isLocalOnlyRecord) {
          try {
            await updateSheetRecord(
              sheetConfig,
              accessToken,
              pendingConfirm.rowIndex,
              sheetHeaders,
              finalPayload,
              targetRecord?.raw
            );
            showToast(
              pendingConfirm.photoFile
                ? 'อัปเดตข้อมูลและบันทึกรูปหน้าบ้านเข้า Google Drive เรียบร้อยแล้ว'
                : 'อัปเดตข้อมูลเข้า Google Sheet จริงเรียบร้อยแล้ว',
              'success'
            );
          } catch (err: any) {
            if (err instanceof SheetsApiError && err.status === 401) {
              clearAccessToken();
              setAccessToken(null);
              await updateOverlayRecord(
                sheetConfig.spreadsheetId,
                targetUid,
                finalPayload
              );
              showToast(
                'แก้ไขบนหน้าเว็บแล้ว (สิทธิ์ Google หมดอายุ — ยังไม่เข้าไฟล์ Google Sheet)',
                'warning'
              );
            } else {
              throw err;
            }
          }
        } else {
          await updateOverlayRecord(
            sheetConfig.spreadsheetId,
            targetUid,
            finalPayload
          );
          showToast(
            isLocalOnlyRecord
              ? 'แก้ไขรายการบนหน้าเว็บเรียบร้อยแล้ว'
              : 'แก้ไขบนหน้าเว็บแล้ว (ยังไม่เข้าไฟล์ Google Sheet — กด "ตั้งค่าชีท" เพื่อเชื่อม Apps Script)',
            'warning'
          );
        }

        setEditingRecord(null);
        setPickedCoords(null);
        setFormResetTrigger((n) => n + 1);
      } else if (pendingConfirm.mode === 'delete') {
        if ((hasAppsScript || serviceAccountConfigured) && !isLocalOnlyRecord) {
          await deleteSheetRecord(
            sheetConfig,
            null,
            pendingConfirm.rowIndex,
            !hasAppsScript && serviceAccountConfigured
          );
          showToast('ลบรายการออกจาก Google Sheet จริงเรียบร้อยแล้ว', 'success');
        } else if (accessToken && !isLocalOnlyRecord) {
          try {
            await deleteSheetRecord(sheetConfig, accessToken, pendingConfirm.rowIndex);
            showToast('ลบรายการออกจาก Google Sheet จริงเรียบร้อยแล้ว', 'success');
          } catch (err: any) {
            if (err instanceof SheetsApiError && err.status === 401) {
              clearAccessToken();
              setAccessToken(null);
              await deleteOverlayRecord(sheetConfig.spreadsheetId, targetUid);
              showToast('ลบรายการบนหน้าเว็บแล้ว (ยังไม่เข้าไฟล์ Google Sheet)', 'warning');
            } else {
              throw err;
            }
          }
        } else {
          await deleteOverlayRecord(sheetConfig.spreadsheetId, targetUid);
          showToast(
            isLocalOnlyRecord
              ? 'ลบรายการเรียบร้อยแล้ว'
              : 'ลบรายการบนหน้าเว็บแล้ว (ยังไม่ลบในไฟล์ Google Sheet)',
            'warning'
          );
        }

        if (editingRecord?.uid === targetUid) {
          setEditingRecord(null);
          setPickedCoords(null);
        }
      }

      setPendingConfirm(null);
      await syncSheetData({ silent: true });
    } catch (err: any) {
      showToast(`ดำเนินการไม่สำเร็จ: ${err?.message || 'เกิดข้อผิดพลาด'}`, 'error');
    } finally {
      setIsMutating(false);
    }
  };

  const handleEditRecord = useCallback((rec: MeterRequest) => {
    setEditingRecord(rec);
    if (rec.latitude !== null && rec.longitude !== null) {
      setPickedCoords({ lat: rec.latitude, lng: rec.longitude });
      setFocusedRecord(rec);
    } else {
      setPickedCoords(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleDeleteRecord = useCallback((rec: MeterRequest) => {
    setPendingConfirm({
      mode: 'delete',
      rowIndex: rec.rowIndex,
      record: rec,
    });
  }, []);

  const handleSelectNotificationEvent = useCallback(
    (ev: DataChangeEvent) => {
      setChangeEvents((prev) =>
        prev.map((item) => (item.id === ev.id ? { ...item, read: true } : item))
      );
      const target = records.find((r) => r.uid === ev.recordUid);
      if (target) {
        setFocusedRecord(target);
      }
    },
    [records]
  );

  const lastSyncedLabel = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'กำลังเชื่อมต่อ...';

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-[#EEF4FB] dark:bg-[#08111E] text-slate-900 dark:text-slate-100 transition-colors duration-200">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-[1100] shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}
      {/* Top Navigation Bar (Strict 3-Zone Contract, Royal Navy Gradient) */}
      <header className="sticky top-0 z-[1000] bg-gradient-to-r from-[#0A3A82] via-[#0F5EBC] to-[#117CC8] dark:from-[#071A38] dark:via-[#0B2A57] dark:to-[#0F3B73] border-b border-[#08306E]/30 dark:border-[#1D3A60] shadow-xs transition-colors">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4 lg:gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#map-section"
            className="flex items-center gap-2 sm:gap-2.5 min-w-0 text-xs sm:text-base lg:text-lg font-bold tracking-tight text-white"
          >
            <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-white text-[#0A3A82] dark:bg-[#133B70] dark:text-[#7CC4FF] dark:border dark:border-[#255799] shadow-xs flex items-center justify-center shrink-0">
              <Droplets className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
            <span className="truncate">ระบบติดตามคำขอติดตั้ง / ย้ายมาตรวัดน้ำ</span>
          </a>

          {/* Zone 2: Clean Single-line Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-white/85">
            <a
              href="#map-section"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              แผนที่พิกัด
            </a>
            <a
              href="#analytics-section"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              สถิติภาพรวม
            </a>
            {isAdmin && (
              <a
                href="#table-section"
                className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
              >
                รายการคำขอ
              </a>
            )}
          </nav>

          {/* Zone 3: Chrome PWA Install + Day/Night Mode Switch + Admin Access */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <PWAInstallControl />

            <div
              role="group"
              aria-label="โหมดแสดงผลกลางวันและกลางคืน"
              className="inline-flex items-center bg-white/15 dark:bg-[#081529]/70 p-0.5 rounded-lg border border-white/25 dark:border-[#244A7A]"
            >
              <button
                type="button"
                onClick={() => setTheme('light')}
                aria-pressed={!isDark}
                title="โหมดกลางวัน"
                className={`px-1.5 sm:px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                  !isDark
                    ? 'bg-white text-[#0A3A82] shadow-xs'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">กลางวัน</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                aria-pressed={isDark}
                title="โหมดกลางคืน"
                className={`px-1.5 sm:px-2.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                  isDark
                    ? 'bg-[#2B7CD3] text-white shadow-xs'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">กลางคืน</span>
              </button>
            </div>

            {isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  setIsAdmin(false);
                  setAdminToken(null);
                  setCanManageSheetConfig(false);
                  setSettingsModalOpen(false);
                  setEditingRecord(null);
                  setPickedCoords(null);
                  showToast('ออกจากโหมดผู้ดูแลระบบแล้ว', 'info');
                }}
                title="ออกจากระบบ Admin"
                className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="sm:hidden">ออก</span>
                <span className="hidden sm:inline">ออกจากระบบ Admin</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                title="เข้าสู่ระบบ Admin"
                className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 bg-white hover:bg-blue-50 text-[#0A3A82] dark:bg-[#2B7CD3] dark:hover:bg-[#3689E2] dark:text-white text-xs font-semibold rounded-lg shadow-xs transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="sm:hidden">Admin</span>
                <span className="hidden sm:inline">เข้าสู่ระบบ Admin</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Real-time AppSheet / Google Sheets Toolbar (Admin Only) */}
      {isAdmin && (
        <div className="bg-white/95 dark:bg-[#0D192B] border-b border-[#DCE6F3] dark:border-[#1B314E] transition-colors">
          <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600 dark:text-slate-300 min-w-0">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100">
                <span
                  className={`w-2 h-2 rounded-full ${
                    connectionMode === 'error'
                      ? 'bg-rose-500'
                      : connectionMode === 'oauth' ||
                        connectionMode === 'apps_script' ||
                        connectionMode === 'public_csv'
                      ? 'bg-emerald-500'
                      : 'bg-amber-400'
                  }`}
                />
                <span>
                  {connectionMode === 'oauth'
                    ? 'เชื่อมต่อ Google Sheets API (Real-time)'
                    : connectionMode === 'apps_script'
                    ? 'เชื่อมต่อ Google Apps Script อัตโนมัติ (Real-time)'
                    : connectionMode === 'public_csv'
                    ? sheetConfig.appsScriptUrl?.trim()
                      ? 'เชื่อมต่อ Google Sheets + Apps Script อัตโนมัติ (Real-time)'
                      : 'เชื่อมต่อ Google Sheets อัตโนมัติ (Real-time)'
                    : connectionMode === 'error'
                    ? 'การเชื่อมต่อขัดข้อง'
                    : 'กำลังเชื่อมต่อ Google Sheets อัตโนมัติ...'}
                </span>
              </span>

              {canManageSheetConfig && (
                <>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                    ·
                  </span>

                  <a
                    href={`https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#0B4DA2] dark:text-[#66B2FF] hover:underline font-medium"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>
                      {sheetConfig.spreadsheetTitle || 'ชีท AppSheet'}
                      {sheetConfig.sheetName ? ` / ${sheetConfig.sheetName}` : ''}
                    </span>
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                    ·
                  </span>

                  <a
                    href={buildDriveFolderUrl(sheetConfig.driveFolderId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#0B4DA2] dark:text-[#66B2FF] hover:underline font-medium"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>โฟลเดอร์ Drive</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}

              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                ·
              </span>

              <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                อัปเดตล่าสุด {lastSyncedLabel}
                {sheetConfig.pollIntervalMs > 0
                  ? ` (ซิงค์อัตโนมัติทุก ${sheetConfig.pollIntervalMs / 1000} วิ)`
                  : ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => syncSheetData({ silent: false })}
                disabled={isSyncing}
                className="px-3 py-2 bg-[#0B4DA2] hover:bg-[#083A7E] dark:bg-[#2B7CD3] dark:hover:bg-[#2266B5] disabled:opacity-60 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>ซิงค์ทันที</span>
              </button>

              <NotificationCenter
                events={changeEvents}
                desktopNotifyEnabled={desktopNotifyEnabled}
                soundEnabled={soundEnabled}
                onToggleDesktopNotify={handleToggleDesktopNotify}
                onToggleSound={() => setSoundEnabled((prev) => !prev)}
                onMarkAllRead={() =>
                  setChangeEvents((prev) => prev.map((e) => ({ ...e, read: true })))
                }
                onClearAll={() => setChangeEvents([])}
                onSelectEvent={handleSelectNotificationEvent}
              />

              {canManageSheetConfig && (
                <button
                  type="button"
                  onClick={() => setSettingsModalOpen(true)}
                  className="px-3 py-2 bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] hover:bg-[#E7F0FC] dark:hover:bg-[#15253D] text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <Settings className="w-3.5 h-3.5 text-[#0B4DA2] dark:text-[#66B2FF]" />
                  <span>ตั้งค่าชีท</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5 min-w-0">
        {/* Portal Title Banner (Inspired by Royal-to-Ocean Blue Portal Header Card) */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0A3D8A] via-[#0E64C2] to-[#1798C8] dark:from-[#0B2246] dark:via-[#0F3264] dark:to-[#134B7F] text-white px-4 sm:px-6 py-4 sm:py-5 shadow-sm border border-[#0B4DA2]/20 dark:border-[#1E477A]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-12 w-56 h-56 rounded-full bg-white/10 dark:bg-[#5EA6E0]/10 blur-2xl"
          />
          <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <span className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white dark:bg-[#133A6B] text-[#0A3D8A] dark:text-[#7CC4FF] dark:border dark:border-[#265CA0] shadow-xs flex items-center justify-center shrink-0">
                <Droplets className="w-5 h-5 sm:w-6 sm:h-6" />
              </span>
              <div className="min-w-0">
                <h1 className="text-base sm:text-xl font-bold tracking-tight text-white leading-snug">
                  ระบบติดตามคำขอติดตั้ง / ย้ายมาตรวัดน้ำ
                </h1>
                <p className="text-xs sm:text-[13px] text-sky-100/90 dark:text-slate-300 mt-0.5 leading-snug">
                  ระบบวิเคราะห์ ติดตามพิกัดแผนที่ และเชื่อมโยงข้อมูล Google Sheets / AppSheet แบบเรียลไทม์
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0 text-xs">
              <span className="text-sky-100/90 dark:text-slate-300 tabular-nums hidden md:inline">
                ข้อมูลในตัวกรอง {filteredRecords.length.toLocaleString('th-TH')} / {records.length.toLocaleString('th-TH')} รายการ
              </span>
              {!isAdmin && (
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 dark:bg-[#163F73] dark:hover:bg-[#1E5292] border border-white/25 dark:border-[#2B64AA] text-white font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>จัดการคำขอ (Admin)</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Compact Quick Jump Strip for Mobile / Small Tablet */}
        <nav
          aria-label="เมนูลัดบนมือถือ"
          className="flex md:hidden items-center gap-1.5 overflow-x-auto pb-0.5"
        >
          <a
            href="#map-section"
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-[#0B4DA2] whitespace-nowrap shrink-0"
          >
            แผนที่พิกัด
          </a>
          <a
            href="#analytics-section"
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-[#0B4DA2] whitespace-nowrap shrink-0"
          >
            สถิติภาพรวม
          </a>
          {isAdmin && (
            <a
              href="#table-section"
              className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-[#0B4DA2] whitespace-nowrap shrink-0"
            >
              รายการคำขอ
            </a>
          )}
        </nav>

        {/* Connection Error Alert if Google Sheet cannot be reached */}
        {connectionMode === 'error' && connectionError && (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-900 dark:text-rose-200 space-y-1">
                <p className="font-semibold">ไม่สามารถดึงข้อมูลจาก Google Sheets ได้</p>
                <p className="text-rose-700 dark:text-rose-300">{connectionError}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => syncSheetData({ silent: false })}
                className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold"
              >
                ลองเชื่อมต่อใหม่
              </button>
              {isAdmin && canManageSheetConfig && (
                <button
                  type="button"
                  onClick={() => setSettingsModalOpen(true)}
                  className="px-3 py-2 bg-white dark:bg-[#0F1B2E] border border-rose-200 dark:border-rose-700/60 hover:bg-rose-100 dark:hover:bg-rose-950/60 text-rose-800 dark:text-rose-200 rounded-lg text-xs font-medium"
                >
                  ตั้งค่าชีท
                </button>
              )}
            </div>
          </div>
        )}

        {/* Analytics Charts (Moved to Top KPI Position) */}
        <AnalyticsCharts
          records={filteredRecords}
          activeStatusFilter={filterStatus}
          onFilterByStatus={setFilterStatus}
          isDark={isDark}
        />

        {/* Filter Controls (Deep Navy Header Bar + Clean Inputs) */}
        <section className="bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl overflow-hidden shadow-xs transition-colors">
          <div className="bg-gradient-to-r from-[#0A3A82] to-[#0F62BD] dark:from-[#0C254B] dark:to-[#133B70] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-white">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-sky-200 dark:text-[#7CC4FF] shrink-0" />
              <h2 className="text-xs sm:text-sm font-semibold">
                ตัวกรองข้อมูลสำหรับการติดตามพิกัดและสถิติ
              </h2>
            </div>

            <button
              type="button"
              onClick={() => {
                setFilterStatus('');
                setFilterMoo('');
                setFilterSubdistrict('');
                setFilterDistrict('');
                setFilterProvince('');
                setFilterDateFrom('');
                setFilterDateTo('');
                setSearchQuery('');
              }}
              className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 dark:bg-[#163B6B] dark:hover:bg-[#1D4E8C] border border-white/20 dark:border-[#285C9E] text-white text-[11px] sm:text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>ล้างตัวกรองทั้งหมด</span>
            </button>
          </div>

          <div className="p-3.5 sm:p-4 space-y-3">
            {/* Row 1: Status + Date Range (วัน/เดือน/ปี ระหว่างช่วง) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-4">
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  สถานะคำขอ
                </label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#132238] focus:border-[#0B4DA2] dark:focus:border-[#3B8CE2] transition-colors"
                >
                  <option value="">ทั้งหมด</option>
                  {statusOptions.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-8">
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  ช่วง วัน / เดือน / ปี (วันที่ยื่นคำร้อง)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-xl px-3 py-1.5 focus-within:bg-white dark:focus-within:bg-[#132238] focus-within:border-[#0B4DA2] dark:focus-within:border-[#3B8CE2] transition-colors">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                      ตั้งแต่
                    </span>
                    <input
                      type="date"
                      value={filterDateFrom}
                      max={filterDateTo || undefined}
                      onChange={(e) => setFilterDateFrom(e.target.value)}
                      aria-label="ตั้งแต่วันที่"
                      className="w-full bg-transparent text-xs text-slate-900 dark:text-slate-100 outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-xl px-3 py-1.5 focus-within:bg-white dark:focus-within:bg-[#132238] focus-within:border-[#0B4DA2] dark:focus-within:border-[#3B8CE2] transition-colors">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                      ถึงวันที่
                    </span>
                    <input
                      type="date"
                      value={filterDateTo}
                      min={filterDateFrom || undefined}
                      onChange={(e) => setFilterDateTo(e.target.value)}
                      aria-label="ถึงวันที่"
                      className="w-full bg-transparent text-xs text-slate-900 dark:text-slate-100 outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2: Sub-area filters (หมู่ / ตำบล / อำเภอ / จังหวัด) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1 border-t border-slate-100 dark:border-[#172A44]">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  หมู่
                </label>
                <select
                  value={filterMoo}
                  onChange={(e) => setFilterMoo(e.target.value)}
                  className="w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#132238] focus:border-[#0B4DA2] dark:focus:border-[#3B8CE2] transition-colors"
                >
                  <option value="">ทุกหมู่</option>
                  {mooOptions.map((m) => (
                    <option key={m} value={m}>
                      หมู่ที่ {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  ตำบล
                </label>
                <select
                  value={filterSubdistrict}
                  onChange={(e) => {
                    setFilterSubdistrict(e.target.value);
                    setFilterMoo('');
                  }}
                  className="w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#132238] focus:border-[#0B4DA2] dark:focus:border-[#3B8CE2] transition-colors"
                >
                  <option value="">ทุกตำบล</option>
                  {subdistrictOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  อำเภอ
                </label>
                <select
                  value={filterDistrict}
                  onChange={(e) => {
                    setFilterDistrict(e.target.value);
                    setFilterSubdistrict('');
                    setFilterMoo('');
                  }}
                  className="w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#132238] focus:border-[#0B4DA2] dark:focus:border-[#3B8CE2] transition-colors"
                >
                  <option value="">ทุกอำเภอ</option>
                  {districtOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  จังหวัด
                </label>
                <select
                  value={filterProvince}
                  onChange={(e) => {
                    setFilterProvince(e.target.value);
                    setFilterDistrict('');
                    setFilterSubdistrict('');
                    setFilterMoo('');
                  }}
                  className="w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#132238] focus:border-[#0B4DA2] dark:focus:border-[#3B8CE2] transition-colors"
                >
                  <option value="">ทุกจังหวัด</option>
                  {provinceOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Map + Admin-Only "บันทึกคำขอใหม่" Form */}
        <div
          className={`grid grid-cols-1 gap-4 sm:gap-5 items-stretch w-full ${
            isAdmin ? 'lg:grid-cols-12' : ''
          }`}
        >
          <div className={isAdmin ? 'lg:col-span-7 min-w-0 flex flex-col' : 'w-full min-w-0 flex flex-col'}>
            <MapWorkspace
              records={filteredRecords}
              isAdmin={isAdmin}
              isDark={isDark}
              apiKeyOverride={serverMapsApiKey}
              pickedCoords={pickedCoords}
              focusedRecord={focusedRecord}
              userLocation={userLocation}
              onLocateUser={handleLocateUser}
              onMapClickCoords={(lat, lng) => setPickedCoords({ lat, lng })}
              onEditRecord={handleEditRecord}
            />
          </div>

          {isAdmin && (
            <div className="lg:col-span-5 min-w-0 flex flex-col">
              <AdminRequestForm
                editingRecord={editingRecord}
                pickedCoords={pickedCoords}
                isGoogleConnected={Boolean(accessToken)}
                isGoogleSigningIn={isGoogleSigningIn}
                hasAppsScript={Boolean(
                  sheetConfig.appsScriptUrl?.trim() || isInsideGoogleAppsScript()
                )}
                serviceAccountConfigured={serviceAccountConfigured}
                googleUserEmail={googleUserEmail}
                googleAuthError={googleAuthError}
                isSubmitting={isMutating}
                pendingSyncCount={pendingOverlayCount}
                isFlushingPending={isFlushingPending}
                driveFolderId={sheetConfig.driveFolderId}
                canManageSheetConfig={canManageSheetConfig}
                resetTrigger={formResetTrigger}
                onConnectGoogle={() => handleGoogleSignIn(false)}
                onConnectGoogleForDrive={() => handleGoogleSignIn(true)}
                onOpenSheetSettings={() => setSettingsModalOpen(true)}
                onFlushPending={() => flushPendingOverlayToSheet()}
                onCaptureCurrentGps={handleCaptureGpsForForm}
                onCoordsManualChange={(lat, lng) => {
                  if (lat !== null && lng !== null) {
                    setPickedCoords({ lat, lng });
                  } else {
                    setPickedCoords(null);
                  }
                }}
                onCancelEdit={() => {
                  setEditingRecord(null);
                  setPickedCoords(null);
                }}
                onSubmit={handleFormSubmit}
              />
            </div>
          )}
        </div>

        {/* Admin Workspace with Tab Bar (Admin Only) */}
        {isAdmin && (
          <section
            id="table-section"
            className="bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl overflow-hidden shadow-xs transition-colors"
          >
            {/* Admin Tab Bar */}
            <div className="bg-[#F4F8FD] dark:bg-[#0A1424] border-b border-[#DCE6F3] dark:border-[#1D3350] px-3 sm:px-5 pt-2.5 sm:pt-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
              <div
                role="tablist"
                aria-label="แท็บจัดการข้อมูลสำหรับผู้ดูแลระบบ"
                className="flex items-center gap-1.5 overflow-x-auto max-w-full flex-nowrap sm:flex-wrap"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={adminWorkspaceTab === 'table'}
                  onClick={() => setAdminWorkspaceTab('table')}
                  className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap ${
                    adminWorkspaceTab === 'table'
                      ? 'bg-white dark:bg-[#0F1B2E] text-[#0B4DA2] dark:text-[#66B2FF] border-[#0B4DA2] dark:border-[#3B8CE2]'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#15253D]/60'
                  }`}
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  <span>รายการคำขอทั้งหมด</span>
                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums bg-[#E8F1FC] dark:bg-[#152B4A] text-[#0B4DA2] dark:text-[#7CC4FF]">
                    {filteredRecords.length.toLocaleString('th-TH')}
                  </span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={adminWorkspaceTab === 'batch_builder'}
                  onClick={() => setAdminWorkspaceTab('batch_builder')}
                  className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap ${
                    adminWorkspaceTab === 'batch_builder'
                      ? 'bg-white dark:bg-[#0F1B2E] text-[#0B4DA2] dark:text-[#66B2FF] border-[#0B4DA2] dark:border-[#3B8CE2]'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#15253D]/60'
                  }`}
                >
                  <PackageCheck className="w-3.5 h-3.5" />
                  <span>รวมชุดติดตั้งเสร็จสิ้น</span>
                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                    {completedEligibleUnbatchedCount.toLocaleString('th-TH')}
                  </span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={adminWorkspaceTab === 'batch_archive'}
                  onClick={() => setAdminWorkspaceTab('batch_archive')}
                  className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 transition-colors inline-flex items-center gap-2 whitespace-nowrap ${
                    adminWorkspaceTab === 'batch_archive'
                      ? 'bg-white dark:bg-[#0F1B2E] text-[#0B4DA2] dark:text-[#66B2FF] border-[#0B4DA2] dark:border-[#3B8CE2]'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#15253D]/60'
                  }`}
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>ที่เก็บข้อมูลชุดงาน</span>
                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums bg-[#E8F1FC] dark:bg-[#152B4A] text-[#0B4DA2] dark:text-[#7CC4FF]">
                    {completedBatches.length.toLocaleString('th-TH')}
                  </span>
                </button>
              </div>

              <span className="text-[11px] text-slate-500 dark:text-slate-400 pb-2 hidden xl:inline">
                เฉพาะผู้ดูแลระบบ (Admin)
              </span>
            </div>

            {adminWorkspaceTab === 'table' && (
              <RequestsTable
                embedded
                records={filteredRecords}
                totalCount={records.length}
                isLoading={isLoading}
                isAdmin={isAdmin}
                searchQuery={searchQuery}
                statusOptions={statusOptions}
                filterContext={{
                  status: filterStatus,
                  location: [filterMoo ? `หมู่ที่ ${filterMoo}` : '', filterSubdistrict, filterDistrict, filterProvince].filter(Boolean).join(' '),
                  province: filterProvince,
                  district: filterDistrict,
                  subdistrict: filterSubdistrict,
                  moo: filterMoo,
                  month: '',
                  dateFrom: filterDateFrom,
                  dateTo: filterDateTo,
                  searchQuery,
                  totalUnfilteredCount: records.length,
                }}
                onSearchChange={setSearchQuery}
                onStatusChange={setFilterStatus}
                onFocusRecord={(rec) => {
                  setFocusedRecord(rec);
                  document
                    .getElementById('map-section')
                    ?.scrollIntoView({ behavior: 'smooth' });
                }}
                onEditRecord={handleEditRecord}
                onDeleteRecord={handleDeleteRecord}
                onExportFeedback={(msg, tone) => showToast(msg, tone)}
              />
            )}

            {adminWorkspaceTab === 'batch_builder' && (
              <AdminBatchWorkspace
                mode="builder"
                records={records}
                spreadsheetId={sheetConfig.spreadsheetId}
                appsScriptUrl={sheetConfig.appsScriptUrl}
                accessToken={accessToken}
                driveFolderId={sheetConfig.driveFolderId}
                canManageSheetConfig={canManageSheetConfig}
                onBatchesChange={setCompletedBatches}
                onNotify={(msg, tone) => showToast(msg, tone)}
              />
            )}

            {adminWorkspaceTab === 'batch_archive' && (
              <AdminBatchWorkspace
                mode="archive"
                records={records}
                spreadsheetId={sheetConfig.spreadsheetId}
                appsScriptUrl={sheetConfig.appsScriptUrl}
                accessToken={accessToken}
                driveFolderId={sheetConfig.driveFolderId}
                canManageSheetConfig={canManageSheetConfig}
                onBatchesChange={setCompletedBatches}
                onNotify={(msg, tone) => showToast(msg, tone)}
              />
            )}
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white dark:bg-[#0D192B] border-t border-[#DCE6F3] dark:border-[#1B314E] py-5 px-4 sm:px-6 text-center text-xs text-slate-600 dark:text-slate-300 transition-colors">
        <div className="max-w-[1440px] mx-auto space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">
            พัฒนาโดย # งานบริการและควบคุมน้ำสูญเสีย
          </p>
          <p className="text-slate-600 dark:text-slate-300">
            #นายสามารถ บุญกัน นายช่างโยธา 6
          </p>
          <p className="text-[#0B4DA2] dark:text-[#66B2FF] font-medium">
            กปภ.สาขาขาณุวรลักษบุรี{' '}
            <a
              href="tel:055771277"
              className="hover:underline tabular-nums"
            >
              Tel : 055 771 277
            </a>
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">
            ระบบติดตามคำขอติดตั้ง / ย้ายมาตรวัดน้ำ · เชื่อมโยงข้อมูล Google Sheets / AppSheet แบบเรียลไทม์
          </p>
        </div>
      </footer>

      {/* Modals */}
      <AdminLoginModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={(session: AdminSessionPayload) => {
          setIsAdmin(true);
          setAdminToken(session.token || null);
          setCanManageSheetConfig(Boolean(session.canManageSheetConfig));
          showToast(
            `เข้าสู่ระบบ Admin (${session.username}) สำเร็จ เปิดใช้งานส่วนบันทึกคำขอใหม่และแก้ไขข้อมูลแล้ว`,
            'success'
          );
        }}
      />

      {isAdmin && canManageSheetConfig && (
        <SheetSettingsModal
          open={settingsModalOpen}
          config={sheetConfig}
          accessToken={accessToken}
          googleUserEmail={googleUserEmail}
          isGoogleSigningIn={isGoogleSigningIn}
          serviceAccountConfigured={serviceAccountConfigured}
          serviceAccountEmail={serviceAccountEmail}
          pendingOverlayCount={pendingOverlayCount}
          isFlushingPending={isFlushingPending}
          onFlushPending={() => flushPendingOverlayToSheet()}
          onConnectGoogle={() => handleGoogleSignIn(false)}
          onDisconnectGoogle={handleGoogleSignOut}
          onClose={() => setSettingsModalOpen(false)}
          onSave={async (nextConfig) => {
            hasLoadedOnceRef.current = false;
            setSheetConfig(nextConfig);
            await saveServerConfig(nextConfig, adminToken);
            showToast('บันทึกการตั้งค่า Google Sheets แล้ว กำลังซิงค์ข้อมูล...', 'info');
            if (nextConfig.appsScriptUrl?.trim() && pendingOverlayCount > 0) {
              await flushPendingOverlayToSheet(nextConfig);
            }
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        variant={pendingConfirm?.mode === 'delete' ? 'danger' : 'primary'}
        title={
          pendingConfirm?.mode === 'delete'
            ? 'ยืนยันการลบข้อมูลคำขอ'
            : 'ยืนยันการบันทึกแก้ไขข้อมูลคำขอ'
        }
        description={
          pendingConfirm?.mode === 'delete'
            ? 'คุณต้องการลบรายการคำขอนี้ออกจากระบบใช่หรือไม่?'
            : 'คุณต้องการบันทึกการเปลี่ยนแปลงข้อมูลคำขอนี้ใช่หรือไม่?'
        }
        details={
          pendingConfirm?.mode === 'delete' && pendingConfirm.record
            ? [
                {
                  label: 'ตำแหน่งข้อมูล',
                  value:
                    pendingConfirm.rowIndex > 0
                      ? `แถวที่ ${pendingConfirm.rowIndex}`
                      : 'รายการใหม่ในระบบ',
                },
                { label: 'เลขที่ RQ', value: pendingConfirm.record.rqNumber || '-' },
                { label: 'ชื่อ - สกุล', value: pendingConfirm.record.fullName || '-' },
                { label: 'เบอร์โทร', value: pendingConfirm.record.phone || '-' },
              ]
            : pendingConfirm?.payload
            ? [
                {
                  label: 'ตำแหน่งข้อมูล',
                  value:
                    pendingConfirm.rowIndex > 0
                      ? `แถวที่ ${pendingConfirm.rowIndex}`
                      : 'รายการใหม่ในระบบ',
                },
                { label: 'เลขที่ RQ', value: pendingConfirm.payload.rqNumber || '-' },
                { label: 'ชื่อ - สกุล', value: pendingConfirm.payload.fullName || '-' },
                { label: 'สถานะ', value: pendingConfirm.payload.status },
                {
                  label: 'ราคา',
                  value: `${pendingConfirm.payload.price.toLocaleString('th-TH')} บาท`,
                },
                {
                  label: 'พิกัด',
                  value:
                    formatLatLngString(
                      pendingConfirm.payload.latitude,
                      pendingConfirm.payload.longitude
                    ) || '-',
                },
                {
                  label: 'รูปหน้าบ้าน',
                  value: pendingConfirm.photoFile
                    ? `แนบรูปใหม่ (${pendingConfirm.photoFile.name})`
                    : pendingConfirm.payload.housePhotoUrl
                    ? 'มีลิงก์รูปเดิม'
                    : 'ไม่มี',
                },
              ]
            : []
        }
        confirmLabel={
          pendingConfirm?.mode === 'delete' ? 'ยืนยันลบข้อมูล' : 'ยืนยันบันทึกแก้ไข'
        }
        isProcessing={isMutating}
        onConfirm={executeConfirmedMutation}
        onCancel={() => {
          if (!isMutating) setPendingConfirm(null);
        }}
      />

      {/* Live Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-4 left-3 right-3 sm:left-auto sm:right-5 z-[3000] sm:max-w-sm rounded-xl shadow-lg border px-4 py-3 flex items-start gap-3 text-xs ${
            toast.tone === 'error'
              ? 'bg-rose-950 border-rose-800 text-white'
              : toast.tone === 'warning'
              ? 'bg-amber-950 border-amber-800 text-white'
              : toast.tone === 'success'
              ? 'bg-[#12263D] border-emerald-700 text-white'
              : 'bg-[#12263D] border-[#2271B3] text-white'
          }`}
        >
          <CheckCircle2
            className={`w-4 h-4 shrink-0 mt-0.5 ${
              toast.tone === 'error'
                ? 'text-rose-400'
                : toast.tone === 'warning'
                ? 'text-amber-400'
                : 'text-emerald-400'
            }`}
          />
          <div className="flex-1 space-y-1">
            <p className="leading-snug">{toast.message}</p>
            {toast.focusCoords && (
              <button
                type="button"
                onClick={() => {
                  const matched = records.find(
                    (r) => r.uid === toast.focusCoords?.uid
                  );
                  if (matched) {
                    setFocusedRecord(matched);
                    document
                      .getElementById('map-section')
                      ?.scrollIntoView({ behavior: 'smooth' });
                  }
                  setToast(null);
                }}
                className="text-[#8CC5F2] hover:underline font-medium"
              >
                ดูตำแหน่งบนแผนที่
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white"
            aria-label="ปิดการแจ้งเตือน"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
