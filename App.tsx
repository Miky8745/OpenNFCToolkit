import React, { useEffect, useState } from 'react';
import { Image, StatusBar, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import NfcManager from 'react-native-nfc-manager';
import { AppState } from 'react-native';
import { C, TAB_CONFIG } from './src/constants';
import styles from './src/styles';
import type { Tab } from './src/types';
import ReadScreen from './src/screens/ReadScreen';
import WriteScreen from './src/screens/WriteScreen';
import OtherScreen from './src/screens/OtherScreen';

function TabBar({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (t: Tab) => void }) {
  return (
    <View style={styles.tabBar}>
      {TAB_CONFIG.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tabItem, isActive && styles.tabItemActive]}
            onPress={() => onTabChange(tab.id)}
            activeOpacity={0.7}>
            <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : styles.tabLabelInactive]}>
              {tab.label}
            </Text>
            {isActive && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function NfcWarningBanner() {
  return (
    <TouchableOpacity style={styles.nfcWarning} onPress={() => NfcManager.goToNfcSetting()} activeOpacity={0.8}>
      <Text style={styles.nfcWarningIcon}>⚠</Text>
      <Text style={styles.nfcWarningText}>NFC is disabled — tap to open Settings</Text>
    </TouchableOpacity>
  );
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>('read');
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Image
            source={require('./android/app/src/main/res/1024.png')}
            style={styles.headerLogo}
          />
          <View>
            <Text style={styles.headerTitle}>OpenNFCT</Text>
            <Text style={styles.headerSubtitle}>Open NFC Toolkit</Text>
          </View>
        </View>
      </View>
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <View style={styles.content}>
        <View style={[styles.tabScreen, activeTab !== 'read'  && styles.tabScreenHidden]}><ReadScreen /></View>
        <View style={[styles.tabScreen, activeTab !== 'write' && styles.tabScreenHidden]}><WriteScreen /></View>
        <View style={[styles.tabScreen, activeTab !== 'other' && styles.tabScreenHidden]}><OtherScreen /></View>
      </View>
    </View>
  );
}

export default function App() {
  const [nfcEnabled, setNfcEnabled] = useState(true);

  useEffect(() => {
    async function initNfc() {
      const supported = await NfcManager.isSupported();
      if (!supported) { setNfcEnabled(false); return; }
      await NfcManager.start();
      setNfcEnabled(await NfcManager.isEnabled());
    }
    initNfc();
    const sub = AppState.addEventListener('change', async state => {
      if (state === 'active') setNfcEnabled(await NfcManager.isEnabled());
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        {!nfcEnabled && <NfcWarningBanner />}
        <AppContent />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
