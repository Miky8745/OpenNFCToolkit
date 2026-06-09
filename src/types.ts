export type Tab = 'read' | 'write' | 'other';
export type ScanStatus = 'idle' | 'scanning' | 'done' | 'error';
export type MemoryTab = 'hex' | 'utf8' | 'ascii' | 'format' | 'type';
export type ExportAction = 'copy' | 'disk';
export type ExportFormat = 'hex' | 'utf8' | 'ascii' | 'binary' | 'onfct';
export type WriteRecordType = 'text' | 'url' | 'email' | 'phone' | 'onfct';
export type WriteStatus = 'idle' | 'writing' | 'done' | 'error';
export type OtherSubScreen = null | 'erase' | 'emulate' | 'format' | 'clone';
export type CloneStatus = 'idle' | 'reading' | 'ready' | 'writing' | 'done' | 'error';

export type ParsedRecord = {
  label: string;
  value: string;
  raw: string;
  tnf: number;
  typeStr: string;
  typeBytes: number[];
  idBytes: number[];
};

export type TagMeta = {
  tagType: string;
  dataFormat: string;
  memoryInfo: string;
  totalBytes: number;
  supported: boolean;
};

export type TagData = {
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

export type MifareBlock = {
  sector: number;
  block: number;
  blockInSector: number;
  blockCount: number;
  data: number[];
  sectorKey: number[];
};

export type OnfctFile = {
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

// Raw record shape returned by react-native-nfc-manager before parsing
export type NdefRawRecord = {
  tnf: number;
  type: number[];
  payload: number[];
  id: number[];
};

// Raw tag object returned by NfcManager.getTag()
export type NfcRawTag = {
  id?: string;
  techTypes?: string[];
  ndefMessage?: NdefRawRecord[];
  maxSize?: number;
  isWritable?: boolean;
  canMakeReadOnly?: boolean;
  atqa?: string;
  sak?: number;
};
