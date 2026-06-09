import type { ExportAction, ExportFormat, MemoryTab, Tab, WriteRecordType } from './types';

export const C = {
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
} as const;

export const MIFARE_KEYS: number[][] = [
  [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
  [0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5],
  [0xD3, 0xF7, 0xD3, 0xF7, 0xD3, 0xF7],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5],
];

export const URI_PREFIXES: string[] = [
  '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:',
  'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://',
  'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://', 'news:',
  'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:',
  'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://',
  'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:',
  'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
];

export const TNF_FORMAT_LABELS: Record<number, string> = {
  0x00: 'Empty (0x00)',
  0x01: 'NFC Well Known (0x01)\nDefined by RFC 2141, RFC 3986',
  0x02: 'MIME Media (0x02)\nDefined by RFC 2046',
  0x03: 'Absolute URI (0x03)\nDefined by RFC 3986',
  0x04: 'NFC External (0x04)\nDefined by NFC Forum RTD',
  0x05: 'Unknown (0x05)',
  0x06: 'Unchanged (0x06)',
  0x07: 'Reserved (0x07)',
};

export const WELL_KNOWN_TYPE_NAMES: Record<string, string> = {
  T: 'Text Record',
  U: 'URI Record',
  Sp: 'Smart Poster',
  act: 'Action Record',
  gc: 'Generic Control',
  aar: 'Android Application Record',
};

export const MEMORY_TABS: { id: MemoryTab; label: string }[] = [
  { id: 'hex', label: 'Hex' },
  { id: 'utf8', label: 'UTF-8' },
  { id: 'ascii', label: 'ASCII' },
  { id: 'format', label: 'Format' },
  { id: 'type', label: 'Type' },
];

export const EXPORT_ACTION_OPTIONS: { label: string; value: ExportAction }[] = [
  { label: 'Copy', value: 'copy' },
  { label: 'Save to Disk', value: 'disk' },
];

export const EXPORT_FORMAT_OPTIONS: { label: string; value: ExportFormat }[] = [
  { label: 'Hex', value: 'hex' },
  { label: 'UTF-8', value: 'utf8' },
  { label: 'ASCII', value: 'ascii' },
  { label: 'Binary', value: 'binary' },
  { label: 'Open NFC Toolkit data file', value: 'onfct' },
];

export const WRITE_TYPE_OPTIONS: { label: string; value: WriteRecordType }[] = [
  { label: 'Text', value: 'text' },
  { label: 'URL', value: 'url' },
  { label: 'Email', value: 'email' },
  { label: 'Phone', value: 'phone' },
  { label: '.onfct File', value: 'onfct' },
];

export const TAB_CONFIG: { id: Tab; label: string }[] = [
  { id: 'read', label: 'Read' },
  { id: 'write', label: 'Write' },
  { id: 'other', label: 'Other' },
];
