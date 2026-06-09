import React, { useState } from 'react';
import { Text, TouchableOpacity, Vibration, View } from 'react-native';
import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';
import { msgFromError } from '../../nativeBridge';
import styles from '../../styles';

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.otherBackBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.otherBackBtnText}>← Back</Text>
    </TouchableOpacity>
  );
}

export default function FormatFlow({ onBack }: { onBack: () => void }) {
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
