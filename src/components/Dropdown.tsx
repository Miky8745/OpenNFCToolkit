import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import styles from '../styles';

type Props<T extends string> = {
  options: { label: string; value: T }[];
  value: T;
  onSelect: (v: T) => void;
  isOpen: boolean;
  onToggle: () => void;
};

export default function Dropdown<T extends string>({ options, value, onSelect, isOpen, onToggle }: Props<T>) {
  const label = options.find(o => o.value === value)?.label ?? value;
  return (
    <>
      <TouchableOpacity style={styles.dropdownBtn} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.dropdownBtnText} numberOfLines={1}>{label}</Text>
        <Text style={styles.dropdownArrow}>{isOpen ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={onToggle}>
        <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPress={onToggle}>
          <View style={styles.dropdownSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.dropdownSheetTitle}>Select Option</Text>
            {options.map(o => (
              <TouchableOpacity
                key={o.value}
                style={[styles.dropdownSheetItem, o.value === value && styles.dropdownSheetItemActive]}
                onPress={() => { onSelect(o.value); onToggle(); }}>
                <Text style={[styles.dropdownSheetItemText, o.value === value && styles.dropdownSheetItemTextActive]}>
                  {o.label}
                </Text>
                {o.value === value && <Text style={styles.dropdownSheetCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
