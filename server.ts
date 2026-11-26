import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

interface OverlayRecordPayload {
  rqNumber: string;
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
  housePhotoUrl?: string;
}

interface OverlayAddition extends OverlayRecordPayload {
  uid: string;
  rowIndex: number;
  createdAt: number;
  updatedAt: number;
}

interface OverlayUpdate extends OverlayRecordPayload {
  uid: string;
  updatedAt: number;
}

interface SheetOverlay {
  updates: Record<string, OverlayUpdate>;
  additions: OverlayAddition[];
  deletions: string[];
  updatedAt: number;
}

type OverlayDatabase = Record<string, SheetOverlay>;

interface SharedSheetConfig {
  spreadsheetId?: string;
  sheetName?: string;
  pollIntervalMs?: number;
  appsScriptUrl?: string;
  driveFolderId?: string;
}

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const PORT = Number(process.env.PORT) || 3000;
const LEGACY_SPREADSHEET_ID = '17bZyj009jyxtjWb8DsZCXkmd4DQO0UAzHPEVyvWZ8Ns';
const DEFAULT_SPREADSHEET_ID = '1iBqlVp4jXeI254idzjvtSltaX7BJ-a40uy-n3XwnAsg';
const LEGACY_DRIVE_FOLDER_ID = '1uE-I15oyqiqZb_wsuGQ5TfJXONZY_uY3';
const DEFAULT_DRIVE_FOLDER_ID = '1JHld17nuqe0xkd-cd-V8ymR_KofBL-F1';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'sheet-overlay.json');
const CONFIG_FILE = path.join(DATA_DIR, 'sheet-config.json');
const BATCHES_FILE = path.join(DATA_DIR, 'completed-batches.json');

function normalizeSharedConfig(cfg: SharedSheetConfig): SharedSheetConfig {
  const rawSheetId = (cfg.spreadsheetId || '').trim();
  const isLegacySheet = rawSheetId === LEGACY_SPREADSHEET_ID;
  const rawFolderId = (cfg.driveFolderId || '').trim();
  const isLegacyFolder = rawFolderId === LEGACY_DRIVE_FOLDER_ID;
  return {
    ...cfg,
    spreadsheetId: !rawSheetId || isLegacySheet ? DEFAULT_SPREADSHEET_ID : rawSheetId,
    sheetName: isLegacySheet ? '' : cfg.sheetName,
    driveFolderId: !rawFolderId || isLegacyFolder ? DEFAULT_DRIVE_FOLDER_ID : rawFolderId,
  };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function emptyOverlay(): SheetOverlay {
  return {
    updates: {},
    additions: [],
    deletions: [],
    updatedAt: Date.now(),
  };
}

function loadJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as T;
    }
  } catch (err) {
    console.warn(`Could not read ${filePath}, using fallback:`, err);
  }
  return fallback;
}

function saveJsonFile(filePath: string, data: unknown): void {
  try {
    ensureDataDir();
    const tmpFile = `${filePath}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    console.error(`Failed to persist ${filePath}:`, err);
  }
}

const db: OverlayDatabase = loadJsonFile<OverlayDatabase>(DATA_FILE, {});
if (db[LEGACY_SPREADSHEET_ID] && !db[DEFAULT_SPREADSHEET_ID]) {
  db[DEFAULT_SPREADSHEET_ID] = db[LEGACY_SPREADSHEET_ID];
  delete db[LEGACY_SPREADSHEET_ID];
  saveJsonFile(DATA_FILE, db);
}
let sharedConfig: SharedSheetConfig = normalizeSharedConfig(
  loadJsonFile<SharedSheetConfig>(CONFIG_FILE, {})
);
const batchesDb: Record<string, any[]> = loadJsonFile<Record<string, any[]>>(BATCHES_FILE, {});

function getSheetOverlay(spreadsheetId: string): SheetOverlay {
  const key = (spreadsheetId || 'default').trim() || 'default';
  if (!db[key]) {
    db[key] = emptyOverlay();
  }
  return db[key];
}

function parseServiceAccountFromEnv(): ServiceAccountCredentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.client_email && parsed?.private_key) {
      return parsed as ServiceAccountCredentials;
    }
  } catch {
    console.warn('Invalid GOOGLE_SERVICE_ACCOUNT_JSON format');
  }
  return null;
}

let cachedSaToken: { token: string; expiresAt: number } | null = null;

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getServiceAccountAccessToken(
  sa: ServiceAccountCredentials
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedSaToken && cachedSaToken.expiresAt - 60 > nowSec) {
    return cachedSaToken.token;
  }

  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
      aud: tokenUri,
      exp: nowSec + 3600,
      iat: nowSec,
    })
  );

  const unsignedJwt = `${header}.${claimSet}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  signer.end();
  const signature = base64UrlEncode(signer.sign(sa.private_key));
  const jwt = `${unsignedJwt}.${signature}`;

  const tokenRes = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Service Account auth failed: HTTP ${tokenRes.status} ${errText}`);
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokenJson.access_token) {
    throw new Error('Service Account did not return an access_token');
  }

  cachedSaToken = {
    token: tokenJson.access_token,
    expiresAt: nowSec + (tokenJson.expires_in || 3600),
  };
  return cachedSaToken.token;
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

async function resolveSheetMeta(
  spreadsheetId: string,
  accessToken: string,
  preferredSheetName?: string
): Promise<{ sheetTitle: string; sheetId: number }> {
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=sheets.properties(sheetId,title)`;
  const res = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  const tabs = data.sheets || [];
  const matched =
    tabs.find((t) => t.properties?.title === preferredSheetName) || tabs[0];
  if (!matched?.properties?.title || matched.properties.sheetId === undefined) {
    throw new Error('ไม่พบแผ่นงานในไฟล์ Google Sheets');
  }
  return {
    sheetTitle: matched.properties.title,
    sheetId: matched.properties.sheetId,
  };
}

function isHtmlLike(text: string): boolean {
  const trimmed = (text || '').trim().toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<script')
  );
}

interface AdminAccountRecord {
  u: string;
  salt: string;
  hash: string;
  canManageSheetConfig: boolean;
}

const ADMIN_ACCOUNTS: AdminAccountRecord[] = [
  {
    u: 'Admin',
    salt: '0282a822f630c683d329a1c39cc86486',
    hash: '0dd3b135b43e5e1135e1aadab02a4ca95261fe7ba9e176f06ac251ae843a66169e71e85bf0d6f8de08f5c552317242486366777a050d4bd8fa46ba7ca9b1438e',
    canManageSheetConfig: true,
  },
  {
    u: '13367',
    salt: '23c523b8c0976685c95b1eeaf32628fa',
    hash: '706409d1c1da4f3a678d8351a1bb3bd4211168b00d8cc79d7cb69753ae720e42532f638d1fa5be34ab2d1e47516f26cd01243411ba12dfb2f6e8f4bf3e98ee54',
    canManageSheetConfig: true,
  },
  {
    u: '16479',
    salt: '2abc72cb1516e1d2884564fce2dc0a8e',
    hash: '7efaaf132df64415ecaf1b05c77343992bcf5c732800a8dc17d29a71e71f6ec243fbc2b6ec723df9e9c66418760195f43ae80a76473f223ecd40b6f8e6f6d9f0',
    canManageSheetConfig: true,
  },
  {
    u: '15563',
    salt: '38a861a34df70e0d1039245e7b746b79',
    hash: '7829a85f5faa5f8e862879c0533a48fa5a62d36b8b5a634561ca61e81559a06f901b4c1b1cb711d08e7851d78f7d34b95f7d1e206bec7683cafb52343f76f332',
    canManageSheetConfig: true,
  },
  {
    u: '14356',
    salt: '0bb6c99d461869ea2278059217e95185',
    hash: 'fa08c5827f1a38fadf43eecb711d853d970e1572fb31e7c9704b9a1724eaf0a1634354d0e45a05eee3840f58f8b42d8ae811a81f75a258c376055e798c8a83f6',
    canManageSheetConfig: true,
  },
  {
    u: '15687',
    salt: '45025c66ee18bb6c1637804e017c3079',
    hash: 'c68dd90083a96a519284db03d1d1f471feab552610e10a0b720c24e93177e4985dd449107d1e4dfc7eeb18194a1a12fb26a8dfde457c87047d34c3ceb0dfb7ca',
    canManageSheetConfig: true,
  },
  {
    u: '17191',
    salt: 'fcf30bb9d4fc29cdf89846c0aced760d',
    hash: '25c74b08c12101f97fb0e0677e05420da5bc7a71f7efe322cacb722046ed1348a96f4aff279a24f991debd3493dc4e8d838ce94929786d494ec394a0a241eca9',
    canManageSheetConfig: true,
  },
  {
    u: '15676',
    salt: '282253cbdeff37c337bd4184bf4ec150',
    hash: 'cf91b5d1ca58aacb1fdc4f9492de8eab8dc7d4ad0963fd1dc91f1069febfda34eff5105aeb8f46532bf9b671807e4f7e3d2165227d55f330d603f6f8dfc4fcc9',
    canManageSheetConfig: true,
  },
];

const ADMIN_SESSION_SECRET =
  (process.env.ADMIN_SESSION_SECRET || '').trim() ||
  crypto.randomBytes(32).toString('hex');

const ADMIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function verifyScryptPassword(
  password: string,
  salt: string,
  expectedHashHex: string
): boolean {
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHashHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function verifyPlainOverride(input: string, envValue: string): boolean {
  const a = Buffer.from(input, 'utf8');
  const b = Buffer.from(envValue, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function issueAdminToken(username: string, canManageSheetConfig: boolean): string {
  const payload = base64UrlEncode(
    JSON.stringify({
      u: username,
      master: canManageSheetConfig,
      exp: Date.now() + ADMIN_TOKEN_TTL_MS,
    })
  );
  const sig = base64UrlEncode(
    crypto
      .createHmac('sha256', ADMIN_SESSION_SECRET)
      .update(payload)
      .digest()
  );
  return `${payload}.${sig}`;
}

function verifyAdminSession(
  req: express.Request
): { username: string; canManageSheetConfig: boolean } | null {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;

  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!payload || !sig) return null;

  const expectedSig = base64UrlEncode(
    crypto
      .createHmac('sha256', ADMIN_SESSION_SECRET)
      .update(payload)
      .digest()
  );
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as { u?: string; master?: boolean; exp?: number };
    if (!decoded?.u || typeof decoded.exp !== 'number' || decoded.exp < Date.now()) {
      return null;
    }
    return {
      username: decoded.u,
      canManageSheetConfig: Boolean(decoded.master),
    };
  } catch {
    return null;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.post('/api/admin/login', (req, res) => {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password.trim() : '';

    if (!username || !password) {
      res.status(400).json({
        ok: false,
        message: 'กรุณาระบุชื่อผู้ใช้และรหัสผ่าน',
      });
      return;
    }

    const account = ADMIN_ACCOUNTS.find(
      (acc) => acc.u.toLowerCase() === username.toLowerCase()
    );
    if (!account) {
      res.status(401).json({
        ok: false,
        message: 'ชื่อผู้ใช้หรือรหัสผ่านผู้ดูแลระบบไม่ถูกต้อง',
      });
      return;
    }

    const masterEnvOverride =
      account.u === '15563' ? (process.env.ADMIN_15563_PASSWORD || '').trim() : '';
    const isPasswordValid = masterEnvOverride
      ? verifyPlainOverride(password, masterEnvOverride)
      : verifyScryptPassword(password, account.salt, account.hash);

    if (!isPasswordValid) {
      res.status(401).json({
        ok: false,
        message: 'ชื่อผู้ใช้หรือรหัสผ่านผู้ดูแลระบบไม่ถูกต้อง',
      });
      return;
    }

    const canManageSheetConfig = account.canManageSheetConfig;
    const token = issueAdminToken(account.u, canManageSheetConfig);
    res.json({
      ok: true,
      token,
      username: account.u,
      canManageSheetConfig,
    });
  });

  app.get('/api/admin/session', (req, res) => {
    const session = verifyAdminSession(req);
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      username: session.username,
      canManageSheetConfig: session.canManageSheetConfig,
    });
  });

  // Shared configuration (so Apps Script URL persists across devices/reloads)
  app.get('/api/config', (_req, res) => {
    const envScriptUrl = (process.env.APPS_SCRIPT_URL || '').trim();
    const sa = parseServiceAccountFromEnv();
    const googleMapsApiKey = (
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      ''
    ).trim();
    res.json({
      ...sharedConfig,
      appsScriptUrl: sharedConfig.appsScriptUrl || envScriptUrl || '',
      serviceAccountConfigured: Boolean(sa),
      serviceAccountEmail: sa?.client_email || null,
      googleMapsApiKey,
    });
  });

  app.put('/api/config', (req, res) => {
    const session = verifyAdminSession(req);
    if (!session) {
      res.status(401).json({
        ok: false,
        message: 'กรุณาเข้าสู่ระบบผู้ดูแลระบบก่อนบันทึกการตั้งค่าชีท',
      });
      return;
    }
    if (!session.canManageSheetConfig) {
      res.status(403).json({
        ok: false,
        message: 'บัญชีนี้ไม่มีสิทธิ์แก้ไขการตั้งค่าชีท',
      });
      return;
    }

    const body = req.body || {};
    sharedConfig = normalizeSharedConfig({
      spreadsheetId:
        typeof body.spreadsheetId === 'string'
          ? body.spreadsheetId.trim()
          : sharedConfig.spreadsheetId,
      sheetName:
        typeof body.sheetName === 'string'
          ? body.sheetName.trim()
          : sharedConfig.sheetName,
      pollIntervalMs:
        typeof body.pollIntervalMs === 'number'
          ? body.pollIntervalMs
          : sharedConfig.pollIntervalMs,
      appsScriptUrl:
        typeof body.appsScriptUrl === 'string'
          ? body.appsScriptUrl.trim()
          : sharedConfig.appsScriptUrl,
      driveFolderId:
        typeof body.driveFolderId === 'string'
          ? body.driveFolderId.trim()
          : sharedConfig.driveFolderId,
    });
    saveJsonFile(CONFIG_FILE, sharedConfig);
    res.json({ ok: true, config: sharedConfig });
  });

  // Server-side Service Account write endpoint (zero user login when configured)
  app.post('/api/sheets/service-write', async (req, res) => {
    const sa = parseServiceAccountFromEnv();
    if (!sa) {
      res.status(400).json({
        success: false,
        message: 'ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_JSON บนเซิร์ฟเวอร์',
      });
      return;
    }

    const { action, spreadsheetId, sheetName, rowIndex, rowValues } = req.body || {};
    if (!spreadsheetId || !action) {
      res.status(400).json({ success: false, message: 'ข้อมูลคำขอไม่ครบถ้วน' });
      return;
    }

    try {
      const token = await getServiceAccountAccessToken(sa);
      const { sheetTitle, sheetId } = await resolveSheetMeta(
        spreadsheetId,
        token,
        sheetName
      );

      if (action === 'add') {
        const endCol = columnLetter(Math.max((rowValues?.length || 1) - 1, 0));
        const range = `'${sheetTitle.replace(/'/g, "''")}'!A:${endCol}`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId
        )}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
        const up = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ majorDimension: 'ROWS', values: [rowValues] }),
        });
        if (!up.ok) {
          const err = await up.json().catch(() => ({}));
          throw new Error(err?.error?.message || `HTTP ${up.status}`);
        }
        res.json({ success: true });
        return;
      }

      if (action === 'update') {
        const endCol = columnLetter(Math.max((rowValues?.length || 1) - 1, 0));
        const range = `'${sheetTitle.replace(/'/g, "''")}'!A${rowIndex}:${endCol}${rowIndex}`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId
        )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
        const up = await fetch(url, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range,
            majorDimension: 'ROWS',
            values: [rowValues],
          }),
        });
        if (!up.ok) {
          const err = await up.json().catch(() => ({}));
          throw new Error(err?.error?.message || `HTTP ${up.status}`);
        }
        res.json({ success: true });
        return;
      }

      if (action === 'delete') {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId
        )}:batchUpdate`;
        const up = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: Number(rowIndex) - 1,
                    endIndex: Number(rowIndex),
                  },
                },
              },
            ],
          }),
        });
        if (!up.ok) {
          const err = await up.json().catch(() => ({}));
          throw new Error(err?.error?.message || `HTTP ${up.status}`);
        }
        res.json({ success: true });
        return;
      }

      res.status(400).json({ success: false, message: 'ไม่รู้จัก action ที่ระบุ' });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: err?.message || 'Service Account เขียนข้อมูลเข้า Google Sheets ไม่สำเร็จ',
      });
    }
  });

  // Overlay routes (web-side persistence fallback when no Google Sheet write bridge is active)
  app.get('/api/overlay/:spreadsheetId', (req, res) => {
    const overlay = getSheetOverlay(req.params.spreadsheetId);
    res.json(overlay);
  });

  app.post('/api/overlay/:spreadsheetId/add', (req, res) => {
    const spreadsheetId = req.params.spreadsheetId;
    const overlay = getSheetOverlay(spreadsheetId);
    const body = req.body || {};
    const now = Date.now();
    const uid =
      typeof body.uid === 'string' && body.uid.trim()
        ? body.uid.trim()
        : `local:${now}:${Math.random().toString(36).slice(2, 8)}`;

    const addition: OverlayAddition = {
      uid,
      rowIndex: -1 * (overlay.additions.length + 1),
      rqNumber: String(body.rqNumber ?? ''),
      requestDate: String(body.requestDate ?? ''),
      fullName: String(body.fullName ?? ''),
      houseNo: String(body.houseNo ?? ''),
      moo: String(body.moo ?? ''),
      subdistrict: String(body.subdistrict ?? ''),
      district: String(body.district ?? ''),
      province: String(body.province ?? ''),
      locationSummary: String(body.locationSummary ?? ''),
      phone: String(body.phone ?? ''),
      price: Number(body.price) || 0,
      status: String(body.status ?? 'รอตรวจสอบ'),
      latitude: typeof body.latitude === 'number' ? body.latitude : null,
      longitude: typeof body.longitude === 'number' ? body.longitude : null,
      note: String(body.note ?? ''),
      housePhotoUrl: String(body.housePhotoUrl ?? ''),
      createdAt: now,
      updatedAt: now,
    };

    overlay.additions.push(addition);
    overlay.updatedAt = now;
    saveJsonFile(DATA_FILE, db);
    res.json({ overlay, addition });
  });

  app.put('/api/overlay/:spreadsheetId/update', (req, res) => {
    const spreadsheetId = req.params.spreadsheetId;
    const overlay = getSheetOverlay(spreadsheetId);
    const body = req.body || {};
    const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
    if (!uid) {
      res.status(400).json({ error: 'Missing record uid' });
      return;
    }

    const now = Date.now();
    const fields: OverlayRecordPayload = {
      rqNumber: String(body.rqNumber ?? ''),
      requestDate: String(body.requestDate ?? ''),
      fullName: String(body.fullName ?? ''),
      houseNo: String(body.houseNo ?? ''),
      moo: String(body.moo ?? ''),
      subdistrict: String(body.subdistrict ?? ''),
      district: String(body.district ?? ''),
      province: String(body.province ?? ''),
      locationSummary: String(body.locationSummary ?? ''),
      phone: String(body.phone ?? ''),
      price: Number(body.price) || 0,
      status: String(body.status ?? 'รอตรวจสอบ'),
      latitude: typeof body.latitude === 'number' ? body.latitude : null,
      longitude: typeof body.longitude === 'number' ? body.longitude : null,
      note: String(body.note ?? ''),
      housePhotoUrl: String(body.housePhotoUrl ?? ''),
    };

    const localIdx = overlay.additions.findIndex((item) => item.uid === uid);
    if (localIdx !== -1) {
      overlay.additions[localIdx] = {
        ...overlay.additions[localIdx],
        ...fields,
        updatedAt: now,
      };
    } else {
      overlay.updates[uid] = {
        uid,
        ...fields,
        updatedAt: now,
      };
      overlay.deletions = overlay.deletions.filter((d) => d !== uid);
    }

    overlay.updatedAt = now;
    saveJsonFile(DATA_FILE, db);
    res.json({ overlay });
  });

  app.delete('/api/overlay/:spreadsheetId/delete', (req, res) => {
    const spreadsheetId = req.params.spreadsheetId;
    const overlay = getSheetOverlay(spreadsheetId);
    const body = req.body || {};
    const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
    if (!uid) {
      res.status(400).json({ error: 'Missing record uid' });
      return;
    }

    const prevCount = overlay.additions.length;
    overlay.additions = overlay.additions.filter((item) => item.uid !== uid);
    if (overlay.additions.length === prevCount) {
      if (!overlay.deletions.includes(uid)) {
        overlay.deletions.push(uid);
      }
      delete overlay.updates[uid];
    }

    overlay.updatedAt = Date.now();
    saveJsonFile(DATA_FILE, db);
    res.json({ overlay });
  });

  app.delete('/api/overlay/:spreadsheetId/reset', (req, res) => {
    const key = (req.params.spreadsheetId || 'default').trim() || 'default';
    db[key] = emptyOverlay();
    saveJsonFile(DATA_FILE, db);
    res.json({ overlay: db[key] });
  });

  // Persistent storage for Admin "ชุดติดตั้งเสร็จสิ้น" batches
  app.get('/api/completed-batches/:spreadsheetId', (req, res) => {
    const key = (req.params.spreadsheetId || 'default').trim() || 'default';
    const list = Array.isArray(batchesDb[key]) ? batchesDb[key] : [];
    res.json({ batches: list });
  });

  app.post('/api/completed-batches/:spreadsheetId', (req, res) => {
    const key = (req.params.spreadsheetId || 'default').trim() || 'default';
    const body = req.body || {};
    const records = Array.isArray(body.records) ? body.records : [];
    if (records.length === 0) {
      res.status(400).json({ error: 'กรุณาเลือกรายการอย่างน้อย 1 รายการ' });
      return;
    }

    const now = Date.now();
    const id =
      typeof body.id === 'string' && body.id.trim()
        ? body.id.trim()
        : `batch_${now}_${Math.random().toString(36).slice(2, 7)}`;

    const totalAmount = records.reduce(
      (sum: number, r: any) => sum + (Number(r?.price) || 0),
      0
    );
    const mappedCount = records.filter(
      (r: any) =>
        typeof r?.latitude === 'number' &&
        Number.isFinite(r.latitude) &&
        typeof r?.longitude === 'number' &&
        Number.isFinite(r.longitude)
    ).length;

    const batch = {
      id,
      spreadsheetId: key,
      batchCode: String(body.batchCode || 'มท55120-183/'),
      title: String(body.title || 'ชุดงานติดตั้งมาตรวัดน้ำเสร็จสิ้น'),
      completedDate: String(body.completedDate || new Date(now).toISOString().slice(0, 10)),
      inspectorName: String(body.inspectorName || ''),
      note: String(body.note || ''),
      exportFormats: Array.isArray(body.exportFormats) ? body.exportFormats : ['excel', 'pdf'],
      statusUpdatedInSheet: Boolean(body.statusUpdatedInSheet),
      includeTax: body.includeTax !== undefined ? Boolean(body.includeTax) : true,
      memoSigners:
        body.memoSigners && typeof body.memoSigners === 'object'
          ? body.memoSigners
          : undefined,
      recordCount: records.length,
      totalAmount,
      mappedCount,
      records,
      createdAt: now,
    };

    const existing = Array.isArray(batchesDb[key]) ? batchesDb[key] : [];
    batchesDb[key] = [batch, ...existing.filter((item) => item.id !== id)];
    saveJsonFile(BATCHES_FILE, batchesDb);
    res.json({ batch, batches: batchesDb[key] });
  });

  app.delete('/api/completed-batches/:spreadsheetId/:batchId', (req, res) => {
    const key = (req.params.spreadsheetId || 'default').trim() || 'default';
    const batchId = (req.params.batchId || '').trim();
    const existing = Array.isArray(batchesDb[key]) ? batchesDb[key] : [];
    batchesDb[key] = existing.filter((item) => item.id !== batchId);
    saveJsonFile(BATCHES_FILE, batchesDb);
    res.json({ batches: batchesDb[key] });
  });

  function validateAppsScriptWebAppUrl(rawUrl: unknown): { ok: true; url: string } | { ok: false; message: string } {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return { ok: false, message: 'กรุณาวางลิงก์ Google Apps Script Web App ก่อน' };
    }
    const clean = rawUrl.trim();
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
          message: 'ลิงก์นี้เป็นลิงก์ทดสอบ (/dev) กรุณาใช้ลิงก์ที่ลงท้ายด้วย /exec จากเมนู Deploy > Web app',
        };
      }
      if (!parsed.pathname.endsWith('/exec')) {
        return {
          ok: false,
          message: 'ลิงก์ Apps Script ไม่สมบูรณ์ กรุณาคัดลอก URL มาครบทั้งเส้นที่ลงท้ายด้วย /exec',
        };
      }
      return { ok: true, url: clean };
    } catch {
      return {
        ok: false,
        message: 'รูปแบบลิงก์ Apps Script ไม่ถูกต้อง',
      };
    }
  }

  // Test Apps Script Web App connection (via GET or POST ping)
  app.post('/api/apps-script/test', async (req, res) => {
    const check = validateAppsScriptWebAppUrl(req.body?.appsScriptUrl);
    if (check.ok === false) {
      res.status(400).json({
        success: false,
        message: check.message,
      });
      return;
    }

    try {
      const targetUrl = new URL(check.url);
      targetUrl.searchParams.set('action', 'ping');
      const upstream = await fetch(targetUrl.toString(), {
        method: 'GET',
        redirect: 'follow',
      });
      const text = await upstream.text();
      if (upstream.url.includes('accounts.google.com')) {
        res.status(403).json({
          success: false,
          message:
            'Apps Script ยังไม่ได้เปิดสิทธิ์ Who has access เป็น "Anyone" (ทุกคน) กรุณา Deploy ใหม่และเลือก Anyone',
        });
        return;
      }
      if (upstream.status === 404) {
        res.status(404).json({
          success: false,
          message:
            'ไม่พบ Apps Script Web App ที่ลิงก์นี้ (HTTP 404) กรุณาตรวจสอบว่า Deploy > Web app แล้ว และคัดลอก URL ครบทั้งเส้นถึง /exec',
        });
        return;
      }
      if (!upstream.ok) {
        res.status(upstream.status).json({
          success: false,
          message: `Apps Script ตอบกลับ HTTP ${upstream.status}`,
        });
        return;
      }
      if (isHtmlLike(text)) {
        res.status(403).json({
          success: false,
          message:
            'Apps Script ตอบกลับเป็นหน้าเว็บ HTML แทน JSON (กรุณาตรวจสอบว่าวางโค้ด Code.gs ที่มี doGet และตั้งค่า Who has access เป็น "Anyone")',
        });
        return;
      }
      try {
        const parsed = JSON.parse(text);
        res.json({ success: true, ...parsed });
      } catch {
        res.json({ success: true, message: 'เชื่อมต่อ Apps Script สำเร็จ' });
      }
    } catch (err: any) {
      res.status(502).json({
        success: false,
        message: err?.message || 'ไม่สามารถเชื่อมต่อ Apps Script URL ได้',
      });
    }
  });

  // Proxy for Google Apps Script Web App writes (strictly verifies JSON response, never silently fakes success on HTML login pages)
  app.post('/api/apps-script', async (req, res) => {
    const check = validateAppsScriptWebAppUrl(req.body?.appsScriptUrl);
    const { payload } = req.body || {};
    if (check.ok === false) {
      res.status(400).json({
        success: false,
        message: check.message,
      });
      return;
    }

    try {
      const upstream = await fetch(check.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload || {}),
        redirect: 'follow',
      });
      const text = await upstream.text();

      if (upstream.url.includes('accounts.google.com')) {
        res.status(403).json({
          success: false,
          message:
            'Apps Script ปฏิเสธการเข้าถึง (ยังไม่ได้เลือก Who has access เป็น "Anyone") กรุณาตรวจสอบการ Deploy ใน Google Sheet',
        });
        return;
      }

      if (upstream.status === 404) {
        res.status(404).json({
          success: false,
          message:
            'ไม่พบลิงก์ Apps Script Web App นี้ (HTTP 404) กรุณาตรวจสอบว่า Deploy > Web app แล้ว และ URL ลงท้ายด้วย /exec',
        });
        return;
      }

      if (!upstream.ok) {
        res.status(upstream.status).json({
          success: false,
          message: `Apps Script HTTP ${upstream.status}`,
        });
        return;
      }

      if (isHtmlLike(text)) {
        res.status(403).json({
          success: false,
          message:
            'Apps Script ตอบกลับเป็นหน้าเว็บ HTML แทน JSON (กรุณาตั้งค่า Who has access เป็น "Anyone" และ Deploy ใหม่)',
        });
        return;
      }

      const parsed = JSON.parse(text);
      if (parsed && parsed.success === false) {
        res.status(400).json({
          success: false,
          message: parsed.message || 'Apps Script ปฏิเสธการบันทึกข้อมูล',
        });
        return;
      }
      res.json(parsed);
    } catch (err: any) {
      res.status(502).json({
        success: false,
        message:
          err?.message || 'ไม่สามารถส่งข้อมูลเข้า Apps Script / Google Sheets ได้',
      });
    }
  });

  const httpServer = http.createServer(app);
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
