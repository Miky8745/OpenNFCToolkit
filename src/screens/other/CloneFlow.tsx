import React, { useState } from 'react';
import { Alert, Text, TouchableOpacity, Vibration, View } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { C, MIFARE_KEYS } from '../../constants';
import { isBridgeError, msgFromError, openFileBinaryAsync, saveFileBinaryAsync } from '../../nativeBridge';
import { encodeNdefFallback } from '../../nfcHelpers';
import styles from '../../styles';
import type { CloneStatus, MifareBlock, NfcRawTag } from '../../types';

// The library's MifareClassicHandlerAndroid types are wrong: sector-to-block returns
// a plain number, block reads/writes take a number, and getBlockCountInSector is missing.
type MCHandler = {
  mifareClassicGetSectorCount(): Promise<number>;
  mifareClassicGetBlockCountInSector(sector: number): Promise<number>;
  mifareClassicSectorToBlock(sector: number): Promise<number>;
  mifareClassicReadBlock(block: number): Promise<number[]>;
  mifareClassicWriteBlock(block: number, data: number[]): Promise<void>;
  mifareClassicAuthenticateA(sector: number, keys: number[]): Promise<void>;
  mifareClassicAuthenticateB(sector: number, keys: number[]): Promise<void>;
};

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.otherBackBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.otherBackBtnText}>← Back</Text>
    </TouchableOpacity>
  );
}

export default function CloneFlow({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<CloneStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [binError, setBinError] = useState('');
  const [sourcePages, setSourcePages] = useState<{ page: number; hex: string }[]>([]);
  const [sourceMifareBlocks, setSourceMifareBlocks] = useState<MifareBlock[]>([]);
  const [sourceBytes, setSourceBytes] = useState<number[]>([]);

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
    } catch (e: unknown) {
      if (!isBridgeError(e) || e.code !== 'CANCELLED') {
        Alert.alert('Save Failed', msgFromError(e));
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
        const blocks: MifareBlock[] = [];
        if (bytes.length === 320) {
          for (let s = 0; s < 5; s++) {
            for (let b = 0; b < 4; b++) {
              const abs = s * 4 + b;
              blocks.push({ sector: s, block: abs, blockInSector: b, blockCount: 4, data: bytes.slice(abs * 16, abs * 16 + 16), sectorKey: defaultKey });
            }
          }
        } else if (bytes.length === 1024) {
          for (let s = 0; s < 16; s++) {
            for (let b = 0; b < 4; b++) {
              const abs = s * 4 + b;
              blocks.push({ sector: s, block: abs, blockInSector: b, blockCount: 4, data: bytes.slice(abs * 16, abs * 16 + 16), sectorKey: defaultKey });
            }
          }
        } else {
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
        setSourceBytes(bytes);
        setSourcePages([]);
        setSourceMifareBlocks([]);
      }
      Vibration.vibrate(100);
      setStatus('ready');
    } catch (e: unknown) {
      if (!isBridgeError(e) || e.code !== 'CANCELLED') {
        setBinError(msgFromError(e));
      }
    }
  }

  async function readSource() {
    setStatus('reading');
    setErrorMsg('');
    try {
      let ndefBytes: number[] = [];
      let gotNdef = false;
      try {
        await NfcManager.requestTechnology(NfcTech.Ndef);
        const tag = (await NfcManager.getTag()) as NfcRawTag | null;
        if (tag && Array.isArray(tag.ndefMessage) && tag.ndefMessage.length > 0) {
          ndefBytes = encodeNdefFallback(tag.ndefMessage);
          gotNdef = true;
        }
      } catch { /* NDEF not available */ }
      finally { await NfcManager.cancelTechnologyRequest().catch(() => {}); }

      let gotMifare = false;
      try {
        await NfcManager.requestTechnology(NfcTech.MifareClassic);
        const MC = NfcManager.mifareClassicHandlerAndroid as unknown as MCHandler;
        const sectorCount: number = await MC.mifareClassicGetSectorCount();
        const blocks: MifareBlock[] = [];

        for (let s = 0; s < sectorCount; s++) {
          let authKey: number[] | null = null;
          for (const key of MIFARE_KEYS) {
            try {
              await MC.mifareClassicAuthenticateA(s, key);
              authKey = key;
              break;
            } catch { /* try next key */ }
          }
          if (!authKey) continue;

          const blockCount: number = await MC.mifareClassicGetBlockCountInSector(s);
          const firstBlock: number = await MC.mifareClassicSectorToBlock(s);
          for (let b = 0; b < blockCount; b++) {
            try {
              const data: number[] = await MC.mifareClassicReadBlock(firstBlock + b);
              blocks.push({ sector: s, block: firstBlock + b, blockInSector: b, blockCount, data, sectorKey: authKey });
            } catch { /* block unreadable */ }
          }
        }

        if (blocks.length > 0) {
          setSourceMifareBlocks(blocks);
          gotMifare = true;
        }
      } catch { /* not a MIFARE Classic tag */ }
      finally { await NfcManager.cancelTechnologyRequest().catch(() => {}); }

      let gotPages = false;
      if (!gotMifare) {
        try {
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
            } catch { break; }
          }
          if (pages.length > 0) {
            setSourcePages(pages);
            gotPages = true;
          }
        } catch { /* non-Type2 tag */ }
        finally { await NfcManager.cancelTechnologyRequest().catch(() => {}); }
      }

      if (!gotMifare && !gotPages && !gotNdef) {
        throw new Error('No data found on source tag — tag may be blank or unsupported');
      }
      if (!gotMifare && !gotPages) {
        setSourceBytes(ndefBytes);
      }

      Vibration.vibrate(100);
      setStatus('ready');
    } catch (e: unknown) {
      const msg = msgFromError(e);
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
        await NfcManager.requestTechnology(NfcTech.MifareClassic);
        const MC = NfcManager.mifareClassicHandlerAndroid as unknown as MCHandler;

        const sectorKeyB = new Map<number, number[]>();
        for (const blk of sourceMifareBlocks) {
          if (blk.blockInSector === blk.blockCount - 1) {
            const kb = blk.data.slice(10, 16);
            if (kb.some(b => b !== 0)) sectorKeyB.set(blk.sector, kb);
          }
        }

        let lastAuthSector = -1;
        let writtenBlocks = 0;
        let skippedBlocks = 0;
        for (const { sector, block, blockInSector, blockCount, data, sectorKey } of sourceMifareBlocks) {
          if (block === 0) continue;
          if (sector !== lastAuthSector) {
            const sourceKeyB = sectorKeyB.get(sector);
            const keysToTry: Array<[string, number[]]> = [];
            if (sourceKeyB) keysToTry.push(['B', sourceKeyB]);
            keysToTry.push(['A', sectorKey]);
            for (const k of MIFARE_KEYS) {
              if (k.join() !== sectorKey.join() && (!sourceKeyB || k.join() !== sourceKeyB.join())) {
                keysToTry.push(['B', k], ['A', k]);
              }
            }

            let authed = false;
            for (const [label, key] of keysToTry) {
              const authFn = label === 'B' ? MC.mifareClassicAuthenticateB.bind(MC) : MC.mifareClassicAuthenticateA.bind(MC);
              try { await authFn(sector, key); authed = true; break; }
              catch { /* try next */ }
            }
            if (!authed) throw new Error(`Could not authenticate target sector ${sector} — target tag may use unknown keys`);
            lastAuthSector = sector;
          }
          const isTrailer = blockInSector === blockCount - 1;
          const writeData = [...data];
          if (isTrailer) { for (let i = 0; i < 6; i++) writeData[i] = sectorKey[i]; }
          try {
            await MC.mifareClassicWriteBlock(block, writeData);
            writtenBlocks++;
          } catch { skippedBlocks++; }
        }
        if (writtenBlocks === 0) {
          throw new Error(`No blocks could be written — use a blank MIFARE Classic card as the target (factory default keys). Skipped: ${skippedBlocks}`);
        }
      } else if (sourcePages.length > 0) {
        await NfcManager.requestTechnology(NfcTech.NfcA);
        for (const { page, hex } of sourcePages) {
          if (page < 3) continue;
          const data = hex.trim().split(/\s+/).map(h => parseInt(h, 16));
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
          const tag = (await NfcManager.getTag()) as NfcRawTag | null;
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
    } catch (e: unknown) {
      const msg = msgFromError(e);
      if (msg === 'cancelled') { setStatus('ready'); }
      else { setErrorMsg(msg); setStatus('error'); }
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
  }

  if (status === 'reading') {
    return (
      <View style={styles.screen}>
        <View style={[styles.iconCircle, styles.iconCircleScanning]}>
          <Text style={styles.iconText}>⟳</Text>
        </View>
        <Text style={styles.screenTitle}>Scan Source Tag</Text>
        <Text style={styles.screenSubtitle}>Hold the tag you want to clone near your phone</Text>
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonCancel]} onPress={() => { NfcManager.cancelTechnologyRequest().catch(() => {}); setStatus('idle'); }}>
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
        <TouchableOpacity style={[styles.actionButton, styles.actionButtonCancel]} onPress={() => { NfcManager.cancelTechnologyRequest().catch(() => {}); setStatus('ready'); }}>
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
          Reads all memory pages from a source tag and writes them to a target tag.
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
