import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Calendar,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderCheck,
  Loader2,
  PackageCheck,
  PencilLine,
  Save,
  Search,
  Square,
  Trash2,
  UserCheck,
} from 'lucide-react';
import {
  BatchMemoSigners,
  CompletedBatch,
  CompletedBatchRecord,
  MeterRequest,
} from '../types/meter';
import {
  BatchRecordEditableFields,
  deleteCompletedBatch,
  fetchCompletedBatches,
  getEligibleCompletedUnbatchedRecords,
  isRecordAlreadyBatched,
  saveCompletedBatch,
  toBatchRecords,
  updateCompletedBatch,
} from '../services/batchService';
import {
  exportCompletedBatchToExcel,
  exportCompletedBatchToPdf,
} from '../services/exportService';
import { buildDriveFolderUrl } from '../services/driveService';

interface AdminBatchWorkspaceProps {
  mode: 'builder' | 'archive';
  records: MeterRequest[];
  spreadsheetId: string;
  appsScriptUrl?: string;
  accessToken?: string | null;
  driveFolderId?: string;
  onBatchCountChange?: (count: number) => void;
  onBatchesChange?: (batches: CompletedBatch[]) => void;
  onUpdateStatusesToCompleted?: (targetRecords: MeterRequest[]) => Promise<{
    updatedToSheet: boolean;
    updatedCount: number;
  }>;
  onNotify: (
    message: string,
    tone: 'info' | 'success' | 'warning' | 'error'
  ) => void;
}

function splitArea(rec: Pick<MeterRequest, 'subdistrict' | 'district' | 'province' | 'locationSummary'>) {
  let subdistrict = (rec.subdistrict || '').trim();
  let district = (rec.district || '').trim();
  let province = (rec.province || '').trim();
  if ((!subdistrict || !district || !province) && rec.locationSummary) {
    const t = rec.locationSummary.match(/ต\.([^\s]+)/);
    const a = rec.locationSummary.match(/อ\.([^\s]+)/);
    const j = rec.locationSummary.match(/จ\.([^\s(]+)/);
    if (!subdistrict && t) subdistrict = `ต.${t[1]}`;
    if (!district && a) district = `อ.${a[1]}`;
    if (!province && j) province = `จ.${j[1]}`;
  }
  return {
    subdistrict: subdistrict || '-',
    district: district || '-',
    province: province || '-',
  };
}

function formatThaiDate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function generateDefaultBatchCode(_existingCount?: number): string {
  return 'มท55120-183/';
}

const DEFAULT_MEMO_SIGNERS: Required<BatchMemoSigners> = {
  meterSizeText: '1/2"',
  proposerName: 'นายคมกฤช ปัญญา',
  proposerTitle: 'หัวหน้างาน 8 งานบริการและควบคุมน้ำสูญเสีย',
  managerName: 'นายปริญญา กัตฐะ',
  managerTitle: 'ผู้จัดการการประปาส่วนภูมิภาคสาขาขาณุวรลักษบุรี',
  adminHeadName: 'นางชฎาภัทร์ แจ่มสว่าง',
  adminHeadTitle: 'หัวหน้างาน 8 งานอำนวยการ',
  inspectorTitle: 'นายช่างโยธา 6',
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export const AdminBatchWorkspace: React.FC<AdminBatchWorkspaceProps> = ({
  mode,
  records,
  spreadsheetId,
  appsScriptUrl,
  accessToken,
  driveFolderId,
  onBatchCountChange,
  onBatchesChange,
  onNotify,
}) => {
  const [batches, setBatches] = useState<CompletedBatch[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);

  // Builder state
  const [searchText, setSearchText] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [editableFieldsByUid, setEditableFieldsByUid] = useState<
    Record<string, BatchRecordEditableFields>
  >({});

  const todayIso = new Date().toISOString().slice(0, 10);
  const [batchCode, setBatchCode] = useState(() => generateDefaultBatchCode(0));
  const [batchTitle, setBatchTitle] = useState('ชุดงานติดตั้งมาตรวัดน้ำเสร็จสิ้น');
  const [completedDate, setCompletedDate] = useState(todayIso);
  const [inspectorName, setInspectorName] = useState('นายสามารถ บุญกัน');
  const [batchNote, setBatchNote] = useState('');
  const [includeTax, setIncludeTax] = useState<boolean>(true);
  const [memoSigners, setMemoSigners] = useState<Required<BatchMemoSigners>>({
    ...DEFAULT_MEMO_SIGNERS,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isExportingId, setIsExportingId] = useState<string | null>(null);

  // Archive state
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archivePageSize, setArchivePageSize] = useState<number>(10);
  const [archiveCurrentPage, setArchiveCurrentPage] = useState<number>(1);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmSaveBatchId, setConfirmSaveBatchId] = useState<string | null>(null);
  const [dirtyArchiveBatchIds, setDirtyArchiveBatchIds] = useState<Record<string, boolean>>({});
  const [savingArchiveBatchId, setSavingArchiveBatchId] = useState<string | null>(null);

  const getEditableField = (
    rec: MeterRequest,
    field: keyof BatchRecordEditableFields
  ): string => {
    const ov = editableFieldsByUid[rec.uid]?.[field];
    if (ov !== undefined) return ov;
    if (field === 'jobNumber') {
      return String(rec.raw?.['เลขที่ งาน'] ?? rec.raw?.['เลขที่งาน'] ?? rec.rqNumber ?? '');
    }
    if (field === 'waterUserNo') {
      return String(rec.raw?.['เลขที่ผู้ใช้น้ำ'] ?? rec.raw?.['เลขที่ผู้ใช้น้ำประปา'] ?? '');
    }
    if (field === 'houseNo') {
      return String(rec.houseNo ?? '');
    }
    if (field === 'price') {
      return Number.isFinite(rec.price) ? String(rec.price) : '0';
    }
    if (field === 'note') {
      return String(rec.note ?? '');
    }
    if (field === 'meterSize') {
      return String(rec.raw?.['ขนาดมาตร'] ?? rec.raw?.['ขนาด'] ?? '');
    }
    return String(rec.raw?.['หมายเลขมาตร'] ?? rec.raw?.['เลขมาตร'] ?? '');
  };

  const setEditableField = (
    uid: string,
    field: keyof BatchRecordEditableFields,
    value: string
  ) => {
    setEditableFieldsByUid((prev) => ({
      ...prev,
      [uid]: {
        ...prev[uid],
        [field]: value,
      },
    }));
  };

  useEffect(() => {
    let active = true;
    setIsLoadingBatches(true);
    fetchCompletedBatches(spreadsheetId, { accessToken, driveFolderId })
      .then((list) => {
        if (!active) return;
        setBatches(list);
        onBatchCountChange?.(list.length);
        onBatchesChange?.(list);
        if (list.length > 0 && !expandedBatchId) {
          setExpandedBatchId(list[0].id);
        }
      })
      .finally(() => {
        if (active) setIsLoadingBatches(false);
      });
    return () => {
      active = false;
    };
  }, [spreadsheetId, accessToken, driveFolderId]);

  useEffect(() => {
    onBatchCountChange?.(batches.length);
    onBatchesChange?.(batches);
  }, [batches, onBatchCountChange, onBatchesChange]);

  // Eligible source records: status "ติดตั้งเสร็จสิ้น" (or "เสร็จสิ้น") and NOT already present in any saved batch
  const {
    eligible: eligibleRecords,
    alreadyBatchedCount,
    batchedKeySet,
  } = useMemo(
    () => getEligibleCompletedUnbatchedRecords(records, batches),
    [records, batches]
  );

  const areaOptions = useMemo(() => {
    const set = new Set<string>();
    eligibleRecords.forEach((r) => {
      const { subdistrict } = splitArea(r);
      if (subdistrict !== '-') set.add(subdistrict);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
  }, [eligibleRecords]);

  const visibleCandidates = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return eligibleRecords.filter((r) => {
      if (areaFilter) {
        const { subdistrict } = splitArea(r);
        if (subdistrict !== areaFilter) return false;
      }
      if (q) {
        const jobNo = getEditableField(r, 'jobNumber');
        const waterNo = getEditableField(r, 'waterUserNo');
        const meterNo = getEditableField(r, 'meterNumber');
        const meterSize = getEditableField(r, 'meterSize');
        const hay = `${jobNo} ${waterNo} ${meterNo} ${meterSize} ${r.rqNumber} ${r.fullName} ${r.moo} ${r.subdistrict} ${r.district} ${r.province} ${r.locationSummary} ${r.phone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [eligibleRecords, areaFilter, searchText, editableFieldsByUid]);

  // Prune selectedUids if source records disappeared
  useEffect(() => {
    const eligibleUidSet = new Set(eligibleRecords.map((r) => r.uid));
    setSelectedUids((prev) => {
      const filtered = prev.filter((id) => eligibleUidSet.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [eligibleRecords]);

  const selectedRecords = useMemo(() => {
    const set = new Set(selectedUids);
    return eligibleRecords.filter((r) => set.has(r.uid));
  }, [eligibleRecords, selectedUids]);

  const selectedSummary = useMemo(() => {
    const subtotalAmount = selectedRecords.reduce((s, r) => {
      const ovPrice = editableFieldsByUid[r.uid]?.price;
      const num =
        ovPrice !== undefined
          ? Number.parseFloat(String(ovPrice).replace(/,/g, '')) || 0
          : r.price || 0;
      return s + num;
    }, 0);
    const vatAmount = includeTax ? Math.round(subtotalAmount * 0.07 * 100) / 100 : 0;
    const grandTotalAmount = Math.round((subtotalAmount + vatAmount) * 100) / 100;
    const mappedCount = selectedRecords.filter(
      (r) => r.latitude !== null && r.longitude !== null
    ).length;
    const areaCount = new Set(
      selectedRecords.map((r) => splitArea(r).subdistrict).filter((v) => v !== '-')
    ).size;
    return {
      totalAmount: subtotalAmount,
      vatAmount,
      grandTotalAmount,
      mappedCount,
      areaCount,
    };
  }, [selectedRecords, editableFieldsByUid, includeTax]);

  const allVisibleSelected =
    visibleCandidates.length > 0 &&
    visibleCandidates.every((r) => selectedUids.includes(r.uid));

  const toggleSelectOne = (uid: string) => {
    setSelectedUids((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = visibleCandidates.map((r) => r.uid);
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleIds);
      setSelectedUids((prev) => prev.filter((id) => !visibleSet.has(id)));
    } else {
      setSelectedUids((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const buildDraftBatch = (): CompletedBatch => {
    return {
      id: `draft_${Date.now()}`,
      spreadsheetId,
      batchCode: batchCode.trim() || generateDefaultBatchCode(batches.length),
      title: batchTitle.trim() || 'ชุดงานติดตั้งมาตรวัดน้ำเสร็จสิ้น',
      completedDate: completedDate || todayIso,
      inspectorName: inspectorName.trim(),
      note: batchNote.trim(),
      exportFormats: ['excel', 'pdf'],
      statusUpdatedInSheet: false,
      includeTax,
      memoSigners: {
        meterSizeText: memoSigners.meterSizeText.trim() || DEFAULT_MEMO_SIGNERS.meterSizeText,
        proposerName: memoSigners.proposerName.trim() || DEFAULT_MEMO_SIGNERS.proposerName,
        proposerTitle: memoSigners.proposerTitle.trim() || DEFAULT_MEMO_SIGNERS.proposerTitle,
        managerName: memoSigners.managerName.trim() || DEFAULT_MEMO_SIGNERS.managerName,
        managerTitle: memoSigners.managerTitle.trim() || DEFAULT_MEMO_SIGNERS.managerTitle,
        adminHeadName: memoSigners.adminHeadName.trim() || DEFAULT_MEMO_SIGNERS.adminHeadName,
        adminHeadTitle: memoSigners.adminHeadTitle.trim() || DEFAULT_MEMO_SIGNERS.adminHeadTitle,
        inspectorTitle: memoSigners.inspectorTitle.trim() || DEFAULT_MEMO_SIGNERS.inspectorTitle,
      },
      recordCount: selectedRecords.length,
      totalAmount: selectedSummary.totalAmount,
      mappedCount: selectedSummary.mappedCount,
      records: toBatchRecords(selectedRecords, true, editableFieldsByUid),
      createdAt: Date.now(),
    };
  };

  const handleQuickExportDraft = async (format: 'excel' | 'pdf') => {
    if (selectedRecords.length === 0) {
      onNotify('กรุณาเลือกรายการอย่างน้อย 1 รายการก่อนส่งออก', 'warning');
      return;
    }
    setIsExportingId(`draft_${format}`);
    try {
      const draft = buildDraftBatch();
      const fname =
        format === 'excel'
          ? await exportCompletedBatchToExcel(draft)
          : await exportCompletedBatchToPdf(draft);
      onNotify(`ส่งออกไฟล์ (${fname}) เรียบร้อยแล้ว`, 'success');
    } catch (err) {
      onNotify(
        `ส่งออกไม่สำเร็จ: ${err instanceof Error ? err.message : 'เกิดข้อผิดพลาด'}`,
        'error'
      );
    } finally {
      setIsExportingId(null);
    }
  };

  const handleSaveBatchAndExport = async () => {
    const freshSelected = selectedRecords.filter(
      (r) => !isRecordAlreadyBatched(r, batchedKeySet)
    );
    if (freshSelected.length === 0) {
      onNotify(
        'กรุณาเลือกรายการที่ยังไม่เคยรวมชุดอย่างน้อย 1 รายการ',
        'warning'
      );
      return;
    }

    setIsSaving(true);
    try {
      const { batch, batches: nextList, syncedToSheetTab, syncedToDrive } = await saveCompletedBatch({
        spreadsheetId,
        batchCode: batchCode.trim() || generateDefaultBatchCode(batches.length),
        title: batchTitle.trim() || 'ชุดงานติดตั้งมาตรวัดน้ำเสร็จสิ้น',
        completedDate: completedDate || todayIso,
        inspectorName: inspectorName.trim(),
        note: batchNote.trim(),
        exportFormats: ['excel', 'pdf'],
        statusUpdatedInSheet: false,
        includeTax,
        memoSigners: {
          meterSizeText: memoSigners.meterSizeText.trim() || DEFAULT_MEMO_SIGNERS.meterSizeText,
          proposerName: memoSigners.proposerName.trim() || DEFAULT_MEMO_SIGNERS.proposerName,
          proposerTitle: memoSigners.proposerTitle.trim() || DEFAULT_MEMO_SIGNERS.proposerTitle,
          managerName: memoSigners.managerName.trim() || DEFAULT_MEMO_SIGNERS.managerName,
          managerTitle: memoSigners.managerTitle.trim() || DEFAULT_MEMO_SIGNERS.managerTitle,
          adminHeadName: memoSigners.adminHeadName.trim() || DEFAULT_MEMO_SIGNERS.adminHeadName,
          adminHeadTitle: memoSigners.adminHeadTitle.trim() || DEFAULT_MEMO_SIGNERS.adminHeadTitle,
          inspectorTitle: memoSigners.inspectorTitle.trim() || DEFAULT_MEMO_SIGNERS.inspectorTitle,
        },
        records: toBatchRecords(freshSelected, true, editableFieldsByUid),
        appsScriptUrl,
        accessToken,
        driveFolderId,
      });

      setBatches(nextList);
      setExpandedBatchId(batch.id);
      setSelectedUids([]);
      setBatchNote('');
      setBatchCode(generateDefaultBatchCode(nextList.length));

      const syncNote =
        syncedToDrive && syncedToSheetTab
          ? ' และบันทึกลง Google Drive + แท็บ "ที่เก็บข้อมูล_ติดตั้งเสร็จสิ้น" ใน Google Sheet แล้ว'
          : syncedToDrive
            ? ' และบันทึกลงโฟลเดอร์ Google Drive เรียบร้อยแล้ว'
            : syncedToSheetTab
              ? ' และบันทึกลงแท็บ "ที่เก็บข้อมูล_ติดตั้งเสร็จสิ้น" ใน Google Sheet แล้ว'
              : ' และบันทึกเข้าที่เก็บข้อมูลเรียบร้อยแล้ว';
      onNotify(
        `บันทึกชุดงาน "${batch.title}" (${batch.recordCount} รายการ)${syncNote} (สามารถกดดาวน์โหลด Excel / PDF เองได้ในแท็บที่เก็บข้อมูลชุดงาน)`,
        'success'
      );
    } catch (err) {
      onNotify(
        `บันทึกชุดงานไม่สำเร็จ: ${err instanceof Error ? err.message : 'เกิดข้อผิดพลาด'}`,
        'error'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportSavedBatch = async (
    batch: CompletedBatch,
    format: 'excel' | 'pdf'
  ) => {
    const key = `${batch.id}_${format}`;
    setIsExportingId(key);
    try {
      const fname =
        format === 'excel'
          ? await exportCompletedBatchToExcel(batch)
          : await exportCompletedBatchToPdf(batch);
      onNotify(`ส่งออกไฟล์ (${fname}) เรียบร้อยแล้ว`, 'success');
    } catch (err) {
      onNotify(
        `ส่งออกไม่สำเร็จ: ${err instanceof Error ? err.message : 'เกิดข้อผิดพลาด'}`,
        'error'
      );
    } finally {
      setIsExportingId(null);
    }
  };

  const handleDeleteSavedBatch = async (batchId: string) => {
    try {
      const next = await deleteCompletedBatch(spreadsheetId, batchId, {
        appsScriptUrl,
        accessToken,
        driveFolderId,
      });
      setBatches(next);
      setConfirmDeleteId(null);
      if (expandedBatchId === batchId) {
        setExpandedBatchId(next[0]?.id || null);
      }
      onNotify('ลบชุดบันทึกออกจากคลังที่เก็บข้อมูลแล้ว', 'info');
    } catch {
      onNotify('ไม่สามารถลบชุดบันทึกได้', 'error');
    }
  };

  const handleArchiveRecordFieldChange = (
    batchId: string,
    recordIndex: number,
    field: keyof BatchRecordEditableFields,
    value: string
  ) => {
    setBatches((prev) =>
      prev.map((b) => {
        if (b.id !== batchId) return b;
        const nextRecs: CompletedBatchRecord[] = b.records.map((rec, idx) => {
          if (idx !== recordIndex) return rec;
          if (field === 'price') {
            const parsed = Number.parseFloat(value.replace(/,/g, ''));
            return { ...rec, price: Number.isFinite(parsed) ? parsed : 0 };
          }
          return { ...rec, [field]: value };
        });
        const nextTotal = nextRecs.reduce((s, r) => s + (Number(r.price) || 0), 0);
        return { ...b, records: nextRecs, totalAmount: nextTotal };
      })
    );
    setDirtyArchiveBatchIds((prev) => ({ ...prev, [batchId]: true }));
  };

  const handleArchiveBatchMetaChange = (
    batchId: string,
    patch: Partial<Pick<CompletedBatch, 'batchCode' | 'title' | 'completedDate' | 'inspectorName' | 'includeTax'>>
  ) => {
    setBatches((prev) =>
      prev.map((b) => (b.id === batchId ? { ...b, ...patch } : b))
    );
    setDirtyArchiveBatchIds((prev) => ({ ...prev, [batchId]: true }));
  };

  const handleArchiveMemoSignerChange = (
    batchId: string,
    field: keyof BatchMemoSigners,
    value: string
  ) => {
    setBatches((prev) =>
      prev.map((b) =>
        b.id === batchId
          ? {
              ...b,
              memoSigners: {
                ...DEFAULT_MEMO_SIGNERS,
                ...(b.memoSigners || {}),
                [field]: value,
              },
            }
          : b
      )
    );
    setDirtyArchiveBatchIds((prev) => ({ ...prev, [batchId]: true }));
  };

  const handleSaveArchiveBatchEdits = async (batch: CompletedBatch) => {
    setConfirmSaveBatchId(null);
    setSavingArchiveBatchId(batch.id);
    try {
      const { batches: nextList, syncedToSheetTab, syncedToDrive } = await updateCompletedBatch(
        batch,
        appsScriptUrl,
        { accessToken, driveFolderId }
      );
      setBatches(nextList);
      setDirtyArchiveBatchIds((prev) => {
        const cp = { ...prev };
        delete cp[batch.id];
        return cp;
      });
      const syncMsg =
        syncedToDrive && syncedToSheetTab
          ? `บันทึกการแก้ไขชุดงาน "${batch.batchCode}" ลง Google Drive และ Google Sheet แล้ว`
          : syncedToDrive
            ? `บันทึกการแก้ไขชุดงาน "${batch.batchCode}" ลงโฟลเดอร์ Google Drive แล้ว`
            : syncedToSheetTab
              ? `บันทึกการแก้ไขชุดงาน "${batch.batchCode}" และซิงค์ลง Google Sheet แล้ว`
              : `บันทึกการแก้ไขเลขที่งาน / เลขที่ผู้ใช้น้ำ / หมายเลขมาตร / ขนาดมาตร ในชุด "${batch.batchCode}" แล้ว`;
      onNotify(syncMsg, 'success');
    } catch (err) {
      onNotify(
        `บันทึกการแก้ไขไม่สำเร็จ: ${err instanceof Error ? err.message : 'เกิดข้อผิดพลาด'}`,
        'error'
      );
    } finally {
      setSavingArchiveBatchId(null);
    }
  };

  const filteredBatches = useMemo(() => {
    const q = archiveSearch.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter((b) => {
      const hay = `${b.batchCode} ${b.title} ${b.inspectorName} ${b.note} ${b.records
        .map(
          (r) =>
            `${r.jobNumber || r.rqNumber} ${r.waterUserNo || ''} ${r.meterNumber || ''} ${r.meterSize || ''} ${r.fullName} ${r.subdistrict}`
        )
        .join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [batches, archiveSearch]);

  useEffect(() => {
    setArchiveCurrentPage(1);
  }, [archivePageSize, archiveSearch]);

  const totalArchivePages = Math.max(1, Math.ceil(filteredBatches.length / archivePageSize));
  const safeArchivePage = Math.min(archiveCurrentPage, totalArchivePages);
  const archiveStartIndex = (safeArchivePage - 1) * archivePageSize;
  const archiveEndIndex = Math.min(archiveStartIndex + archivePageSize, filteredBatches.length);

  const paginatedBatches = useMemo(
    () => filteredBatches.slice(archiveStartIndex, archiveStartIndex + archivePageSize),
    [filteredBatches, archiveStartIndex, archivePageSize]
  );

  const archivePageNumbers = useMemo(() => {
    if (totalArchivePages <= 7) {
      return Array.from({ length: totalArchivePages }, (_, i) => i + 1);
    }
    const pages: Array<number | 'ellipsis-left' | 'ellipsis-right'> = [1];
    const left = Math.max(2, safeArchivePage - 1);
    const right = Math.min(totalArchivePages - 1, safeArchivePage + 1);
    if (left > 2) pages.push('ellipsis-left');
    for (let p = left; p <= right; p += 1) {
      pages.push(p);
    }
    if (right < totalArchivePages - 1) pages.push('ellipsis-right');
    pages.push(totalArchivePages);
    return pages;
  }, [totalArchivePages, safeArchivePage]);

  if (mode === 'archive') {
    return (
      <div className="p-4 sm:p-5 space-y-4">
        <datalist id="pwa-meter-sizes-list">
          <option value='1/2"' />
          <option value='3/4"' />
          <option value='1"' />
          <option value='1 1/2"' />
          <option value='2"' />
          <option value='3"' />
          <option value='4"' />
        </datalist>
        {/* Archive Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-[#EDF5FC] dark:bg-[#2271B3]/20 text-[#2271B3] dark:text-[#5EA6E0] flex items-center justify-center shrink-0">
              <Archive className="w-4 h-4" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  ที่เก็บข้อมูลชุดงานติดตั้งเสร็จสิ้น
                </h3>
                <a
                  href={buildDriveFolderUrl(driveFolderId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2271B3] dark:text-[#5EA6E0] hover:underline"
                >
                  <span>เปิดโฟลเดอร์ Drive</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                บันทึกประวัติชุดงานพร้อมข้อมูลครบทุกคอลัมน์ สามารถเปิดดู แก้ไข และส่งออกเป็น Excel หรือ PDF ซ้ำได้ตลอดเวลา
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={archiveSearch}
              onChange={(e) => setArchiveSearch(e.target.value)}
              placeholder="ค้นหารหัสชุดงาน, ชื่อชุด, เลข RQ, ชื่อลูกค้า..."
              className="w-full bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-lg py-2 pl-9 pr-3 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
            />
          </div>
        </div>

        {isLoadingBatches ? (
          <div className="py-12 text-center text-xs text-slate-400 dark:text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#2271B3]" />
            <span>กำลังโหลดข้อมูลชุดงานที่บันทึกไว้...</span>
          </div>
        ) : filteredBatches.length === 0 ? (
          <div className="py-12 px-4 text-center bg-[#F8FAFD] dark:bg-[#0D1724] border border-dashed border-slate-300 dark:border-[#263850] rounded-xl space-y-2">
            <FolderCheck className="w-8 h-8 mx-auto text-[#2271B3]/60 dark:text-[#5EA6E0]/60" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              ยังไม่มีชุดข้อมูลในคลังที่เก็บข้อมูล
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ไปที่แท็บ &ldquo;รวมชุดติดตั้งเสร็จสิ้น&rdquo; เพื่อเลือกรายการสถานะ &ldquo;ติดตั้งเสร็จสิ้น&rdquo; แล้วบันทึกเข้าคลังข้อมูล
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {paginatedBatches.map((batch) => {
              const isExpanded = expandedBatchId === batch.id;
              const isConfirmingDel = confirmDeleteId === batch.id;
              return (
                <div
                  key={batch.id}
                  className="bg-[#F8FAFD] dark:bg-[#0D1724] border border-slate-200 dark:border-[#213145] rounded-xl overflow-hidden transition-colors"
                >
                  <div className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-[#2271B3] text-white font-mono text-[11px] font-semibold">
                          {batch.batchCode}
                        </span>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {batch.title}
                        </h4>
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">
                          {batch.recordCount.toLocaleString('th-TH')} รายการ ·{' '}
                          {(batch.includeTax === false
                            ? batch.totalAmount
                            : Math.round(batch.totalAmount * 1.07 * 100) / 100
                          ).toLocaleString('th-TH', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          ฿ ({batch.includeTax === false ? 'ไม่รวมภาษี' : 'รวม VAT 7%'})
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-[#2271B3] dark:text-[#5EA6E0]" />
                          วันที่ขออนุมัติ: {formatThaiDate(batch.completedDate)}
                        </span>
                        {batch.inspectorName && (
                          <span className="inline-flex items-center gap-1">
                            <UserCheck className="w-3.5 h-3.5 text-[#2271B3] dark:text-[#5EA6E0]" />
                            ผู้ควบคุมงาน: {batch.inspectorName}
                          </span>
                        )}
                        <span>
                          บันทึกเมื่อ {new Date(batch.createdAt).toLocaleString('th-TH')}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleExportSavedBatch(batch, 'excel')}
                        disabled={isExportingId !== null}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors"
                      >
                        {isExportingId === `${batch.id}_excel` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                        )}
                        <span>Excel</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleExportSavedBatch(batch, 'pdf')}
                        disabled={isExportingId !== null}
                        className="px-3 py-1.5 bg-[#2271B3] hover:bg-[#1A5A8F] dark:bg-[#3584C7] dark:hover:bg-[#2271B3] disabled:opacity-50 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors"
                      >
                        {isExportingId === `${batch.id}_pdf` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FileText className="w-3.5 h-3.5" />
                        )}
                        <span>PDF</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedBatchId(isExpanded ? null : batch.id)
                        }
                        className="px-3 py-1.5 bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] hover:bg-slate-100 dark:hover:bg-[#162336] text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg inline-flex items-center gap-1 transition-colors"
                      >
                        <span>{isExpanded ? 'ซ่อนรายการ' : 'ดูข้อมูลครบถ้วน'}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {isConfirmingDel ? (
                        <div className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/60 rounded-lg px-2 py-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteSavedBatch(batch.id)}
                            className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline px-1"
                          >
                            ยืนยันลบ
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-slate-500 dark:text-slate-400 hover:underline px-1"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(batch.id)}
                          className="p-1.5 bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] hover:border-rose-300 dark:hover:border-rose-600/50 text-rose-600 dark:text-rose-400 rounded-lg transition-colors"
                          title="ลบชุดบันทึกนี้"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-200 dark:border-[#213145] bg-white dark:bg-[#111C2B]">
                      <div className="px-4 py-2 bg-slate-50/80 dark:bg-[#0D1724] border-b border-slate-200 dark:border-[#213145] flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1.5">
                          <PencilLine className="w-3.5 h-3.5 text-[#2271B3] dark:text-[#5EA6E0]" />
                          <span>
                            สามารถพิมพ์แก้ไข <strong className="text-slate-700 dark:text-slate-200">รหัสชุดงาน (ที่), วันที่ขออนุมัติ, ภาษี, รายชื่อในบันทึกข้อความ และข้อมูลในตาราง</strong> ได้โดยตรง
                          </span>
                        </span>
                        {dirtyArchiveBatchIds[batch.id] && (
                          confirmSaveBatchId === batch.id ? (
                            <div className="inline-flex items-center gap-1.5 bg-[#EDF5FC] dark:bg-[#162B45] border border-[#2271B3]/40 dark:border-[#3B8CE2]/50 rounded-md px-2.5 py-1">
                              <button
                                type="button"
                                onClick={() => handleSaveArchiveBatchEdits(batch)}
                                disabled={savingArchiveBatchId === batch.id}
                                className="text-[11px] font-semibold text-[#0B4DA2] dark:text-[#7CC0F5] hover:underline disabled:opacity-50"
                              >
                                ยืนยันบันทึกทับใน Drive/ชีท
                              </button>
                              <span className="text-slate-300 dark:text-slate-600">|</span>
                              <button
                                type="button"
                                onClick={() => setConfirmSaveBatchId(null)}
                                className="text-[11px] text-slate-500 dark:text-slate-400 hover:underline"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmSaveBatchId(batch.id)}
                              disabled={savingArchiveBatchId === batch.id}
                              className="px-3 py-1 rounded-md bg-[#2271B3] hover:bg-[#1A5A8F] text-white font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                            >
                              {savingArchiveBatchId === batch.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Save className="w-3 h-3" />
                              )}
                              <span>บันทึกข้อมูลที่แก้ไข</span>
                            </button>
                          )
                        )}
                      </div>

                      {/* Editable Memo Metadata & Signers for this archived batch */}
                      <div className="px-4 py-3 bg-[#F8FAFD]/70 dark:bg-[#0B131E] border-b border-slate-200 dark:border-[#213145] space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-[#2271B3] dark:text-[#5EA6E0]">
                            ตั้งค่าบันทึกข้อความ (แผ่นแรก) และภาษีของชุดงานนี้
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleArchiveBatchMetaChange(batch.id, { includeTax: true })}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                                batch.includeTax !== false
                                  ? 'bg-[#EDF5FC] dark:bg-[#2271B3]/25 border-[#2271B3] text-[#1A5A8F] dark:text-[#7CC0F5]'
                                  : 'bg-white dark:bg-[#111C2B] border-slate-200 dark:border-[#263850] text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {batch.includeTax !== false ? (
                                <CheckSquare className="w-3.5 h-3.5 text-[#2271B3] dark:text-[#5EA6E0]" />
                              ) : (
                                <Square className="w-3.5 h-3.5" />
                              )}
                              <span>เพิ่มรายการภาษี (7%)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleArchiveBatchMetaChange(batch.id, { includeTax: false })}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                                batch.includeTax === false
                                  ? 'bg-[#EDF5FC] dark:bg-[#2271B3]/25 border-[#2271B3] text-[#1A5A8F] dark:text-[#7CC0F5]'
                                  : 'bg-white dark:bg-[#111C2B] border-slate-200 dark:border-[#263850] text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {batch.includeTax === false ? (
                                <CheckSquare className="w-3.5 h-3.5 text-[#2271B3] dark:text-[#5EA6E0]" />
                              ) : (
                                <Square className="w-3.5 h-3.5" />
                              )}
                              <span>ไม่รวมภาษี</span>
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px]">
                          <div>
                            <label className="block text-slate-500 dark:text-slate-400 mb-0.5">
                              ที่ (รหัสชุดงาน)
                            </label>
                            <input
                              type="text"
                              value={batch.batchCode || ''}
                              onChange={(e) =>
                                handleArchiveBatchMetaChange(batch.id, { batchCode: e.target.value })
                              }
                              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3]"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-500 dark:text-slate-400 mb-0.5">
                              วันที่ขออนุมัติ
                            </label>
                            <input
                              type="date"
                              value={batch.completedDate || ''}
                              onChange={(e) =>
                                handleArchiveBatchMetaChange(batch.id, { completedDate: e.target.value })
                              }
                              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3]"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-500 dark:text-slate-400 mb-0.5">
                              ขนาดมาตรในบันทึกข้อความ
                            </label>
                            <input
                              type="text"
                              value={batch.memoSigners?.meterSizeText ?? DEFAULT_MEMO_SIGNERS.meterSizeText}
                              onChange={(e) =>
                                handleArchiveMemoSignerChange(batch.id, 'meterSizeText', e.target.value)
                              }
                              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3]"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-500 dark:text-slate-400 mb-0.5">
                              ผู้ควบคุมงาน
                            </label>
                            <input
                              type="text"
                              value={batch.inspectorName || ''}
                              onChange={(e) =>
                                handleArchiveBatchMetaChange(batch.id, { inspectorName: e.target.value })
                              }
                              placeholder="นายสามารถ บุญกัน"
                              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3]"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-500 dark:text-slate-400 mb-0.5">
                              ผู้เสนอเรื่อง
                            </label>
                            <input
                              type="text"
                              value={batch.memoSigners?.proposerName ?? DEFAULT_MEMO_SIGNERS.proposerName}
                              onChange={(e) =>
                                handleArchiveMemoSignerChange(batch.id, 'proposerName', e.target.value)
                              }
                              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3]"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-500 dark:text-slate-400 mb-0.5">
                              ตำแหน่งผู้เสนอเรื่อง
                            </label>
                            <input
                              type="text"
                              value={batch.memoSigners?.proposerTitle ?? DEFAULT_MEMO_SIGNERS.proposerTitle}
                              onChange={(e) =>
                                handleArchiveMemoSignerChange(batch.id, 'proposerTitle', e.target.value)
                              }
                              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3]"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-500 dark:text-slate-400 mb-0.5">
                              ผู้อนุมัติ (ผู้จัดการฯ)
                            </label>
                            <input
                              type="text"
                              value={batch.memoSigners?.managerName ?? DEFAULT_MEMO_SIGNERS.managerName}
                              onChange={(e) =>
                                handleArchiveMemoSignerChange(batch.id, 'managerName', e.target.value)
                              }
                              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3]"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-500 dark:text-slate-400 mb-0.5">
                              หัวหน้างานอำนวยการ
                            </label>
                            <input
                              type="text"
                              value={batch.memoSigners?.adminHeadName ?? DEFAULT_MEMO_SIGNERS.adminHeadName}
                              onChange={(e) =>
                                handleArchiveMemoSignerChange(batch.id, 'adminHeadName', e.target.value)
                              }
                              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3]"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-50 dark:bg-[#0F1826] border-b border-slate-200 dark:border-[#213145] text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            <tr>
                              <th className="py-2.5 px-3 whitespace-nowrap">#</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">เลขที่ งาน</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">เลขที่ผู้ใช้น้ำ</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">ชื่อ-สกุล</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">บ้านเลขที่</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">หมู่ที่</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">ตำบล</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">อำเภอ</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">เบอร์โทร</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">วงเงินที่จะจ้าง</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">หมายเลขมาตร</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">ขนาดมาตร</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">หมายเหตุ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-[#1B2B40] text-xs text-slate-700 dark:text-slate-300">
                            {batch.records.map((rec, i) => {
                              const area = splitArea(rec);
                              const jobVal = rec.jobNumber ?? rec.rqNumber ?? '';
                              const waterVal = rec.waterUserNo ?? '';
                              const houseVal = rec.houseNo ?? '';
                              const priceVal = Number.isFinite(Number(rec.price)) ? String(rec.price) : '0';
                              const meterVal = rec.meterNumber ?? '';
                              const meterSizeVal = rec.meterSize ?? '';
                              const noteVal = rec.note ?? '';
                              return (
                                <tr
                                  key={`${batch.id}_${rec.uid}_${i}`}
                                  className="hover:bg-[#EDF5FC]/40 dark:hover:bg-[#162336]"
                                >
                                  <td className="py-2 px-3 tabular-nums text-slate-500">
                                    {i + 1}
                                  </td>
                                  <td className="py-1.5 px-2 whitespace-nowrap">
                                    <input
                                      type="text"
                                      value={jobVal}
                                      onChange={(e) =>
                                        handleArchiveRecordFieldChange(
                                          batch.id,
                                          i,
                                          'jobNumber',
                                          e.target.value
                                        )
                                      }
                                      placeholder="เลขที่ งาน..."
                                      className="w-32 bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2 whitespace-nowrap">
                                    <input
                                      type="text"
                                      value={waterVal}
                                      onChange={(e) =>
                                        handleArchiveRecordFieldChange(
                                          batch.id,
                                          i,
                                          'waterUserNo',
                                          e.target.value
                                        )
                                      }
                                      placeholder="เลขที่ผู้ใช้น้ำ..."
                                      className="w-32 bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                                    />
                                  </td>
                                  <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                    {rec.fullName || '-'}
                                  </td>
                                  <td className="py-1.5 px-2 whitespace-nowrap">
                                    <input
                                      type="text"
                                      value={houseVal}
                                      onChange={(e) =>
                                        handleArchiveRecordFieldChange(
                                          batch.id,
                                          i,
                                          'houseNo',
                                          e.target.value
                                        )
                                      }
                                      placeholder="บ้านเลขที่..."
                                      className="w-20 bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                                    />
                                  </td>
                                  <td className="py-2 px-3 whitespace-nowrap">
                                    {rec.moo ? `หมู่ที่ ${rec.moo}` : '-'}
                                  </td>
                                  <td className="py-2 px-3 whitespace-nowrap">
                                    {area.subdistrict}
                                  </td>
                                  <td className="py-2 px-3 whitespace-nowrap">
                                    {area.district}
                                  </td>
                                  <td className="py-2 px-3 font-mono whitespace-nowrap">
                                    {rec.phone || '-'}
                                  </td>
                                  <td className="py-1.5 px-2 whitespace-nowrap">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={priceVal}
                                      onChange={(e) =>
                                        handleArchiveRecordFieldChange(
                                          batch.id,
                                          i,
                                          'price',
                                          e.target.value
                                        )
                                      }
                                      className="w-24 bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-right text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2 whitespace-nowrap">
                                    <input
                                      type="text"
                                      value={meterVal}
                                      onChange={(e) =>
                                        handleArchiveRecordFieldChange(
                                          batch.id,
                                          i,
                                          'meterNumber',
                                          e.target.value
                                        )
                                      }
                                      placeholder="หมายเลขมาตร..."
                                      className="w-36 bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2 whitespace-nowrap">
                                    <input
                                      type="text"
                                      list="pwa-meter-sizes-list"
                                      value={meterSizeVal}
                                      onChange={(e) =>
                                        handleArchiveRecordFieldChange(
                                          batch.id,
                                          i,
                                          'meterSize',
                                          e.target.value
                                        )
                                      }
                                      placeholder='ขนาดมาตร...'
                                      className="w-24 bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2 whitespace-nowrap">
                                    <input
                                      type="text"
                                      value={noteVal}
                                      onChange={(e) =>
                                        handleArchiveRecordFieldChange(
                                          batch.id,
                                          i,
                                          'note',
                                          e.target.value
                                        )
                                      }
                                      placeholder="หมายเหตุ..."
                                      className="w-28 bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Pagination Bar (10 / 20 / 50 / 100 items per page) */}
            <div className="px-3.5 sm:px-5 py-3 bg-[#F4F8FD] dark:bg-[#0A1424] border border-[#DCE6F3] dark:border-[#1D3350] rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-slate-600 dark:text-slate-300 tabular-nums">
                  แสดง{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {(archiveStartIndex + 1).toLocaleString('th-TH')}–{archiveEndIndex.toLocaleString('th-TH')}
                  </strong>{' '}
                  จาก{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {filteredBatches.length.toLocaleString('th-TH')}
                  </strong>{' '}
                  รายการ
                </span>

                <div className="inline-flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    แสดงต่อหน้า:
                  </span>
                  <div
                    role="group"
                    aria-label="จำนวนชุดงานต่อหน้า"
                    className="inline-flex items-center bg-white dark:bg-[#0F1B2E] p-0.5 rounded-lg border border-[#D5E3F4] dark:border-[#1D3350]"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => {
                      const active = archivePageSize === size;
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setArchivePageSize(size)}
                          aria-pressed={active}
                          className={`px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-semibold tabular-nums transition-colors ${
                            active
                              ? 'bg-[#0F62BD] dark:bg-[#2B7CD3] text-white shadow-xs'
                              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-[#EDF5FD] dark:hover:bg-[#15253D]'
                          }`}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setArchiveCurrentPage((p) => Math.max(1, Math.min(p, totalArchivePages) - 1))
                  }
                  disabled={safeArchivePage <= 1}
                  aria-label="หน้าก่อนหน้า"
                  className="px-2.5 py-1.5 rounded-lg border border-[#D5E3F4] dark:border-[#1D3350] bg-white dark:bg-[#0F1B2E] text-slate-700 dark:text-slate-200 hover:bg-[#EDF5FD] dark:hover:bg-[#15253D] disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center gap-1 font-medium transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>ก่อนหน้า</span>
                </button>

                <div className="inline-flex items-center gap-1">
                  {archivePageNumbers.map((item) =>
                    typeof item === 'number' ? (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setArchiveCurrentPage(item)}
                        aria-current={item === safeArchivePage ? 'page' : undefined}
                        className={`min-w-[30px] h-7 px-2 rounded-lg text-[11px] font-semibold tabular-nums border transition-colors ${
                          item === safeArchivePage
                            ? 'bg-[#0F62BD] dark:bg-[#2B7CD3] border-[#0F62BD] dark:border-[#2B7CD3] text-white shadow-xs'
                            : 'bg-white dark:bg-[#0F1B2E] border-[#D5E3F4] dark:border-[#1D3350] text-slate-700 dark:text-slate-200 hover:bg-[#EDF5FD] dark:hover:bg-[#15253D]'
                        }`}
                      >
                        {item}
                      </button>
                    ) : (
                      <span
                        key={item}
                        className="px-1 text-slate-400 dark:text-slate-500 select-none"
                      >
                        ...
                      </span>
                    )
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setArchiveCurrentPage((p) =>
                      Math.min(totalArchivePages, Math.min(p, totalArchivePages) + 1)
                    )
                  }
                  disabled={safeArchivePage >= totalArchivePages}
                  aria-label="หน้าถัดไป"
                  className="px-2.5 py-1.5 rounded-lg border border-[#D5E3F4] dark:border-[#1D3350] bg-white dark:bg-[#0F1B2E] text-slate-700 dark:text-slate-200 hover:bg-[#EDF5FD] dark:hover:bg-[#15253D] disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center gap-1 font-medium transition-colors"
                >
                  <span>ถัดไป</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Mode: 'builder' ("รวมชุดติดตั้งเสร็จสิ้น" from unbatched "ติดตั้งเสร็จสิ้น")
  return (
    <div className="p-4 sm:p-5 space-y-5">
      <datalist id="pwa-meter-sizes-list">
        <option value='1/2"' />
        <option value='3/4"' />
        <option value='1"' />
        <option value='1 1/2"' />
        <option value='2"' />
        <option value='3"' />
        <option value='4"' />
      </datalist>
      {/* Builder Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-[#EDF5FC] dark:bg-[#2271B3]/20 text-[#2271B3] dark:text-[#5EA6E0] flex items-center justify-center shrink-0">
            <PackageCheck className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              รวมชุดติดตั้งเสร็จสิ้น (ดึงจากรายการ &ldquo;ติดตั้งเสร็จสิ้น&rdquo; ที่ยังไม่เคยรวมชุด)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ข้อมูลที่เคยรวมชุดไปแล้วจะถูกซ่อนอัตโนมัติ ไม่สามารถนำมารวมชุดซ้ำได้อีก (หากลบชุดงานเดิมออกจากที่เก็บข้อมูล รายการจะกลับมาให้เลือกใหม่ได้)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:flex-none sm:w-56">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="ค้นหาเลข RQ, ชื่อ, หมู่, เบอร์..."
              className="w-full bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-lg py-2 pl-9 pr-3 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
            />
          </div>

          <select
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
            className="bg-slate-50 dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-lg py-2 px-2.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
          >
            <option value="">ทุกตำบล / พื้นที่</option>
            {areaOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Multi-Select Source Table */}
      <div className="border border-slate-200 dark:border-[#213145] rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 bg-[#F8FAFD] dark:bg-[#0D1724] border-b border-slate-200 dark:border-[#213145] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleSelectAllVisible}
              disabled={visibleCandidates.length === 0}
              className="inline-flex items-center gap-1.5 font-semibold text-[#2271B3] dark:text-[#5EA6E0] hover:underline disabled:opacity-40"
            >
              {allVisibleSelected ? (
                <CheckSquare className="w-4 h-4" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              <span>
                {allVisibleSelected
                  ? 'ยกเลิกเลือกทั้งหมดที่แสดง'
                  : `เลือกทั้งหมด (${visibleCandidates.length} รายการ)`}
              </span>
            </button>
            {selectedUids.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedUids([])}
                className="text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
              >
                ล้างที่เลือก ({selectedUids.length})
              </button>
            )}
          </div>
          <span className="text-slate-500 dark:text-slate-400 tabular-nums">
            พร้อมรวมชุด {eligibleRecords.length.toLocaleString('th-TH')} รายการ
            {alreadyBatchedCount > 0 && (
              <> · รวมชุดไปแล้ว {alreadyBatchedCount.toLocaleString('th-TH')} รายการ</>
            )}
            {' '}· เลือกแล้ว{' '}
            <strong className="text-[#2271B3] dark:text-[#5EA6E0]">
              {selectedRecords.length}
            </strong>{' '}
            รายการ
          </span>
        </div>

        <div className="overflow-x-auto max-h-[380px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 dark:bg-[#0F1826] border-b border-slate-200 dark:border-[#213145] z-10 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              <tr>
                <th className="py-2.5 px-3 text-center w-10">เลือก</th>
                <th className="py-2.5 px-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <span>เลขที่ งาน</span>
                    <PencilLine className="w-3 h-3 text-[#2271B3] dark:text-[#5EA6E0]" />
                  </span>
                </th>
                <th className="py-2.5 px-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <span>เลขที่ผู้ใช้น้ำ</span>
                    <PencilLine className="w-3 h-3 text-[#2271B3] dark:text-[#5EA6E0]" />
                  </span>
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">ชื่อ-สกุล</th>
                <th className="py-2.5 px-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <span>บ้านเลขที่</span>
                    <PencilLine className="w-3 h-3 text-[#2271B3] dark:text-[#5EA6E0]" />
                  </span>
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">หมู่ที่</th>
                <th className="py-2.5 px-3 whitespace-nowrap">ตำบล</th>
                <th className="py-2.5 px-3 whitespace-nowrap">อำเภอ</th>
                <th className="py-2.5 px-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <span>วงเงินที่จะจ้าง</span>
                    <PencilLine className="w-3 h-3 text-[#2271B3] dark:text-[#5EA6E0]" />
                  </span>
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">สถานะ</th>
                <th className="py-2.5 px-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <span>หมายเลขมาตร</span>
                    <PencilLine className="w-3 h-3 text-[#2271B3] dark:text-[#5EA6E0]" />
                  </span>
                </th>
                <th className="py-2.5 px-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <span>ขนาดมาตร</span>
                    <PencilLine className="w-3 h-3 text-[#2271B3] dark:text-[#5EA6E0]" />
                  </span>
                </th>
                <th className="py-2.5 px-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <span>หมายเหตุ</span>
                    <PencilLine className="w-3 h-3 text-[#2271B3] dark:text-[#5EA6E0]" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#1B2B40] text-xs text-slate-700 dark:text-slate-300">
              {visibleCandidates.length === 0 ? (
                <tr>
                  <td
                    colSpan={13}
                    className="py-10 px-4 text-center text-slate-400 dark:text-slate-500"
                  >
                    {alreadyBatchedCount > 0
                      ? 'รายการสถานะ "ติดตั้งเสร็จสิ้น" ทั้งหมดถูกรวมชุดไปแล้ว (ไม่สามารถรวมชุดซ้ำได้อีก)'
                      : 'ไม่พบรายการสถานะ "ติดตั้งเสร็จสิ้น" ที่ยังไม่เคยรวมชุดในขณะนี้'}
                  </td>
                </tr>
              ) : (
                visibleCandidates.map((rec) => {
                  const isChecked = selectedUids.includes(rec.uid);
                  const area = splitArea(rec);
                  const jobVal = getEditableField(rec, 'jobNumber');
                  const waterVal = getEditableField(rec, 'waterUserNo');
                  const houseVal = getEditableField(rec, 'houseNo');
                  const priceVal = getEditableField(rec, 'price');
                  const meterVal = getEditableField(rec, 'meterNumber');
                  const meterSizeVal = getEditableField(rec, 'meterSize');
                  const noteVal = getEditableField(rec, 'note');
                  return (
                    <tr
                      key={rec.uid}
                      onClick={() => toggleSelectOne(rec.uid)}
                      className={`cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-[#EDF5FC] dark:bg-[#19324D]'
                          : 'hover:bg-slate-50 dark:hover:bg-[#162336]'
                      }`}
                    >
                      <td
                        className="py-2 px-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectOne(rec.uid)}
                          className="w-4 h-4 accent-[#2271B3] rounded cursor-pointer align-middle"
                          aria-label={`เลือกรายการ ${jobVal || rec.fullName}`}
                        />
                      </td>
                      <td
                        className="py-1.5 px-2 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={jobVal}
                          onChange={(e) =>
                            setEditableField(rec.uid, 'jobNumber', e.target.value)
                          }
                          placeholder="พิมพ์เลขที่ งาน..."
                          className="w-32 bg-white dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                        />
                      </td>
                      <td
                        className="py-1.5 px-2 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={waterVal}
                          onChange={(e) =>
                            setEditableField(rec.uid, 'waterUserNo', e.target.value)
                          }
                          placeholder="เลขที่ผู้ใช้น้ำ..."
                          className="w-32 bg-white dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                        />
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {rec.fullName || '-'}
                      </td>
                      <td
                        className="py-1.5 px-2 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={houseVal}
                          onChange={(e) =>
                            setEditableField(rec.uid, 'houseNo', e.target.value)
                          }
                          placeholder="บ้านเลขที่..."
                          className="w-20 bg-white dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                        />
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {rec.moo ? `หมู่ที่ ${rec.moo}` : '-'}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">{area.subdistrict}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{area.district}</td>
                      <td
                        className="py-1.5 px-2 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="number"
                          step="0.01"
                          value={priceVal}
                          onChange={(e) =>
                            setEditableField(rec.uid, 'price', e.target.value)
                          }
                          className="w-24 bg-white dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-right text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                        />
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span>{rec.status}</span>
                        </span>
                      </td>
                      <td
                        className="py-1.5 px-2 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={meterVal}
                          onChange={(e) =>
                            setEditableField(rec.uid, 'meterNumber', e.target.value)
                          }
                          placeholder="หมายเลขมาตร..."
                          className="w-36 bg-white dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                        />
                      </td>
                      <td
                        className="py-1.5 px-2 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          list="pwa-meter-sizes-list"
                          value={meterSizeVal}
                          onChange={(e) =>
                            setEditableField(rec.uid, 'meterSize', e.target.value)
                          }
                          placeholder='ขนาดมาตร...'
                          className="w-24 bg-white dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                        />
                      </td>
                      <td
                        className="py-1.5 px-2 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={noteVal}
                          onChange={(e) =>
                            setEditableField(rec.uid, 'note', e.target.value)
                          }
                          placeholder="หมายเหตุ..."
                          className="w-28 bg-white dark:bg-[#0F1826] border border-slate-200 dark:border-[#263850] rounded-md px-2 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Easy Batch Form + File Format Selector + Save & Export */}
      <div className="bg-[#F8FAFD] dark:bg-[#0D1724] border border-slate-200 dark:border-[#213145] rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#213145] pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">
              ข้อมูลชุดงานและรูปแบบเอกสารส่งออก (สำหรับจัดเก็บและส่งงาน)
            </h4>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
            <span className="px-2.5 py-1 rounded-md bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] font-semibold text-[#2271B3] dark:text-[#5EA6E0]">
              เลือกแล้ว {selectedRecords.length} รายการ
            </span>
            <span className="px-2.5 py-1 rounded-md bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] font-semibold text-slate-800 dark:text-slate-100">
              ยอดงาน{' '}
              {selectedSummary.totalAmount.toLocaleString('th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              บาท
            </span>
            {includeTax && (
              <span className="px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 font-semibold text-amber-700 dark:text-amber-300">
                VAT 7%: {selectedSummary.vatAmount.toLocaleString('th-TH', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                · รวมทั้งสิ้น{' '}
                {selectedSummary.grandTotalAmount.toLocaleString('th-TH', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                บาท
              </span>
            )}
            <span className="text-slate-500 dark:text-slate-400">
              ครอบคลุม {selectedSummary.areaCount} ตำบล · {selectedSummary.mappedCount} พิกัด
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              รหัสชุดงาน / ที่ (ใช้ขึ้นหัวบันทึกข้อความ)
            </label>
            <input
              type="text"
              value={batchCode}
              onChange={(e) => setBatchCode(e.target.value)}
              placeholder="มท55120-183/"
              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-lg py-2 px-3 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              ชื่อชุดงานติดตั้งเสร็จสิ้น
            </label>
            <input
              type="text"
              value={batchTitle}
              onChange={(e) => setBatchTitle(e.target.value)}
              placeholder="เช่น ชุดงานติดตั้ง ต.แสนตอ"
              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-lg py-2 px-3 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              วันที่ขออนุมัติ (แสดงในบันทึกข้อความ)
            </label>
            <input
              type="date"
              value={completedDate}
              onChange={(e) => setCompletedDate(e.target.value)}
              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-lg py-1.5 px-3 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              ขนาดมาตร (ข้อความในบันทึกข้อความ)
            </label>
            <input
              type="text"
              list="pwa-meter-sizes-list"
              value={memoSigners.meterSizeText}
              onChange={(e) =>
                setMemoSigners((prev) => ({ ...prev, meterSizeText: e.target.value }))
              }
              placeholder='เช่น 1/2"'
              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-lg py-2 px-3 text-xs font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
            />
          </div>
        </div>

        {/* Tax Toggle Checkboxes + Live Memo Preview Banner */}
        <div className="bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#213145] rounded-lg p-3 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 mr-1">
                การคำนวณภาษีในบันทึกข้อความและตาราง:
              </span>
              <button
                type="button"
                onClick={() => setIncludeTax(true)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  includeTax
                    ? 'bg-[#EDF5FC] dark:bg-[#2271B3]/25 border-[#2271B3] text-[#1A5A8F] dark:text-[#7CC0F5]'
                    : 'bg-slate-50 dark:bg-[#0D1724] border-slate-200 dark:border-[#263850] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#162336]'
                }`}
              >
                {includeTax ? (
                  <CheckSquare className="w-4 h-4 text-[#2271B3] dark:text-[#5EA6E0]" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                <span>เพิ่มรายการภาษี (รวมภาษีมูลค่าเพิ่ม 7%)</span>
              </button>

              <button
                type="button"
                onClick={() => setIncludeTax(false)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  !includeTax
                    ? 'bg-[#EDF5FC] dark:bg-[#2271B3]/25 border-[#2271B3] text-[#1A5A8F] dark:text-[#7CC0F5]'
                    : 'bg-slate-50 dark:bg-[#0D1724] border-slate-200 dark:border-[#263850] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#162336]'
                }`}
              >
                {!includeTax ? (
                  <CheckSquare className="w-4 h-4 text-[#2271B3] dark:text-[#5EA6E0]" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                <span>ไม่รวมภาษี (ไม่รวมภาษีมูลค่าเพิ่ม)</span>
              </button>
            </div>
          </div>

          <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-[#0D1724] border border-slate-200/80 dark:border-[#1E2E44] rounded-md px-3 py-2">
            <span className="font-semibold text-[#2271B3] dark:text-[#5EA6E0]">สรุปข้อความที่จะพิมพ์ในบันทึกข้อความ (แผ่นที่ 1): </span>
            ที่ <strong className="font-mono">{batchCode.trim() || 'มท55120-183/'}</strong> · วันที่{' '}
            <strong>{formatThaiDate(completedDate)}</strong> · จำนวน{' '}
            <strong>{selectedRecords.length}</strong> ราย · เป็นเงินทั้งสิ้น{' '}
            <strong>
              {selectedSummary.grandTotalAmount.toLocaleString('th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </strong>{' '}
            -บาท ({includeTax ? 'รวมภาษีมูลค่าเพิ่ม' : 'ไม่รวมภาษีมูลค่าเพิ่ม'})
          </div>
        </div>

        {/* Editable Memo Signers & Titles */}
        <div className="bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#213145] rounded-lg p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100">
            <PencilLine className="w-3.5 h-3.5 text-[#2271B3] dark:text-[#5EA6E0]" />
            <span>รายชื่อและตำแหน่งผู้ลงนามในบันทึกข้อความ / ผู้ควบคุมงาน (พิมพ์แก้ไขได้)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                ผู้เสนอเรื่อง
              </label>
              <input
                type="text"
                value={memoSigners.proposerName}
                onChange={(e) =>
                  setMemoSigners((prev) => ({ ...prev, proposerName: e.target.value }))
                }
                placeholder="นายคมกฤช ปัญญา"
                className="w-full bg-slate-50 dark:bg-[#0D1724] border border-slate-200 dark:border-[#263850] rounded-lg py-1.5 px-2.5 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                ตำแหน่งผู้เสนอเรื่อง
              </label>
              <input
                type="text"
                value={memoSigners.proposerTitle}
                onChange={(e) =>
                  setMemoSigners((prev) => ({ ...prev, proposerTitle: e.target.value }))
                }
                placeholder="หัวหน้างาน 8 งานบริการและควบคุมน้ำสูญเสีย"
                className="w-full bg-slate-50 dark:bg-[#0D1724] border border-slate-200 dark:border-[#263850] rounded-lg py-1.5 px-2.5 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                ผู้อนุมัติ (ผู้จัดการฯ)
              </label>
              <input
                type="text"
                value={memoSigners.managerName}
                onChange={(e) =>
                  setMemoSigners((prev) => ({ ...prev, managerName: e.target.value }))
                }
                placeholder="นายปริญญา กัตฐะ"
                className="w-full bg-slate-50 dark:bg-[#0D1724] border border-slate-200 dark:border-[#263850] rounded-lg py-1.5 px-2.5 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                ตำแหน่งผู้อนุมัติ
              </label>
              <input
                type="text"
                value={memoSigners.managerTitle}
                onChange={(e) =>
                  setMemoSigners((prev) => ({ ...prev, managerTitle: e.target.value }))
                }
                placeholder="ผู้จัดการการประปาส่วนภูมิภาคสาขาขาณุวรลักษบุรี"
                className="w-full bg-slate-50 dark:bg-[#0D1724] border border-slate-200 dark:border-[#263850] rounded-lg py-1.5 px-2.5 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                หัวหน้างานอำนวยการ
              </label>
              <input
                type="text"
                value={memoSigners.adminHeadName}
                onChange={(e) =>
                  setMemoSigners((prev) => ({ ...prev, adminHeadName: e.target.value }))
                }
                placeholder="นางชฎาภัทร์ แจ่มสว่าง"
                className="w-full bg-slate-50 dark:bg-[#0D1724] border border-slate-200 dark:border-[#263850] rounded-lg py-1.5 px-2.5 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                ตำแหน่งหัวหน้างานอำนวยการ
              </label>
              <input
                type="text"
                value={memoSigners.adminHeadTitle}
                onChange={(e) =>
                  setMemoSigners((prev) => ({ ...prev, adminHeadTitle: e.target.value }))
                }
                placeholder="หัวหน้างาน 8 งานอำนวยการ"
                className="w-full bg-slate-50 dark:bg-[#0D1724] border border-slate-200 dark:border-[#263850] rounded-lg py-1.5 px-2.5 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                ผู้ควบคุมงาน (ท้ายตารางสรุป)
              </label>
              <input
                type="text"
                value={inspectorName}
                onChange={(e) => setInspectorName(e.target.value)}
                placeholder="นายสามารถ บุญกัน"
                className="w-full bg-slate-50 dark:bg-[#0D1724] border border-slate-200 dark:border-[#263850] rounded-lg py-1.5 px-2.5 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                ตำแหน่งผู้ควบคุมงาน
              </label>
              <input
                type="text"
                value={memoSigners.inspectorTitle}
                onChange={(e) =>
                  setMemoSigners((prev) => ({ ...prev, inspectorTitle: e.target.value }))
                }
                placeholder="นายช่างโยธา 6"
                className="w-full bg-slate-50 dark:bg-[#0D1724] border border-slate-200 dark:border-[#263850] rounded-lg py-1.5 px-2.5 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-[#162336] focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
          <div className="lg:col-span-5">
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              หมายเหตุชุดงาน (ถ้ามี)
            </label>
            <input
              type="text"
              value={batchNote}
              onChange={(e) => setBatchNote(e.target.value)}
              placeholder="รายละเอียดเพิ่มเติมสำหรับใบสรุป..."
              className="w-full bg-white dark:bg-[#111C2B] border border-slate-200 dark:border-[#263850] rounded-lg py-2 px-3 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-[#2271B3] dark:focus:border-[#5EA6E0]"
            />
          </div>

          <div className="lg:col-span-7 flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-2 lg:pt-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              บันทึกชุดงานเข้าคลังข้อมูลก่อน แล้วกดดาวน์โหลด <strong className="text-slate-700 dark:text-slate-200">Excel / PDF</strong> (จะมีแผ่นบันทึกข้อความอยู่ก่อนตารางสรุป)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-[#213145]">
          <button
            type="button"
            onClick={() => handleQuickExportDraft('excel')}
            disabled={selectedRecords.length === 0 || isSaving || isExportingId !== null}
            className="px-3.5 py-2 bg-white dark:bg-[#111C2B] border border-emerald-600/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-45 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors"
          >
            {isExportingId === 'draft_excel' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5" />
            )}
            <span>ดาวน์โหลด Excel</span>
          </button>

          <button
            type="button"
            onClick={() => handleQuickExportDraft('pdf')}
            disabled={selectedRecords.length === 0 || isSaving || isExportingId !== null}
            className="px-3.5 py-2 bg-white dark:bg-[#111C2B] border border-[#2271B3]/45 text-[#2271B3] dark:text-[#5EA6E0] hover:bg-[#EDF5FC] dark:hover:bg-[#162336] disabled:opacity-45 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors"
          >
            {isExportingId === 'draft_pdf' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            <span>ดาวน์โหลด PDF</span>
          </button>

          <button
            type="button"
            onClick={handleSaveBatchAndExport}
            disabled={selectedRecords.length === 0 || isSaving}
            className="px-4 py-2 bg-[#2271B3] hover:bg-[#1A5A8F] dark:bg-[#3584C7] dark:hover:bg-[#2271B3] disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs inline-flex items-center gap-1.5 transition-colors"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            <span>
              {isSaving
                ? 'กำลังบันทึกชุดงาน...'
                : 'บันทึกชุดงานเข้าที่เก็บข้อมูล'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
