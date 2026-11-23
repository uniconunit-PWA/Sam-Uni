import { MeterFormPayload, MeterRequest } from '../types/meter';
import { extractSpreadsheetId } from './sheetsService';

export interface OverlayRecordFields {
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

export interface OverlayAddition extends OverlayRecordFields {
  uid: string;
  rowIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface OverlayUpdate extends OverlayRecordFields {
  uid: string;
  updatedAt: number;
}

export interface SheetOverlayState {
  updates: Record<string, OverlayUpdate>;
  additions: OverlayAddition[];
  deletions: string[];
  updatedAt: number;
}

function emptyOverlay(): SheetOverlayState {
  return {
    updates: {},
    additions: [],
    deletions: [],
    updatedAt: 0,
  };
}

function storageKey(spreadsheetId: string): string {
  return `water_meter_overlay_v1_${extractSpreadsheetId(spreadsheetId)}`;
}

function readLocalOverlay(spreadsheetId: string): SheetOverlayState {
  try {
    const raw = localStorage.getItem(storageKey(spreadsheetId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        updates: parsed.updates || {},
        additions: Array.isArray(parsed.additions) ? parsed.additions : [],
        deletions: Array.isArray(parsed.deletions) ? parsed.deletions : [],
        updatedAt: Number(parsed.updatedAt) || 0,
      };
    }
  } catch {
    // ignore storage errors
  }
  return emptyOverlay();
}

function writeLocalOverlay(spreadsheetId: string, overlay: SheetOverlayState): void {
  try {
    localStorage.setItem(storageKey(spreadsheetId), JSON.stringify(overlay));
  } catch {
    // ignore storage errors
  }
}

export function buildSummaryFromPayload(payload: MeterFormPayload): string {
  const parts: string[] = [];
  if (payload.subdistrict) {
    parts.push(
      payload.subdistrict.startsWith('ต.') ? payload.subdistrict : `ต.${payload.subdistrict}`
    );
  }
  if (payload.district) {
    parts.push(payload.district.startsWith('อ.') ? payload.district : `อ.${payload.district}`);
  }
  if (payload.province) {
    parts.push(payload.province.startsWith('จ.') ? payload.province : `จ.${payload.province}`);
  }
  return parts.join(' ');
}

function toOverlayFields(payload: MeterFormPayload): OverlayRecordFields {
  return {
    rqNumber: payload.rqNumber || '',
    requestDate: payload.requestDate || '',
    fullName: payload.fullName || '',
    houseNo: payload.houseNo || '',
    moo: payload.moo || '',
    subdistrict: payload.subdistrict || '',
    district: payload.district || '',
    province: payload.province || '',
    locationSummary: buildSummaryFromPayload(payload),
    phone: payload.phone || '',
    price: Number(payload.price) || 0,
    status: payload.status || 'รับคำร้องแล้ว(รอสำรวจ)',
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    note: payload.note || '',
    housePhotoUrl: payload.housePhotoUrl || '',
  };
}

export async function fetchOverlayState(spreadsheetId: string): Promise<SheetOverlayState> {
  const id = extractSpreadsheetId(spreadsheetId);
  try {
    const res = await fetch(`/api/overlay/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const serverOverlay = (await res.json()) as SheetOverlayState;
      writeLocalOverlay(id, serverOverlay);
      return serverOverlay;
    }
  } catch {
    // Fallback to local cache if API unavailable
  }
  return readLocalOverlay(id);
}

export async function addOverlayRecord(
  spreadsheetId: string,
  payload: MeterFormPayload
): Promise<SheetOverlayState> {
  const id = extractSpreadsheetId(spreadsheetId);
  const fields = toOverlayFields(payload);

  try {
    const res = await fetch(`/api/overlay/${encodeURIComponent(id)}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (res.ok) {
      const data = await res.json();
      writeLocalOverlay(id, data.overlay);
      return data.overlay;
    }
  } catch {
    // Fallback to localStorage
  }

  const current = readLocalOverlay(id);
  const now = Date.now();
  const addition: OverlayAddition = {
    uid: `local:${now}:${Math.random().toString(36).slice(2, 8)}`,
    rowIndex: -1 * (current.additions.length + 1),
    ...fields,
    createdAt: now,
    updatedAt: now,
  };
  const next: SheetOverlayState = {
    ...current,
    additions: [...current.additions, addition],
    updatedAt: now,
  };
  writeLocalOverlay(id, next);
  return next;
}

export async function updateOverlayRecord(
  spreadsheetId: string,
  uid: string,
  payload: MeterFormPayload
): Promise<SheetOverlayState> {
  const id = extractSpreadsheetId(spreadsheetId);
  const fields = toOverlayFields(payload);

  try {
    const res = await fetch(`/api/overlay/${encodeURIComponent(id)}/update`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, ...fields }),
    });
    if (res.ok) {
      const data = await res.json();
      writeLocalOverlay(id, data.overlay);
      return data.overlay;
    }
  } catch {
    // Fallback to localStorage
  }

  const current = readLocalOverlay(id);
  const now = Date.now();
  const localIdx = current.additions.findIndex((a) => a.uid === uid);
  let nextAdditions = [...current.additions];
  const nextUpdates = { ...current.updates };
  let nextDeletions = [...current.deletions];

  if (localIdx !== -1) {
    nextAdditions[localIdx] = {
      ...nextAdditions[localIdx],
      ...fields,
      updatedAt: now,
    };
  } else {
    nextUpdates[uid] = { uid, ...fields, updatedAt: now };
    nextDeletions = nextDeletions.filter((d) => d !== uid);
  }

  const next: SheetOverlayState = {
    updates: nextUpdates,
    additions: nextAdditions,
    deletions: nextDeletions,
    updatedAt: now,
  };
  writeLocalOverlay(id, next);
  return next;
}

export async function deleteOverlayRecord(
  spreadsheetId: string,
  uid: string
): Promise<SheetOverlayState> {
  const id = extractSpreadsheetId(spreadsheetId);

  try {
    const res = await fetch(`/api/overlay/${encodeURIComponent(id)}/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    });
    if (res.ok) {
      const data = await res.json();
      writeLocalOverlay(id, data.overlay);
      return data.overlay;
    }
  } catch {
    // Fallback to localStorage
  }

  const current = readLocalOverlay(id);
  const prevLen = current.additions.length;
  const nextAdditions = current.additions.filter((a) => a.uid !== uid);
  const nextUpdates = { ...current.updates };
  const nextDeletions = [...current.deletions];

  if (nextAdditions.length === prevLen) {
    if (!nextDeletions.includes(uid)) {
      nextDeletions.push(uid);
    }
    delete nextUpdates[uid];
  }

  const next: SheetOverlayState = {
    updates: nextUpdates,
    additions: nextAdditions,
    deletions: nextDeletions,
    updatedAt: Date.now(),
  };
  writeLocalOverlay(id, next);
  return next;
}

export async function resetOverlayState(spreadsheetId: string): Promise<SheetOverlayState> {
  const id = extractSpreadsheetId(spreadsheetId);
  try {
    await fetch(`/api/overlay/${encodeURIComponent(id)}/reset`, { method: 'DELETE' });
  } catch {
    // ignore
  }
  const empty = emptyOverlay();
  writeLocalOverlay(id, empty);
  return empty;
}

export function mergeSheetWithOverlay(
  sheetRecords: MeterRequest[],
  overlay: SheetOverlayState
): MeterRequest[] {
  const deletedSet = new Set(overlay.deletions || []);

  const mergedSheetRecords: MeterRequest[] = [];
  for (const rec of sheetRecords) {
    if (deletedSet.has(rec.uid)) continue;
    const override = overlay.updates?.[rec.uid];
    if (override) {
      mergedSheetRecords.push({
        ...rec,
        rqNumber: override.rqNumber,
        requestDate: override.requestDate,
        fullName: override.fullName,
        houseNo: override.houseNo,
        moo: override.moo,
        subdistrict: override.subdistrict,
        district: override.district,
        province: override.province,
        locationSummary: override.locationSummary || rec.locationSummary,
        phone: override.phone,
        price: override.price,
        status: override.status,
        latitude: override.latitude,
        longitude: override.longitude,
        note: override.note,
        housePhotoUrl: override.housePhotoUrl || rec.housePhotoUrl,
      });
    } else {
      mergedSheetRecords.push(rec);
    }
  }

  const addedRecords: MeterRequest[] = [];
  for (const add of overlay.additions || []) {
    if (deletedSet.has(add.uid)) continue;
    // Skip if already synced into the live Google Sheet
    const alreadyInSheet = mergedSheetRecords.some(
      (s) =>
        (add.rqNumber && s.rqNumber && s.rqNumber === add.rqNumber) ||
        (s.fullName === add.fullName && s.phone === add.phone && add.fullName !== '')
    );
    if (alreadyInSheet) continue;

    addedRecords.push({
      rowIndex: add.rowIndex,
      uid: add.uid,
      rqNumber: add.rqNumber,
      requestDate: add.requestDate,
      fullName: add.fullName,
      houseNo: add.houseNo,
      moo: add.moo,
      subdistrict: add.subdistrict,
      district: add.district,
      province: add.province,
      locationSummary: add.locationSummary,
      phone: add.phone,
      price: add.price,
      status: add.status,
      latitude: add.latitude,
      longitude: add.longitude,
      note: add.note,
      housePhotoUrl: add.housePhotoUrl || '',
      raw: {},
    });
  }

  return [...mergedSheetRecords, ...addedRecords];
}
