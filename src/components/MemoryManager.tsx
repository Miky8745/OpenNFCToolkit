import Clipboard from '@react-native-clipboard/clipboard';
import React, { useState } from 'react';
import { Alert, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import {
  EXPORT_ACTION_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  MEMORY_TABS,
  TNF_FORMAT_LABELS,
  WELL_KNOWN_TYPE_NAMES,
} from '../constants';
import { buildOnfct, memToAscii, memToBinary, memToUtf8, toHexDump } from '../nfcHelpers';
import { isBridgeError, saveFileAsync } from '../nativeBridge';
import styles from '../styles';
import type { ExportAction, ExportFormat, MemoryTab, TagData } from '../types';
import Dropdown from './Dropdown';

export default function MemoryManager({
  visible,
  onClose,
  tagData,
}: {
  visible: boolean;
  onClose: () => void;
  tagData: TagData;
}) {
  const [activeTab, setActiveTab] = useState<MemoryTab>('hex');
  const [exportAction, setExportAction] = useState<ExportAction>('copy');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('hex');
  const [actionOpen, setActionOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);

  // Prefer the full raw page dump (complete memory) when available; fall back to NDEF bytes.
  const bytes = tagData.rawPages && tagData.rawPages.length > 0
    ? tagData.rawPages.flatMap(p => p.hex.trim().split(/\s+/).map(h => parseInt(h, 16)))
    : tagData.rawNdefBytes;

  async function handleExport() {
    if (exportFormat === 'onfct') {
      try {
        await saveFileAsync(buildOnfct(tagData), 'tag.onfct', 'application/octet-stream');
      } catch (e: unknown) {
        if (!isBridgeError(e) || e.code !== 'CANCELLED') {
          Alert.alert('Save Failed', isBridgeError(e) ? e.message : 'Could not save file.');
        }
      }
      return;
    }

    const hex = bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const content =
      exportFormat === 'hex'    ? hex :
      exportFormat === 'utf8'   ? memToUtf8(bytes) :
      exportFormat === 'ascii'  ? memToAscii(bytes) :
      memToBinary(bytes);

    if (exportAction === 'copy') {
      Clipboard.setString(content);
    } else {
      try {
        await saveFileAsync(content, 'nfc_dump.txt', 'text/plain');
      } catch (e: unknown) {
        if (!isBridgeError(e) || e.code !== 'CANCELLED') {
          Alert.alert('Save Failed', isBridgeError(e) ? e.message : 'Could not save file.');
        }
      }
    }
  }

  function renderContent() {
    switch (activeTab) {
      case 'hex':   return <Text style={styles.monoContent}>{toHexDump(bytes)}</Text>;
      case 'utf8':  return <Text style={styles.monoContent}>{memToUtf8(bytes)}</Text>;
      case 'ascii': return <Text style={styles.monoContent}>{memToAscii(bytes)}</Text>;

      case 'format':
        if (!tagData.records.length) return <Text style={styles.memEmptyNote}>No NDEF records</Text>;
        return (
          <>
            {tagData.records.map((r, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.memDivider} />}
                <Text style={styles.memRecordIndex}>Record {i + 1}</Text>
                <Text style={styles.memFormatText}>
                  {TNF_FORMAT_LABELS[r.tnf] ?? `Unknown TNF (0x${r.tnf.toString(16)})`}
                </Text>
              </View>
            ))}
          </>
        );

      case 'type':
        if (!tagData.records.length) return <Text style={styles.memEmptyNote}>No NDEF records</Text>;
        return (
          <>
            {tagData.records.map((r, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.memDivider} />}
                <Text style={styles.memRecordIndex}>Record {i + 1}</Text>
                <Text style={styles.memTypeBig}>{r.typeStr || '—'}</Text>
                <Text style={styles.memTypeDesc}>
                  {WELL_KNOWN_TYPE_NAMES[r.typeStr] ?? r.typeStr ?? 'Unknown type'}
                </Text>
              </View>
            ))}
          </>
        );
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.memModal}>
        <View style={styles.memHeader}>
          <Text style={styles.memHeaderTitle}>Memory Manager</Text>
          <TouchableOpacity onPress={onClose} style={styles.memCloseBtn}>
            <Text style={styles.memCloseText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.memTabBar}>
          {MEMORY_TABS.map(t => {
            const active = t.id === activeTab;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.memTabItem, active && styles.memTabItemActive]}
                onPress={() => setActiveTab(t.id)}
                activeOpacity={0.7}>
                <Text style={[styles.memTabLabel, active && styles.memTabLabelActive]}>{t.label}</Text>
                {active && <View style={styles.memTabIndicator} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView style={styles.memContent} contentContainerStyle={styles.memContentInner}>
          {renderContent()}
          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={styles.memFooter}>
          <View style={styles.memExportRow}>
            <Dropdown
              options={EXPORT_ACTION_OPTIONS}
              value={exportAction}
              onSelect={setExportAction}
              isOpen={actionOpen}
              onToggle={() => { setActionOpen(v => !v); setFormatOpen(false); }}
            />
            <Dropdown
              options={EXPORT_FORMAT_OPTIONS}
              value={exportFormat}
              onSelect={setExportFormat}
              isOpen={formatOpen}
              onToggle={() => { setFormatOpen(v => !v); setActionOpen(false); }}
            />
            <TouchableOpacity style={styles.memConfirmBtn} onPress={handleExport} activeOpacity={0.7}>
              <Text style={styles.memConfirmText}>✓</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
