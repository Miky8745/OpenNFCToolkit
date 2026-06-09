import { Ndef } from 'react-native-nfc-manager';
import { TNF_FORMAT_LABELS as _TNF, URI_PREFIXES, WELL_KNOWN_TYPE_NAMES as _WKT } from './constants';
import type { NdefRawRecord, ParsedRecord, TagData, TagMeta } from './types';

// ── Tag identification ────────────────────────────────────────────────────────

export function identifyTag(
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
      totalBytes: 1024, supported: false,
    };
    if (sak === 0x18) return {
      tagType: 'ISO 14443-3A (NXP - Mifare Classic 4k)',
      dataFormat: 'NXP Mifare Classic',
      memoryInfo: '4 kb : 32 sectors of 4 blocks + 8 sectors of 16 blocks (16 bytes each)',
      totalBytes: 4096, supported: false,
    };
    if (sak === 0x09) return {
      tagType: 'ISO 14443-3A (NXP - Mifare Mini)',
      dataFormat: 'NXP Mifare Classic',
      memoryInfo: '320 b : 5 sectors of 4 blocks (16 bytes each)',
      totalBytes: 320, supported: false,
    };
    if (sak === 0x28) return {
      tagType: 'ISO 14443-3A (NXP - Mifare Classic 1k - Emulated)',
      dataFormat: 'NXP Mifare Classic',
      memoryInfo: '1 kb : 16 sectors of 4 blocks (16 bytes each)',
      totalBytes: 1024, supported: false,
    };
    if (sak === 0x38) return {
      tagType: 'ISO 14443-3A (NXP - Mifare Classic 4k - Emulated)',
      dataFormat: 'NXP Mifare Classic',
      memoryInfo: '4 kb : 32 sectors of 4 blocks + 8 sectors of 16 blocks (16 bytes each)',
      totalBytes: 4096, supported: false,
    };
    if (sak === 0x00 && atqaNum === 0x0044) {
      const cap = maxSize ?? 48;
      return {
        tagType: 'ISO 14443-3A (NXP - Mifare Ultralight)',
        dataFormat: 'NXP Mifare Ultralight',
        memoryInfo: `${cap} b : ${Math.ceil(cap / 4)} pages of 4 bytes`,
        totalBytes: cap, supported: true,
      };
    }
    if (sak === 0x20) {
      const cap = maxSize ?? 0;
      const model = cap <= 144 ? 'NTAG213' : cap <= 504 ? 'NTAG215' : cap <= 888 ? 'NTAG216' : 'ISO-DEP';
      return {
        tagType: `ISO 14443-4A (NXP - ${model})`,
        dataFormat: 'NFC Forum Type 4',
        memoryInfo: cap > 0 ? `${cap} bytes user memory` : 'Unknown',
        totalBytes: cap, supported: true,
      };
    }
    if (sak === 0x00) {
      const cap = maxSize ?? 0;
      return {
        tagType: 'ISO 14443-3A (NFC Forum Type 2)',
        dataFormat: 'NFC Forum Type 2',
        memoryInfo: cap > 0 ? `${cap} bytes` : 'Unknown',
        totalBytes: cap, supported: true,
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

// ── Byte / string helpers ─────────────────────────────────────────────────────

export function toHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

export function toStr(bytes: number[]): string {
  try {
    return decodeURIComponent(bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join(''));
  } catch {
    return bytes.map(b => String.fromCharCode(b)).join('');
  }
}

export function formatUid(id: string | undefined): string {
  if (!id) return 'Unknown';
  const clean = id.replace(/[^0-9a-fA-F]/g, '');
  return (clean.match(/.{1,2}/g) ?? [clean]).join(':').toUpperCase();
}

export function shortTech(full: string): string {
  return full.split('.').pop() ?? full;
}

// ── NDEF record parsing ───────────────────────────────────────────────────────

export function parseRecord(r: NdefRawRecord): ParsedRecord {
  const typeStr = r.type.map(b => String.fromCharCode(b)).join('');
  const raw = toHex(r.payload);
  const base = {
    tnf: r.tnf, typeStr,
    typeBytes: Array.isArray(r.type) ? r.type : [],
    idBytes: Array.isArray(r.id) ? r.id : [],
    raw,
  };

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
  if (r.tnf === Ndef.TNF_MIME_MEDIA)    return { ...base, label: `MIME: ${typeStr}`,       value: toStr(r.payload) };
  if (r.tnf === Ndef.TNF_ABSOLUTE_URI)  return { ...base, label: 'Absolute URI',            value: typeStr };
  if (r.tnf === Ndef.TNF_EXTERNAL_TYPE) return { ...base, label: `External (${typeStr})`,   value: toStr(r.payload) };
  if (r.tnf === Ndef.TNF_EMPTY)         return { ...base, label: 'Empty',                   value: '—' };
  return { ...base, label: `Unknown (TNF ${r.tnf})`, value: raw };
}

// ── Memory encoding helpers ───────────────────────────────────────────────────

// Manual NDEF encoder — fallback when Ndef.encodeMessage returns null/undefined.
// Handles any TNF/type/payload combination without relying on library recognition.
export function encodeNdefFallback(records: NdefRawRecord[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const type    = r.type    ?? [];
    const payload = r.payload ?? [];
    const id      = r.id      ?? [];
    const isShort = payload.length <= 255;

    let flags = r.tnf & 0x07;
    if (i === 0)                   flags |= 0x80; // MB
    if (i === records.length - 1)  flags |= 0x40; // ME
    if (isShort)                   flags |= 0x10; // SR
    if (id.length > 0)             flags |= 0x08; // IL

    out.push(flags);
    out.push(type.length);
    if (isShort) {
      out.push(payload.length);
    } else {
      out.push(
        (payload.length >>> 24) & 0xFF, (payload.length >>> 16) & 0xFF,
        (payload.length >>>  8) & 0xFF,  payload.length         & 0xFF,
      );
    }
    if (id.length > 0) out.push(id.length);
    out.push(...type, ...id, ...payload);
  }
  return out;
}

export function toHexDump(bytes: number[]): string {
  if (!bytes.length) return '(empty)';
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = chunk.map(b => b.toString(16).padStart(2, '0').toUpperCase());
    const left  = hex.slice(0, 8).join(' ').padEnd(23, ' ');
    const right = hex.slice(8).join(' ');
    const addr  = i.toString(16).padStart(4, '0').toUpperCase();
    lines.push(`${addr}  ${left}  ${right}`);
  }
  return lines.join('\n');
}

export function memToUtf8(bytes: number[]): string {
  if (!bytes.length) return '(empty)';
  try {
    return decodeURIComponent(bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join(''));
  } catch {
    return bytes.map(b => String.fromCharCode(b)).join('');
  }
}

export function memToAscii(bytes: number[]): string {
  if (!bytes.length) return '(empty)';
  return bytes.map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
}

export function memToBinary(bytes: number[]): string {
  if (!bytes.length) return '(empty)';
  return bytes.map(b => b.toString(2).padStart(8, '0')).join(' ');
}

// Parse NDEF TLV stream from NFC Forum Type 2 Tag user pages (pages 4+).
// Returns the raw NDEF message bytes and decoded records.
export function extractNdefFromPages(pages: { page: number; hex: string }[]): {
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
    let len = userBytes[i++] ?? 0;
    if (len === 0xFF && i + 1 < userBytes.length) {
      len = ((userBytes[i] ?? 0) << 8) | (userBytes[i + 1] ?? 0);
      i += 2;
    }
    if (tag === 0x03 && len > 0) {
      const ndefBytes = userBytes.slice(i, i + len);
      try {
        const rawRecords = Ndef.decodeMessage(ndefBytes) as NdefRawRecord[];
        return { ndefBytes, records: rawRecords.map(parseRecord) };
      } catch { break; }
    }
    i += len;
  }
  return { ndefBytes: [], records: [] };
}

// ── .onfct file builder ───────────────────────────────────────────────────────

export function buildOnfct(tagData: TagData): string {
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

// Re-export label maps so consumers don't need a separate import
export { TNF_FORMAT_LABELS, WELL_KNOWN_TYPE_NAMES } from './constants';
