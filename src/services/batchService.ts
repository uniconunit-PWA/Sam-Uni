import { CompletedBatch, CompletedBatchRecord, MeterRequest } from '../types/meter';
import { isInsideGoogleAppsScript } from './sheetsService';
import {
  extractDriveFolderId,
  readJsonFileFromDriveFolder,
  upsertJsonFileInDriveFolder,
} from './driveService';

const DRIVE_BATCHES_FILENAME = 'completed-batches.json';
const LOCAL_STORAGE_KEY_PREFIX = 'water_meter_completed_batches_v1_';

function loadLocalBatches(spreadsheetId: string): CompletedBatch[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${spreadsheetId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalBatches(spreadsheetId: string, batches: CompletedBatch[]): void {
  try {
    localStorage.setItem(
      `${LOCAL_STORAGE_KEY_PREFIX}${spreadsheetId}`,
      JSON.stringify(batches)
    );
  } catch {
    // ignore quota errors
  }
}

export interface BatchRecordEditableFields {
  jobNumber?: string;
  waterUserNo?: string;
  meterNumber?: string;
  meterSize?: string;
  houseNo?: string;
  price?: string;
  note?: string;
}

export function isCompletedMeterStatus(status?: string): boolean {
  const st = (status || '').trim();
  return st === 'ติดตั้งเสร็จสิ้น' || st === 'เสร็จสิ้น';
}

export function buildBatchedRecordKeySet(batches: CompletedBatch[]): Set<string> {
  const keys = new Set<string>();
  for (const batch of batches) {
    if (!Array.isArray(batch.records)) continue;
    for (const r of batch.records) {
      const uid = (r.uid || '').trim();
      if (uid && !uid.startsWith('arc:')) keys.add(`uid:${uid}`);
      const rq = (r.rqNumber || '').trim();
      if (rq) keys.add(`rq:${rq}`);
      const fullName = (r.fullName || '').trim();
      const phone = (r.phone || '').trim();
      const reqDate = (r.requestDate || '').trim();
      if (fullName) {
        keys.add(`sig:${fullName}|${phone}|${reqDate}`);
      }
    }
  }
  return keys;
}

export function isRecordAlreadyBatched(
  rec: Pick<MeterRequest, 'uid' | 'rqNumber' | 'fullName' | 'phone' | 'requestDate'>,
  batchedKeySet: Set<string>
): boolean {
  const uid = (rec.uid || '').trim();
  if (uid && batchedKeySet.has(`uid:${uid}`)) return true;
  const rq = (rec.rqNumber || '').trim();
  if (rq && batchedKeySet.has(`rq:${rq}`)) return true;
  const fullName = (rec.fullName || '').trim();
  const phone = (rec.phone || '').trim();
  const reqDate = (rec.requestDate || '').trim();
  if (!rq && fullName && batchedKeySet.has(`sig:${fullName}|${phone}|${reqDate}`)) {
    return true;
  }
  return false;
}

export function getEligibleCompletedUnbatchedRecords(
  records: MeterRequest[],
  batches: CompletedBatch[]
): {
  eligible: MeterRequest[];
  alreadyBatchedCount: number;
  batchedKeySet: Set<string>;
} {
  const batchedKeySet = buildBatchedRecordKeySet(batches);
  const eligible: MeterRequest[] = [];
  let alreadyBatchedCount = 0;
  for (const r of records) {
    if (!isCompletedMeterStatus(r.status)) continue;
    if (isRecordAlreadyBatched(r, batchedKeySet)) {
      alreadyBatchedCount += 1;
    } else {
      eligible.push(r);
    }
  }
  return { eligible, alreadyBatchedCount, batchedKeySet };
}

export function toBatchRecords(
  records: MeterRequest[],
  markCompleted: boolean,
  overridesByUid?: Record<string, BatchRecordEditableFields>
): CompletedBatchRecord[] {
  return records.map((r) => {
    const ov = overridesByUid?.[r.uid];
    const rawJob = r.raw?.['เลขที่ งาน'] || r.raw?.['เลขที่งาน'] || r.rqNumber || '';
    const rawUserNo = r.raw?.['เลขที่ผู้ใช้น้ำ'] || r.raw?.['เลขที่ผู้ใช้น้ำประปา'] || '';
    const rawMeterNo = r.raw?.['หมายเลขมาตร'] || r.raw?.['เลขมาตร'] || '';
    const rawMeterSize = r.raw?.['ขนาดมาตร'] || r.raw?.['ขนาด'] || '';
    const parsedOverridePrice =
      ov?.price !== undefined ? Number.parseFloat(String(ov.price).replace(/,/g, '')) : NaN;
    const finalPrice =
      ov?.price !== undefined
        ? Number.isFinite(parsedOverridePrice)
          ? parsedOverridePrice
          : 0
        : Number.isFinite(r.price)
          ? r.price
          : 0;
    return {
      uid: r.uid,
      rowIndex: r.rowIndex,
      rqNumber: r.rqNumber,
      jobNumber: ov?.jobNumber !== undefined ? ov.jobNumber : rawJob,
      waterUserNo: ov?.waterUserNo !== undefined ? ov.waterUserNo : rawUserNo,
      meterNumber: ov?.meterNumber !== undefined ? ov.meterNumber : rawMeterNo,
      meterSize: ov?.meterSize !== undefined ? ov.meterSize : rawMeterSize,
      requestDate: r.requestDate,
      fullName: r.fullName,
      houseNo: ov?.houseNo !== undefined ? ov.houseNo : r.houseNo,
      moo: r.moo,
      subdistrict: r.subdistrict,
      district: r.district,
      province: r.province,
      locationSummary: r.locationSummary,
      phone: r.phone,
      price: finalPrice,
      status: markCompleted ? 'ติดตั้งเสร็จสิ้น' : r.status || 'ติดตั้งเสร็จสิ้น',
      latitude: r.latitude,
      longitude: r.longitude,
      note: ov?.note !== undefined ? ov.note : r.note,
    };
  });
}

export async function fetchCompletedBatches(
  spreadsheetId: string,
  options?: { accessToken?: string | null; driveFolderId?: string }
): Promise<CompletedBatch[]> {
  const key = (spreadsheetId || 'default').trim() || 'default';
  const folderId = extractDriveFolderId(options?.driveFolderId);

  if (options?.accessToken) {
    try {
      const driveData = await readJsonFileFromDriveFolder<CompletedBatch[] | { batches?: CompletedBatch[] }>(
        options.accessToken,
        folderId,
        DRIVE_BATCHES_FILENAME
      );
      const driveBatches = Array.isArray(driveData)
        ? driveData
        : Array.isArray(driveData?.batches)
          ? driveData.batches
          : null;
      if (driveBatches) {
        saveLocalBatches(key, driveBatches);
        return driveBatches;
      }
    } catch {
      // fall through to Apps Script / server
    }
  }

  if (isInsideGoogleAppsScript()) {
    try {
      const res = await new Promise<any>((resolve, reject) => {
        (window as any).google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .getCompletedBatches();
      });
      if (Array.isArray(res?.batches)) {
        saveLocalBatches(key, res.batches);
        return res.batches;
      }
    } catch {
      // fallback to local
    }
  }

  try {
    const res = await fetch(`/api/completed-batches/${encodeURIComponent(key)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.batches)) {
        saveLocalBatches(key, data.batches);
        return data.batches;
      }
    }
  } catch {
    // fallback to localStorage
  }

  return loadLocalBatches(key);
}

export interface SaveBatchInput {
  spreadsheetId: string;
  batchCode: string;
  title: string;
  completedDate: string;
  inspectorName: string;
  note: string;
  exportFormats: Array<'excel' | 'pdf'>;
  statusUpdatedInSheet: boolean;
  includeTax?: boolean;
  memoSigners?: CompletedBatch['memoSigners'];
  records: CompletedBatchRecord[];
  appsScriptUrl?: string;
  accessToken?: string | null;
  driveFolderId?: string;
}

async function syncBatchesToDriveFolder(
  accessToken: string | null | undefined,
  driveFolderId: string | undefined,
  batches: CompletedBatch[]
): Promise<boolean> {
  if (!accessToken) return false;
  try {
    await upsertJsonFileInDriveFolder(
      accessToken,
      extractDriveFolderId(driveFolderId),
      DRIVE_BATCHES_FILENAME,
      batches
    );
    return true;
  } catch {
    return false;
  }
}

export async function saveCompletedBatch(
  input: SaveBatchInput
): Promise<{
  batch: CompletedBatch;
  batches: CompletedBatch[];
  syncedToSheetTab: boolean;
  syncedToDrive: boolean;
}> {
  const key = (input.spreadsheetId || 'default').trim() || 'default';
  const now = Date.now();
  const totalAmount = input.records.reduce((s, r) => s + (Number(r.price) || 0), 0);
  const mappedCount = input.records.filter(
    (r) => r.latitude !== null && r.longitude !== null
  ).length;

  const newBatch: CompletedBatch = {
    id: `batch_${now}_${Math.random().toString(36).slice(2, 7)}`,
    spreadsheetId: key,
    batchCode: input.batchCode,
    title: input.title,
    completedDate: input.completedDate,
    inspectorName: input.inspectorName,
    note: input.note,
    exportFormats: input.exportFormats,
    statusUpdatedInSheet: input.statusUpdatedInSheet,
    includeTax: input.includeTax ?? true,
    memoSigners: input.memoSigners,
    recordCount: input.records.length,
    totalAmount,
    mappedCount,
    records: input.records,
    createdAt: now,
  };

  let syncedToSheetTab = false;

  // 1. Sync archive to Google Sheet tab via Apps Script if available
  if (isInsideGoogleAppsScript()) {
    try {
      await new Promise<any>((resolve, reject) => {
        (window as any).google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .saveCompletedBatch(newBatch);
      });
      syncedToSheetTab = true;
    } catch {
      // ignore and continue saving locally/server
    }
  } else if (input.appsScriptUrl?.trim().startsWith('https://script.google.com/')) {
    const cleanUrl = input.appsScriptUrl.trim();
    const payload = { action: 'saveCompletedBatch', spreadsheetId: key, batch: newBatch };
    try {
      const res = await fetch('/api/apps-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appsScriptUrl: cleanUrl, payload }),
      });
      if (res.ok) {
        const parsed = await res.json();
        if (parsed?.success !== false) {
          syncedToSheetTab = true;
        }
      } else if (res.status === 404 || res.status === 405) {
        const directRes = await fetch(cleanUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          redirect: 'follow',
        });
        if (directRes.ok) {
          const parsed = await directRes.json().catch(() => null);
          if (parsed?.success !== false) syncedToSheetTab = true;
        }
      }
    } catch {
      // fallback to server storage
    }
  }

  // 2. Persist on Express server storage (data/completed-batches.json)
  let finalBatches: CompletedBatch[] | null = null;
  let savedBatch = newBatch;
  try {
    const res = await fetch(`/api/completed-batches/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newBatch),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.batches)) {
        finalBatches = data.batches;
        savedBatch = data.batch || newBatch;
      }
    }
  } catch {
    // fallback to localStorage
  }

  if (!finalBatches) {
    finalBatches = [newBatch, ...loadLocalBatches(key)];
  }
  saveLocalBatches(key, finalBatches);

  // 3. Persist directly into Google Drive folder (completed-batches.json)
  const syncedToDrive = await syncBatchesToDriveFolder(
    input.accessToken,
    input.driveFolderId,
    finalBatches
  );

  return {
    batch: savedBatch,
    batches: finalBatches,
    syncedToSheetTab,
    syncedToDrive,
  };
}

export async function updateCompletedBatch(
  updatedBatch: CompletedBatch,
  appsScriptUrl?: string,
  options?: { accessToken?: string | null; driveFolderId?: string }
): Promise<{
  batch: CompletedBatch;
  batches: CompletedBatch[];
  syncedToSheetTab: boolean;
  syncedToDrive: boolean;
}> {
  const key = (updatedBatch.spreadsheetId || 'default').trim() || 'default';
  let syncedToSheetTab = false;

  if (isInsideGoogleAppsScript()) {
    try {
      await new Promise<any>((resolve, reject) => {
        (window as any).google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .saveCompletedBatch(updatedBatch);
      });
      syncedToSheetTab = true;
    } catch {
      // ignore
    }
  } else if (appsScriptUrl?.trim().startsWith('https://script.google.com/')) {
    const cleanUrl = appsScriptUrl.trim();
    const payload = { action: 'saveCompletedBatch', spreadsheetId: key, batch: updatedBatch };
    try {
      const res = await fetch('/api/apps-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appsScriptUrl: cleanUrl, payload }),
      });
      if (res.ok) {
        const parsed = await res.json();
        if (parsed?.success !== false) {
          syncedToSheetTab = true;
        }
      } else if (res.status === 404 || res.status === 405) {
        const directRes = await fetch(cleanUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          redirect: 'follow',
        });
        if (directRes.ok) {
          const parsed = await directRes.json().catch(() => null);
          if (parsed?.success !== false) syncedToSheetTab = true;
        }
      }
    } catch {
      // ignore
    }
  }

  let finalBatches: CompletedBatch[] | null = null;
  let savedBatch = updatedBatch;
  try {
    const res = await fetch(`/api/completed-batches/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedBatch),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.batches)) {
        finalBatches = data.batches;
        savedBatch = data.batch || updatedBatch;
      }
    }
  } catch {
    // fallback
  }

  if (!finalBatches) {
    finalBatches = loadLocalBatches(key).map((b) =>
      b.id === updatedBatch.id ? updatedBatch : b
    );
  }
  saveLocalBatches(key, finalBatches);

  const syncedToDrive = await syncBatchesToDriveFolder(
    options?.accessToken,
    options?.driveFolderId,
    finalBatches
  );

  return {
    batch: savedBatch,
    batches: finalBatches,
    syncedToSheetTab,
    syncedToDrive,
  };
}

export async function deleteCompletedBatch(
  spreadsheetId: string,
  batchId: string,
  options?: {
    appsScriptUrl?: string;
    accessToken?: string | null;
    driveFolderId?: string;
  }
): Promise<CompletedBatch[]> {
  const key = (spreadsheetId || 'default').trim() || 'default';

  if (isInsideGoogleAppsScript()) {
    try {
      await new Promise<any>((resolve, reject) => {
        (window as any).google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .deleteCompletedBatch(batchId);
      });
    } catch {
      // ignore
    }
  } else if (options?.appsScriptUrl?.trim().startsWith('https://script.google.com/')) {
    const cleanUrl = options.appsScriptUrl.trim();
    const payload = { action: 'deleteCompletedBatch', spreadsheetId: key, batchId };
    try {
      await fetch('/api/apps-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appsScriptUrl: cleanUrl, payload }),
      });
    } catch {
      // ignore
    }
  }

  let finalBatches: CompletedBatch[] | null = null;
  try {
    const res = await fetch(
      `/api/completed-batches/${encodeURIComponent(key)}/${encodeURIComponent(batchId)}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.batches)) {
        finalBatches = data.batches;
      }
    }
  } catch {
    // fallback
  }

  if (!finalBatches) {
    finalBatches = loadLocalBatches(key).filter((b) => b.id !== batchId);
  }
  saveLocalBatches(key, finalBatches);

  await syncBatchesToDriveFolder(
    options?.accessToken,
    options?.driveFolderId,
    finalBatches
  );

  return finalBatches;
}
