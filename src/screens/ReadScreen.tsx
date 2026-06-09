import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, Vibration, View } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import MemoryManager from '../components/MemoryManager';
import { InfoRow, SectionLabel } from '../components/InfoRow';
import { msgFromError } from '../nativeBridge';
import { encodeNdefFallback, extractNdefFromPages, formatUid, identifyTag, parseRecord, shortTech } from '../nfcHelpers';
import styles from '../styles';
import type { NfcRawTag, ParsedRecord, ScanStatus, TagData } from '../types';

// Re-export shared components so WriteScreen / EmulateFlow can import from here
export { InfoRow, SectionLabel };

export default function ReadScreen() {
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
    let raw: NfcRawTag | null = null;

    try {
      // Phase 1: NDEF tech — get parsed records and tag metadata.
      // We cancel after reading so Phase 2 can connect via NfcA on the same tap.
      try {
        await NfcManager.requestTechnology(NfcTech.Ndef);
        raw = (await NfcManager.getTag()) as NfcRawTag | null;
        if (raw?.ndefMessage && raw.ndefMessage.length > 0) {
          for (const r of raw.ndefMessage) records.push(parseRecord(r));
          rawNdefBytes = encodeNdefFallback(raw.ndefMessage);
        }
        await NfcManager.cancelTechnologyRequest();
      } catch { /* NDEF not available — handled below */ }

      // Phase 2: NfcA transceive — raw page dump for NTAG/Ultralight.
      // Quietly skipped for IsoDep (Type 4) tags which don't respond to 0x30.
      try {
        await NfcManager.requestTechnology(NfcTech.NfcA);
        if (!raw) raw = (await NfcManager.getTag()) as NfcRawTag | null;
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
          if (records.length === 0) {
            const parsed = extractNdefFromPages(pages);
            rawNdefBytes = parsed.ndefBytes;
            parsed.records.forEach(r => records.push(r));
          }
        }
      } catch { /* non-Type2 tag — fine if Phase 1 gave NDEF data */ }

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
    } catch (e: unknown) {
      const msg = msgFromError(e);
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

          <SectionLabel text="Memory" />
          <View style={styles.card}>
            {tagMeta?.memoryInfo && <InfoRow label="Memory Info" value={tagMeta.memoryInfo} />}
            {ndefMaxSize != null && (
              <InfoRow label="Size" value={`${ndefUsedBytes} / ${ndefMaxSize} Bytes`} />
            )}
            {ndefWritable != null && <InfoRow label="Writable" value={ndefWritable ? 'Yes' : 'No'} />}
            {ndefCanLock != null && <InfoRow label="Can be Read-Only" value={ndefCanLock ? 'Yes' : 'No'} />}
          </View>

          <TouchableOpacity
            style={[styles.actionButton, styles.memManagerButton]}
            onPress={() => setMemVisible(true)}>
            <Text style={styles.actionButtonText}>Open Memory Manager</Text>
          </TouchableOpacity>

          <SectionLabel text="Technologies" />
          <View style={styles.chipRow}>
            {tagData.techTypes.map(t => (
              <View key={t} style={styles.chip}>
                <Text style={styles.chipText}>{t}</Text>
              </View>
            ))}
          </View>

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
