import Clipboard from '@react-native-clipboard/clipboard';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  Modal,
  NativeModules,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';

const { SaveFile, Hce } = NativeModules;

function saveFileAsync(content: string, filename: string, mimeType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    SaveFile.save(content, filename, mimeType, (err: any) => {
      if (err) reject(err); else resolve();
    });
  });
}

function openFileAsync(mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    SaveFile.open(mimeType, (err: any, result: string) => {
      if (err) reject(err); else resolve(result);
    });
  });
}

function bytesToBase64(bytes: number[]): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): number[] {
  const binary = atob(b64);
  const out: number[] = new Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function saveFileBinaryAsync(bytes: number[], filename: string, mimeType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    SaveFile.saveBinary(bytesToBase64(bytes), filename, mimeType, (err: any) => {
      if (err) reject(err); else resolve();
    });
  });
}

function openFileBinaryAsync(mimeType: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    SaveFile.openBinary(mimeType, (err: any, result: string) => {
      if (err) reject(err); else resolve(base64ToBytes(result));
    });
  });
}

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'read' | 'write' | 'other';
type ScanStatus = 'idle' | 'scanning' | 'done' | 'error';
type MemoryTab = 'hex' | 'utf8' | 'ascii' | 'format' | 'type';

type ParsedRecord = {
  label: string;
  value: string;
  raw: string;       // payload as colon-hex (for display)
  tnf: number;
  typeStr: string;   // type decoded as ASCII string (for display)
  typeBytes: number[]; // type field as raw bytes (for lossless reconstruction)
  idBytes: number[];   // id field as raw bytes
};

type TagMeta = {
  tagType: string;
  dataFormat: string;
  memoryInfo: string;
  totalBytes: number;
  supported: boolean;
};

type TagData = {
  uid: string;
  techTypes: string[];
  records: ParsedRecord[];
  ndefMaxSize: number | null;
  ndefWritable: boolean | null;
  ndefCanLock: boolean | null;
  atqa?: string;
  sak?: number;
  tagMeta: TagMeta | null;
  rawNdefBytes: number[];
  ndefUsedBytes: number;
  rawPages?: { page: number; hex: string }[];
};

type MifareBlock = {
  sector: number;
  block: number;        // absolute block index
  blockInSector: number;
  blockCount: number;   // total blocks in this sector
  data: number[];       // 16 bytes
  sectorKey: number[];  // Key A used to authenticate the source sector
};

const MIFARE_KEYS: number[][] = [
  [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
  [0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5],
  [0xD3, 0xF7, 0xD3, 0xF7, 0xD3, 0xF7],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5],
];

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  bg: '#1a1a1a',
  surface: '#242424',
  surfaceAlt: '#2c2c2c',
  border: '#333333',
  tabBar: '#1e1e1e',
  activeTab: '#3a7d44',
  activeTabText: '#ffffff',
  inactiveTabText: '#8a8a8a',
  accent: '#4caf50',
  accentDim: '#2d6e35',
  text: '#e0e0e0',
  textMuted: '#666666',
  textFaint: '#444444',
  indicator: '#4caf50',
  error: '#ef5350',
  warning: '#ff9800',
  overlay: 'rgba(0,0,0,0.6)',
};

// ── Tag identification ────────────────────────────────────────────────────────

function identifyTag(
  techTypes: string[],
  sak?: number,
  atqa?: string,
  maxSize?: number | null,
): TagMeta {
  const atqaNum = atqa ? parseInt(atqa.replace(/^0x/i, ''), 16) : undefined;

  if (sak !== undefined) {
    if (sak === 0x08) return {
      tagType: 'ISO 14443-3A (NXP - Mifare Classic 1k)',
      dataFormat: 'NXP Mifare Classic',
      memoryInfo: '1 kb : 16 sectors of 4 blocks (16 bytes each)',
      totalBytes: 1024,
      supported: false,
    };
    if (sak === 0x18) return {
      tagType: 'ISO 14443-3A (NXP - Mifare Classic 4k)',
      dataFormat: 'NXP Mifare Classic',
      memoryInfo: '4 kb : 32 sectors of 4 blocks + 8 sectors of 16 blocks (16 bytes each)',
      totalBytes: 4096,
      supported: false,
    };
    if (sak === 0x09) return {
      tagType: 'ISO 14443-3A (NXP - Mifare Mini)',
      dataFormat: 'NXP Mifare Classic',
      memoryInfo: '320 b : 5 sectors of 4 blocks (16 bytes each)',
      totalBytes: 320,
      supported: false,
    };
    if (sak === 0x28) return {
      tagType: 'ISO 14443-3A (NXP - Mifare Classic 1k - Emulated)',
      dataFormat: 'NXP Mifare Classic',
      memoryInfo: '1 kb : 16 sectors of 4 blocks (16 bytes each)',
      totalBytes: 1024,
      supported: false,
    };
    if (sak === 0x38) return {
      tagType: 'ISO 14443-3A (NXP - Mifare Classic 4k - Emulated)',
      dataFormat: 'NXP Mifare Classic',
      memoryInfo: '4 kb : 32 sectors of 4 blocks + 8 sectors of 16 blocks (16 bytes each)',
      totalBytes: 4096,
      supported: false,
    };
    if (sak === 0x00 && atqaNum === 0x0044) {
      const cap = maxSize ?? 48;
      return {
        tagType: 'ISO 14443-3A (NXP - Mifare Ultralight)',
        dataFormat: 'NXP Mifare Ultralight',
        memoryInfo: `${cap} b : ${Math.ceil(cap / 4)} pages of 4 bytes`,
        totalBytes: cap,
        supported: true,
      };
    }
    if (sak === 0x20) {
      const cap = maxSize ?? 0;
      const model = cap <= 144 ? 'NTAG213' : cap <= 504 ? 'NTAG215' : cap <= 888 ? 'NTAG216' : 'ISO-DEP';
      return {
        tagType: `ISO 14443-4A (NXP - ${model})`,
        dataFormat: 'NFC Forum Type 4',
        memoryInfo: cap > 0 ? `${cap} bytes user memory` : 'Unknown',
        totalBytes: cap,
        supported: true,
      };
    }
    if (sak === 0x00) {
      const cap = maxSize ?? 0;
      return {
        tagType: 'ISO 14443-3A (NFC Forum Type 2)',
        dataFormat: 'NFC Forum Type 2',
        memoryInfo: cap > 0 ? `${cap} bytes` : 'Unknown',
        totalBytes: cap,
        supported: true,
      };
    }
  }

  if (techTypes.some(t => t.includes('NfcB'))) return {
    tagType: 'ISO 14443-3B', dataFormat: 'NFC Forum Type 4B',
    memoryInfo: 'Unknown', totalBytes: 0, supported: true,
  };
  if (techTypes.some(t => t.includes('NfcF'))) return {
    tagType: 'ISO 18092 (FeliCa)', dataFormat: 'NFC Forum Type 3',
    memoryInfo: 'Unknown', totalBytes: 0, supported: true,
  };
  if (techTypes.some(t => t.includes('NfcV'))) return {
    tagType: 'ISO 15693', dataFormat: 'ISO 15693',
    memoryInfo: 'Unknown', totalBytes: 0, supported: true,
  };

  return { tagType: 'Unknown', dataFormat: 'Unknown', memoryInfo: 'Unknown', totalBytes: 0, supported: true };
}

// ── NFC / NDEF helpers ────────────────────────────────────────────────────────

const URI_PREFIXES = [
  '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:',
  'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://',
  'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://', 'news:',
  'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:',
  'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://',
  'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:',
  'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
];

const TNF_FORMAT_LABELS: Record<number, string> = {
  0x00: 'Empty (0x00)',
  0x01: 'NFC Well Known (0x01)\nDefined by RFC 2141, RFC 3986',
  0x02: 'MIME Media (0x02)\nDefined by RFC 2046',
  0x03: 'Absolute URI (0x03)\nDefined by RFC 3986',
  0x04: 'NFC External (0x04)\nDefined by NFC Forum RTD',
  0x05: 'Unknown (0x05)',
  0x06: 'Unchanged (0x06)',
  0x07: 'Reserved (0x07)',
};

const WELL_KNOWN_TYPE_NAMES: Record<string, string> = {
  T: 'Text Record',
  U: 'URI Record',
  Sp: 'Smart Poster',
  act: 'Action Record',
  gc: 'Generic Control',
  aar: 'Android Application Record',
};

function toHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

function toStr(bytes: number[]): string {
  try {
    return decodeURIComponent(bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join(''));
  } catch {
    return bytes.map(b => String.fromCharCode(b)).join('');
  }
}

function formatUid(id: string | undefined): string {
  if (!id) return 'Unknown';
  const clean = id.replace(/[^0-9a-fA-F]/g, '');
  return (clean.match(/.{1,2}/g) ?? [clean]).join(':').toUpperCase();
}

function shortTech(full: string): string {
  return full.split('.').pop() ?? full;
}

function parseRecord(r: { tnf: number; type: number[]; payload: number[]; id: number[] }): ParsedRecord {
  const typeStr = r.type.map(b => String.fromCharCode(b)).join('');
  const raw = toHex(r.payload);
  const base = { tnf: r.tnf, typeStr, typeBytes: Array.isArray(r.type) ? r.type : [], idBytes: Array.isArray(r.id) ? r.id : [], raw };

  if (r.tnf === Ndef.TNF_WELL_KNOWN) {
    if (typeStr === 'T') {
      const statusByte = r.payload[0] ?? 0;
      const langLen = statusByte & 0x3f;
      return { ...base, label: 'Text', value: toStr(r.payload.slice(1 + langLen)) };
    }
    if (typeStr === 'U') {
      const prefix = URI_PREFIXES[r.payload[0]] ?? '';
      return { ...base, label: 'URI', value: prefix + r.payload.slice(1).map(b => String.fromCharCode(b)).join('') };
    }
    if (typeStr === 'Sp') return { ...base, label: 'Smart Poster', value: `${r.payload.length} bytes` };
    if (typeStr === 'act') {
      const actions = ['Do the action', 'Save for later', 'Open for editing'];
      return { ...base, label: 'Action', value: actions[r.payload[0]] ?? `0x${r.payload[0]?.toString(16)}` };
    }
    return { ...base, label: `Well-Known (${typeStr})`, value: raw };
  }
  if (r.tnf === Ndef.TNF_MIME_MEDIA)    return { ...base, label: `MIME: ${typeStr}`, value: toStr(r.payload) };
  if (r.tnf === Ndef.TNF_ABSOLUTE_URI)  return { ...base, label: 'Absolute URI',       value: typeStr };
  if (r.tnf === Ndef.TNF_EXTERNAL_TYPE) return { ...base, label: `External (${typeStr})`, value: toStr(r.payload) };
  if (r.tnf === Ndef.TNF_EMPTY)         return { ...base, label: 'Empty',              value: '—' };
  return { ...base, label: `Unknown (TNF ${r.tnf})`, value: raw };
}

// ── Memory encoding helpers ───────────────────────────────────────────────────

// Manual NDEF encoder — fallback when Ndef.encodeMessage returns null/undefined.
// Handles any TNF/type/payload combination without relying on library recognition.
function encodeNdefFallback(records: { tnf: number; type: number[]; payload: number[]; id: number[] }[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const type    = r.type    ?? [];
    const payload = r.payload ?? [];
    const id      = r.id      ?? [];
    const isShort = payload.length <= 255;

    let flags = r.tnf & 0x07;
    if (i === 0)                     flags |= 0x80; // MB
    if (i === records.length - 1)    flags |= 0x40; // ME
    if (isShort)                     flags |= 0x10; // SR
    if (id.length > 0)               flags |= 0x08; // IL

    out.push(flags);
    out.push(type.length);
    if (isShort) {
      out.push(payload.length);
    } else {
      out.push((payload.length >>> 24) & 0xFF, (payload.length >>> 16) & 0xFF,
               (payload.length >>>  8) & 0xFF,  payload.length         & 0xFF);
    }
    if (id.length > 0) out.push(id.length);
    out.push(...type, ...id, ...payload);
  }
  return out;
}

function toHexDump(bytes: number[]): string {
  if (!bytes.length) return '(empty)';
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = chunk.map(b => b.toString(16).padStart(2, '0').toUpperCase());
    const left = hex.slice(0, 8).join(' ').padEnd(23, ' ');
    const right = hex.slice(8).join(' ');
    const addr = i.toString(16).padStart(4, '0').toUpperCase();
    lines.push(`${addr}  ${left}  ${right}`);
  }
  return lines.join('\n');
}

function memToUtf8(bytes: number[]): string {
  if (!bytes.length) return '(empty)';
  try {
    return decodeURIComponent(bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join(''));
  } catch {
    return bytes.map(b => String.fromCharCode(b)).join('');
  }
}

function memToAscii(bytes: number[]): string {
  if (!bytes.length) return '(empty)';
  return bytes.map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
}

function memToBinary(bytes: number[]): string {
  if (!bytes.length) return '(empty)';
  return bytes.map(b => b.toString(2).padStart(8, '0')).join(' ');
}

// Parse NDEF TLV stream from NFC Forum Type 2 Tag user pages (pages 4+).
// Returns the raw NDEF message bytes and decoded records.
function extractNdefFromPages(pages: { page: number; hex: string }[]): {
  ndefBytes: number[];
  records: ParsedRecord[];
} {
  const userBytes: number[] = [];
  for (const p of pages) {
    if (p.page < 4) continue;
    p.hex.trim().split(/\s+/).forEach(h => userBytes.push(parseInt(h, 16)));
  }
  let i = 0;
  while (i < userBytes.length) {
    const tag = userBytes[i++];
    if (tag === 0xFE || tag === undefined) break;
    if (tag === 0x00) continue;
    let len = userBytes[i++];
    if (len === 0xFF && i + 1 < userBytes.length) {
      len = (userBytes[i] << 8) | userBytes[i + 1];
      i += 2;
    }
    if (tag === 0x03 && len > 0) {
      const ndefBytes = userBytes.slice(i, i + len);
      try {
        const rawRecords: any[] = Ndef.decodeMessage(ndefBytes);
        return { ndefBytes, records: rawRecords.map(parseRecord) };
      } catch { break; }
    }
    i += len;
  }
  return { ndefBytes: [], records: [] };
}

// ── Memory Manager ────────────────────────────────────────────────────────────

const MEMORY_TABS: { id: MemoryTab; label: string }[] = [
  { id: 'hex', label: 'Hex' },
  { id: 'utf8', label: 'UTF-8' },
  { id: 'ascii', label: 'ASCII' },
  { id: 'format', label: 'Format' },
  { id: 'type', label: 'Type' },
];

type ExportAction = 'copy' | 'disk';
type ExportFormat = 'hex' | 'utf8' | 'ascii' | 'binary' | 'onfct';

const EXPORT_ACTION_OPTIONS: {label: string; value: ExportAction}[] = [
  {label: 'Copy', value: 'copy'},
  {label: 'Save to Disk', value: 'disk'},
];

const EXPORT_FORMAT_OPTIONS: {label: string; value: ExportFormat}[] = [
  {label: 'Hex', value: 'hex'},
  {label: 'UTF-8', value: 'utf8'},
  {label: 'ASCII', value: 'ascii'},
  {label: 'Binary', value: 'binary'},
  {label: 'Open NFC Toolkit data file', value: 'onfct'},
];

type OnfctFile = {
  version: number;
  format: string;
  tag: {
    uid: string;
    type: string;
    dataFormat: string;
    memoryInfo: string;
    atqa?: string;
    sak?: number | null;
    techTypes?: string[];
  };
  ndef: { encodedHex: string; recordCount: number; records: { label: string; value: string }[] };
  raw?: { pages: { page: number; hex: string }[] };
};

function buildOnfct(tagData: TagData): string {
  const encodedHex = tagData.rawNdefBytes
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');

  return JSON.stringify({
    version: 1,
    format: 'onfct',
    timestamp: new Date().toISOString(),
    tag: {
      uid: tagData.uid,
      type: tagData.tagMeta?.tagType ?? 'Unknown',
      dataFormat: tagData.tagMeta?.dataFormat ?? 'Unknown',
      memoryInfo: tagData.tagMeta?.memoryInfo ?? 'Unknown',
      atqa: tagData.atqa ?? null,
      sak: tagData.sak ?? null,
      techTypes: tagData.techTypes,
    },
    ndef: {
      encodedHex,
      recordCount: tagData.records.length,
      records: tagData.records.map(r => ({
        label: r.label,
        value: r.value,
        tnf: r.tnf,
        typeHex:    r.typeBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
        idHex:      r.idBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
        payloadHex: r.raw.split(':').filter(Boolean).join(' '),
      })),
    },
    ...(tagData.rawPages && tagData.rawPages.length > 0
      ? { raw: { pages: tagData.rawPages } }
      : {}),
  }, null, 2);
}

function Dropdown<T extends string>({
  options,
  value,
  onSelect,
  isOpen,
  onToggle,
}: {
  options: {label: string; value: T}[];
  value: T;
  onSelect: (v: T) => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const label = options.find(o => o.value === value)?.label ?? value;
  return (
    <>
      <TouchableOpacity style={styles.dropdownBtn} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.dropdownBtnText} numberOfLines={1}>{label}</Text>
        <Text style={styles.dropdownArrow}>{isOpen ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={onToggle}>
        <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPress={onToggle}>
          <View style={styles.dropdownSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.dropdownSheetTitle}>Select Option</Text>
            {options.map(o => (
              <TouchableOpacity
                key={o.value}
                style={[styles.dropdownSheetItem, o.value === value && styles.dropdownSheetItemActive]}
                onPress={() => {onSelect(o.value); onToggle();}}>
                <Text style={[styles.dropdownSheetItemText, o.value === value && styles.dropdownSheetItemTextActive]}>
                  {o.label}
                </Text>
                {o.value === value && <Text style={styles.dropdownSheetCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function MemoryManager({
  visible,
  onClose,
  tagData,
}: {
  visible: boolean;
  onClose: () => void;
  tagData: TagData;
}) {
  const [activeTab, setActiveTab] = useState<MemoryTab>('hex');
  const [exportAction, setExportAction] = useState<ExportAction>('copy');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('hex');
  const [actionOpen, setActionOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  // Prefer the full raw page dump (complete memory) when available; fall back to NDEF bytes.
  const bytes = tagData.rawPages && tagData.rawPages.length > 0
    ? tagData.rawPages.flatMap(p => p.hex.trim().split(/\s+/).map(h => parseInt(h, 16)))
    : tagData.rawNdefBytes;

  async function handleExport() {
    if (exportFormat === 'onfct') {
      try {
        await saveFileAsync(buildOnfct(tagData), 'tag.onfct', 'application/octet-stream');
      } catch (e: any) {
        if (e?.code !== 'CANCELLED') {
          Alert.alert('Save Failed', e?.message ?? 'Could not save file.');
        }
      }
      return;
    }

    const hex = bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const content =
      exportFormat === 'hex' ? hex :
      exportFormat === 'utf8' ? memToUtf8(bytes) :
      exportFormat === 'ascii' ? memToAscii(bytes) :
      memToBinary(bytes);

    if (exportAction === 'copy') {
      Clipboard.setString(content);
    } else {
      try {
        await saveFileAsync(content, 'nfc_dump.txt', 'text/plain');
      } catch (e: any) {
        if (e?.code !== 'CANCELLED') {
          Alert.alert('Save Failed', e?.message ?? 'Could not save file.');
        }
      }
    }
  }

  function renderContent() {
    switch (activeTab) {
      case 'hex':
        return <Text style={styles.monoContent}>{toHexDump(bytes)}</Text>;

      case 'utf8':
        return <Text style={styles.monoContent}>{memToUtf8(bytes)}</Text>;

      case 'ascii':
        return <Text style={styles.monoContent}>{memToAscii(bytes)}</Text>;

      case 'format':
        if (!tagData.records.length) return <Text style={styles.memEmptyNote}>No NDEF records</Text>;
        return (
          <>
            {tagData.records.map((r, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.memDivider} />}
                <Text style={styles.memRecordIndex}>Record {i + 1}</Text>
                <Text style={styles.memFormatText}>{TNF_FORMAT_LABELS[r.tnf] ?? `Unknown TNF (0x${r.tnf.toString(16)})`}</Text>
              </View>
            ))}
          </>
        );

      case 'type':
        if (!tagData.records.length) return <Text style={styles.memEmptyNote}>No NDEF records</Text>;
        return (
          <>
            {tagData.records.map((r, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.memDivider} />}
                <Text style={styles.memRecordIndex}>Record {i + 1}</Text>
                <Text style={styles.memTypeBig}>{r.typeStr || '—'}</Text>
                <Text style={styles.memTypeDesc}>
                  {WELL_KNOWN_TYPE_NAMES[r.typeStr] ?? r.typeStr ?? 'Unknown type'}
                </Text>
              </View>
            ))}
          </>
        );
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.memModal}>
        {/* Header */}
        <View style={styles.memHeader}>
          <Text style={styles.memHeaderTitle}>Memory Manager</Text>
          <TouchableOpacity onPress={onClose} style={styles.memCloseBtn}>
            <Text style={styles.memCloseText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Sub-tab bar */}
        <View style={styles.memTabBar}>
          {MEMORY_TABS.map(t => {
            const active = t.id === activeTab;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.memTabItem, active && styles.memTabItemActive]}
                onPress={() => setActiveTab(t.id)}
                activeOpacity={0.7}>
                <Text style={[styles.memTabLabel, active && styles.memTabLabelActive]}>
                  {t.label}
                </Text>
                {active && <View style={styles.memTabIndicator} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Content */}
        <ScrollView style={styles.memContent} contentContainerStyle={styles.memContentInner}>
          {renderContent()}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Export controls */}
        <View style={styles.memFooter}>
          <View style={styles.memExportRow}>
            <Dropdown
              options={EXPORT_ACTION_OPTIONS}
              value={exportAction}
              onSelect={setExportAction}
              isOpen={actionOpen}
              onToggle={() => { setActionOpen(v => !v); setFormatOpen(false); }}
            />
            <Dropdown
              options={EXPORT_FORMAT_OPTIONS}
              value={exportFormat}
              onSelect={setExportFormat}
              isOpen={formatOpen}
              onToggle={() => { setFormatOpen(v => !v); setActionOpen(false); }}
            />
            <TouchableOpacity style={styles.memConfirmBtn} onPress={handleExport} activeOpacity={0.7}>
              <Text style={styles.memConfirmText}>✓</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Read screen ───────────────────────────────────────────────────────────────

function ReadScreen() {
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [tagData, setTagData] = useState<TagData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [memVisible, setMemVisible] = useState(false);

  async function scan() {
    setStatus('scanning');
    setTagData(null);
    setErrorMsg('');

    const records: ParsedRecord[] = [];
    let rawNdefBytes: number[] = [];
    let rawPages: { page: number; hex: string }[] | undefined;
    let raw: any = null;

    try {
      // Phase 1: NDEF tech — get parsed records and tag metadata.
      // We cancel after reading so Phase 2 can connect via NfcA on the same tap.
      try {
        await NfcManager.requestTechnology(NfcTech.Ndef);
        raw = (await NfcManager.getTag()) as any;
        if (raw && Array.isArray(raw.ndefMessage) && raw.ndefMessage.length > 0) {
          for (const r of raw.ndefMessage) records.push(parseRecord(r));
          rawNdefBytes = encodeNdefFallback(raw.ndefMessage);
        }
        await NfcManager.cancelTechnologyRequest();
      } catch { /* NDEF not available, or tag removed before Phase 2 — handled below */ }

      // Phase 2: NfcA transceive — dump all raw pages for a complete memory snapshot.
      // Uses the standard NFC Type 2 READ command (0x30) which works for NTAG/Ultralight.
      // Quietly skipped for IsoDep (Type 4) tags which don't respond to 0x30.
      try {
        await NfcManager.requestTechnology(NfcTech.NfcA);
        if (!raw) raw = (await NfcManager.getTag()) as any;
        const pages: { page: number; hex: string }[] = [];
        for (let pageNum = 0; pageNum < 256; pageNum += 4) {
          try {
            const resp: number[] = await NfcManager.nfcAHandler.transceive([0x30, pageNum]);
            for (let i = 0; i < 4 && pageNum + i < 256; i++) {
              const slice = resp.slice(i * 4, (i + 1) * 4);
              pages.push({
                page: pageNum + i,
                hex: slice.map((b: number) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
              });
            }
          } catch { break; }
        }
        if (pages.length > 0) {
          rawPages = pages;
          // If NDEF phase didn't yield records (unformatted tag), parse from raw pages
          if (records.length === 0) {
            const parsed = extractNdefFromPages(pages);
            rawNdefBytes = parsed.ndefBytes;
            parsed.records.forEach(r => records.push(r));
          }
        }
      } catch { /* IsoDep or other non-Type2 tag — fine if Phase 1 gave us NDEF data */ }

      if (!raw) throw new Error('No tag detected');

      const techTypes = ((raw.techTypes ?? []) as string[]).map(shortTech);
      const tagMeta = identifyTag(techTypes, raw.sak, raw.atqa, raw.maxSize);

      setTagData({
        uid: formatUid(raw.id),
        techTypes,
        records,
        ndefMaxSize: raw.maxSize ?? null,
        ndefWritable: raw.isWritable ?? null,
        ndefCanLock: raw.canMakeReadOnly ?? null,
        atqa: raw.atqa,
        sak: raw.sak,
        tagMeta,
        rawNdefBytes,
        ndefUsedBytes: rawNdefBytes.length,
        rawPages,
      });
      Vibration.vibrate(200);
      setStatus('done');
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      if (msg === 'cancelled') {
        setStatus('idle');
      } else {
        setErrorMsg(msg);
        setStatus('error');
      }
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
  }

  function cancel() {
    NfcManager.cancelTechnologyRequest().catch(() => {});
    setStatus('idle');
  }

  if (status === 'scanning') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleScanning]}>
          <Text style={styles.iconText}>⟳</Text>
        </View>
        <Text style={styles.screenTitle}>Waiting for tag…</Text>
        <Text style={styles.screenSubtitle}>Hold an NFC tag close to your phone</Text>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonCancel]} onPress={cancel}>
          <Text style={styles.actionButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'done' && tagData) {
    const { tagMeta, atqa, sak, ndefMaxSize, ndefUsedBytes, ndefWritable, ndefCanLock } = tagData;

    return (
      <>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.resultsHeader}>Tag Detected</Text>

          {/* Tag Info */}
          <SectionLabel text="Tag Info" />
          <View style={styles.card}>
            {tagMeta && (
              <>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Tag Type</Text>
                  <View style={styles.infoValueCol}>
                    <Text style={styles.infoValueFull}>{tagMeta.tagType}</Text>
                    {!tagMeta.supported && (
                      <Text style={styles.notSupportedBadge}>Not supported</Text>
                    )}
                  </View>
                </View>
                <InfoRow label="Data Format" value={tagMeta.dataFormat} />
              </>
            )}
            <InfoRow label="Serial Number" value={tagData.uid} mono />
            {atqa != null && <InfoRow label="ATQA" value={atqa} mono />}
            {sak != null && (
              <InfoRow label="SAK" value={`0x${sak.toString(16).toUpperCase().padStart(2, '0')}`} mono />
            )}
          </View>

          {/* Memory */}
          <SectionLabel text="Memory" />
          <View style={styles.card}>
            {tagMeta?.memoryInfo && <InfoRow label="Memory Info" value={tagMeta.memoryInfo} />}
            {ndefMaxSize != null && (
              <InfoRow
                label="Size"
                value={`${ndefUsedBytes} / ${ndefMaxSize} Bytes`}
              />
            )}
            {ndefWritable != null && <InfoRow label="Writable" value={ndefWritable ? 'Yes' : 'No'} />}
            {ndefCanLock != null && <InfoRow label="Can be Read-Only" value={ndefCanLock ? 'Yes' : 'No'} />}
          </View>

          <TouchableOpacity
            style={[styles.actionButton, styles.memManagerButton]}
            onPress={() => setMemVisible(true)}>
            <Text style={styles.actionButtonText}>Open Memory Manager</Text>
          </TouchableOpacity>

          {/* Technologies */}
          <SectionLabel text="Technologies" />
          <View style={styles.chipRow}>
            {tagData.techTypes.map(t => (
              <View key={t} style={styles.chip}>
                <Text style={styles.chipText}>{t}</Text>
              </View>
            ))}
          </View>

          {/* NDEF Records */}
          <SectionLabel text={`NDEF Records (${tagData.records.length})`} />
          {tagData.records.length === 0 ? (
            <Text style={styles.emptyNote}>No NDEF records on this tag</Text>
          ) : (
            tagData.records.map((r, i) => (
              <View key={i} style={styles.recordCard}>
                <Text style={styles.recordType}>{r.label}</Text>
                <Text style={styles.recordValue}>{r.value}</Text>
                {r.raw !== r.value && <Text style={styles.recordRaw}>{r.raw}</Text>}
              </View>
            ))
          )}

          <TouchableOpacity style={[styles.actionButton, styles.scanAgainButton]} onPress={scan}>
            <Text style={styles.actionButtonText}>Scan Again</Text>
          </TouchableOpacity>
          <View style={{ height: 40 }} />
        </ScrollView>

        <MemoryManager
          visible={memVisible}
          onClose={() => setMemVisible(false)}
          tagData={tagData}
        />
      </>
    );
  }

  // idle or error
  return (
    <View style={styles.screen}>
      <View style={[styles.iconCircle, status === 'error' && styles.iconCircleError]}>
        <Text style={styles.iconText}>⟳</Text>
      </View>
      <Text style={styles.screenTitle}>Read NFC Tag</Text>
      {status === 'error' ? (
        <Text style={[styles.screenSubtitle, styles.errorText]}>{errorMsg}</Text>
      ) : (
        <Text style={styles.screenSubtitle}>
          Hold your device near an NFC tag to read its contents
        </Text>
      )}
      <TouchableOpacity style={styles.actionButton} onPress={scan}>
        <Text style={styles.actionButtonText}>
          {status === 'error' ? 'Try Again' : 'Start Scanning'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, mono && styles.infoValueMono]}>{value}</Text>
    </View>
  );
}

// ── Write screen ─────────────────────────────────────────────────────────────

type WriteRecordType = 'text' | 'url' | 'email' | 'phone' | 'onfct';
type WriteStatus = 'idle' | 'writing' | 'done' | 'error';

const WRITE_TYPE_OPTIONS: { label: string; value: WriteRecordType }[] = [
  { label: 'Text', value: 'text' },
  { label: 'URL', value: 'url' },
  { label: 'Email', value: 'email' },
  { label: 'Phone', value: 'phone' },
  { label: '.onfct File', value: 'onfct' },
];

function writePlaceholder(t: WriteRecordType) {
  if (t === 'url') return 'https://example.com';
  if (t === 'email') return 'user@example.com';
  if (t === 'phone') return '+1 234 567 8900';
  return 'Enter text…';
}

function writeKeyboard(t: WriteRecordType) {
  if (t === 'url') return 'url' as const;
  if (t === 'email') return 'email-address' as const;
  if (t === 'phone') return 'phone-pad' as const;
  return 'default' as const;
}

function buildRecord(type: WriteRecordType, text: string) {
  if (type === 'text') return Ndef.textRecord(text);
  const prefix =
    type === 'email' && !text.startsWith('mailto:') ? 'mailto:' :
    type === 'phone' && !text.startsWith('tel:') ? 'tel:' : '';
  return Ndef.uriRecord(prefix + text);
}

function WriteScreen() {
  const [recordType, setRecordType] = useState<WriteRecordType>('text');
  const [content, setContent] = useState('');
  const [onfctFile, setOnfctFile] = useState<OnfctFile | null>(null);
  const [onfctError, setOnfctError] = useState('');
  const [status, setStatus] = useState<WriteStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [typeOpen, setTypeOpen] = useState(false);

  async function loadOnfctFile() {
    setOnfctError('');
    try {
      const content: string = await openFileAsync('*/*');
      const parsed = JSON.parse(content) as OnfctFile;
      if (parsed.format !== 'onfct') throw new Error('Not a valid .onfct file');
      if (!parsed.ndef?.encodedHex) throw new Error('File contains no NDEF data');
      setOnfctFile(parsed);
    } catch (e: any) {
      if (e?.code !== 'CANCELLED') {
        setOnfctError(e?.message ?? 'Invalid file format');
      }
    }
  }

  async function writeBytes(bytes: number[]) {
    let usedNdef = true;
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
    } catch {
      usedNdef = false;
      await NfcManager.requestTechnology(NfcTech.NdefFormatable);
    }
    if (usedNdef) {
      await NfcManager.ndefHandler.writeNdefMessage(bytes);
    } else {
      await NfcManager.ndefFormatableHandlerAndroid.formatNdef(bytes);
    }
  }

  async function write() {
    if (recordType === 'onfct') {
      if (!onfctFile) return;
      setStatus('writing');
      setErrorMsg('');
      try {
        if (onfctFile.raw?.pages && onfctFile.raw.pages.length > 0) {
          // Write raw pages via NfcA transceive using NFC Type 2 WRITE command (0xA2).
          // Pages 0-2: UID, OTP, lock bytes — hardware read-only, skip them.
          // Page 3: CC (Capability Container) — writable; restoring it makes a
          // blank target NDEF-capable with the correct size/permissions.
          // Pages 4+: user data (NDEF TLV).
          await NfcManager.requestTechnology(NfcTech.NfcA);
          for (const { page, hex } of onfctFile.raw.pages) {
            if (page < 3) continue;
            const data = hex.trim().split(/\s+/).map(h => parseInt(h, 16));
            await NfcManager.nfcAHandler.transceive([0xA2, page, ...data]);
          }
        } else {
          const bytes = onfctFile.ndef.encodedHex
            .trim()
            .split(/[\s,:\n]+/)
            .filter(Boolean)
            .map(h => parseInt(h, 16));
          await writeBytes(bytes);
        }
        Vibration.vibrate(200);
        setStatus('done');
      } catch (e: any) {
        const msg: string = e?.message ?? String(e);
        if (msg === 'cancelled') { setStatus('idle'); }
        else { setErrorMsg(msg); setStatus('error'); }
      } finally {
        NfcManager.cancelTechnologyRequest().catch(() => {});
      }
      return;
    }

    const trimmed = content.trim();
    if (!trimmed) return;
    setStatus('writing');
    setErrorMsg('');
    try {
      const record = buildRecord(recordType, trimmed);
      const bytes = Ndef.encodeMessage([record]);
      if (!bytes) throw new Error('Failed to encode NDEF message');
      await writeBytes(bytes);
      Vibration.vibrate(200);
      setStatus('done');
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      if (msg === 'cancelled') { setStatus('idle'); }
      else { setErrorMsg(msg); setStatus('error'); }
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
  }

  function cancel() {
    NfcManager.cancelTechnologyRequest().catch(() => {});
    setStatus('idle');
  }

  const canWrite = recordType === 'onfct' ? onfctFile !== null : content.trim().length > 0;

  if (status === 'writing') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleScanning]}>
          <Text style={styles.iconText}>⟳</Text>
        </View>
        <Text style={styles.screenTitle}>Ready to Write</Text>
        <Text style={styles.screenSubtitle}>Hold an NFC tag close to your phone</Text>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonCancel]} onPress={cancel}>
          <Text style={styles.actionButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'done') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleWrite]}>
          <Text style={styles.iconText}>✓</Text>
        </View>
        <Text style={styles.screenTitle}>Written Successfully</Text>
        <Text style={styles.screenSubtitle}>The tag has been written.</Text>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonWrite]}
          onPress={() => { setStatus('idle'); setContent(''); setOnfctFile(null); }}>
          <Text style={styles.actionButtonText}>Write Another</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.resultsHeader}>Write NFC Tag</Text>

      <SectionLabel text="Record Type" />
      <View style={styles.writeDropdownRow}>
        <Dropdown
          options={WRITE_TYPE_OPTIONS}
          value={recordType}
          onSelect={v => { setRecordType(v); setContent(''); setOnfctFile(null); setOnfctError(''); }}
          isOpen={typeOpen}
          onToggle={() => setTypeOpen(v => !v)}
        />
      </View>

      <SectionLabel text="Content" />
      {recordType === 'onfct' ? (
        <>
          {onfctFile ? (
            <View style={styles.card}>
              <InfoRow label="Type" value={onfctFile.tag.type} />
              <InfoRow label="UID" value={onfctFile.tag.uid} mono />
              <InfoRow label="Records" value={String(onfctFile.ndef.recordCount)} />
              <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.infoLabel}>NDEF Bytes</Text>
                <Text style={styles.infoValue}>
                  {onfctFile.ndef.encodedHex.trim().split(/[\s,:\n]+/).filter(Boolean).length}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={[styles.writeInput, { color: C.textMuted, paddingVertical: 14 }]}>
                No file loaded — tap below to pick a .onfct file
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border, alignSelf: 'stretch', marginTop: 10 }]}
            onPress={loadOnfctFile}
            activeOpacity={0.7}>
            <Text style={[styles.actionButtonText, { color: C.text }]}>
              {onfctFile ? 'Load Different File' : 'Load .onfct File'}
            </Text>
          </TouchableOpacity>
          {onfctError ? (
            <Text style={[styles.screenSubtitle, styles.errorText, styles.writeError]}>{onfctError}</Text>
          ) : null}
        </>
      ) : (
        <View style={styles.card}>
          <TextInput
            style={[styles.writeInput, recordType === 'text' && styles.writeInputMulti]}
            value={content}
            onChangeText={setContent}
            placeholder={writePlaceholder(recordType)}
            placeholderTextColor={C.textMuted}
            keyboardType={writeKeyboard(recordType)}
            multiline={recordType === 'text'}
            autoCapitalize={recordType === 'text' ? 'sentences' : 'none'}
            autoCorrect={recordType === 'text'}
          />
        </View>
      )}

      {status === 'error' && (
        <Text style={[styles.screenSubtitle, styles.errorText, styles.writeError]}>{errorMsg}</Text>
      )}

      <TouchableOpacity
        style={[styles.actionButton, styles.actionButtonWrite, styles.writeSubmitBtn,
                !canWrite && styles.writeSubmitBtnDisabled]}
        onPress={write}
        activeOpacity={0.7}
        disabled={!canWrite}>
        <Text style={styles.actionButtonText}>
          {status === 'error' ? 'Try Again' : 'Write to Tag'}
        </Text>
      </TouchableOpacity>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ── Other screen ─────────────────────────────────────────────────────────────

type OtherSubScreen = null | 'erase' | 'emulate' | 'format' | 'clone';

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.otherBackBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.otherBackBtnText}>← Back</Text>
    </TouchableOpacity>
  );
}

function EraseFlow({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function erase() {
    setStatus('scanning');
    setErrorMsg('');
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const bytes = Ndef.encodeMessage([{ tnf: Ndef.TNF_EMPTY, type: [], id: [], payload: [] }]);
      if (!bytes) throw new Error('Failed to encode empty NDEF message');
      await NfcManager.ndefHandler.writeNdefMessage(bytes);
      Vibration.vibrate(200);
      setStatus('done');
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      if (msg === 'cancelled') { setStatus('idle'); }
      else { setErrorMsg(msg); setStatus('error'); }
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
  }

  function cancel() {
    NfcManager.cancelTechnologyRequest().catch(() => {});
    setStatus('idle');
  }

  if (status === 'scanning') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleScanning]}>
          <Text style={styles.iconText}>⟳</Text>
        </View>
        <Text style={styles.screenTitle}>Ready to Erase</Text>
        <Text style={styles.screenSubtitle}>Hold an NFC tag close to your phone</Text>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonCancel]} onPress={cancel}>
          <Text style={styles.actionButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'done') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleWrite]}>
          <Text style={styles.iconText}>✓</Text>
        </View>
        <Text style={styles.screenTitle}>Tag Erased</Text>
        <Text style={styles.screenSubtitle}>All NDEF data has been cleared.</Text>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonOther]} onPress={() => setStatus('idle')}>
          <Text style={styles.actionButtonText}>Erase Another</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.otherBackBtn} onPress={onBack}>
          <Text style={styles.otherBackBtnText}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.iconCircle, styles.iconCircleOther]}>
        <Text style={styles.iconText}>⌫</Text>
      </View>
      <Text style={styles.screenTitle}>Erase Tag</Text>
      <Text style={[styles.screenSubtitle, status === 'error' && styles.errorText]}>
        {status === 'error' ? errorMsg : 'Removes all NDEF records from the tag.'}
      </Text>
      <TouchableOpacity style={[styles.actionButton, styles.actionButtonOther]} onPress={erase}>
        <Text style={styles.actionButtonText}>{status === 'error' ? 'Try Again' : 'Erase Tag'}</Text>
      </TouchableOpacity>
      <BackButton onPress={onBack} />
    </View>
  );
}

function FormatFlow({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function format() {
    setStatus('scanning');
    setErrorMsg('');
    try {
      await NfcManager.requestTechnology(NfcTech.NdefFormatable);
      const bytes = Ndef.encodeMessage([{ tnf: Ndef.TNF_EMPTY, type: [], id: [], payload: [] }]);
      if (!bytes) throw new Error('Failed to encode empty NDEF message');
      await NfcManager.ndefFormatableHandlerAndroid.formatNdef(bytes);
      Vibration.vibrate(200);
      setStatus('done');
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      if (msg === 'cancelled') { setStatus('idle'); }
      else { setErrorMsg(msg); setStatus('error'); }
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
  }

  function cancel() {
    NfcManager.cancelTechnologyRequest().catch(() => {});
    setStatus('idle');
  }

  if (status === 'scanning') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleScanning]}>
          <Text style={styles.iconText}>⟳</Text>
        </View>
        <Text style={styles.screenTitle}>Ready to Format</Text>
        <Text style={styles.screenSubtitle}>Hold an unformatted NFC tag close to your phone</Text>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonCancel]} onPress={cancel}>
          <Text style={styles.actionButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'done') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleWrite]}>
          <Text style={styles.iconText}>✓</Text>
        </View>
        <Text style={styles.screenTitle}>Tag Formatted</Text>
        <Text style={styles.screenSubtitle}>The tag is now ready for NDEF data.</Text>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonOther]} onPress={() => setStatus('idle')}>
          <Text style={styles.actionButtonText}>Format Another</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.otherBackBtn} onPress={onBack}>
          <Text style={styles.otherBackBtnText}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.iconCircle, styles.iconCircleOther]}>
        <Text style={styles.iconText}>⊞</Text>
      </View>
      <Text style={styles.screenTitle}>Format Tag</Text>
      <Text style={[styles.screenSubtitle, status === 'error' && styles.errorText]}>
        {status === 'error' ? errorMsg : 'Initialises an unformatted tag as NDEF so it can store records.'}
      </Text>
      <TouchableOpacity style={[styles.actionButton, styles.actionButtonOther]} onPress={format}>
        <Text style={styles.actionButtonText}>{status === 'error' ? 'Try Again' : 'Format Tag'}</Text>
      </TouchableOpacity>
      <BackButton onPress={onBack} />
    </View>
  );
}

function EmulateFlow({ onBack }: { onBack: () => void }) {
  const [onfct, setOnfct] = useState<OnfctFile | null>(null);
  const [emulating, setEmulating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function loadFile() {
    setErrorMsg('');
    try {
      const content: string = await openFileAsync('*/*');
      const parsed = JSON.parse(content) as OnfctFile;
      if (parsed.format !== 'onfct') throw new Error('Not a valid .onfct file');
      if (!parsed.ndef?.encodedHex) throw new Error('File contains no NDEF data');
      setOnfct(parsed);
    } catch (e: any) {
      if (e?.code !== 'CANCELLED') {
        setErrorMsg(e?.message ?? 'Invalid file format');
      }
    }
  }

  const isMifareClassic = onfct?.tag.dataFormat === 'NXP Mifare Classic';

  async function startEmulation() {
    if (!onfct) return;
    setErrorMsg('');
    try {
      await Hce.start(onfct.ndef.encodedHex);
      setEmulating(true);
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Failed to start emulation');
    }
  }

  async function stopEmulation() {
    await Hce.stop();
    setEmulating(false);
  }

  if (emulating && onfct) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.resultsHeader}>Emulating Tag</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Status</Text>
            <Text style={[styles.infoValue, { color: C.accent }]}>Active</Text>
          </View>
          <InfoRow label="Type" value={onfct.tag.type} />
          <InfoRow label="Records" value={String(onfct.ndef.recordCount)} />
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.infoLabel}>NDEF Bytes</Text>
            <Text style={styles.infoValue}>{onfct.ndef.encodedHex.split(' ').filter(Boolean).length}</Text>
          </View>
        </View>
        {isMifareClassic && (
          <View style={styles.emulateWarning}>
            <Text style={styles.emulateWarningTitle}>Mifare Classic limitation</Text>
            <Text style={styles.emulateWarningBody}>
              Android HCE can only emulate ISO-DEP (Type 4) cards. The phone will be detected as a
              Type 4 tag, not Mifare Classic. Readers that exclusively accept Mifare Classic (e.g.
              most access-control systems) will reject it. Readers that also support ISO-DEP will
              be able to read the NDEF content.
            </Text>
          </View>
        )}
        <Text style={[styles.screenSubtitle, { marginTop: 16, marginLeft: 2 }]}>
          Hold your phone near an NFC reader to be detected as a Type 4 Tag.
        </Text>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonCancel, { alignSelf: 'stretch', marginTop: 24 }]}
          onPress={stopEmulation}
          activeOpacity={0.7}>
          <Text style={styles.actionButtonText}>Stop Emulation</Text>
        </TouchableOpacity>
        <BackButton onPress={async () => { await stopEmulation(); onBack(); }} />
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.resultsHeader}>Emulate Tag</Text>

      {onfct ? (
        <>
          <SectionLabel text="Loaded Tag" />
          <View style={styles.card}>
            <InfoRow label="Type" value={onfct.tag.type} />
            <InfoRow label="Format" value={onfct.tag.dataFormat} />
            <InfoRow label="UID" value={onfct.tag.uid} mono />
            {onfct.tag.atqa != null && <InfoRow label="ATQA" value={String(onfct.tag.atqa)} mono />}
            {onfct.tag.sak != null && (
              <InfoRow label="SAK" value={`0x${onfct.tag.sak.toString(16).toUpperCase().padStart(2, '0')}`} mono />
            )}
            {onfct.tag.techTypes && onfct.tag.techTypes.length > 0 && (
              <InfoRow label="Technologies" value={onfct.tag.techTypes.join(', ')} />
            )}
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.infoLabel}>Records</Text>
              <Text style={styles.infoValue}>{onfct.ndef.recordCount}</Text>
            </View>
          </View>
          {onfct.ndef.records.map((r, i) => (
            <View key={i} style={styles.recordCard}>
              <Text style={styles.recordType}>{r.label}</Text>
              <Text style={styles.recordValue}>{r.value}</Text>
            </View>
          ))}
        </>
      ) : (
        <Text style={[styles.screenSubtitle, { marginTop: 8, marginLeft: 2 }]}>
          Load a .onfct file exported from the Memory Manager to emulate the tag.
        </Text>
      )}

      <TouchableOpacity
        style={[styles.actionButton, { backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border, alignSelf: 'stretch', marginTop: onfct ? 16 : 24 }]}
        onPress={loadFile}
        activeOpacity={0.7}>
        <Text style={[styles.actionButtonText, { color: C.text }]}>
          {onfct ? 'Load Different File' : 'Load .onfct File'}
        </Text>
      </TouchableOpacity>

      {errorMsg ? (
        <Text style={[styles.screenSubtitle, styles.errorText, { marginTop: 10, marginLeft: 2 }]}>{errorMsg}</Text>
      ) : null}

      {onfct && isMifareClassic && (
        <View style={[styles.emulateWarning, { marginTop: 16 }]}>
          <Text style={styles.emulateWarningTitle}>Mifare Classic limitation</Text>
          <Text style={styles.emulateWarningBody}>
            Android HCE can only emulate ISO-DEP (Type 4) cards. Readers that exclusively
            accept Mifare Classic will reject the phone. Readers that support ISO-DEP will
            still be able to read the NDEF content.
          </Text>
        </View>
      )}

      {onfct && (
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonOther, styles.writeSubmitBtn]}
          onPress={startEmulation}
          activeOpacity={0.7}>
          <Text style={styles.actionButtonText}>Start Emulation</Text>
        </TouchableOpacity>
      )}

      <BackButton onPress={onBack} />
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

type CloneStatus = 'idle' | 'reading' | 'ready' | 'writing' | 'done' | 'error';

function CloneFlow({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<CloneStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [binError, setBinError] = useState('');
  const [sourcePages, setSourcePages] = useState<{ page: number; hex: string }[]>([]);
  const [sourceMifareBlocks, setSourceMifareBlocks] = useState<MifareBlock[]>([]);
  const [sourceBytes, setSourceBytes] = useState<number[]>([]); // NDEF fallback only

  function resetSource() {
    setSourcePages([]);
    setSourceMifareBlocks([]);
    setSourceBytes([]);
  }

  async function saveBin() {
    let bytes: number[];
    if (sourceMifareBlocks.length > 0) {
      bytes = [...sourceMifareBlocks]
        .sort((a, b) => a.block - b.block)
        .flatMap(blk => blk.data);
    } else if (sourcePages.length > 0) {
      bytes = [...sourcePages]
        .sort((a, b) => a.page - b.page)
        .flatMap(p => p.hex.trim().split(/\s+/).map(h => parseInt(h, 16)));
    } else {
      bytes = sourceBytes;
    }
    try {
      await saveFileBinaryAsync(bytes, 'tag_dump.bin', 'application/octet-stream');
    } catch (e: any) {
      if (e?.code !== 'CANCELLED') {
        Alert.alert('Save Failed', e?.message ?? 'Could not save file.');
      }
    }
  }

  async function loadBin() {
    setBinError('');
    try {
      const bytes = await openFileBinaryAsync('*/*');
      if (bytes.length === 0) throw new Error('File is empty');

      const defaultKey = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];

      if (bytes.length === 320 || bytes.length === 1024 || bytes.length === 4096) {
        // MIFARE Classic memory dump
        const blocks: MifareBlock[] = [];
        if (bytes.length === 320) {
          // MIFARE Mini: 5 sectors × 4 blocks × 16 bytes
          for (let s = 0; s < 5; s++) {
            for (let b = 0; b < 4; b++) {
              const abs = s * 4 + b;
              blocks.push({ sector: s, block: abs, blockInSector: b, blockCount: 4, data: bytes.slice(abs * 16, abs * 16 + 16), sectorKey: defaultKey });
            }
          }
        } else if (bytes.length === 1024) {
          // MIFARE Classic 1K: 16 sectors × 4 blocks × 16 bytes
          for (let s = 0; s < 16; s++) {
            for (let b = 0; b < 4; b++) {
              const abs = s * 4 + b;
              blocks.push({ sector: s, block: abs, blockInSector: b, blockCount: 4, data: bytes.slice(abs * 16, abs * 16 + 16), sectorKey: defaultKey });
            }
          }
        } else {
          // MIFARE Classic 4K: sectors 0-31 (4 blocks), sectors 32-39 (16 blocks)
          for (let s = 0; s < 32; s++) {
            for (let b = 0; b < 4; b++) {
              const abs = s * 4 + b;
              blocks.push({ sector: s, block: abs, blockInSector: b, blockCount: 4, data: bytes.slice(abs * 16, abs * 16 + 16), sectorKey: defaultKey });
            }
          }
          for (let s = 32; s < 40; s++) {
            for (let b = 0; b < 16; b++) {
              const abs = 128 + (s - 32) * 16 + b;
              blocks.push({ sector: s, block: abs, blockInSector: b, blockCount: 16, data: bytes.slice(abs * 16, abs * 16 + 16), sectorKey: defaultKey });
            }
          }
        }
        setSourceMifareBlocks(blocks);
        setSourcePages([]);
        setSourceBytes([]);
      } else if (bytes.length % 4 === 0) {
        // NFC Type 2 / NTAG: pages of 4 bytes
        const pages: { page: number; hex: string }[] = [];
        for (let i = 0; i < bytes.length; i += 4) {
          pages.push({
            page: i / 4,
            hex: bytes.slice(i, i + 4).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
          });
        }
        setSourcePages(pages);
        setSourceMifareBlocks([]);
        setSourceBytes([]);
      } else {
        // Raw NDEF bytes fallback
        setSourceBytes(bytes);
        setSourcePages([]);
        setSourceMifareBlocks([]);
      }
      Vibration.vibrate(100);
      setStatus('ready');
    } catch (e: any) {
      if (e?.code !== 'CANCELLED') {
        setBinError(e?.message ?? 'Could not load file.');
      }
    }
  }

  async function readSource() {
    setStatus('reading');
    setErrorMsg('');
    console.log('[Clone] readSource start');
    try {
      // Phase 1: NDEF — fast primary read for any NDEF-formatted tag
      let ndefBytes: number[] = [];
      let gotNdef = false;
      try {
        console.log('[Clone] phase 1: requesting NDEF...');
        await NfcManager.requestTechnology(NfcTech.Ndef);
        const tag = (await NfcManager.getTag()) as any;
        if (tag && Array.isArray(tag.ndefMessage) && tag.ndefMessage.length > 0) {
          ndefBytes = encodeNdefFallback(tag.ndefMessage);
          gotNdef = true;
          console.log('[Clone] NDEF bytes:', ndefBytes.length);
        } else {
          console.log('[Clone] NDEF tech connected but no records');
        }
      } catch (ndefErr) {
        console.log('[Clone] NDEF not available:', ndefErr);
      } finally {
        await NfcManager.cancelTechnologyRequest().catch(() => {});
      }

      // Phase 2: MifareClassic — full sector/block dump
      let gotMifare = false;
      try {
        console.log('[Clone] phase 2: requesting MifareClassic...');
        await NfcManager.requestTechnology(NfcTech.MifareClassic);
        const MC = NfcManager.mifareClassicHandlerAndroid;
        const sectorCount: number = await MC.mifareClassicGetSectorCount();
        console.log(`[Clone] MifareClassic: ${sectorCount} sectors`);
        const blocks: MifareBlock[] = [];

        for (let s = 0; s < sectorCount; s++) {
          // Try common Key A values in order
          let authKey: number[] | null = null;
          for (const key of MIFARE_KEYS) {
            try {
              await MC.mifareClassicAuthenticateA(s, key);
              authKey = key;
              break;
            } catch { /* try next key */ }
          }
          if (!authKey) {
            console.log(`[Clone] sector ${s}: all keys failed, skipping`);
            continue;
          }

          const blockCount: number = await MC.mifareClassicGetBlockCountInSector(s);
          const firstBlock: number = await MC.mifareClassicSectorToBlock(s);
          for (let b = 0; b < blockCount; b++) {
            try {
              const data: number[] = await MC.mifareClassicReadBlock(firstBlock + b);
              blocks.push({ sector: s, block: firstBlock + b, blockInSector: b, blockCount, data, sectorKey: authKey });
            } catch (blkErr) {
              console.log(`[Clone] block ${firstBlock + b} read failed:`, blkErr);
            }
          }
        }

        console.log(`[Clone] MifareClassic: read ${blocks.length} blocks`);
        if (blocks.length > 0) {
          setSourceMifareBlocks(blocks);
          gotMifare = true;
        }
      } catch (mcErr) {
        console.log('[Clone] MifareClassic phase skipped:', mcErr);
      } finally {
        await NfcManager.cancelTechnologyRequest().catch(() => {});
      }

      // Phase 3: NfcA transceive — raw page dump for NTAG/Type 2
      let gotPages = false;
      if (!gotMifare) {
        try {
          console.log('[Clone] phase 3: requesting NfcA for raw pages...');
          await NfcManager.requestTechnology(NfcTech.NfcA);
          const pages: { page: number; hex: string }[] = [];
          for (let pageNum = 0; pageNum < 256; pageNum += 4) {
            try {
              const resp: number[] = await NfcManager.nfcAHandler.transceive([0x30, pageNum]);
              for (let i = 0; i < 4 && pageNum + i < 256; i++) {
                const slice = resp.slice(i * 4, (i + 1) * 4);
                pages.push({
                  page: pageNum + i,
                  hex: slice.map((b: number) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
                });
              }
            } catch (pageErr) {
              console.log(`[Clone] page read stopped at page ${pageNum}:`, pageErr);
              break;
            }
          }
          console.log(`[Clone] read ${pages.length} pages`);
          if (pages.length > 0) {
            setSourcePages(pages);
            gotPages = true;
          }
        } catch (nfcAErr) {
          console.log('[Clone] NfcA phase skipped:', nfcAErr);
        } finally {
          await NfcManager.cancelTechnologyRequest().catch(() => {});
        }
      }

      console.log(`[Clone] gotMifare=${gotMifare} gotPages=${gotPages} gotNdef=${gotNdef}`);
      if (!gotMifare && !gotPages && !gotNdef) {
        throw new Error('No data found on source tag — tag may be blank or unsupported');
      }
      if (!gotMifare && !gotPages) {
        setSourceBytes(ndefBytes);
      }

      console.log('[Clone] setting status ready');
      Vibration.vibrate(100);
      setStatus('ready');
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      console.log('[Clone] readSource error:', msg);
      if (msg === 'cancelled') { setStatus('idle'); }
      else { setErrorMsg(msg); setStatus('error'); }
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
  }

  async function writeTarget() {
    setStatus('writing');
    setErrorMsg('');
    try {
      if (sourceMifareBlocks.length > 0) {
        // MIFARE Classic write: authenticate each sector then write blocks.
        // Block 0 (sector 0, block 0) is the manufacturer block — hardware-locked on real cards, skip it.
        // Sector trailers: write with Key A restored from the source auth key (Key A is masked as
        // 00 00 00 00 00 00 on read, so we substitute the key we actually used to authenticate).
        console.log('[Clone] writeTarget: requesting MifareClassic...');
        await NfcManager.requestTechnology(NfcTech.MifareClassic);
        console.log('[Clone] writeTarget: MifareClassic granted');
        const MC = NfcManager.mifareClassicHandlerAndroid;

        // Extract Key B from source sector trailers (bytes 10–15 of each trailer block).
        // On NDEF cards the access bits make Key B readable via Key A, so these bytes hold
        // the real key — not zeros. Build a per-sector map before the write loop.
        const sectorKeyB = new Map<number, number[]>();
        for (const blk of sourceMifareBlocks) {
          if (blk.blockInSector === blk.blockCount - 1) {
            const kb = blk.data.slice(10, 16);
            if (kb.some(b => b !== 0)) {
              sectorKeyB.set(blk.sector, kb);
              console.log(`[Clone] sector ${blk.sector} Key B from trailer: ${kb.map(b => b.toString(16).padStart(2,'0')).join(':')}`);
            }
          }
        }

        let lastAuthSector = -1;
        let writtenBlocks = 0;
        let skippedBlocks = 0;
        for (const { sector, block, blockInSector, blockCount, data, sectorKey } of sourceMifareBlocks) {
          if (block === 0) { console.log('[Clone] block 0 skipped (manufacturer)'); continue; }
          if (sector !== lastAuthSector) {
            // Priority: source Key B (from trailer) → source Key A → common keys (B then A)
            const sourceKeyB = sectorKeyB.get(sector);
            const keysToTry: Array<[string, number[]]> = [];
            if (sourceKeyB) keysToTry.push(['B', sourceKeyB]);
            keysToTry.push(['A', sectorKey]);
            for (const k of MIFARE_KEYS) {
              if (k.join() !== sectorKey.join() && (!sourceKeyB || k.join() !== sourceKeyB.join())) {
                keysToTry.push(['B', k], ['A', k]);
              }
            }

            let authedDesc: string | null = null;
            for (const [label, key] of keysToTry) {
              const authFn = label === 'B' ? MC.mifareClassicAuthenticateB.bind(MC) : MC.mifareClassicAuthenticateA.bind(MC);
              try {
                await authFn(sector, key);
                authedDesc = `Key${label} ${key.map(b => b.toString(16).padStart(2,'0')).join(':')}`;
                break;
              } catch { /* try next */ }
            }
            if (!authedDesc) throw new Error(`Could not authenticate target sector ${sector} — target tag may use unknown keys`);
            console.log(`[Clone] sector ${sector} write auth OK with ${authedDesc}`);
            lastAuthSector = sector;
          }
          const isTrailer = blockInSector === blockCount - 1;
          let writeData = [...data];
          if (isTrailer) {
            for (let i = 0; i < 6; i++) writeData[i] = sectorKey[i];
          }
          const hexData = writeData.map(b => b.toString(16).padStart(2,'0')).join(' ');
          console.log(`[Clone] writing block ${block} (sector ${sector}, blockInSector ${blockInSector}, trailer=${isTrailer}): ${hexData}`);
          try {
            await MC.mifareClassicWriteBlock(block, writeData);
            console.log(`[Clone] block ${block} written OK`);
            writtenBlocks++;
          } catch (writeErr) {
            console.log(`[Clone] block ${block} write FAILED (access denied or tag moved — use a blank target card):`, writeErr);
            skippedBlocks++;
          }
        }
        console.log(`[Clone] MIFARE write done: ${writtenBlocks} written, ${skippedBlocks} skipped`);
        if (writtenBlocks === 0) {
          throw new Error('No blocks could be written — use a blank MIFARE Classic card as the target (factory default keys)');
        }
      } else if (sourcePages.length > 0) {
        await NfcManager.requestTechnology(NfcTech.NfcA);
        for (const { page, hex } of sourcePages) {
          if (page < 3) continue;
          const data = hex.trim().split(/\s+/).map(h => parseInt(h, 16));
          // NFC Type 2 WRITE command: cmd 0xA2, page offset, 4 data bytes
          await NfcManager.nfcAHandler.transceive([0xA2, page, ...data]);
        }
      } else {
        let usedNdef = true;
        try {
          await NfcManager.requestTechnology(NfcTech.Ndef);
        } catch {
          usedNdef = false;
          await NfcManager.requestTechnology(NfcTech.NdefFormatable);
        }
        if (usedNdef) {
          const tag = (await NfcManager.getTag()) as any;
          if (tag?.maxSize != null && tag.maxSize < sourceBytes.length) {
            throw new Error(`Target tag is too small: ${tag.maxSize} bytes available, source needs ${sourceBytes.length}.`);
          }
          await NfcManager.ndefHandler.writeNdefMessage(sourceBytes);
        } else {
          await NfcManager.ndefFormatableHandlerAndroid.formatNdef(sourceBytes);
        }
      }
      Vibration.vibrate(200);
      setStatus('done');
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      if (msg === 'cancelled') { setStatus('ready'); }
      else { setErrorMsg(msg); setStatus('error'); }
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
  }

  function cancelRead() {
    NfcManager.cancelTechnologyRequest().catch(() => {});
    setStatus('idle');
  }

  function cancelWrite() {
    NfcManager.cancelTechnologyRequest().catch(() => {});
    setStatus('ready');
  }

  if (status === 'reading') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleScanning]}>
          <Text style={styles.iconText}>⟳</Text>
        </View>
        <Text style={styles.screenTitle}>Scan Source Tag</Text>
        <Text style={styles.screenSubtitle}>Hold the tag you want to clone near your phone</Text>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonCancel]} onPress={cancelRead}>
          <Text style={styles.actionButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'ready') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleWrite]}>
          <Text style={styles.iconText}>✓</Text>
        </View>
        <Text style={styles.screenTitle}>Source Read</Text>
        <View style={[styles.card, { alignSelf: 'stretch', marginBottom: 4 }]}>
          {sourceMifareBlocks.length > 0 ? (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Sectors read</Text>
                <Text style={styles.infoValue}>{new Set(sourceMifareBlocks.map(b => b.sector)).size}</Text>
              </View>
              <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.infoLabel}>Blocks read</Text>
                <Text style={styles.infoValue}>{sourceMifareBlocks.length}</Text>
              </View>
            </>
          ) : sourcePages.length > 0 ? (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Memory pages</Text>
                <Text style={styles.infoValue}>{sourcePages.length}</Text>
              </View>
              <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.infoLabel}>Bytes in RAM</Text>
                <Text style={styles.infoValue}>{sourcePages.length * 4}</Text>
              </View>
            </>
          ) : (
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.infoLabel}>Bytes in RAM</Text>
              <Text style={styles.infoValue}>{sourceBytes.length}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonWrite, { alignSelf: 'stretch' }]} onPress={writeTarget} activeOpacity={0.7}>
          <Text style={styles.actionButtonText}>Write to Target Tag</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, { backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border, alignSelf: 'stretch' }]} onPress={saveBin} activeOpacity={0.7}>
          <Text style={[styles.actionButtonText, { color: C.text }]}>Save as .bin</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, { backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border, alignSelf: 'stretch' }]} onPress={() => { resetSource(); setStatus('idle'); }} activeOpacity={0.7}>
          <Text style={[styles.actionButtonText, { color: C.text }]}>Re-scan Source</Text>
        </TouchableOpacity>
        <BackButton onPress={onBack} />
      </View>
    );
  }

  if (status === 'writing') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleScanning]}>
          <Text style={styles.iconText}>⟳</Text>
        </View>
        <Text style={styles.screenTitle}>Scan Target Tag</Text>
        <Text style={styles.screenSubtitle}>Hold the target tag near your phone — keep it still</Text>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonCancel]} onPress={cancelWrite}>
          <Text style={styles.actionButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'done') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleWrite]}>
          <Text style={styles.iconText}>✓</Text>
        </View>
        <Text style={styles.screenTitle}>Clone Complete</Text>
        <Text style={styles.screenSubtitle}>Tag memory written to target tag.</Text>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonOther]} onPress={() => { resetSource(); setStatus('idle'); }}>
          <Text style={styles.actionButtonText}>Clone Another</Text>
        </TouchableOpacity>
        <BackButton onPress={onBack} />
      </View>
    );
  }

  // idle + error
  return (
    <View style={styles.screen}>
      <View style={[styles.iconCircle, status === 'error' ? styles.iconCircleError : styles.iconCircleOther]}>
        <Text style={styles.iconText}>⊕</Text>
      </View>
      <Text style={styles.screenTitle}>Clone Tag</Text>
      {status === 'error' ? (
        <Text style={[styles.screenSubtitle, styles.errorText]}>{errorMsg}</Text>
      ) : (
        <Text style={styles.screenSubtitle}>
          Reads all memory pages from a source tag and writes them to a target tag — works with any data format.
        </Text>
      )}
      <TouchableOpacity style={[styles.actionButton, styles.actionButtonOther]} onPress={readSource}>
        <Text style={styles.actionButtonText}>{status === 'error' ? 'Try Again' : 'Start — Scan Source Tag'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.actionButton, { backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border, alignSelf: 'stretch' }]} onPress={loadBin} activeOpacity={0.7}>
        <Text style={[styles.actionButtonText, { color: C.text }]}>Load from .bin</Text>
      </TouchableOpacity>
      {binError ? (
        <Text style={[styles.screenSubtitle, styles.errorText]}>{binError}</Text>
      ) : null}
      <BackButton onPress={onBack} />
    </View>
  );
}

function OtherScreen() {
  const [subScreen, setSubScreen] = useState<OtherSubScreen>(null);

  if (subScreen === 'erase')   return <EraseFlow   onBack={() => setSubScreen(null)} />;
  if (subScreen === 'emulate') return <EmulateFlow onBack={() => setSubScreen(null)} />;
  if (subScreen === 'format')  return <FormatFlow  onBack={() => setSubScreen(null)} />;
  if (subScreen === 'clone')   return <CloneFlow   onBack={() => setSubScreen(null)} />;

  const OPTIONS: { key: OtherSubScreen & string; title: string; desc: string; icon: string }[] = [
    { key: 'erase',   title: 'Erase Tag',    desc: 'Clear all NDEF data from a tag',              icon: '⌫' },
    { key: 'format',  title: 'Format Tag',   desc: 'Initialise an unformatted tag for NDEF use',  icon: '⊞' },
    { key: 'emulate', title: 'Emulate Tag',  desc: 'Emulate a tag from a hex memory dump',        icon: '◈' },
    { key: 'clone',   title: 'Clone Tag',    desc: 'Copy all memory pages from one tag to another', icon: '⊕' },
  ];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.resultsHeader}>Other Actions</Text>
      {OPTIONS.map(o => (
        <TouchableOpacity
          key={o.key}
          style={styles.otherCard}
          onPress={() => setSubScreen(o.key)}
          activeOpacity={0.7}>
          <Text style={styles.otherCardIcon}>{o.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.otherCardTitle}>{o.title}</Text>
            <Text style={styles.otherCardDesc}>{o.desc}</Text>
          </View>
          <Text style={styles.otherCardChevron}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TAB_CONFIG: { id: Tab; label: string }[] = [
  { id: 'read', label: 'Read' },
  { id: 'write', label: 'Write' },
  { id: 'other', label: 'Other' },
];

function TabBar({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (t: Tab) => void }) {
  return (
    <View style={styles.tabBar}>
      {TAB_CONFIG.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tabItem, isActive && styles.tabItemActive]}
            onPress={() => onTabChange(tab.id)}
            activeOpacity={0.7}>
            <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : styles.tabLabelInactive]}>
              {tab.label}
            </Text>
            {isActive && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>('read');
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Image
            source={require('./android/app/src/main/res/1024.png')}
            style={styles.headerLogo}
          />
          <View>
            <Text style={styles.headerTitle}>OpenNFCT</Text>
            <Text style={styles.headerSubtitle}>Open NFC Toolkit</Text>
          </View>
        </View>
      </View>
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <View style={styles.content}>
        <View style={[styles.tabScreen, activeTab !== 'read' && styles.tabScreenHidden]}><ReadScreen /></View>
        <View style={[styles.tabScreen, activeTab !== 'write' && styles.tabScreenHidden]}><WriteScreen /></View>
        <View style={[styles.tabScreen, activeTab !== 'other' && styles.tabScreenHidden]}><OtherScreen /></View>
      </View>
    </View>
  );
}

function NfcWarningBanner() {
  return (
    <TouchableOpacity style={styles.nfcWarning} onPress={() => NfcManager.goToNfcSetting()} activeOpacity={0.8}>
      <Text style={styles.nfcWarningIcon}>⚠</Text>
      <Text style={styles.nfcWarningText}>NFC is disabled — tap to open Settings</Text>
    </TouchableOpacity>
  );
}

function App() {
  const [nfcEnabled, setNfcEnabled] = useState<boolean>(true);

  useEffect(() => {
    async function initNfc() {
      const supported = await NfcManager.isSupported();
      if (!supported) { setNfcEnabled(false); return; }
      await NfcManager.start();
      setNfcEnabled(await NfcManager.isEnabled());
    }
    initNfc();
    const sub = AppState.addEventListener('change', async state => {
      if (state === 'active') setNfcEnabled(await NfcManager.isEnabled());
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        {!nfcEnabled && <NfcWarningBanner />}
        <AppContent />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerLogo: { width: 44, height: 44, borderRadius: 10 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: C.accent, letterSpacing: 1.2 },
  headerSubtitle: { fontSize: 12, color: C.textMuted, marginTop: 2, letterSpacing: 0.5 },

  tabBar: { flexDirection: 'row', backgroundColor: C.tabBar, borderBottomWidth: 1, borderBottomColor: C.border },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 14, position: 'relative' },
  tabItemActive: { backgroundColor: C.surface },
  tabLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  tabLabelActive: { color: C.activeTabText },
  tabLabelInactive: { color: C.inactiveTabText },
  tabIndicator: { position: 'absolute', bottom: 0, left: 12, right: 12, height: 2, backgroundColor: C.indicator, borderRadius: 1 },

  content: { flex: 1 },
  tabScreen: { flex: 1 },
  tabScreenHidden: { display: 'none' },

  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  iconCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.accentDim,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8, borderWidth: 1, borderColor: C.accent,
  },
  iconCircleScanning: { borderColor: C.warning, backgroundColor: '#3a2a00' },
  iconCircleError: { borderColor: C.error, backgroundColor: '#3a0000' },
  iconCircleWrite: { backgroundColor: '#1a4a2e', borderColor: '#66bb6a' },
  iconCircleOther: { backgroundColor: '#2a2a2a', borderColor: '#757575' },
  iconText: { fontSize: 32, color: '#ffffff' },

  screenTitle: { fontSize: 20, fontWeight: '700', color: C.text, textAlign: 'center' },
  screenSubtitle: { fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 20, maxWidth: 260 },
  errorText: { color: C.error },

  actionButton: { marginTop: 8, backgroundColor: C.activeTab, paddingVertical: 14, paddingHorizontal: 36, borderRadius: 8 },
  actionButtonWrite: { backgroundColor: '#2e7d32' },
  actionButtonOther: { backgroundColor: '#424242' },
  actionButtonCancel: { backgroundColor: '#5a3a00' },
  actionButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600', letterSpacing: 0.5, textAlign: 'center' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 20 },
  resultsHeader: { fontSize: 18, fontWeight: '700', color: C.accent, marginBottom: 16, letterSpacing: 0.5 },

  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: C.textMuted, letterSpacing: 1,
    textTransform: 'uppercase', marginTop: 20, marginBottom: 8, marginLeft: 2,
  },

  card: { backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  infoLabel: { fontSize: 13, color: C.textMuted, flexShrink: 0, marginRight: 8, paddingTop: 1 },
  infoValue: { fontSize: 13, color: C.text, maxWidth: '65%', textAlign: 'right', flexShrink: 1 },
  infoValueMono: { fontFamily: 'monospace', letterSpacing: 0.5 },
  infoValueCol: { alignItems: 'flex-end', flexShrink: 1, maxWidth: '65%' },
  notSupportedBadge: { fontSize: 10, color: C.warning, marginTop: 3, letterSpacing: 0.3 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: C.surfaceAlt, borderRadius: 4, paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: C.border },
  chipText: { fontSize: 12, color: C.text },

  recordCard: { backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 8 },
  recordType: { fontSize: 11, fontWeight: '600', color: C.accent, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 },
  recordValue: { fontSize: 14, color: C.text, lineHeight: 20 },
  recordRaw: { fontSize: 10, color: C.textFaint, fontFamily: 'monospace', marginTop: 8, lineHeight: 14 },

  emptyNote: { fontSize: 13, color: C.textMuted, fontStyle: 'italic', marginLeft: 2 },
  scanAgainButton: { alignSelf: 'center', marginTop: 24 },
  memManagerButton: { marginTop: 20, paddingHorizontal: 0, alignSelf: 'stretch' },

  // Other screen
  otherCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
    padding: 16, marginBottom: 10, gap: 12,
  },
  otherCardIcon: { fontSize: 22, color: C.accent, width: 28, textAlign: 'center' },
  otherCardTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 3 },
  otherCardDesc: { fontSize: 12, color: C.textMuted, lineHeight: 17 },
  otherCardChevron: { fontSize: 22, color: C.textMuted },
  otherBackBtn: { marginTop: 16, alignSelf: 'center', padding: 8 },
  otherBackBtnText: { fontSize: 14, color: C.textMuted },

  // Write screen
  writeDropdownRow: { flexDirection: 'row' },
  writeInput: {
    fontSize: 14, color: C.text, paddingVertical: 12, paddingHorizontal: 14,
    textAlignVertical: 'top',
  },
  writeInputMulti: { minHeight: 100 },
  writeError: { marginTop: 10, marginLeft: 2 },
  writeSubmitBtn: { alignSelf: 'stretch', marginTop: 20 },
  writeSubmitBtnDisabled: { opacity: 0.35 },

  // NFC warning banner
  nfcWarning: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#3a2a00',
    borderBottomWidth: 1, borderBottomColor: '#7a5a00', paddingVertical: 10, paddingHorizontal: 16, gap: 10,
  },
  nfcWarningIcon: { fontSize: 16, color: C.warning },
  nfcWarningText: { fontSize: 13, color: C.warning, flex: 1 },

  // Memory Manager modal
  memModal: { flex: 1, backgroundColor: C.bg },
  memHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  memHeaderTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  memCloseBtn: { padding: 4 },
  memCloseText: { fontSize: 18, color: C.textMuted },

  memTabBar: {
    flexDirection: 'row', backgroundColor: C.tabBar,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  memTabItem: { flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative' },
  memTabItemActive: { backgroundColor: C.surface },
  memTabLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: C.inactiveTabText },
  memTabLabelActive: { color: C.activeTabText },
  memTabIndicator: { position: 'absolute', bottom: 0, left: 8, right: 8, height: 2, backgroundColor: C.indicator, borderRadius: 1 },

  memContent: { flex: 1 },
  memContentInner: { padding: 16 },
  monoContent: { fontFamily: 'monospace', fontSize: 12, color: C.text, lineHeight: 20 },

  memDivider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  memRecordIndex: { fontSize: 11, fontWeight: '600', color: C.accent, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  memFormatText: { fontSize: 14, color: C.text, lineHeight: 22 },
  memTypeBig: { fontSize: 32, fontWeight: '700', color: C.accent, fontFamily: 'monospace', marginBottom: 8 },
  memTypeDesc: { fontSize: 14, color: C.textMuted },
  memEmptyNote: { fontSize: 13, color: C.textMuted, fontStyle: 'italic' },

  memFooter: {
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: C.bg,
  },
  memExportRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memConfirmBtn: {
    backgroundColor: C.activeTab, borderRadius: 8,
    paddingVertical: 12, paddingHorizontal: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  memConfirmText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  // Dropdown
  dropdownBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt, borderRadius: 8, paddingVertical: 12,
    paddingHorizontal: 12, borderWidth: 1, borderColor: C.border,
  },
  dropdownBtnText: { fontSize: 13, color: C.text, fontWeight: '600', flex: 1 },
  dropdownArrow: { fontSize: 9, color: C.textMuted, marginLeft: 6 },
  dropdownOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: C.overlay },
  dropdownSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingBottom: 32, paddingTop: 12, overflow: 'hidden',
  },
  sheetHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  dropdownSheetTitle: {
    fontSize: 11, fontWeight: '600', color: C.textMuted, letterSpacing: 1,
    textTransform: 'uppercase', paddingHorizontal: 20, marginBottom: 4,
  },
  dropdownSheetItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: C.border,
  },
  dropdownSheetItemActive: { backgroundColor: C.accentDim },
  dropdownSheetItemText: { fontSize: 16, color: C.text },
  dropdownSheetItemTextActive: { color: '#fff', fontWeight: '600' },
  dropdownSheetCheck: { fontSize: 14, color: C.accent },

  // Info value inside infoValueCol (no nested maxWidth constraint)
  infoValueFull: { fontSize: 13, color: C.text, textAlign: 'right', flexShrink: 1 },

  // Emulate — Mifare Classic limitation warning
  emulateWarning: {
    backgroundColor: '#3a2a00', borderRadius: 8,
    borderWidth: 1, borderColor: '#7a5a00',
    padding: 14, marginTop: 8,
  },
  emulateWarningTitle: { fontSize: 13, fontWeight: '700', color: C.warning, marginBottom: 6 },
  emulateWarningBody: { fontSize: 12, color: '#ccaa55', lineHeight: 18 },
});

export default App;
