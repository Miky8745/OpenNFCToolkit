import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { C } from '../../constants';
import { isBridgeError, msgFromError, openFileAsync } from '../../nativeBridge';
import styles from '../../styles';
import type { OnfctFile } from '../../types';
import { Hce } from '../../nativeBridge';
import { InfoRow, SectionLabel } from '../ReadScreen';

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.otherBackBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.otherBackBtnText}>← Back</Text>
    </TouchableOpacity>
  );
}

export default function EmulateFlow({ onBack }: { onBack: () => void }) {
  const [onfct, setOnfct] = useState<OnfctFile | null>(null);
  const [emulating, setEmulating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function loadFile() {
    setErrorMsg('');
    try {
      const content = await openFileAsync('*/*');
      const parsed = JSON.parse(content) as OnfctFile;
      if (parsed.format !== 'onfct') throw new Error('Not a valid .onfct file');
      if (!parsed.ndef?.encodedHex) throw new Error('File contains no NDEF data');
      setOnfct(parsed);
    } catch (e: unknown) {
      if (!isBridgeError(e) || e.code !== 'CANCELLED') {
        setErrorMsg(msgFromError(e));
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
    } catch (e: unknown) {
      setErrorMsg(msgFromError(e));
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
