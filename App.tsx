import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { PressStart2P_400Regular } from '@expo-google-fonts/press-start-2p';
import { VT323_400Regular } from '@expo-google-fonts/vt323';
import * as Notifications from 'expo-notifications';
import { SQLiteProvider, type SQLiteDatabase, useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type Payment = {
  id: number;
  name: string;
  category: string;
  amount: number;
  dueDate: string;
  frequency: string;
  note: string;
  paid: number;
  notificationId: string;
};

type PaymentDraft = Omit<Payment, 'id' | 'amount' | 'paid' | 'notificationId'> & { amount: string };

const COLORS = {
  ink: '#000000',
  panel: '#080808',
  panelSoft: '#111111',
  line: '#373737',
  accent: '#FF5050',
  accentEdge: '#862929',
  red: '#FF5050',
  yellow: '#FFE14A',
  white: '#FFFFFF',
  muted: '#B5B5B5',
  green: '#58ED79',
};

const PIXEL = 'PressStart2P_400Regular';
const MONO = 'VT323_400Regular';
const categories = ['SUSCRIPCIÓN', 'TARJETA', 'VEHÍCULO', 'SERVICIO', 'OTRO'];
const frequencies = ['MENSUAL', 'ANUAL', 'ÚNICO'];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const todayText = () => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
};

const emptyDraft = (): PaymentDraft => ({
  name: '',
  category: 'SUSCRIPCIÓN',
  amount: '',
  dueDate: todayText(),
  frequency: 'MENSUAL',
  note: '',
});

async function migrateDatabase(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'OTRO',
      amount REAL NOT NULL DEFAULT 0,
      due_date TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'MENSUAL',
      note TEXT NOT NULL DEFAULT '',
      paid INTEGER NOT NULL DEFAULT 0,
      notification_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function cancelReminder(notificationId: string) {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // El pago se conserva aunque el sistema ya haya retirado la notificación.
  }
}

async function scheduleReminder(dueDate: string) {
  const reminderDate = new Date(`${dueDate}T09:00:00`);
  reminderDate.setDate(reminderDate.getDate() - 1);
  if (reminderDate.getTime() <= Date.now()) return '';

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('bugdev-pagos', {
        name: 'Recordatorios de pagos',
        importance: Notifications.AndroidImportance.HIGH,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }

    const currentPermission = await Notifications.getPermissionsAsync();
    const permission = currentPermission.granted
      ? currentPermission
      : await Notifications.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Recordatorio desactivado', 'Puedes guardar este pago sin aviso. Para recibir recordatorios, permite las notificaciones en los ajustes del dispositivo.');
      return '';
    }

    return await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Reminder Dev',
        body: 'Tienes un pago pendiente para mañana. Abre tu agenda para ver los detalles.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderDate,
        channelId: Platform.OS === 'android' ? 'bugdev-pagos' : undefined,
      },
    });
  } catch {
    // Un fallo de Expo Go o del sistema no debe impedir guardar el pago.
    Alert.alert('Recordatorio no disponible', 'No se pudo programar el aviso. Puedes guardar el pago sin recordatorio y volver a intentarlo al editarlo.');
    return '';
  }
}

function dayDifference(dateText: string) {
  const target = new Date(`${dateText}T12:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function dueCopy(payment: Payment) {
  if (payment.paid) return { text: 'PAGADO', color: COLORS.green };
  const days = dayDifference(payment.dueDate);
  if (days < 0) return { text: `VENCIDO HACE ${Math.abs(days)} D`, color: COLORS.red };
  if (days === 0) return { text: 'VENCE HOY', color: COLORS.red };
  if (days === 1) return { text: 'VENCE MAÑANA', color: COLORS.yellow };
  return { text: `FALTAN ${days} DÍAS`, color: days <= 7 ? COLORS.yellow : COLORS.green };
}

function PaymentsScreen() {
  const db = useSQLiteContext();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filter, setFilter] = useState<'PENDIENTES' | 'PAGADOS' | 'TODOS'>('PENDIENTES');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PaymentDraft>(emptyDraft());

  const loadPayments = useCallback(async () => {
    const rows = await db.getAllAsync<Payment>(`
      SELECT id, name, category, amount, due_date AS dueDate, frequency, note, paid,
             notification_id AS notificationId
      FROM payments
      ORDER BY paid ASC, due_date ASC, name COLLATE NOCASE
    `);
    setPayments(rows);
  }, [db]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  const visiblePayments = useMemo(() => {
    if (filter === 'TODOS') return payments;
    return payments.filter((payment) => (filter === 'PAGADOS' ? payment.paid === 1 : payment.paid === 0));
  }, [payments, filter]);

  const stats = useMemo(() => {
    const pending = payments.filter((payment) => !payment.paid);
    return {
      amount: pending.reduce((sum, payment) => sum + payment.amount, 0),
      overdue: pending.filter((payment) => dayDifference(payment.dueDate) < 0).length,
      nextSeven: pending.filter((payment) => {
        const days = dayDifference(payment.dueDate);
        return days >= 0 && days <= 7;
      }).length,
    };
  }, [payments]);

  const openCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setModalVisible(true);
  };

  const openEdit = (payment: Payment) => {
    setEditingId(payment.id);
    setDraft({
      name: payment.name,
      category: payment.category,
      amount: String(payment.amount),
      dueDate: payment.dueDate,
      frequency: payment.frequency,
      note: payment.note,
    });
    setModalVisible(true);
  };

  const savePayment = async () => {
    const name = draft.name.trim();
    const amount = Math.max(0, Number.parseFloat(draft.amount.replace(',', '.') || '0'));
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) && Number.isFinite(new Date(`${draft.dueDate}T12:00:00`).getTime());
    if (!name) {
      Alert.alert('Falta el nombre', 'Escribe qué pago deseas controlar.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Monto inválido', 'Escribe un monto mayor que cero.');
      return;
    }
    if (!validDate) {
      Alert.alert('Fecha inválida', 'Usa el formato AAAA-MM-DD, por ejemplo 2026-09-15.');
      return;
    }

    if (editingId) {
      const previous = payments.find((payment) => payment.id === editingId);
      await cancelReminder(previous?.notificationId ?? '');
      const notificationId = previous?.paid ? '' : await scheduleReminder(draft.dueDate);
      await db.runAsync(
        'UPDATE payments SET name = ?, category = ?, amount = ?, due_date = ?, frequency = ?, note = ?, notification_id = ? WHERE id = ?',
        name,
        draft.category,
        amount,
        draft.dueDate,
        draft.frequency,
        draft.note.trim(),
        notificationId,
        editingId
      );
    } else {
      const notificationId = await scheduleReminder(draft.dueDate);
      await db.runAsync(
        'INSERT INTO payments (name, category, amount, due_date, frequency, note, notification_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        name,
        draft.category,
        amount,
        draft.dueDate,
        draft.frequency,
        draft.note.trim(),
        notificationId
      );
    }
    setModalVisible(false);
    await loadPayments();
  };

  const togglePaid = async (payment: Payment) => {
    const nextPaid = payment.paid ? 0 : 1;
    await cancelReminder(payment.notificationId);
    const notificationId = nextPaid ? '' : await scheduleReminder(payment.dueDate);
    await db.runAsync('UPDATE payments SET paid = ?, notification_id = ? WHERE id = ?', nextPaid, notificationId, payment.id);
    await loadPayments();
  };

  const removePayment = (payment: Payment) => {
    Alert.alert('Eliminar cuenta', `¿Quieres eliminar “${payment.name}”?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await cancelReminder(payment.notificationId);
          await db.runAsync('DELETE FROM payments WHERE id = ?', payment.id);
          await loadPayments();
        },
      },
    ]);
  };

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={require('./assets/icon-arcade.png')} style={styles.logo} />
            <View>
              <Text style={styles.eyebrow}>BUG DEV / APP 02</Text>
              <Text style={styles.brand}>REMINDER DEV</Text>
            </View>
          </View>
          <Pressable style={styles.addButton} onPress={openCreate}>
            <Text style={styles.addButtonText}>＋ NUEVO</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroKicker}>AGENDA DE CUENTAS</Text>
          <Text style={styles.heroTitle}>QUE NADA SE{`\n`}VENZA.</Text>
          <Text style={styles.heroCopy}>
            Organiza suscripciones, tarjetas y pagos por fecha. Recibe una alerta local un día antes.
          </Text>
          <View style={styles.pendingTotal}>
            <Text style={styles.pendingLabel}>TOTAL PENDIENTE</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.pendingAmount}>${stats.amount.toFixed(2)}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatCard label="PRÓXIMOS 7 DÍAS" value={String(stats.nextSeven).padStart(2, '0')} color={COLORS.yellow} />
          <StatCard label="VENCIDOS" value={String(stats.overdue).padStart(2, '0')} color={stats.overdue ? COLORS.red : COLORS.green} />
          <StatCard label="REGISTRADOS" value={String(payments.length).padStart(2, '0')} color={COLORS.green} />
        </View>

        <View style={styles.filterRow}>
          {(['PENDIENTES', 'PAGADOS', 'TODOS'] as const).map((item) => (
            <Pressable key={item} style={[styles.filter, filter === item && styles.filterActive]} onPress={() => setFilter(item)}>
              <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.sectionBar}>
          <Text style={styles.sectionTitle}>CALENDARIO DE PAGOS</Text>
          <Text style={styles.sectionCount}>{visiblePayments.length} CUENTAS</Text>
        </View>

        {visiblePayments.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>◇</Text>
            <Text style={styles.emptyTitle}>{payments.length ? 'NADA POR AQUÍ' : 'AGENDA VACÍA'}</Text>
            <Text style={styles.emptyCopy}>
              {payments.length ? 'Cambia el filtro para ver otras cuentas.' : 'Registra Netflix, Disney+, Spotify o cualquier pago.'}
            </Text>
            {!payments.length && (
              <Pressable style={styles.emptyButton} onPress={openCreate}>
                <Text style={styles.emptyButtonText}>REGISTRAR PRIMER PAGO</Text>
              </Pressable>
            )}
          </View>
        ) : (
          visiblePayments.map((payment) => {
            const status = dueCopy(payment);
            return (
              <View key={payment.id} style={[styles.paymentCard, payment.paid === 1 && styles.paymentCardPaid]}>
                <Pressable style={styles.paymentMain} onPress={() => openEdit(payment)}>
                  <View style={styles.dateBox}>
                    <Text style={styles.dateDay}>{payment.dueDate.slice(8, 10)}</Text>
                    <Text style={styles.dateMonth}>{payment.dueDate.slice(5, 7)}</Text>
                  </View>
                  <View style={styles.paymentInfo}>
                    <Text style={styles.paymentName}>{payment.name}</Text>
                    <Text style={styles.paymentMeta}>{payment.category} · {payment.frequency}</Text>
                    <Text style={[styles.dueText, { color: status.color }]}>● {status.text}</Text>
                  </View>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={styles.paymentAmount}>${payment.amount.toFixed(2)}</Text>
                </Pressable>
                {payment.note ? <Text style={styles.note}>“{payment.note}”</Text> : null}
                <View style={styles.actions}>
                  <Pressable style={[styles.paidButton, payment.paid === 1 && styles.paidButtonDone]} onPress={() => togglePaid(payment)}>
                    <Text style={[styles.paidButtonText, payment.paid === 1 && styles.paidButtonTextDone]}>
                      {payment.paid ? '↺ MARCAR PENDIENTE' : '✓ MARCAR PAGADO'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => removePayment(payment)} hitSlop={10}>
                    <Text style={styles.deleteText}>ELIMINAR</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        <View style={styles.privacyCard}>
          <Text style={styles.privacyIcon}>▣</Text>
          <View style={styles.privacyCopy}>
            <Text style={styles.privacyText}>Los datos y recordatorios permanecen en este dispositivo.</Text>
          </View>
        </View>
        <Text style={styles.footer}>BUG DEV · TU AGENDA LOCAL DE PAGOS</Text>
      </ScrollView>

      <PaymentModal
        visible={modalVisible}
        editing={editingId !== null}
        draft={draft}
        setDraft={setDraft}
        onClose={() => setModalVisible(false)}
        onSave={savePayment}
      />
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statCard}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function PaymentModal({
  visible,
  editing,
  draft,
  setDraft,
  onClose,
  onSave,
}: {
  visible: boolean;
  editing: boolean;
  draft: PaymentDraft;
  setDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  onClose: () => void;
  onSave: () => void;
}) {
  const field = (key: keyof PaymentDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalKicker}>{editing ? 'EDITAR CUENTA' : 'NUEVA CUENTA'}</Text>
              <Text style={styles.modalTitle}>PAGO</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}><Text style={styles.closeText}>×</Text></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Field label="NOMBRE *" value={draft.name} onChangeText={field('name')} placeholder="Ej. Netflix, Disney+ o Spotify" />
            <Field label="MONTO USD *" currency value={draft.amount} onChangeText={field('amount')} placeholder="0.00" keyboardType="decimal-pad" />
            <Field label="FECHA DE PAGO *" value={draft.dueDate} onChangeText={field('dueDate')} placeholder="AAAA-MM-DD" autoCapitalize="none" />
            <Text style={styles.fieldLabel}>CATEGORÍA</Text>
            <View style={styles.chips}>
              {categories.map((category) => (
                <Pressable key={category} style={[styles.chip, draft.category === category && styles.chipActive]} onPress={() => field('category')(category)}>
                  <Text style={[styles.chipText, draft.category === category && styles.chipTextActive]}>{category}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>FRECUENCIA</Text>
            <View style={styles.chips}>
              {frequencies.map((frequency) => (
                <Pressable key={frequency} style={[styles.chip, draft.frequency === frequency && styles.chipRed]} onPress={() => field('frequency')(frequency)}>
                  <Text style={[styles.chipText, draft.frequency === frequency && styles.chipTextActive]}>{frequency}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="NOTA" value={draft.note} onChangeText={field('note')} placeholder="Ej. Se cobra en la tarjeta principal" />
            <Pressable style={styles.saveButton} onPress={onSave}>
              <Text style={styles.saveButtonText}>{editing ? 'GUARDAR CAMBIOS' : 'AGREGAR A LA AGENDA'} →</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string; currency?: boolean }) {
  const { label, currency, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={currency ? styles.currencyField : undefined}>
        {currency && <Text style={styles.currencySymbol} accessible={false}>$</Text>}
        <TextInput {...inputProps} accessibilityLabel={label} style={[styles.input, currency && styles.currencyInput]} placeholderTextColor="#999999" selectionColor={COLORS.red} />
      </View>
    </View>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ PressStart2P_400Regular, VT323_400Regular });

  if (!fontsLoaded && !fontError) {
    return (
      <View style={styles.fontLoading}>
        <StatusBar style="light" />
        <ActivityIndicator color={COLORS.yellow} size="large" />
        <Text style={styles.loadingLabel}>CARGANDO...</Text>
      </View>
    );
  }

  return (
    <SQLiteProvider databaseName="bugdev-pagos.db" onInit={migrateDatabase}>
      <PaymentsScreen />
    </SQLiteProvider>
  );
}

const styles = StyleSheet.create({

  app: { flex: 1, backgroundColor: COLORS.ink },
  fontLoading: { flex: 1, backgroundColor: COLORS.ink, alignItems: 'center', justifyContent: 'center', gap: 18 },
  loadingLabel: { color: COLORS.white, fontSize: 16 },
  content: { paddingTop: Platform.OS === 'ios' ? 62 : 38, paddingHorizontal: 18, paddingBottom: 42, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 24 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  logo: { width: 50, height: 50, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.ink, resizeMode: 'contain' },
  eyebrow: { color: COLORS.muted, fontFamily: MONO, fontSize: 14, lineHeight: 18 },
  brand: { color: COLORS.white, fontFamily: PIXEL, fontSize: 12, lineHeight: 19 },
  addButton: { minHeight: 44, justifyContent: 'center', backgroundColor: COLORS.accent, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 4, borderRightWidth: 4, borderColor: COLORS.accentEdge },
  addButtonText: { color: COLORS.ink, fontFamily: MONO, fontSize: 21 },
  hero: { backgroundColor: COLORS.panel, borderWidth: 2, borderColor: COLORS.line, padding: 20, marginBottom: 12 },
  heroKicker: { color: COLORS.white, fontFamily: MONO, fontSize: 16, lineHeight: 20, marginBottom: 16 },
  heroTitle: { color: COLORS.white, fontFamily: PIXEL, fontSize: 22, lineHeight: 35 },
  heroCopy: { color: COLORS.muted, fontFamily: MONO, fontSize: 22, lineHeight: 25, marginTop: 16 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, minHeight: 116, backgroundColor: COLORS.panelSoft, borderWidth: 1, borderColor: COLORS.line, padding: 12, justifyContent: 'flex-end' },
  statValue: { fontFamily: PIXEL, fontSize: 22, lineHeight: 30 },
  statLabel: { color: COLORS.white, fontFamily: MONO, fontSize: 16, lineHeight: 18, marginTop: 8 },
  sectionBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 14 },
  sectionTitle: { color: COLORS.white, fontFamily: PIXEL, fontSize: 11, lineHeight: 18 },
  sectionCount: { color: COLORS.yellow, fontFamily: MONO, fontSize: 16 },
  emptyState: { alignItems: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: COLORS.line, padding: 28, backgroundColor: COLORS.ink },
  emptyIcon: { color: COLORS.accent, fontSize: 48, lineHeight: 54 },
  emptyTitle: { color: COLORS.white, fontFamily: PIXEL, fontSize: 12, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  emptyCopy: { color: COLORS.muted, fontFamily: MONO, fontSize: 22, lineHeight: 25, textAlign: 'center', marginTop: 12 },
  emptyButton: { minHeight: 46, justifyContent: 'center', marginTop: 20, borderWidth: 2, borderColor: COLORS.accent, paddingHorizontal: 14, paddingVertical: 11 },
  emptyButtonText: { color: COLORS.accent, fontFamily: MONO, fontSize: 20, textAlign: 'center' },
  deleteText: { color: COLORS.red, fontFamily: MONO, fontSize: 17, paddingVertical: 12 },
  footer: { color: COLORS.muted, fontFamily: MONO, fontSize: 15, lineHeight: 19, textAlign: 'center', marginTop: 28 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, .85)' },
  modalCard: { width: '100%', maxWidth: 720, alignSelf: 'center', maxHeight: '92%', backgroundColor: COLORS.panel, borderTopWidth: 3, borderColor: COLORS.accent, padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 22 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  modalKicker: { color: COLORS.accent, fontFamily: MONO, fontSize: 17, marginBottom: 10 },
  modalTitle: { color: COLORS.white, fontFamily: PIXEL, fontSize: 22, lineHeight: 32 },
  closeText: { color: COLORS.white, fontSize: 34, lineHeight: 44, minWidth: 44, textAlign: 'center' },
  field: { marginBottom: 18 },
  fieldLabel: { color: COLORS.white, fontFamily: MONO, fontSize: 18, marginBottom: 8 },
  input: { minHeight: 54, backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.line, color: COLORS.white, paddingHorizontal: 13, paddingVertical: 10, fontFamily: MONO, fontSize: 24 },
  currencyField: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.line },
  currencySymbol: { color: COLORS.yellow, fontFamily: MONO, fontSize: 24, paddingLeft: 13 },
  currencyInput: { flex: 1, minWidth: 0, borderWidth: 0, paddingLeft: 9, color: COLORS.yellow },
  saveButton: { minHeight: 56, backgroundColor: COLORS.accent, borderBottomWidth: 5, borderRightWidth: 5, borderColor: COLORS.accentEdge, padding: 16, alignItems: 'center', marginTop: 8 },
  saveButtonText: { color: COLORS.ink, fontFamily: MONO, fontSize: 22, textAlign: 'center' },


  pendingTotal: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.line, gap: 10 },
  pendingLabel: { color: COLORS.white, fontFamily: MONO, fontSize: 18 },
  pendingAmount: { color: COLORS.yellow, fontFamily: PIXEL, fontSize: 26, lineHeight: 36 },
  filterRow: { flexDirection: 'row', gap: 7, marginBottom: 24 },
  filter: { flex: 1, minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: COLORS.line, paddingVertical: 10, alignItems: 'center', backgroundColor: COLORS.ink },
  filterActive: { borderColor: COLORS.yellow, borderBottomWidth: 3, backgroundColor: COLORS.panelSoft },
  filterText: { color: COLORS.muted, fontFamily: MONO, fontSize: 18 },
  filterTextActive: { color: COLORS.yellow },
  paymentCard: { backgroundColor: COLORS.panel, borderWidth: 2, borderColor: COLORS.line, marginBottom: 14 },
  paymentCardPaid: { borderColor: COLORS.green },
  paymentMain: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  dateBox: { width: 56, height: 64, backgroundColor: COLORS.ink, borderWidth: 2, borderColor: COLORS.red, alignItems: 'center', justifyContent: 'center', gap: 6 },
  dateDay: { color: COLORS.yellow, fontFamily: PIXEL, fontSize: 18, lineHeight: 22 },
  dateMonth: { color: COLORS.red, fontFamily: MONO, fontSize: 18 },
  paymentInfo: { flex: 1, minWidth: 0 },
  paymentName: { color: COLORS.white, fontFamily: MONO, fontSize: 25, lineHeight: 27, marginBottom: 5 },
  paymentMeta: { color: COLORS.muted, fontFamily: MONO, fontSize: 16, lineHeight: 18 },
  dueText: { fontFamily: MONO, fontSize: 16, lineHeight: 18, marginTop: 6 },
  paymentAmount: { color: COLORS.yellow, fontFamily: MONO, fontSize: 26, maxWidth: '30%' },
  note: { color: COLORS.muted, fontFamily: MONO, fontSize: 20, lineHeight: 23, paddingHorizontal: 14, paddingBottom: 12 },
  actions: { borderTopWidth: 1, borderTopColor: COLORS.line, minHeight: 60, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 14 },
  paidButton: { flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 6, borderWidth: 1, borderColor: COLORS.green, alignItems: 'center' },
  paidButtonDone: { borderColor: COLORS.muted },
  paidButtonText: { color: COLORS.green, fontFamily: MONO, fontSize: 18, textAlign: 'center' },
  paidButtonTextDone: { color: COLORS.white },
  privacyCard: { marginTop: 16, borderLeftWidth: 4, borderLeftColor: COLORS.green, padding: 16, backgroundColor: COLORS.panelSoft, flexDirection: 'row', gap: 13 },
  privacyIcon: { color: COLORS.green, fontSize: 26 },
  privacyCopy: { flex: 1 },
  privacyText: { color: COLORS.muted, fontFamily: MONO, fontSize: 20, lineHeight: 23 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  chip: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: COLORS.ink },
  chipActive: { borderColor: COLORS.yellow, borderBottomWidth: 3, backgroundColor: COLORS.panelSoft },
  chipRed: { borderColor: COLORS.yellow, borderBottomWidth: 3, backgroundColor: COLORS.panelSoft },
  chipText: { color: COLORS.muted, fontFamily: MONO, fontSize: 18 },
  chipTextActive: { color: COLORS.yellow },
});
