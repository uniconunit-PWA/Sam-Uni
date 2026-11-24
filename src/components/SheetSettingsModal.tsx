import React, { useState, useEffect } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  ExternalLink,
  FolderSearch,
  RefreshCw,
  UploadCloud,
  X,
  AlertCircle,
} from 'lucide-react';
import { SheetConfig, SheetTabInfo } from '../types/meter';
import {
  extractSpreadsheetId,
  fetchSpreadsheetMetadata,
  testAppsScriptConnection,
} from '../services/sheetsService';
import {
  DriveSpreadsheetItem,
  HOUSE_PHOTO_FOLDER_ID,
  buildDriveFolderUrl,
  extractDriveFolderId,
  listSpreadsheetsInDriveFolder,
} from '../services/driveService';
import { GoogleSignInButton } from './GoogleSignInButton';

interface SheetSettingsModalProps {
  open: boolean;
  config: SheetConfig;
  accessToken: string | null;
  googleUserEmail: string | null;
  isGoogleSigningIn: boolean;
  serviceAccountConfigured: boolean;
  serviceAccountEmail: string | null;
  pendingOverlayCount: number;
  isFlushingPending: boolean;
  onFlushPending: () => void;
  onConnectGoogle: () => void;
  onDisconnectGoogle: () => void;
  onClose: () => void;
  onSave: (nextConfig: SheetConfig) => void;
}

const DEFAULT_SHEET_ID = '1iBqlVp4jXeI254idzjvtSltaX7BJ-a40uy-n3XwnAsg';

const APPS_SCRIPT_SNIPPET = `const SPREADSHEET_ID = '${DEFAULT_SHEET_ID}';
var HOUSE_PHOTO_FOLDER_ID = '${HOUSE_PHOTO_FOLDER_ID}';
var PHOTO_HEADER_KEYS = ['รูปหน้าบ้าน', 'ภาพหน้าบ้าน', 'รูปถ่ายหน้าบ้าน', 'ภาพถ่ายหน้าบ้าน', 'ลิงก์รูปหน้าบ้าน', 'house photo', 'photo url', 'photo', 'image'];

function getDriveFolderId_() {
  try {
    var saved = PropertiesService.getScriptProperties().getProperty('HOUSE_PHOTO_FOLDER_ID');
    if (saved && String(saved).trim()) return String(saved).trim();
  } catch (e) {}
  return HOUSE_PHOTO_FOLDER_ID;
}

function getTargetSpreadsheet_(overrideId) {
  if (overrideId && String(overrideId).trim()) {
    return SpreadsheetApp.openById(String(overrideId).trim());
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID) || SpreadsheetApp.getActiveSpreadsheet();
}

function getTargetSheet_(ss, sheetName) {
  return (sheetName && ss.getSheetByName(sheetName)) || ss.getSheets()[0];
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action === 'ping') {
    var ss = getTargetSpreadsheet_(params.spreadsheetId);
    var sheet = getTargetSheet_(ss, params.sheetName);
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      status: 'ready',
      spreadsheetTitle: ss.getName(),
      sheetName: sheet ? sheet.getName() : '',
      driveFolderId: getDriveFolderId_()
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ระบบวิเคราะห์และติดตามคำขอติดตั้ง/ย้ายมาตรวัดน้ำ')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getSheetPayload(sheetName, spreadsheetId) {
  var ss = getTargetSpreadsheet_(spreadsheetId);
  var sheet = getTargetSheet_(ss, sheetName);
  var rows = sheet ? sheet.getDataRange().getDisplayValues() : [];
  var tabs = ss.getSheets().map(function(s) {
    return { sheetId: s.getSheetId(), title: s.getName(), rowCount: s.getMaxRows() };
  });
  return {
    rows: rows,
    sheetName: sheet ? sheet.getName() : '',
    spreadsheetTitle: ss.getName(),
    spreadsheetId: ss.getId(),
    driveFolderId: getDriveFolderId_(),
    tabs: tabs
  };
}

function buildRowFromPayload_(headers, payload, existingRow) {
  var latLng = (payload.latitude !== null && payload.latitude !== undefined &&
    payload.longitude !== null && payload.longitude !== undefined &&
    payload.latitude !== '' && payload.longitude !== '')
    ? Number(payload.latitude).toFixed(6) + ', ' + Number(payload.longitude).toFixed(6)
    : '';
  var locationCombined = [payload.subdistrict, payload.district, payload.province].filter(Boolean).join(' ');

  return headers.map(function(h, idx) {
    var key = String(h || '').trim().toLowerCase().replace(/\\s+/g, ' ');
    if (['เลขที่ rq', 'เลขที่คำขอ', 'เลขที่งาน', 'เลขงาน', 'rq', 'job id'].indexOf(key) !== -1) return payload.rqNumber || '';
    if (['วันที่ยื่นคำร้อง', 'วันที่', 'วันที่ต้องการ', 'date'].indexOf(key) !== -1) return payload.requestDate || '';
    if (['ชื่อ-สกุล', 'ชื่อ - สกุล', 'ชื่อสกุล', 'ชื่อ', 'full name'].indexOf(key) !== -1) return payload.fullName || '';
    if (['บ้านเลขที่', 'ที่อยู่', 'house no'].indexOf(key) !== -1) return payload.houseNo || '';
    if (['หมู่ที่', 'หมู่', 'moo'].indexOf(key) !== -1) return payload.moo || '';
    if (['ตำบล', 'subdistrict'].indexOf(key) !== -1) return payload.subdistrict || '';
    if (['อำเภอ', 'district'].indexOf(key) !== -1) return payload.district || '';
    if (['จังหวัด', 'province'].indexOf(key) !== -1) return payload.province || '';
    if (['ตำบล-อำเภอ-จังหวัด', 'พื้นที่', 'location info'].indexOf(key) !== -1) return locationCombined;
    if (['เบอร์โทร', 'เบอร์ติดต่อ', 'โทรศัพท์', 'phone'].indexOf(key) !== -1) return payload.phone || '';
    if (['ราคา', 'ยอดชำระ', 'ยอดชำระเงิน', 'amount', 'price'].indexOf(key) !== -1) return payload.price !== undefined && payload.price !== null ? String(payload.price) : '0';
    if (['สถานะ', 'สถานะการชำระเงิน', 'status'].indexOf(key) !== -1) return payload.status || 'รับคำร้องแล้ว(รอสำรวจ)';
    if (['lat/long', 'พิกัด', 'location', 'coordinates'].indexOf(key) !== -1) return latLng;
    if (['latitude', 'lat'].indexOf(key) !== -1) return payload.latitude !== null && payload.latitude !== undefined ? String(payload.latitude) : '';
    if (['longitude', 'lng', 'long'].indexOf(key) !== -1) return payload.longitude !== null && payload.longitude !== undefined ? String(payload.longitude) : '';
    if (['หมายเหตุ', 'รายละเอียด', 'note', 'notes'].indexOf(key) !== -1) return payload.note || '';
    if (PHOTO_HEADER_KEYS.indexOf(key) !== -1) {
      return payload.housePhotoUrl !== undefined
        ? (payload.housePhotoUrl || '')
        : (existingRow && existingRow[idx] !== undefined ? existingRow[idx] : '');
    }
    return existingRow && existingRow[idx] !== undefined ? existingRow[idx] : '';
  });
}

function uploadHousePhoto_(folderId, fileName, mimeType, base64Data) {
  var targetId = folderId || getDriveFolderId_();
  if (!base64Data) throw new Error('ไม่พบข้อมูลไฟล์รูปภาพ');
  var folder = DriveApp.getFolderById(targetId);
  var bytes = Utilities.base64Decode(base64Data);
  var safeName = fileName || ('รูปหน้าบ้าน_' + Date.now() + '.jpg');
  var blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', safeName);
  var file = folder.createFile(blob);
  return {
    success: true,
    action: 'uploadHousePhoto',
    fileId: file.getId(),
    fileName: file.getName(),
    webViewLink: file.getUrl()
  };
}

function ensurePhotoHeader_(sheet, headers, housePhotoUrl) {
  if (!housePhotoUrl) return false;
  for (var i = 0; i < headers.length; i++) {
    var key = String(headers[i] || '').trim().toLowerCase().replace(/\\s+/g, ' ');
    if (PHOTO_HEADER_KEYS.indexOf(key) !== -1) return false;
  }
  var nextCol = headers.length + 1;
  sheet.getRange(1, nextCol).setValue('รูปหน้าบ้าน');
  headers.push('รูปหน้าบ้าน');
  return true;
}

function findRowIndex_(sheet, rowIndex, matchRqNumber) {
  var lastRow = sheet.getLastRow();
  var idx = Number(rowIndex);
  if (matchRqNumber && lastRow >= 2) {
    var rqCol = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    if (idx >= 2 && idx <= lastRow && String(rqCol[idx - 2][0]).trim() === String(matchRqNumber).trim()) {
      return idx;
    }
    for (var i = 0; i < rqCol.length; i++) {
      if (String(rqCol[i][0]).trim() === String(matchRqNumber).trim()) {
        return i + 2;
      }
    }
  }
  return idx;
}

function preparePhoneCellsForText_(sheet, headers, rowValues, startRow) {
  if (!sheet || !Array.isArray(headers) || !Array.isArray(rowValues)) return rowValues;
  var out = rowValues.slice();
  var phoneKeys = ['เบอร์โทร', 'เบอร์ติดต่อ', 'โทรศัพท์', 'phone'];
  for (var c = 0; c < headers.length; c++) {
    var key = String(headers[c] || '').trim().toLowerCase().replace(/\\s+/g, ' ');
    if (phoneKeys.indexOf(key) !== -1) {
      if (startRow >= 2) {
        sheet.getRange(startRow, c + 1).setNumberFormat('@');
      }
      if (c < out.length && out[c] !== null && out[c] !== undefined) {
        out[c] = String(out[c]).replace(/^'+/, '').trim();
      }
    }
  }
  return out;
}

function handleApiAction(data) {
  if (data && data.action === 'setDriveFolderId') {
    var rawFolder = String(data.folderId || '').trim();
    var folderMatch = rawFolder.match(/\\/folders\\/([a-zA-Z0-9-_]+)/);
    var cleanFolder = (folderMatch && folderMatch[1]) ? folderMatch[1] : (rawFolder || HOUSE_PHOTO_FOLDER_ID);
    PropertiesService.getScriptProperties().setProperty('HOUSE_PHOTO_FOLDER_ID', cleanFolder);
    return { success: true, action: 'setDriveFolderId', driveFolderId: cleanFolder };
  }

  if (data && data.action === 'uploadHousePhoto') {
    try {
      return uploadHousePhoto_(data.folderId, data.fileName, data.mimeType, data.base64Data);
    } catch (err) {
      return {
        success: false,
        message: err && err.message ? err.message : String(err)
      };
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var ss = getTargetSpreadsheet_(data && data.spreadsheetId);
    var sheet = getTargetSheet_(ss, data.sheetName);
    var lastCol = Math.max(sheet.getLastColumn(), 11);
    var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    while (headers.length > 0 && String(headers[headers.length - 1]).trim() === '') headers.pop();

    var values = Array.isArray(data.rowValues) && data.rowValues.length > 0
      ? data.rowValues
      : (data.payload ? buildRowFromPayload_(headers, data.payload) : []);
    var matchRq = data.matchRqNumber || (data.payload && data.payload.rqNumber) || '';

    if (data.action === 'add') {
      var addPhotoAdded = ensurePhotoHeader_(sheet, headers, data.payload && data.payload.housePhotoUrl);
      var addValues = (!addPhotoAdded && Array.isArray(data.rowValues) && data.rowValues.length >= headers.length)
        ? data.rowValues
        : (data.payload ? buildRowFromPayload_(headers, data.payload) : values);
      var nextRow = Math.max(sheet.getLastRow() + 1, 2);
      var preparedAddValues = preparePhoneCellsForText_(sheet, headers, addValues, nextRow);
      sheet.getRange(nextRow, 1, 1, preparedAddValues.length).setValues([preparedAddValues]);
      SpreadsheetApp.flush();
      return { success: true, action: 'add' };
    }

    if (data.action === 'update') {
      var targetRow = findRowIndex_(sheet, data.rowIndex, matchRq);
      if (targetRow < 2) throw new Error('ไม่พบแถวข้อมูลที่ต้องการแก้ไข');
      var updPhotoAdded = ensurePhotoHeader_(sheet, headers, data.payload && data.payload.housePhotoUrl);
      var existingRow = sheet.getRange(targetRow, 1, 1, Math.max(headers.length, values.length)).getDisplayValues()[0];
      var finalValues = (!updPhotoAdded && Array.isArray(data.rowValues) && data.rowValues.length >= headers.length)
        ? data.rowValues
        : buildRowFromPayload_(headers, data.payload || {}, existingRow);
      var preparedUpdateValues = preparePhoneCellsForText_(sheet, headers, finalValues, targetRow);
      sheet.getRange(targetRow, 1, 1, preparedUpdateValues.length).setValues([preparedUpdateValues]);
      SpreadsheetApp.flush();
      return { success: true, action: 'update', rowIndex: targetRow };
    }

    if (data.action === 'delete') {
      var delRow = findRowIndex_(sheet, data.rowIndex, matchRq);
      if (delRow < 2) throw new Error('ไม่พบแถวข้อมูลที่ต้องการลบ');
      sheet.deleteRow(delRow);
      SpreadsheetApp.flush();
      return { success: true, action: 'delete', rowIndex: delRow };
    }

    return { success: false, message: 'ไม่รู้จักคำสั่ง: ' + data.action };
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : String(err)
    };
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  var result = handleApiAction(data);
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}`;

export const SheetSettingsModal: React.FC<SheetSettingsModalProps> = ({
  open,
  config,
  accessToken,
  googleUserEmail,
  isGoogleSigningIn,
  serviceAccountConfigured,
  serviceAccountEmail,
  pendingOverlayCount,
  isFlushingPending,
  onFlushPending,
  onConnectGoogle,
  onDisconnectGoogle,
  onClose,
  onSave,
}) => {
  const [sheetInput, setSheetInput] = useState(config.spreadsheetId);
  const [sheetName, setSheetName] = useState(config.sheetName);
  const [availableTabs, setAvailableTabs] = useState<SheetTabInfo[]>(config.availableTabs);
  const [pollIntervalMs, setPollIntervalMs] = useState(config.pollIntervalMs);
  const [appsScriptUrl, setAppsScriptUrl] = useState(config.appsScriptUrl || '');
  const [driveFolderInput, setDriveFolderInput] = useState(
    config.driveFolderId || HOUSE_PHOTO_FOLDER_ID
  );
  const [showScriptHelp, setShowScriptHelp] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [tabError, setTabError] = useState('');
  const [testingScript, setTestingScript] = useState(false);
  const [scriptTestResult, setScriptTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [driveSheets, setDriveSheets] = useState<DriveSpreadsheetItem[]>([]);
  const [loadingDriveSheets, setLoadingDriveSheets] = useState(false);
  const [driveSheetsError, setDriveSheetsError] = useState('');

  useEffect(() => {
    if (open) {
      setSheetInput(config.spreadsheetId);
      setSheetName(config.sheetName);
      setAvailableTabs(config.availableTabs);
      setPollIntervalMs(config.pollIntervalMs);
      setAppsScriptUrl(config.appsScriptUrl || '');
      setDriveFolderInput(config.driveFolderId || HOUSE_PHOTO_FOLDER_ID);
      setShowScriptHelp(!config.appsScriptUrl && !serviceAccountConfigured);
      setTabError('');
      setCopiedScript(false);
      setScriptTestResult(null);
      setDriveSheets([]);
      setDriveSheetsError('');
    }
  }, [open, config, serviceAccountConfigured]);

  if (!open) return null;

  const isFolderUrlInSheetInput = sheetInput.includes('/drive/folders/');
  const spreadsheetId = isFolderUrlInSheetInput
    ? DEFAULT_SHEET_ID
    : extractSpreadsheetId(sheetInput);
  const driveFolderId = extractDriveFolderId(driveFolderInput);

  const handleLoadTabs = async (overrideId?: string) => {
    if (!accessToken) {
      setTabError('สามารถเว้นว่างไว้เพื่อใช้แท็บแรกอัตโนมัติ หรือพิมพ์ชื่อแท็บเองได้ทันที');
      return;
    }
    setLoadingTabs(true);
    setTabError('');
    try {
      const meta = await fetchSpreadsheetMetadata(overrideId || spreadsheetId, accessToken);
      setAvailableTabs(meta.tabs);
      if (meta.tabs.length > 0 && !meta.tabs.some((t) => t.title === sheetName)) {
        setSheetName(meta.tabs[0].title);
      }
    } catch (err: any) {
      setTabError(err?.message || 'ไม่สามารถดึงรายชื่อแท็บได้');
    } finally {
      setLoadingTabs(false);
    }
  };

  const handleDiscoverSheetsInDrive = async () => {
    if (!accessToken) return;
    setLoadingDriveSheets(true);
    setDriveSheetsError('');
    try {
      const list = await listSpreadsheetsInDriveFolder(accessToken, driveFolderId);
      setDriveSheets(list);
      if (list.length === 0) {
        setDriveSheetsError('ไม่พบไฟล์ Google Sheets ในโฟลเดอร์นี้');
      }
    } catch (err: any) {
      setDriveSheetsError(err?.message || 'ไม่สามารถค้นหาไฟล์ในโฟลเดอร์ Drive ได้');
    } finally {
      setLoadingDriveSheets(false);
    }
  };

  const handleTestAppsScript = async () => {
    setTestingScript(true);
    setScriptTestResult(null);
    try {
      const result = await testAppsScriptConnection(appsScriptUrl);
      setScriptTestResult({ success: result.success, message: result.message });
    } catch (err: any) {
      setScriptTestResult({
        success: false,
        message: err?.message || 'ไม่สามารถทดสอบการเชื่อมต่อได้',
      });
    } finally {
      setTestingScript(false);
    }
  };

  const handleCopyScript = async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_SNIPPET);
      setCopiedScript(true);
      window.setTimeout(() => setCopiedScript(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadCodeGs = () => {
    const blob = new Blob([APPS_SCRIPT_SNIPPET], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Code.gs';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const matchedTab = availableTabs.find((t) => t.title === sheetName);
    onSave({
      spreadsheetId,
      spreadsheetTitle: config.spreadsheetTitle,
      sheetName: sheetName.trim(),
      sheetId: matchedTab?.sheetId,
      availableTabs,
      pollIntervalMs,
      appsScriptUrl: appsScriptUrl.trim(),
      driveFolderId,
    });
    onClose();
  };

  const modalInputCls =
    'w-full bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1E3350] rounded-lg py-2 px-3 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:bg-white dark:focus:bg-[#0F1E33] focus:border-[#0F62BD] dark:focus:border-[#4EA3FF] focus:ring-2 focus:ring-[#0F62BD]/20 transition-colors';

  return (
    <div
      className="fixed inset-0 z-[2400] flex items-center justify-center bg-slate-900/60 dark:bg-black/75 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-settings-title"
    >
      <div className="bg-white dark:bg-[#0F1B2E] border border-[#DCE6F3] dark:border-[#1D3350] rounded-2xl w-full max-w-xl shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#0A3A82] dark:border-[#1D3350] bg-gradient-to-r from-[#0A3A82] to-[#0F62BD] dark:from-[#0C254B] dark:to-[#133B70] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-white/15 border border-white/20 text-white flex items-center justify-center shrink-0">
              <Database className="w-4 h-4" />
            </span>
            <h3 id="sheet-settings-title" className="font-semibold text-white text-base">
              ตั้งค่าการเชื่อมโยง AppSheet / Google Sheets
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-lg transition-colors"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {serviceAccountConfigured && (
            <div className="bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/50 rounded-lg p-3 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  เซิร์ฟเวอร์เชื่อมต่อ Google Service Account แล้ว
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-mono mt-0.5">
                  {serviceAccountEmail}
                </p>
              </div>
            </div>
          )}

          {pendingOverlayCount > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
              <span>
                มีข้อมูลที่แก้ไข/เพิ่มไว้บนหน้าเว็บ <strong>{pendingOverlayCount} รายการ</strong> ที่ยังไม่ได้ส่งเข้าไฟล์ Google Sheet
              </span>
              {(Boolean(appsScriptUrl.trim()) || serviceAccountConfigured || Boolean(accessToken)) && (
                <button
                  type="button"
                  disabled={isFlushingPending}
                  onClick={onFlushPending}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>{isFlushingPending ? 'กำลังส่งเข้าชีท...' : 'ส่งเข้า Google Sheet ทันที'}</span>
                </button>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                ลิงก์หรือรหัส Google Spreadsheet (AppSheet Data Source)
              </label>
              <div className="flex items-center gap-2.5">
                {spreadsheetId !== DEFAULT_SHEET_ID && (
                  <button
                    type="button"
                    onClick={() => {
                      setSheetInput(DEFAULT_SHEET_ID);
                      setSheetName('');
                      setAvailableTabs([]);
                    }}
                    className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-[#2271B3] dark:hover:text-[#5EA6E0] hover:underline"
                  >
                    ใช้ชีทในโฟลเดอร์เริ่มต้น
                  </button>
                )}
                <a
                  href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-1"
                >
                  <span>เปิดชีท</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            <input
              type="text"
              required
              value={sheetInput}
              onChange={(e) => setSheetInput(e.target.value)}
              placeholder="วาง URL ของ Google Sheet หรือ Spreadsheet ID"
              className={`${modalInputCls} font-mono`}
            />
            {isFolderUrlInSheetInput && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                ลิงก์ที่วางเป็นลิงก์โฟลเดอร์ Google Drive (ระบบจะใช้ชีทในโฟลเดอร์นี้แทนให้อัตโนมัติ)
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                ลิงก์หรือรหัสโฟลเดอร์ Google Drive (เก็บข้อมูลชุดงาน, ชีท และรูปหน้าบ้าน)
              </label>
              <div className="flex items-center gap-2.5">
                {driveFolderId !== HOUSE_PHOTO_FOLDER_ID && (
                  <button
                    type="button"
                    onClick={() => setDriveFolderInput(HOUSE_PHOTO_FOLDER_ID)}
                    className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-[#2271B3] dark:hover:text-[#5EA6E0] hover:underline"
                  >
                    ใช้ค่าเริ่มต้น
                  </button>
                )}
                <a
                  href={buildDriveFolderUrl(driveFolderId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-1"
                >
                  <span>เปิดโฟลเดอร์</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            <input
              type="text"
              value={driveFolderInput}
              onChange={(e) => setDriveFolderInput(e.target.value)}
              placeholder="วาง URL โฟลเดอร์ Google Drive หรือ Folder ID"
              className={`${modalInputCls} font-mono`}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                รหัสโฟลเดอร์: <span className="font-mono text-slate-700 dark:text-slate-200">{driveFolderId}</span>
              </p>
              {accessToken && (
                <button
                  type="button"
                  onClick={handleDiscoverSheetsInDrive}
                  disabled={loadingDriveSheets}
                  className="text-[11px] font-medium text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-1"
                >
                  <FolderSearch className="w-3.5 h-3.5" />
                  <span>{loadingDriveSheets ? 'กำลังค้นหา...' : 'ค้นหาชีทในโฟลเดอร์ Drive นี้'}</span>
                </button>
              )}
            </div>
            {driveSheetsError && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{driveSheetsError}</p>
            )}
            {driveSheets.length > 0 && (
              <div className="mt-2 bg-[#F4F8FD] dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1E3350] rounded-lg p-2 space-y-1">
                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  เลือกชีทที่พบในโฟลเดอร์ Drive นี้:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {driveSheets.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSheetInput(item.id);
                        setSheetName('');
                        setAvailableTabs([]);
                        void handleLoadTabs(item.id);
                      }}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                        spreadsheetId === item.id
                          ? 'bg-[#2271B3] border-[#2271B3] text-white'
                          : 'bg-white dark:bg-[#111C2B] border-slate-200 dark:border-[#263850] text-slate-700 dark:text-slate-200 hover:border-[#2271B3]'
                      }`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  ชื่อแท็บข้อมูล (Sheet Tab)
                </label>
                {accessToken && (
                  <button
                    type="button"
                    onClick={() => handleLoadTabs()}
                    disabled={loadingTabs}
                    className="text-[11px] text-[#2271B3] dark:text-[#5EA6E0] hover:underline font-medium inline-flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingTabs ? 'animate-spin' : ''}`} />
                    <span>ดึงแท็บ</span>
                  </button>
                )}
              </div>
              {availableTabs.length > 0 ? (
                <select
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  className={modalInputCls}
                >
                  {availableTabs.map((tab) => (
                    <option key={tab.sheetId} value={tab.title}>
                      {tab.title}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  placeholder="เว้นว่าง = ใช้แท็บแรกอัตโนมัติ"
                  className={modalInputCls}
                />
              )}
              {tabError && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{tabError}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                ความถี่ Real-time Auto-Sync
              </label>
              <select
                value={pollIntervalMs}
                onChange={(e) => setPollIntervalMs(Number(e.target.value))}
                className={modalInputCls}
              >
                <option value={5000}>ทุก 5 วินาที (เร็วมาก)</option>
                <option value={10000}>ทุก 10 วินาที (แนะนำ)</option>
                <option value={30000}>ทุก 30 วินาที (ประหยัด)</option>
                <option value={60000}>ทุก 1 นาที</option>
                <option value={0}>ปิดการซิงค์อัตโนมัติ</option>
              </select>
            </div>
          </div>

          {/* Zero-Login Apps Script Write Bridge */}
          <div className="border border-[#D6E7F6] dark:border-[#234161] bg-[#EDF5FC]/60 dark:bg-[#15283D]/70 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                ลิงก์ Google Apps Script Web App (สำหรับเขียนเข้าชีทอัตโนมัติแบบไม่ต้องล็อกอิน)
              </label>
              <button
                type="button"
                onClick={() => setShowScriptHelp((prev) => !prev)}
                className="text-[11px] font-medium text-[#2271B3] dark:text-[#5EA6E0] hover:underline inline-flex items-center gap-0.5 shrink-0"
              >
                <span>{showScriptHelp ? 'ซ่อนวิธีตั้งค่า' : 'ดูโค้ดและวิธีตั้งค่า'}</span>
                {showScriptHelp ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="url"
                value={appsScriptUrl}
                onChange={(e) => {
                  setAppsScriptUrl(e.target.value);
                  setScriptTestResult(null);
                }}
                placeholder="https://script.google.com/macros/s/.../exec"
                className={`flex-1 ${modalInputCls} font-mono`}
              />
              <button
                type="button"
                onClick={handleTestAppsScript}
                disabled={testingScript || !appsScriptUrl.trim()}
                className="px-3 py-2 bg-[#2271B3] hover:bg-[#1A5A8F] dark:bg-[#3584C7] dark:hover:bg-[#2271B3] disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-lg text-xs font-semibold whitespace-nowrap transition-colors"
              >
                {testingScript ? 'กำลังทดสอบ...' : 'ทดสอบเชื่อมต่อ'}
              </button>
            </div>

            {scriptTestResult && (
              <div
                className={`rounded-lg px-3 py-2 text-xs flex items-start gap-2 ${
                  scriptTestResult.success
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-200'
                    : 'bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-rose-800 dark:text-rose-200'
                }`}
              >
                {scriptTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{scriptTestResult.message}</span>
              </div>
            )}

            {showScriptHelp && (
              <div className="bg-[#0B131E] text-slate-100 border border-[#213145] rounded-lg p-3 space-y-2.5">
                <ol className="text-[11px] text-slate-200 space-y-1 list-decimal list-inside leading-relaxed">
                  <li>
                    เปิดไฟล์ Google Sheet ของคุณ แล้วกดเมนู <strong>ส่วนขยาย (Extensions) &gt; Apps Script</strong>
                  </li>
                  <li>ลบโค้ดเดิมทั้งหมด แล้ววางโค้ดด้านล่างนี้ลงไป กดบันทึก</li>
                  <li>
                    กด <strong>Deploy &gt; New deployment &gt; Web app</strong> ตั้งค่า Execute as: <strong>Me</strong> และ Who has access: <strong>Anyone (ทุกคน)</strong>
                  </li>
                  <li>คัดลอก URL ที่ลงท้ายด้วย <code className="text-[#5EA6E0]">/exec</code> มาวางในช่องด้านบน แล้วกด <strong>ทดสอบเชื่อมต่อ</strong></li>
                </ol>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-700">
                  <span className="text-[11px] text-slate-400">ไฟล์ Code.gs สำหรับ Google Apps Script</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleDownloadCodeGs}
                      className="px-2.5 py-1 bg-[#2271B3] hover:bg-[#1A5A8F] text-white rounded text-[11px] inline-flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>ดาวน์โหลด Code.gs</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyScript}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded text-[11px] inline-flex items-center gap-1"
                    >
                      {copiedScript ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>คัดลอกโค้ดแล้ว</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>คัดลอกโค้ด</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <pre className="text-[10px] font-mono text-[#8CC5F2] overflow-x-auto leading-relaxed max-h-48">
                  {APPS_SCRIPT_SNIPPET}
                </pre>
              </div>
            )}
          </div>

          <div className="bg-[#F4F8FD] dark:bg-[#0A1424] border border-[#DCE6F3] dark:border-[#1D3350] rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                หรือยืนยันสิทธิ์ด้วยบัญชี Google ของเจ้าของชีท (ทางเลือก)
              </span>
              {accessToken && googleUserEmail ? (
                <button
                  type="button"
                  onClick={onDisconnectGoogle}
                  className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline font-medium"
                >
                  ตัดการเชื่อมต่อ ({googleUserEmail})
                </button>
              ) : null}
            </div>
            {accessToken ? (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                ยืนยันสิทธิ์บัญชี Google เรียบร้อยแล้ว ({googleUserEmail || 'Google Account'})
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  ใช้กรณีไม่สะดวกวาง Apps Script และต้องการเขียนเข้าชีทผ่านบัญชี Google โดยตรง
                </p>
                <GoogleSignInButton
                  onClick={onConnectGoogle}
                  disabled={isGoogleSigningIn}
                  label={isGoogleSigningIn ? 'กำลังเชื่อมต่อ...' : 'เชื่อมต่อบัญชี Google'}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#091322] border border-[#D5E3F4] dark:border-[#1D3350] rounded-lg hover:bg-[#EDF5FD] dark:hover:bg-[#15253D] transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#0B4DA2] hover:bg-[#083A7E] dark:bg-[#2B7CD3] dark:hover:bg-[#1F69BC] rounded-lg transition-colors shadow-xs"
            >
              บันทึกการตั้งค่า
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
