import { StyleSheet } from 'react-native';
import { C } from './constants';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerLogo: { width: 44, height: 44, borderRadius: 10 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: C.accent, letterSpacing: 1.2 },
  headerSubtitle: { fontSize: 12, color: C.textMuted, marginTop: 2, letterSpacing: 0.5 },

  tabBar: { flexDirection: 'row', backgroundColor: C.tabBar, borderBottomWidth: 1, borderBottomColor: C.border },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 14, position: 'relative' },
  tabItemActive: { backgroundColor: C.surface },
  tabLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  tabLabelActive: { color: C.activeTabText },
  tabLabelInactive: { color: C.inactiveTabText },
  tabIndicator: { position: 'absolute', bottom: 0, left: 12, right: 12, height: 2, backgroundColor: C.indicator, borderRadius: 1 },

  content: { flex: 1 },
  tabScreen: { flex: 1 },
  tabScreenHidden: { display: 'none' },

  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  iconCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.accentDim,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8, borderWidth: 1, borderColor: C.accent,
  },
  iconCircleScanning: { borderColor: C.warning, backgroundColor: '#3a2a00' },
  iconCircleError:    { borderColor: C.error,   backgroundColor: '#3a0000' },
  iconCircleWrite:    { backgroundColor: '#1a4a2e', borderColor: '#66bb6a' },
  iconCircleOther:    { backgroundColor: '#2a2a2a', borderColor: '#757575' },
  iconText: { fontSize: 32, color: '#ffffff' },

  screenTitle:    { fontSize: 20, fontWeight: '700', color: C.text, textAlign: 'center' },
  screenSubtitle: { fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 20, maxWidth: 260 },
  errorText: { color: C.error },

  actionButton:       { marginTop: 8, backgroundColor: C.activeTab, paddingVertical: 14, paddingHorizontal: 36, borderRadius: 8 },
  actionButtonWrite:  { backgroundColor: '#2e7d32' },
  actionButtonOther:  { backgroundColor: '#424242' },
  actionButtonCancel: { backgroundColor: '#5a3a00' },
  actionButtonText:   { color: '#ffffff', fontSize: 14, fontWeight: '600', letterSpacing: 0.5, textAlign: 'center' },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 20 },
  resultsHeader: { fontSize: 18, fontWeight: '700', color: C.accent, marginBottom: 16, letterSpacing: 0.5 },

  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: C.textMuted, letterSpacing: 1,
    textTransform: 'uppercase', marginTop: 20, marginBottom: 8, marginLeft: 2,
  },

  card: { backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  infoLabel:     { fontSize: 13, color: C.textMuted, flexShrink: 0, marginRight: 8, paddingTop: 1 },
  infoValue:     { fontSize: 13, color: C.text, maxWidth: '65%', textAlign: 'right', flexShrink: 1 },
  infoValueMono: { fontFamily: 'monospace', letterSpacing: 0.5 },
  infoValueCol:  { alignItems: 'flex-end', flexShrink: 1, maxWidth: '65%' },
  infoValueFull: { fontSize: 13, color: C.text, textAlign: 'right', flexShrink: 1 },
  notSupportedBadge: { fontSize: 10, color: C.warning, marginTop: 3, letterSpacing: 0.3 },

  chipRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:     { backgroundColor: C.surfaceAlt, borderRadius: 4, paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: C.border },
  chipText: { fontSize: 12, color: C.text },

  recordCard:  { backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 8 },
  recordType:  { fontSize: 11, fontWeight: '600', color: C.accent, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 },
  recordValue: { fontSize: 14, color: C.text, lineHeight: 20 },
  recordRaw:   { fontSize: 10, color: C.textFaint, fontFamily: 'monospace', marginTop: 8, lineHeight: 14 },

  emptyNote:       { fontSize: 13, color: C.textMuted, fontStyle: 'italic', marginLeft: 2 },
  scanAgainButton: { alignSelf: 'center', marginTop: 24 },
  memManagerButton: { marginTop: 20, paddingHorizontal: 0, alignSelf: 'stretch' },

  otherCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
    padding: 16, marginBottom: 10, gap: 12,
  },
  otherCardIcon:    { fontSize: 22, color: C.accent, width: 28, textAlign: 'center' },
  otherCardTitle:   { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 3 },
  otherCardDesc:    { fontSize: 12, color: C.textMuted, lineHeight: 17 },
  otherCardChevron: { fontSize: 22, color: C.textMuted },
  otherBackBtn:     { marginTop: 16, alignSelf: 'center', padding: 8 },
  otherBackBtnText: { fontSize: 14, color: C.textMuted },

  writeDropdownRow:      { flexDirection: 'row' },
  writeInput:            { fontSize: 14, color: C.text, paddingVertical: 12, paddingHorizontal: 14, textAlignVertical: 'top' },
  writeInputMulti:       { minHeight: 100 },
  writeError:            { marginTop: 10, marginLeft: 2 },
  writeSubmitBtn:        { alignSelf: 'stretch', marginTop: 20 },
  writeSubmitBtnDisabled:{ opacity: 0.35 },

  nfcWarning: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#3a2a00',
    borderBottomWidth: 1, borderBottomColor: '#7a5a00', paddingVertical: 10, paddingHorizontal: 16, gap: 10,
  },
  nfcWarningIcon: { fontSize: 16, color: C.warning },
  nfcWarningText: { fontSize: 13, color: C.warning, flex: 1 },

  memModal: { flex: 1, backgroundColor: C.bg },
  memHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  memHeaderTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  memCloseBtn:    { padding: 4 },
  memCloseText:   { fontSize: 18, color: C.textMuted },

  memTabBar:       { flexDirection: 'row', backgroundColor: C.tabBar, borderBottomWidth: 1, borderBottomColor: C.border },
  memTabItem:      { flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative' },
  memTabItemActive:{ backgroundColor: C.surface },
  memTabLabel:     { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: C.inactiveTabText },
  memTabLabelActive:   { color: C.activeTabText },
  memTabIndicator: { position: 'absolute', bottom: 0, left: 8, right: 8, height: 2, backgroundColor: C.indicator, borderRadius: 1 },

  memContent:      { flex: 1 },
  memContentInner: { padding: 16 },
  monoContent:     { fontFamily: 'monospace', fontSize: 12, color: C.text, lineHeight: 20 },

  memDivider:      { height: 1, backgroundColor: C.border, marginVertical: 16 },
  memRecordIndex:  { fontSize: 11, fontWeight: '600', color: C.accent, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  memFormatText:   { fontSize: 14, color: C.text, lineHeight: 22 },
  memTypeBig:      { fontSize: 32, fontWeight: '700', color: C.accent, fontFamily: 'monospace', marginBottom: 8 },
  memTypeDesc:     { fontSize: 14, color: C.textMuted },
  memEmptyNote:    { fontSize: 13, color: C.textMuted, fontStyle: 'italic' },

  memFooter:      { paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  memExportRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memConfirmBtn:  { backgroundColor: C.activeTab, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  memConfirmText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  dropdownBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt, borderRadius: 8, paddingVertical: 12,
    paddingHorizontal: 12, borderWidth: 1, borderColor: C.border,
  },
  dropdownBtnText:         { fontSize: 13, color: C.text, fontWeight: '600', flex: 1 },
  dropdownArrow:           { fontSize: 9, color: C.textMuted, marginLeft: 6 },
  dropdownOverlay:         { flex: 1, justifyContent: 'flex-end', backgroundColor: C.overlay },
  dropdownSheet:           { backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, paddingTop: 12, overflow: 'hidden' },
  sheetHandle:             { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  dropdownSheetTitle:      { fontSize: 11, fontWeight: '600', color: C.textMuted, letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 20, marginBottom: 4 },
  dropdownSheetItem:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: C.border },
  dropdownSheetItemActive: { backgroundColor: C.accentDim },
  dropdownSheetItemText:   { fontSize: 16, color: C.text },
  dropdownSheetItemTextActive: { color: '#fff', fontWeight: '600' },
  dropdownSheetCheck:      { fontSize: 14, color: C.accent },

  emulateWarning:      { backgroundColor: '#3a2a00', borderRadius: 8, borderWidth: 1, borderColor: '#7a5a00', padding: 14, marginTop: 8 },
  emulateWarningTitle: { fontSize: 13, fontWeight: '700', color: C.warning, marginBottom: 6 },
  emulateWarningBody:  { fontSize: 12, color: '#ccaa55', lineHeight: 18 },
});

export default styles;
