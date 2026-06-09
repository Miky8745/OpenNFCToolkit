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

export default function EraseFlow({ onBack }: { onBack: () => void }) {
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
