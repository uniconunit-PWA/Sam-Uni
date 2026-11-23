import {
  DataChangeEvent,
  FieldChangeDiff,
  MeterFormPayload,
  MeterRequest,
  SheetConfig,
  SheetTabInfo,
  formatLatLngString,
  parseLatLngPair,
} from '../types/meter';

export const LEGACY_SPREADSHEET_ID = '17bZyj009jyxtjWb8DsZCXkmd4DQO0UAzHPEVyvWZ8Ns';
export const DEFAULT_SPREADSHEET_ID = '1iBqlVp4jXeI254idzjvtSltaX7BJ-a40uy-n3XwnAsg';

export interface FetchSheetResult {
  records: MeterRequest[];
  headers: string[];
  sheetName: string;
  sheetId?: number;
  spreadsheetTitle?: string;
  availableTabs: SheetTabInfo[];
  mode: 'oauth' | 'apps_script' | 'public_csv';
  fetchedAt: number;
}

interface GoogleScriptRunner {
  withSuccessHandler: (cb: (res: any) => void) => GoogleScriptRunner;
  withFailureHandler: (cb: (err: any) => void) => GoogleScriptRunner;
  [fnName: string]: (...args: any[]) => any;
}

export function isInsideGoogleAppsScript(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as any).google?.script?.run)
  );
}

function runAppsScriptFunction<T = any>(
  fnName: string,
  ...args: unknown[]
): Promise<T> {
  return new Promise((resolve, reject) => {
    const runner: GoogleScriptRunner | undefined = (window as any).google?.script?.run;
    if (!runner) {
      reject(new Error('ไม่พบสภาพแวดล้อม Google Apps Script'));
      return;
    }
    runner
      .withSuccessHandler((res: T) => resolve(res))
      .withFailureHandler((err: any) =>
        reject(new Error(err?.message || String(err) || 'Apps Script error'))
      )[fnName](...args);
  });
}

/**
 * Extracts a Google Spreadsheet ID from either a full URL or raw ID string.
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed || trimmed === LEGACY_SPREADSHEET_ID) return DEFAULT_SPREADSHEET_ID;
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1] === LEGACY_SPREADSHEET_ID ? DEFAULT_SPREADSHEET_ID : match[1];
  }
  return trimmed;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getField(raw: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    if (raw[alias] !== undefined && raw[alias] !== '') {
      return raw[alias];
    }
  }
  const normalizedMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    normalizedMap[normalizeHeader(k)] = v;
  }
  for (const alias of aliases) {
    const val = normalizedMap[normalizeHeader(alias)];
    if (val !== undefined && val !== '') {
      return val;
    }
  }
  return '';
}

function normalizeDateInput(val: string): string {
  const s = (val || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Support DD/MM/YYYY or D/M/YYYY (including Buddhist Era years >= 2400)
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
  return s;
}

function buildLocationSummary(
  explicitSummary: string,
  subdistrict: string,
  district: string,
  province: string
): string {
  if (explicitSummary) return explicitSummary;
  const parts: string[] = [];
  if (subdistrict) parts.push(subdistrict.startsWith('ต.') ? subdistrict : `ต.${subdistrict}`);
  if (district) parts.push(district.startsWith('อ.') ? district : `อ.${district}`);
  if (province) parts.push(province.startsWith('จ.') ? province : `จ.${province}`);
  return parts.join(' ');
}

function parseCombinedLocation(summary: string): {
  subdistrict: string;
  district: string;
  province: string;
} {
  if (!summary) return { subdistrict: '', district: '', province: '' };
  const tMatch = summary.match(/ต\.([^\s]+)/);
  const aMatch = summary.match(/อ\.([^\s]+)/);
  const jMatch = summary.match(/จ\.([^\s(]+)/);
  return {
    subdistrict: tMatch ? `ต.${tMatch[1]}` : '',
    district: aMatch ? `อ.${aMatch[1]}` : '',
    province: jMatch ? `จ.${jMatch[1]}` : '',
  };
}

export function mapRowsToMeterRequests(rows: string[][]): {
  records: MeterRequest[];
  headers: string[];
} {
  if (!rows || rows.length === 0) {
    return { records: [], headers: [] };
  }

  const rawHeaders = rows[0].map((h) => (h || '').trim());
  let lastNonEmpty = rawHeaders.length - 1;
  while (lastNonEmpty >= 0 && rawHeaders[lastNonEmpty] === '') {
    lastNonEmpty--;
  }
  const headers = rawHeaders.slice(0, lastNonEmpty + 1);
  const records: MeterRequest[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // Skip completely empty rows
    const hasAnyContent = cells.some((cell) => cell !== undefined && String(cell).trim() !== '');
    if (!hasAnyContent) continue;

    const raw: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (header) {
        raw[header] = cells[idx] !== undefined ? String(cells[idx]).trim() : '';
      }
    });

    const rqNumber = getField(raw, ['เลขที่ RQ', 'เลขที่คำขอ', 'เลขที่งาน', 'เลขงาน', 'RQ', 'Job ID']);
    const rawDate = getField(raw, ['วันที่ยื่นคำร้อง', 'วันที่', 'วันที่ต้องการ', 'Date']);
    const requestDate = normalizeDateInput(rawDate);
    const fullName = getField(raw, ['ชื่อ-สกุล', 'ชื่อ - สกุล', 'ชื่อสกุล', 'ชื่อ', 'Full Name']);
    const houseNo = getField(raw, ['บ้านเลขที่', 'ที่อยู่', 'House No']);
    const moo = getField(raw, ['หมู่ที่', 'หมู่', 'Moo']);

    const explicitLocation = getField(raw, ['ตำบล-อำเภอ-จังหวัด', 'พื้นที่', 'Location Info']);
    let subdistrict = getField(raw, ['ตำบล', 'Subdistrict']);
    let district = getField(raw, ['อำเภอ', 'District']);
    let province = getField(raw, ['จังหวัด', 'Province']);

    if ((!subdistrict || !district || !province) && explicitLocation) {
      const parsedLoc = parseCombinedLocation(explicitLocation);
      subdistrict = subdistrict || parsedLoc.subdistrict;
      district = district || parsedLoc.district;
      province = province || parsedLoc.province;
    }

    const locationSummary = buildLocationSummary(explicitLocation, subdistrict, district, province);
    const phone = getField(raw, ['เบอร์โทร', 'เบอร์ติดต่อ', 'โทรศัพท์', 'Phone']);

    const rawPrice = getField(raw, ['ราคา', 'ยอดชำระ', 'ยอดชำระเงิน', 'Amount', 'Price']).replace(/,/g, '');
    const price = Number.parseFloat(rawPrice) || 0;

    const rawStatus = getField(raw, ['สถานะ', 'สถานะการชำระเงิน', 'Status']).trim();
    const status =
      !rawStatus || rawStatus === 'รอตรวจสอบ' ? 'รับคำร้องแล้ว(รอสำรวจ)' : rawStatus;

    const combinedLatLong = getField(raw, ['lat/long', 'Lat/Long', 'พิกัด', 'Location', 'Coordinates']);
    const latSeparate = getField(raw, ['latitude', 'Latitude', 'Lat']);
    const lngSeparate = getField(raw, ['longitude', 'Longitude', 'Lng', 'Long']);
    const { lat, lng } = parseLatLngPair(combinedLatLong, latSeparate, lngSeparate);

    const note = getField(raw, ['หมายเหตุ', 'รายละเอียด', 'Note', 'Notes']);
    const housePhotoUrl = getField(raw, [
      'รูปหน้าบ้าน',
      'ภาพหน้าบ้าน',
      'รูปถ่ายหน้าบ้าน',
      'ภาพถ่ายหน้าบ้าน',
      'ลิงก์รูปหน้าบ้าน',
      'House Photo',
      'Photo URL',
      'Photo',
      'Image',
    ]);

    const rowIndex = i + 1; // 1-based sheet row
    const uid = rqNumber
      ? `rq:${rqNumber}`
      : `row:${rowIndex}:${fullName || phone || 'item'}`;

    records.push({
      rowIndex,
      uid,
      rqNumber,
      requestDate,
      fullName,
      houseNo,
      moo,
      subdistrict,
      district,
      province,
      locationSummary,
      phone,
      price,
      status,
      latitude: lat,
      longitude: lng,
      note,
      housePhotoUrl,
      raw,
    });
  }

  return { records, headers };
}

/**
 * RFC 4180 compliant CSV parser handling quoted commas and newlines.
 */
export function parseCSV(csvText: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [''];
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i];
    const next = csvText[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      lines.push(row);
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }

  if (row.length > 1 || row[0] !== '') {
    lines.push(row);
  }
  return lines;
}

export class SheetsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SheetsApiError';
    this.status = status;
  }
}

async function parseGoogleApiError(res: Response, fallbackPrefix: string): Promise<SheetsApiError> {
  const errBody = await res.json().catch(() => ({}));
  const rawMsg = errBody?.error?.message || `HTTP ${res.status}`;
  if (res.status === 401) {
    return new SheetsApiError(
      'สิทธิ์การเข้าถึง Google หมดอายุ กรุณากด Sign in with Google ใหม่อีกครั้ง',
      401
    );
  }
  if (res.status === 403) {
    return new SheetsApiError(
      `บัญชี Google นี้ไม่มีสิทธิ์แก้ไขชีทนี้ หรือยังไม่ได้เปิด Google Sheets API (${rawMsg})`,
      403
    );
  }
  return new SheetsApiError(`${fallbackPrefix} (${rawMsg})`, res.status);
}

/**
 * Fetches spreadsheet metadata (title + all sheet tabs) via Google Sheets API v4.
 * Never assumes tab name is "Sheet1".
 */
export async function fetchSpreadsheetMetadata(
  spreadsheetId: string,
  accessToken: string
): Promise<{ title: string; tabs: SheetTabInfo[] }> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=properties.title,sheets.properties(sheetId,title,gridProperties.rowCount)`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw await parseGoogleApiError(res, 'ไม่สามารถอ่านโครงสร้าง Google Sheet ได้');
  }

  const data = await res.json();
  const tabs: SheetTabInfo[] = (data.sheets || []).map((s: any) => ({
    sheetId: s.properties?.sheetId ?? 0,
    title: s.properties?.title || '',
    rowCount: s.properties?.gridProperties?.rowCount,
  }));

  return {
    title: data.properties?.title || 'Google Spreadsheet',
    tabs,
  };
}

function columnLetter(indexZeroBased: number): string {
  let n = indexZeroBased;
  let letter = '';
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/**
 * Maps a MeterFormPayload back onto the exact existing header columns of the sheet.
 */
export function buildRowValuesForHeaders(
  headers: string[],
  payload: MeterFormPayload,
  existingRaw?: Record<string, string>
): string[] {
  const defaultAppSheetHeaders = [
    'เลขที่ RQ',
    'วันที่ยื่นคำร้อง',
    'ชื่อ-สกุล',
    'หมู่ที่',
    'ตำบล',
    'อำเภอ',
    'จังหวัด',
    'เบอร์โทร',
    'ราคา',
    'สถานะ',
    'lat/long',
    'รูปหน้าบ้าน',
  ];

  const targetHeaders = headers.length > 0 ? headers : defaultAppSheetHeaders;
  const latLngCombined = formatLatLngString(payload.latitude, payload.longitude);
  const locationCombined = buildLocationSummary(
    '',
    payload.subdistrict,
    payload.district,
    payload.province
  );

  return targetHeaders.map((header) => {
    const h = normalizeHeader(header);

    if (['เลขที่ rq', 'เลขที่คำขอ', 'เลขที่งาน', 'เลขงาน', 'rq', 'job id'].includes(h)) {
      return payload.rqNumber || '';
    }
    if (['วันที่ยื่นคำร้อง', 'วันที่', 'วันที่ต้องการ', 'date'].includes(h)) {
      return payload.requestDate || '';
    }
    if (['ชื่อ-สกุล', 'ชื่อ - สกุล', 'ชื่อสกุล', 'ชื่อ', 'full name'].includes(h)) {
      return payload.fullName || '';
    }
    if (['บ้านเลขที่', 'ที่อยู่', 'house no'].includes(h)) {
      return payload.houseNo || '';
    }
    if (['หมู่ที่', 'หมู่', 'moo'].includes(h)) {
      return payload.moo || '';
    }
    if (['ตำบล', 'subdistrict'].includes(h)) {
      return payload.subdistrict || '';
    }
    if (['อำเภอ', 'district'].includes(h)) {
      return payload.district || '';
    }
    if (['จังหวัด', 'province'].includes(h)) {
      return payload.province || '';
    }
    if (['ตำบล-อำเภอ-จังหวัด', 'พื้นที่', 'location info'].includes(h)) {
      return locationCombined;
    }
    if (['เบอร์โทร', 'เบอร์ติดต่อ', 'โทรศัพท์', 'phone'].includes(h)) {
      return payload.phone || '';
    }
    if (['ราคา', 'ยอดชำระ', 'ยอดชำระเงิน', 'amount', 'price'].includes(h)) {
      return payload.price !== undefined && payload.price !== null ? String(payload.price) : '0';
    }
    if (['สถานะ', 'สถานะการชำระเงิน', 'status'].includes(h)) {
      return payload.status || 'รับคำร้องแล้ว(รอสำรวจ)';
    }
    if (['lat/long', 'พิกัด', 'location', 'coordinates'].includes(h)) {
      return latLngCombined;
    }
    if (['latitude', 'lat'].includes(h)) {
      return payload.latitude !== null ? String(payload.latitude) : '';
    }
    if (['longitude', 'lng', 'long'].includes(h)) {
      return payload.longitude !== null ? String(payload.longitude) : '';
    }
    if (['หมายเหตุ', 'รายละเอียด', 'note', 'notes'].includes(h)) {
      return payload.note || '';
    }
    if (
      [
        'รูปหน้าบ้าน',
        'ภาพหน้าบ้าน',
        'รูปถ่ายหน้าบ้าน',
        'ภาพถ่ายหน้าบ้าน',
        'ลิงก์รูปหน้าบ้าน',
        'house photo',
        'photo url',
        'photo',
        'image',
      ].includes(h)
    ) {
      return payload.housePhotoUrl || '';
    }

    // Preserve any unknown AppSheet system/formula columns safely
    return existingRaw?.[header] ?? '';
  });
}

const PHOTO_HEADER_KEYS = new Set([
  'รูปหน้าบ้าน',
  'ภาพหน้าบ้าน',
  'รูปถ่ายหน้าบ้าน',
  'ภาพถ่ายหน้าบ้าน',
  'ลิงก์รูปหน้าบ้าน',
  'house photo',
  'photo url',
  'photo',
  'image',
]);

async function ensurePhotoHeaderIfNeeded(
  spreadsheetId: string,
  sheetTitle: string,
  headers: string[],
  accessToken: string,
  housePhotoUrl?: string
): Promise<string[]> {
  if (!housePhotoUrl || headers.length === 0) return headers;
  const hasPhotoCol = headers.some((h) => PHOTO_HEADER_KEYS.has(normalizeHeader(h)));
  if (hasPhotoCol) return headers;

  const colIdx = headers.length;
  const colLet = columnLetter(colIdx);
  const range = `'${sheetTitle.replace(/'/g, "''")}'!${colLet}1`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values: [['รูปหน้าบ้าน']],
    }),
  });
  if (!res.ok) {
    return headers;
  }
  return [...headers, 'รูปหน้าบ้าน'];
}

/**
 * Fetches sheet records using OAuth Sheets API v4 when signed in,
 * or public CSV export when viewing unauthenticated.
 */
export async function fetchSheetRecords(
  config: SheetConfig,
  accessToken: string | null
): Promise<FetchSheetResult> {
  const spreadsheetId = extractSpreadsheetId(config.spreadsheetId);

  if (isInsideGoogleAppsScript()) {
    const res = await runAppsScriptFunction<{
      rows: string[][];
      sheetName?: string;
      spreadsheetTitle?: string;
      tabs?: SheetTabInfo[];
    }>('getSheetPayload', config.sheetName || '');
    const { records, headers } = mapRowsToMeterRequests(res?.rows || []);
    return {
      records,
      headers,
      sheetName: res?.sheetName || config.sheetName || '',
      spreadsheetTitle: res?.spreadsheetTitle,
      availableTabs: res?.tabs || config.availableTabs,
      mode: 'apps_script',
      fetchedAt: Date.now(),
    };
  }

  if (accessToken) {
    const meta = await fetchSpreadsheetMetadata(spreadsheetId, accessToken);
    if (meta.tabs.length === 0) {
      throw new Error('ไม่พบแผ่นงาน (Sheet Tab) ในไฟล์ Google Sheets นี้');
    }

    const activeTab =
      meta.tabs.find((t) => t.title === config.sheetName) || meta.tabs[0];

    const range = `'${activeTab.title.replace(/'/g, "''")}'!A1:Z`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      throw await parseGoogleApiError(res, 'โหลดข้อมูล Google Sheets ล้มเหลว');
    }

    const json = await res.json();
    const rows: string[][] = json.values || [];
    const { records, headers } = mapRowsToMeterRequests(rows);

    return {
      records,
      headers,
      sheetName: activeTab.title,
      sheetId: activeTab.sheetId,
      spreadsheetTitle: meta.title,
      availableTabs: meta.tabs,
      mode: 'oauth',
      fetchedAt: Date.now(),
    };
  }

  // Unauthenticated public read fallback via Google Sheets CSV / gviz endpoint
  const cacheBuster = Date.now();
  const gvizUrl = config.sheetName
    ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
        spreadsheetId
      )}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(config.sheetName)}&_=${cacheBuster}`
    : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
        spreadsheetId
      )}/export?format=csv&_=${cacheBuster}`;

  const res = await fetch(gvizUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(
      `ไม่สามารถเข้าถึง Google Sheets แบบสาธารณะได้ (HTTP ${res.status}) กรุณาตรวจสอบสิทธิ์การแชร์ของชีท หรือเชื่อมต่อบัญชี Google ในเมนู "ตั้งค่าชีท"`
    );
  }

  const csvText = await res.text();
  if (csvText.trim().startsWith('<!DOCTYPE html') || csvText.trim().startsWith('<html')) {
    throw new Error(
      'ชีทนี้ตั้งค่าเป็นส่วนตัว กรุณาเปิดแชร์แบบ "ทุกคนที่มีลิงก์อ่านได้" หรือเชื่อมต่อบัญชี Google ในเมนู "ตั้งค่าชีท"'
    );
  }

  const rows = parseCSV(csvText);
  const { records, headers } = mapRowsToMeterRequests(rows);

  return {
    records,
    headers,
    sheetName: config.sheetName || '',
    availableTabs: config.availableTabs,
    mode: 'public_csv',
    fetchedAt: Date.now(),
  };
}

async function resolveSheetTitle(
  spreadsheetId: string,
  config: SheetConfig,
  accessToken: string
): Promise<string> {
  if (config.sheetName) return config.sheetName;
  if (config.availableTabs[0]?.title) return config.availableTabs[0].title;
  const meta = await fetchSpreadsheetMetadata(spreadsheetId, accessToken);
  if (!meta.tabs[0]?.title) {
    throw new Error('ไม่พบชื่อแผ่นงาน (Sheet Tab) ในไฟล์ Google Sheets นี้');
  }
  return meta.tabs[0].title;
}

export interface ServerConfigSnapshot {
  spreadsheetId?: string;
  sheetName?: string;
  pollIntervalMs?: number;
  appsScriptUrl?: string;
  driveFolderId?: string;
  serviceAccountConfigured?: boolean;
  serviceAccountEmail?: string | null;
  googleMapsApiKey?: string;
}

export async function fetchServerConfig(): Promise<ServerConfigSnapshot | null> {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ServerConfigSnapshot;
  } catch {
    return null;
  }
}

export async function saveServerConfig(
  config: SheetConfig,
  adminToken?: string | null
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (adminToken) {
      headers.Authorization = `Bearer ${adminToken}`;
    }
    await fetch('/api/config', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName,
        pollIntervalMs: config.pollIntervalMs,
        appsScriptUrl: config.appsScriptUrl || '',
        driveFolderId: config.driveFolderId || '',
      }),
    });
  } catch {
    // ignore if offline
  }
}

function validateAppsScriptClientUrl(
  rawUrl: string
): { ok: true; url: string } | { ok: false; message: string } {
  const clean = rawUrl.trim();
  if (!clean) {
    return { ok: false, message: 'กรุณาวางลิงก์ Google Apps Script Web App ก่อนทดสอบ' };
  }
  if (!clean.startsWith('https://script.google.com/')) {
    return {
      ok: false,
      message: 'URL ต้องขึ้นต้นด้วย https://script.google.com/macros/s/.../exec',
    };
  }
  try {
    const parsed = new URL(clean);
    if (parsed.pathname.endsWith('/dev')) {
      return {
        ok: false,
        message:
          'ลิงก์นี้เป็นลิงก์ทดสอบ (/dev) กรุณาใช้ลิงก์ที่ลงท้ายด้วย /exec จากเมนู Deploy > Web app',
      };
    }
    if (!parsed.pathname.endsWith('/exec')) {
      return {
        ok: false,
        message:
          'ลิงก์ Apps Script ไม่สมบูรณ์ กรุณาคัดลอก URL มาครบทั้งเส้นที่ลงท้ายด้วย /exec',
      };
    }
    return { ok: true, url: clean };
  } catch {
    return { ok: false, message: 'รูปแบบลิงก์ Apps Script ไม่ถูกต้อง' };
  }
}

async function testAppsScriptDirect(
  cleanUrl: string
): Promise<{ success: boolean; message: string; sheetName?: string }> {
  const pingUrl = new URL(cleanUrl);
  pingUrl.searchParams.set('action', 'ping');
  try {
    const directRes = await fetch(pingUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
    });
    const text = await directRes.text();
    if (directRes.status === 404) {
      return {
        success: false,
        message:
          'ไม่พบ Apps Script Web App ที่ลิงก์นี้ (HTTP 404) กรุณาตรวจสอบว่า Deploy > Web app แล้ว และคัดลอก URL ครบทั้งเส้นถึง /exec',
      };
    }
    if (!directRes.ok) {
      return {
        success: false,
        message: `Apps Script ตอบกลับ HTTP ${directRes.status}`,
      };
    }
    const lower = text.trim().toLowerCase();
    if (lower.startsWith('<!doctype') || lower.startsWith('<html')) {
      return {
        success: false,
        message:
          'Apps Script ตอบกลับเป็นหน้าเว็บแทน JSON กรุณาตรวจสอบว่าวางโค้ด Code.gs ล่าสุดและตั้งค่า Who has access เป็น "Anyone"',
      };
    }
    const json = JSON.parse(text);
    if (json && json.success === false) {
      return {
        success: false,
        message: json.message || 'Apps Script ปฏิเสธการเชื่อมต่อ',
      };
    }
    return {
      success: true,
      message: json?.sheetName
        ? `เชื่อมต่อสำเร็จ! พบชีท "${json.sheetName}" พร้อมเขียนข้อมูลอัตโนมัติ`
        : json?.message || 'เชื่อมต่อ Apps Script สำเร็จ พร้อมเขียนข้อมูลเข้าชีทอัตโนมัติ',
      sheetName: json?.sheetName,
    };
  } catch {
    return {
      success: false,
      message:
        'ไม่สามารถเชื่อมต่อ Apps Script Web App ได้ (กรุณาตรวจสอบว่าตั้ง Who has access เป็น "Anyone (ทุกคน)" และคัดลอก URL /exec ถูกต้อง)',
    };
  }
}

export async function testAppsScriptConnection(
  appsScriptUrl: string
): Promise<{ success: boolean; message: string; sheetName?: string }> {
  const check = validateAppsScriptClientUrl(appsScriptUrl);
  if (check.ok === false) {
    return { success: false, message: check.message };
  }
  const cleanUrl = check.url;

  try {
    const res = await fetch('/api/apps-script/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appsScriptUrl: cleanUrl }),
    });
    const json = await res.json().catch(() => null);

    // If /api/apps-script/test route is missing on static/shared hosting (404/405 with non-JSON body), test directly via browser CORS
    if ((res.status === 404 || res.status === 405) && !json?.message) {
      return await testAppsScriptDirect(cleanUrl);
    }

    if (!res.ok || json?.success === false) {
      return {
        success: false,
        message: json?.message || `ทดสอบการเชื่อมต่อไม่สำเร็จ (HTTP ${res.status})`,
      };
    }
    return {
      success: true,
      message: json?.sheetName
        ? `เชื่อมต่อสำเร็จ! พบชีท "${json.sheetName}" พร้อมเขียนข้อมูลอัตโนมัติ`
        : json?.message || 'เชื่อมต่อ Apps Script สำเร็จ พร้อมเขียนข้อมูลเข้าชีทอัตโนมัติ',
      sheetName: json?.sheetName,
    };
  } catch {
    return await testAppsScriptDirect(cleanUrl);
  }
}

async function callServerServiceWrite(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/sheets/service-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.message || `Server Service Account HTTP ${res.status}`);
  }
}

async function callAppsScriptDirectPost(
  cleanUrl: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await fetch(cleanUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  const text = await res.text();
  if (res.status === 404) {
    throw new Error('ไม่พบลิงก์ Apps Script Web App นี้ (HTTP 404) กรุณาตรวจสอบ URL /exec');
  }
  if (!res.ok) {
    throw new Error(`Apps Script ตอบกลับข้อผิดพลาด HTTP ${res.status}`);
  }
  const lower = text.trim().toLowerCase();
  if (lower.startsWith('<!doctype') || lower.startsWith('<html')) {
    throw new Error(
      'Apps Script ปฏิเสธการเข้าถึง (กรุณาตั้งค่า Who has access เป็น "Anyone" และ Deploy ใหม่)'
    );
  }
  const json = JSON.parse(text);
  if (json && json.success === false) {
    throw new Error(json.message || 'Apps Script ปฏิเสธการบันทึกข้อมูล');
  }
}

async function callAppsScriptWrite(
  appsScriptUrl: string,
  body: Record<string, unknown>
): Promise<void> {
  const cleanUrl = appsScriptUrl.trim();
  if (isInsideGoogleAppsScript()) {
    const res = await runAppsScriptFunction<{ success?: boolean; message?: string }>(
      'handleApiAction',
      body
    );
    if (res && res.success === false) {
      throw new Error(res.message || 'Apps Script ปฏิเสธการบันทึกข้อมูล');
    }
    return;
  }

  if (typeof window !== 'undefined') {
    let shouldFallbackDirect = false;
    try {
      const proxyRes = await fetch('/api/apps-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appsScriptUrl: cleanUrl, payload: body }),
      });
      const json = await proxyRes.json().catch(() => null);
      if ((proxyRes.status === 404 || proxyRes.status === 405) && !json?.message) {
        shouldFallbackDirect = true;
      } else {
        if (!proxyRes.ok || (json && json.success === false)) {
          throw new Error(
            json?.message || `Apps Script ตอบกลับข้อผิดพลาด (HTTP ${proxyRes.status})`
          );
        }
        return;
      }
    } catch (err) {
      if (err instanceof TypeError) {
        shouldFallbackDirect = true;
      } else {
        throw err;
      }
    }

    if (shouldFallbackDirect) {
      await callAppsScriptDirectPost(cleanUrl, body);
      return;
    }
  }

  await callAppsScriptDirectPost(cleanUrl, body);
}

export async function appendSheetRecord(
  config: SheetConfig,
  accessToken: string | null,
  headers: string[],
  payload: MeterFormPayload,
  useServiceAccount = false
): Promise<void> {
  const rowValues = buildRowValuesForHeaders(headers, payload);
  const spreadsheetId = extractSpreadsheetId(config.spreadsheetId);

  if (isInsideGoogleAppsScript()) {
    await callAppsScriptWrite('', {
      action: 'add',
      spreadsheetId,
      sheetName: config.sheetName,
      rowValues,
      payload,
    });
    return;
  }

  if (config.appsScriptUrl && config.appsScriptUrl.trim()) {
    await callAppsScriptWrite(config.appsScriptUrl, {
      action: 'add',
      spreadsheetId,
      sheetName: config.sheetName,
      rowValues,
      payload,
    });
    return;
  }

  if (useServiceAccount) {
    await callServerServiceWrite({
      action: 'add',
      spreadsheetId,
      sheetName: config.sheetName,
      rowValues,
    });
    return;
  }

  if (!accessToken) {
    throw new SheetsApiError('ยังไม่ได้ยืนยันสิทธิ์ Google Sheets', 401);
  }

  const sheetTitle = await resolveSheetTitle(spreadsheetId, config, accessToken);
  const effectiveHeaders = await ensurePhotoHeaderIfNeeded(
    spreadsheetId,
    sheetTitle,
    headers,
    accessToken,
    payload.housePhotoUrl
  );
  const effectiveRowValues = buildRowValuesForHeaders(effectiveHeaders, payload);

  const endCol = columnLetter(Math.max(effectiveRowValues.length - 1, 0));
  const range = `'${sheetTitle.replace(/'/g, "''")}'!A:${endCol}`;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      majorDimension: 'ROWS',
      values: [effectiveRowValues],
    }),
  });

  if (!res.ok) {
    throw await parseGoogleApiError(res, 'เพิ่มคำขอลง Google Sheets ไม่สำเร็จ');
  }
}

export async function updateSheetRecord(
  config: SheetConfig,
  accessToken: string | null,
  rowIndex: number,
  headers: string[],
  payload: MeterFormPayload,
  existingRaw?: Record<string, string>,
  useServiceAccount = false
): Promise<void> {
  const rowValues = buildRowValuesForHeaders(headers, payload, existingRaw);
  const spreadsheetId = extractSpreadsheetId(config.spreadsheetId);

  if (isInsideGoogleAppsScript()) {
    await callAppsScriptWrite('', {
      action: 'update',
      spreadsheetId,
      rowIndex,
      sheetName: config.sheetName,
      rowValues,
      payload,
    });
    return;
  }

  if (config.appsScriptUrl && config.appsScriptUrl.trim()) {
    await callAppsScriptWrite(config.appsScriptUrl, {
      action: 'update',
      spreadsheetId,
      rowIndex,
      sheetName: config.sheetName,
      rowValues,
      payload,
    });
    return;
  }

  if (useServiceAccount) {
    await callServerServiceWrite({
      action: 'update',
      spreadsheetId,
      sheetName: config.sheetName,
      rowIndex,
      rowValues,
    });
    return;
  }

  if (!accessToken) {
    throw new SheetsApiError('ยังไม่ได้ยืนยันสิทธิ์ Google Sheets', 401);
  }

  const sheetTitle = await resolveSheetTitle(spreadsheetId, config, accessToken);
  const effectiveHeaders = await ensurePhotoHeaderIfNeeded(
    spreadsheetId,
    sheetTitle,
    headers,
    accessToken,
    payload.housePhotoUrl
  );
  const effectiveRowValues = buildRowValuesForHeaders(
    effectiveHeaders,
    payload,
    existingRaw
  );

  const endCol = columnLetter(Math.max(effectiveRowValues.length - 1, 0));
  const range = `'${sheetTitle.replace(/'/g, "''")}'!A${rowIndex}:${endCol}${rowIndex}`;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values: [effectiveRowValues],
    }),
  });

  if (!res.ok) {
    throw await parseGoogleApiError(res, 'อัปเดตข้อมูลใน Google Sheets ไม่สำเร็จ');
  }
}

export async function deleteSheetRecord(
  config: SheetConfig,
  accessToken: string | null,
  rowIndex: number,
  useServiceAccount = false
): Promise<void> {
  const spreadsheetId = extractSpreadsheetId(config.spreadsheetId);

  if (isInsideGoogleAppsScript()) {
    await callAppsScriptWrite('', {
      action: 'delete',
      spreadsheetId,
      rowIndex,
      sheetName: config.sheetName,
    });
    return;
  }

  if (config.appsScriptUrl && config.appsScriptUrl.trim()) {
    await callAppsScriptWrite(config.appsScriptUrl, {
      action: 'delete',
      spreadsheetId,
      rowIndex,
      sheetName: config.sheetName,
    });
    return;
  }

  if (useServiceAccount) {
    await callServerServiceWrite({
      action: 'delete',
      spreadsheetId,
      sheetName: config.sheetName,
      rowIndex,
    });
    return;
  }

  if (!accessToken) {
    throw new SheetsApiError('ยังไม่ได้ยืนยันสิทธิ์ Google Sheets', 401);
  }

  let targetSheetId = config.sheetId;

  if (targetSheetId === undefined) {
    const meta = await fetchSpreadsheetMetadata(spreadsheetId, accessToken);
    const matched =
      meta.tabs.find((t) => t.title === config.sheetName) || meta.tabs[0];
    targetSheetId = matched?.sheetId;
  }

  if (targetSheetId === undefined) {
    throw new Error('ไม่พบ Sheet ID สำหรับลบแถวข้อมูล');
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}:batchUpdate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: targetSheetId,
              dimension: 'ROWS',
              startIndex: rowIndex - 1,
              endIndex: rowIndex,
            },
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    throw await parseGoogleApiError(res, 'ลบข้อมูลใน Google Sheets ไม่สำเร็จ');
  }
}

/**
 * Compares previous and next snapshots of MeterRequest[] to generate
 * detailed real-time DataChangeEvent notifications.
 */
export function detectRecordChanges(
  prevRecords: MeterRequest[],
  nextRecords: MeterRequest[]
): DataChangeEvent[] {
  const events: DataChangeEvent[] = [];
  const now = Date.now();

  const prevByUid: Record<string, MeterRequest> = {};
  prevRecords.forEach((rec) => {
    prevByUid[rec.uid] = rec;
  });

  const nextByUid: Record<string, MeterRequest> = {};
  nextRecords.forEach((rec) => {
    nextByUid[rec.uid] = rec;
  });

  // Added or updated
  nextRecords.forEach((next) => {
    const prev = prevByUid[next.uid];
    if (!prev) {
      events.push({
        id: `chg-${now}-${next.uid}-add`,
        timestamp: now,
        type: 'added',
        recordUid: next.uid,
        rqNumber: next.rqNumber,
        fullName: next.fullName || 'ไม่ระบุชื่อ',
        status: next.status,
        latitude: next.latitude,
        longitude: next.longitude,
        summary: `เพิ่มคำขอใหม่: ${next.fullName || next.rqNumber || `แถวที่ ${next.rowIndex}`}`,
        diffs: [],
        read: false,
      });
      return;
    }

    const diffs: FieldChangeDiff[] = [];
    if (prev.status !== next.status) {
      diffs.push({ field: 'สถานะ', from: prev.status || '-', to: next.status || '-' });
    }
    if (prev.price !== next.price) {
      diffs.push({
        field: 'ราคา',
        from: `${prev.price.toLocaleString()} ฿`,
        to: `${next.price.toLocaleString()} ฿`,
      });
    }
    if (
      prev.latitude !== next.latitude ||
      prev.longitude !== next.longitude
    ) {
      diffs.push({
        field: 'พิกัด',
        from: formatLatLngString(prev.latitude, prev.longitude) || 'ยังไม่ระบุ',
        to: formatLatLngString(next.latitude, next.longitude) || 'ยังไม่ระบุ',
      });
    }
    if (prev.fullName !== next.fullName) {
      diffs.push({ field: 'ชื่อ-สกุล', from: prev.fullName || '-', to: next.fullName || '-' });
    }
    if (prev.phone !== next.phone) {
      diffs.push({ field: 'เบอร์โทร', from: prev.phone || '-', to: next.phone || '-' });
    }
    if (prev.locationSummary !== next.locationSummary || prev.moo !== next.moo) {
      diffs.push({
        field: 'ที่อยู่',
        from: `ม.${prev.moo || '-'} ${prev.locationSummary || ''}`.trim(),
        to: `ม.${next.moo || '-'} ${next.locationSummary || ''}`.trim(),
      });
    }

    if (diffs.length > 0) {
      const firstDiff = diffs[0];
      events.push({
        id: `chg-${now}-${next.uid}-upd`,
        timestamp: now,
        type: 'updated',
        recordUid: next.uid,
        rqNumber: next.rqNumber,
        fullName: next.fullName || 'ไม่ระบุชื่อ',
        status: next.status,
        latitude: next.latitude,
        longitude: next.longitude,
        summary: `อัปเดตข้อมูล ${next.fullName || next.rqNumber}: ${firstDiff.field} (${firstDiff.from} → ${firstDiff.to})`,
        diffs,
        read: false,
      });
    }
  });

  // Deleted
  prevRecords.forEach((prev) => {
    if (!nextByUid[prev.uid]) {
      events.push({
        id: `chg-${now}-${prev.uid}-del`,
        timestamp: now,
        type: 'deleted',
        recordUid: prev.uid,
        rqNumber: prev.rqNumber,
        fullName: prev.fullName || 'ไม่ระบุชื่อ',
        status: prev.status,
        latitude: prev.latitude,
        longitude: prev.longitude,
        summary: `ลบคำขอ: ${prev.fullName || prev.rqNumber || `แถวที่ ${prev.rowIndex}`}`,
        diffs: [],
        read: false,
      });
    }
  });

  return events;
}
