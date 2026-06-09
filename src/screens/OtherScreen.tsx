import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import styles from '../styles';
import type { OtherSubScreen } from '../types';
import CloneFlow from './other/CloneFlow';
import EmulateFlow from './other/EmulateFlow';
import EraseFlow from './other/EraseFlow';
import FormatFlow from './other/FormatFlow';

const OPTIONS: { key: NonNullable<OtherSubScreen>; title: string; desc: string; icon: string }[] = [
  { key: 'erase',   title: 'Erase Tag',   desc: 'Clear all NDEF data from a tag',               icon: '⌫' },
  { key: 'format',  title: 'Format Tag',  desc: 'Initialise an unformatted tag for NDEF use',   icon: '⊞' },
  { key: 'emulate', title: 'Emulate Tag', desc: 'Emulate a tag from a hex memory dump',         icon: '◈' },
  { key: 'clone',   title: 'Clone Tag',   desc: 'Copy all memory pages from one tag to another', icon: '⊕' },
];

export default function OtherScreen() {
  const [subScreen, setSubScreen] = useState<OtherSubScreen>(null);

  if (subScreen === 'erase')   return <EraseFlow   onBack={() => setSubScreen(null)} />;
  if (subScreen === 'format')  return <FormatFlow  onBack={() => setSubScreen(null)} />;
  if (subScreen === 'emulate') return <EmulateFlow onBack={() => setSubScreen(null)} />;
  if (subScreen === 'clone')   return <CloneFlow   onBack={() => setSubScreen(null)} />;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.resultsHeader}>Other Actions</Text>
      {OPTIONS.map(o => (
        <TouchableOpacity
          key={o.key}
          style={styles.otherCard}
          onPress={() => setSubScreen(o.key)}
          activeOpacity={0.7}>
          <Text style={styles.otherCardIcon}>{o.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.otherCardTitle}>{o.title}</Text>
            <Text style={styles.otherCardDesc}>{o.desc}</Text>
          </View>
          <Text style={styles.otherCardChevron}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
