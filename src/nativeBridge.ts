import { NativeModules } from 'react-native';

export const { SaveFile, Hce } = NativeModules as {
  SaveFile: {
    save(content: string, filename: string, mimeType: string, cb: (err: unknown) => void): void;
    open(mimeType: string, cb: (err: unknown, result: string) => void): void;
    saveBinary(base64: string, filename: string, mimeType: string, cb: (err: unknown) => void): void;
    openBinary(mimeType: string, cb: (err: unknown, result: string) => void): void;
  };
  Hce: {
    start(encodedHex: string): Promise<void>;
    stop(): Promise<void>;
  };
};

// Error helpers

type BridgeError = { code: string; message: string };

export function isBridgeError(e: unknown): e is BridgeError {
  return typeof e === 'object' && e !== null && 'code' in e;
}

export function msgFromError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

// File I/O helpers

export function saveFileAsync(content: string, filename: string, mimeType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    SaveFile.save(content, filename, mimeType, err => {
      if (err) reject(err); else resolve();
    });
  });
}

export function openFileAsync(mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    SaveFile.open(mimeType, (err, result) => {
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

export function saveFileBinaryAsync(bytes: number[], filename: string, mimeType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    SaveFile.saveBinary(bytesToBase64(bytes), filename, mimeType, err => {
      if (err) reject(err); else resolve();
    });
  });
}

export function openFileBinaryAsync(mimeType: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    SaveFile.openBinary(mimeType, (err, result) => {
      if (err) reject(err); else resolve(base64ToBytes(result));
    });
  });
}
