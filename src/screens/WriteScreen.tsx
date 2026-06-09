import React, { useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, Vibration, View } from 'react-native';
import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';
import Dropdown from '../components/Dropdown';
import { InfoRow, SectionLabel } from '../components/InfoRow';
import { C, WRITE_TYPE_OPTIONS } from '../constants';
import { isBridgeError, msgFromError, openFileAsync } from '../nativeBridge';
import styles from '../styles';
import type { OnfctFile, WriteRecordType, WriteStatus } from '../types';

function writePlaceholder(t: WriteRecordType): string {
  if (t === 'url')   return 'https://example.com';
  if (t === 'email') return 'user@example.com';
  if (t === 'phone') return '+1 234 567 8900';
  return 'Enter text…';
}

function writeKeyboard(t: WriteRecordType) {
  if (t === 'url')   return 'url' as const;
  if (t === 'email') return 'email-address' as const;
  if (t === 'phone') return 'phone-pad' as const;
  return 'default' as const;
}

function buildRecord(type: WriteRecordType, text: string) {
  if (type === 'text') return Ndef.textRecord(text);
  const prefix =
    type === 'email' && !text.startsWith('mailto:') ? 'mailto:' :
    type === 'phone' && !text.startsWith('tel:')    ? 'tel:'    : '';
  return Ndef.uriRecord(prefix + text);
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

export default function WriteScreen() {
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
      const fileContent = await openFileAsync('*/*');
      const parsed = JSON.parse(fileContent) as OnfctFile;
      if (parsed.format !== 'onfct') throw new Error('Not a valid .onfct file');
      if (!parsed.ndef?.encodedHex) throw new Error('File contains no NDEF data');
      setOnfctFile(parsed);
    } catch (e: unknown) {
      if (!isBridgeError(e) || e.code !== 'CANCELLED') {
        setOnfctError(isBridgeError(e) ? e.message : msgFromError(e));
      }
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
          await NfcManager.requestTechnology(NfcTech.NfcA);
          for (const { page, hex } of onfctFile.raw.pages) {
            if (page < 3) continue;
            const data = hex.trim().split(/\s+/).map(h => parseInt(h, 16));
            await NfcManager.nfcAHandler.transceive([0xA2, page, ...data]);
          }
        } else {
          const bytes = onfctFile.ndef.encodedHex
            .trim().split(/[\s,:\n]+/).filter(Boolean).map(h => parseInt(h, 16));
          await writeBytes(bytes);
        }
        Vibration.vibrate(200);
        setStatus('done');
      } catch (e: unknown) {
        const msg = msgFromError(e);
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
