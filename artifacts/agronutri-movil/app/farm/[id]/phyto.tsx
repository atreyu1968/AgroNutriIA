import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFarmQueryKey,
  getListPhytoProductsQueryKey,
  getListPhytoTreatmentsQueryKey,
  getListSectorsQueryKey,
  useCreatePhytoProduct,
  useCreatePhytoTreatment,
  useDeletePhytoProduct,
  useDeletePhytoTreatment,
  useGetFarm,
  useListPhytoProducts,
  useListPhytoTreatments,
  useListSectors,
  usePhytoConsult,
} from '@workspace/api-client-react';
import { Badge, Card, EmptyState, ErrorView, LoadingView, PrimaryButton } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

type Segment = 'asesor' | 'cuaderno' | 'catalogo';

const PESTS = [
  'Cochinilla',
  'Mosca blanca',
  'Araña roja / ácaros',
  'Picudo de la platanera',
  'Trips',
  'Pulgones',
  'Malas hierbas',
  'Enfermedades fúngicas',
  'Nematodos',
];

const DOSE_UNITS = ['ml/hl', 'g/hl', 'cc/l', 'l/ha', 'kg/ha', '%'];

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function errorMessage(err: unknown): string {
  return (err as { data?: { error?: string } })?.data?.error ?? 'Error inesperado';
}

function parseNum(v: string): number | null {
  const t = v.replace(',', '.').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function showError(title: string, err: unknown) {
  const msg = errorMessage(err);
  if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
}

function confirm(title: string, body: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${body}`)) onConfirm();
  } else {
    Alert.alert(title, body, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: onConfirm },
    ]);
  }
}

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? c.primary : c.card,
          borderColor: active ? c.primary : c.border,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? c.primaryForeground : c.mutedForeground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  multiline?: boolean;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: c.foreground }]}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { backgroundColor: c.card, borderColor: c.border, color: c.foreground },
        ]}
      />
    </View>
  );
}

function SectorPicker({
  farmId,
  value,
  onChange,
}: {
  farmId: number;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const { data: sectors } = useListSectors(farmId, {
    query: { queryKey: getListSectorsQueryKey(farmId) },
  });
  if (!sectors || sectors.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.chipRow}>
        <Chip label="Toda la finca" active={value === null} onPress={() => onChange(null)} />
        {sectors.map((s) => (
          <Chip
            key={s.id}
            label={s.name}
            active={value === s.id}
            onPress={() => onChange(value === s.id ? null : s.id)}
          />
        ))}
      </View>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  const c = useColors();
  return <Text style={[styles.label, { color: c.foreground }]}>{text}</Text>;
}

// ---------- Asesor ----------

function AdvisorSegment({ farmId, canEdit }: { farmId: number; canEdit: boolean }) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [selectedPests, setSelectedPests] = useState<string[]>([]);
  const [sectorId, setSectorId] = useState<number | null>(null);
  const [answer, setAnswer] = useState<{ answer: string; sources: string[] } | null>(null);

  const consult = usePhytoConsult({
    mutation: {
      onSuccess: (data) => {
        setAnswer(data);
        // El asesor puede haber guardado productos verificados en el catálogo.
        queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });
      },
      onError: (err) => showError('Error del asesor', err),
    },
  });

  if (!canEdit) {
    return (
      <Card>
        <Text style={[styles.mutedNote, { color: c.mutedForeground }]}>
          El asesor está disponible para propietarios y técnicos de la finca.
        </Text>
      </Card>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 12 }}>
        <Text style={[styles.cardTitle, { color: c.foreground }]}>Asesor de fitosanitarios</Text>
        <Text style={[styles.helpText, { color: c.mutedForeground }]}>
          Consulta qué productos están autorizados hoy en platanera. El asesor verifica el Registro
          Oficial del MAPA y las autorizaciones excepcionales de Canarias, y tiene en cuenta las
          aplicaciones ya registradas este año en cada parcela.
        </Text>

        <SectionLabel text="Plagas o problemas (puedes marcar varias)" />
        <View style={styles.chipRow}>
          {PESTS.map((p) => {
            const active = selectedPests.includes(p);
            return (
              <Chip
                key={p}
                label={p}
                active={active}
                testID={`chip-pest-${p}`}
                onPress={() =>
                  setSelectedPests((prev) =>
                    active ? prev.filter((x) => x !== p) : [...prev, p],
                  )
                }
              />
            );
          })}
        </View>
        {selectedPests.length > 1 ? (
          <Text style={[styles.helpText, { color: c.mutedForeground }]}>
            El asesor tratará cada plaga y analizará si los tratamientos se pueden combinar.
          </Text>
        ) : null}

        <SectionLabel text="Sector" />
        <SectorPicker farmId={farmId} value={sectorId} onChange={setSectorId} />

        <Field
          label="Tu consulta"
          value={question}
          onChange={setQuestion}
          multiline
          placeholder="Ej.: Tengo un foco de cochinilla algodonosa. ¿Qué productos autorizados puedo usar y cuánto caldo preparo para 400 plantas?"
          testID="input-phyto-question"
        />

        <PrimaryButton
          title={consult.isPending ? 'Consultando registros oficiales…' : 'Consultar al asesor'}
          loading={consult.isPending}
          disabled={question.trim().length < 5}
          testID="button-phyto-consult"
          onPress={() => {
            setAnswer(null);
            consult.mutate({
              farmId,
              data: {
                question: question.trim(),
                targetPest: selectedPests.length ? selectedPests.join(', ') : null,
                sectorId,
              },
            });
          }}
        />
      </Card>

      {answer ? (
        <Card style={{ gap: 10 }}>
          <Text style={[styles.answerText, { color: c.foreground }]}>{answer.answer}</Text>
          {answer.sources.length > 0 ? (
            <View style={{ gap: 4 }}>
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <Text style={[styles.helpText, { color: c.mutedForeground }]}>
                Fuentes consultadas:
              </Text>
              {answer.sources.map((s, i) => (
                <Pressable key={i} onPress={() => Linking.openURL(s)}>
                  <Text style={[styles.linkText, { color: c.primary }]} numberOfLines={1}>
                    {s}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.warningRow}>
            <Feather name="alert-triangle" size={14} color="#8a6a08" />
            <Text style={[styles.helpText, { color: c.mutedForeground, flex: 1 }]}>
              Contrasta siempre esta información con la etiqueta vigente del producto y el Registro
              del MAPA. La decisión final corresponde a un técnico autorizado.
            </Text>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

// ---------- Cuaderno ----------

type TreatmentForm = {
  date: string;
  sectorId: number | null;
  product: string;
  registry: string;
  active: string;
  pest: string;
  dose: string;
  doseUnit: string;
  water: string;
  area: string;
  safety: string;
  notes: string;
};

const EMPTY_TREATMENT: Omit<TreatmentForm, 'date'> = {
  sectorId: null,
  product: '',
  registry: '',
  active: '',
  pest: '',
  dose: '',
  doseUnit: 'ml/hl',
  water: '',
  area: '',
  safety: '',
  notes: '',
};

function LogSegment({ farmId, canEdit }: { farmId: number; canEdit: boolean }) {
  const c = useColors();
  const queryClient = useQueryClient();
  const treatmentsQuery = useListPhytoTreatments(farmId, {
    query: { queryKey: getListPhytoTreatmentsQueryKey(farmId) },
  });
  const treatments = treatmentsQuery.data;

  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<TreatmentForm>(() => ({
    date: new Date().toISOString().slice(0, 10),
    ...EMPTY_TREATMENT,
  }));
  const set = <K extends keyof TreatmentForm>(key: K) => (value: TreatmentForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListPhytoTreatmentsQueryKey(farmId) });

  const createTreatment = useCreatePhytoTreatment({
    mutation: {
      onSuccess: () => {
        invalidate();
        setAdding(false);
        setForm({ date: new Date().toISOString().slice(0, 10), ...EMPTY_TREATMENT });
      },
      onError: (err) => showError('No se pudo registrar', err),
    },
  });

  const deleteTreatment = useDeletePhytoTreatment({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (err) => showError('No se pudo eliminar', err),
    },
  });

  const years = useMemo(() => {
    const ys = new Set<string>([String(new Date().getFullYear())]);
    for (const t of treatments ?? []) ys.add(t.applicationDate.slice(0, 4));
    return [...ys].sort().reverse();
  }, [treatments]);

  const filtered = useMemo(
    () => (treatments ?? []).filter((t) => t.applicationDate.startsWith(year)),
    [treatments, year],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) {
      const key = `${t.productName} — ${t.sectorName ?? 'toda la finca'}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(form.date.trim());

  if (treatmentsQuery.isLoading) return <LoadingView label="Cargando cuaderno…" />;
  if (treatmentsQuery.isError) return <ErrorView onRetry={() => treatmentsQuery.refetch()} />;

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.chipRow}>
        {years.map((y) => (
          <Chip key={y} label={y} active={year === y} onPress={() => setYear(y)} />
        ))}
      </View>

      {canEdit && !adding ? (
        <PrimaryButton
          title="Registrar aplicación"
          onPress={() => setAdding(true)}
          testID="button-add-treatment"
        />
      ) : null}

      {canEdit && adding ? (
        <Card style={{ gap: 12 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>
            Registrar aplicación fitosanitaria
          </Text>
          <Field
            label="Fecha (AAAA-MM-DD) *"
            value={form.date}
            onChange={set('date')}
            placeholder="2026-08-03"
            testID="input-treatment-date"
          />
          <SectionLabel text="Sector" />
          <SectorPicker farmId={farmId} value={form.sectorId} onChange={set('sectorId')} />
          <Field
            label="Producto (nombre comercial) *"
            value={form.product}
            onChange={set('product')}
            placeholder="Ej.: Movento 150 O-TEQ"
            testID="input-treatment-product"
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                label="Nº registro (MAPA)"
                value={form.registry}
                onChange={set('registry')}
                placeholder="25.318"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Materia activa"
                value={form.active}
                onChange={set('active')}
                placeholder="spirotetramat 15%"
              />
            </View>
          </View>
          <Field
            label="Plaga o problema tratado"
            value={form.pest}
            onChange={set('pest')}
            placeholder="Ej.: cochinilla"
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                label="Dosis"
                value={form.dose}
                onChange={set('dose')}
                keyboardType="decimal-pad"
                placeholder="150"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Caldo (L)"
                value={form.water}
                onChange={set('water')}
                keyboardType="decimal-pad"
                placeholder="400"
              />
            </View>
          </View>
          <SectionLabel text="Unidad de dosis" />
          <View style={styles.chipRow}>
            {DOSE_UNITS.map((u) => (
              <Chip
                key={u}
                label={u}
                active={form.doseUnit === u}
                onPress={() => set('doseUnit')(u)}
              />
            ))}
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                label="Superficie (ha)"
                value={form.area}
                onChange={set('area')}
                keyboardType="decimal-pad"
                placeholder="0.5"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Plazo seg. (días)"
                value={form.safety}
                onChange={set('safety')}
                keyboardType="number-pad"
                placeholder="3"
              />
            </View>
          </View>
          <Field
            label="Notas"
            value={form.notes}
            onChange={set('notes')}
            multiline
            placeholder="Aplicador, condiciones, observaciones…"
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAdding(false)}
                style={[styles.secondaryButton, { borderColor: c.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: c.foreground }]}>Cancelar</Text>
              </Pressable>
            </View>
            <View style={{ flex: 2 }}>
              <PrimaryButton
                title="Guardar registro"
                loading={createTreatment.isPending}
                disabled={!form.product.trim() || !dateValid}
                testID="button-save-treatment"
                onPress={() => {
                  const doseAmount = parseNum(form.dose);
                  createTreatment.mutate({
                    farmId,
                    data: {
                      applicationDate: form.date.trim(),
                      productName: form.product.trim(),
                      sectorId: form.sectorId,
                      registryNumber: form.registry.trim() || null,
                      activeIngredient: form.active.trim() || null,
                      targetPest: form.pest.trim() || null,
                      doseAmount,
                      doseUnit: doseAmount == null ? null : form.doseUnit,
                      waterVolumeL: parseNum(form.water),
                      areaHa: parseNum(form.area),
                      safetyDays: parseNum(form.safety) == null ? null : Math.round(parseNum(form.safety)!),
                      notes: form.notes.trim() || null,
                    },
                  });
                }}
              />
            </View>
          </View>
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title="Sin aplicaciones"
          subtitle={`Sin aplicaciones registradas en ${year}.`}
        />
      ) : (
        filtered.map((t) => (
          <Card key={t.id} style={{ gap: 6 }}>
            <View style={styles.itemHeader}>
              <Text style={[styles.itemTitle, { color: c.foreground, flex: 1 }]} numberOfLines={2}>
                {t.productName}
              </Text>
              {canEdit ? (
                <Pressable
                  accessibilityRole="button"
                  testID={`button-delete-treatment-${t.id}`}
                  disabled={deleteTreatment.isPending}
                  onPress={() =>
                    confirm(
                      '¿Eliminar este registro?',
                      'Se borrará del cuaderno de tratamientos. Esta acción no se puede deshacer.',
                      () => deleteTreatment.mutate({ farmId, treatmentId: t.id }),
                    )
                  }
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
                >
                  <Feather name="trash-2" size={16} color={c.destructive} />
                </Pressable>
              ) : null}
            </View>
            <View style={styles.chipRow}>
              <Badge label={formatDate(t.applicationDate)} />
              <Badge label={t.sectorName ?? 'Toda la finca'} tone="primary" />
              {t.registryNumber ? <Badge label={`Reg. ${t.registryNumber}`} /> : null}
            </View>
            <Text style={[styles.helpText, { color: c.mutedForeground }]}>
              {[
                t.targetPest,
                t.activeIngredient,
                t.doseAmount ? `${t.doseAmount} ${t.doseUnit ?? ''}`.trim() : null,
                t.waterVolumeL ? `caldo ${t.waterVolumeL} L` : null,
                t.safetyDays != null ? `plazo seg. ${t.safetyDays} días` : null,
              ]
                .filter(Boolean)
                .join(' • ') || 'Sin detalles adicionales'}
            </Text>
            {t.notes ? (
              <Text style={[styles.notesText, { color: c.mutedForeground }]}>{t.notes}</Text>
            ) : null}
          </Card>
        ))
      )}

      {counts.length > 0 ? (
        <Card style={{ gap: 8 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>
            Aplicaciones por producto en {year}
          </Text>
          {counts.map(([key, n]) => (
            <View key={key} style={styles.countRow}>
              <Text
                style={[styles.helpText, { color: c.foreground, flex: 1 }]}
                numberOfLines={1}
              >
                {key}
              </Text>
              <Badge label={String(n)} tone={n >= 3 ? 'destructive' : 'muted'} />
            </View>
          ))}
          <Text style={[styles.helpText, { color: c.mutedForeground }]}>
            El máximo legal depende de cada producto: compruébalo en su etiqueta o pregunta al
            asesor.
          </Text>
        </Card>
      ) : null}
    </View>
  );
}

// ---------- Catálogo ----------

type ProductForm = {
  name: string;
  registry: string;
  active: string;
  pests: string;
  dose: string;
  maxApps: string;
  safety: string;
  expiry: string;
  notes: string;
};

const EMPTY_PRODUCT: ProductForm = {
  name: '',
  registry: '',
  active: '',
  pests: '',
  dose: '',
  maxApps: '',
  safety: '',
  expiry: '',
  notes: '',
};

function productStatus(expiryDate: string | null): {
  label: string;
  tone: 'primary' | 'destructive' | 'muted';
} {
  if (!expiryDate) return { label: 'Sin fecha de caducidad', tone: 'muted' };
  const today = new Date().toISOString().slice(0, 10);
  if (expiryDate < today) return { label: `Caducó el ${formatDate(expiryDate)}`, tone: 'destructive' };
  const soon = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (expiryDate <= soon)
    return { label: `Caduca el ${formatDate(expiryDate)}`, tone: 'destructive' };
  return { label: `Vigente hasta ${formatDate(expiryDate)}`, tone: 'primary' };
}

function CatalogSegment({ canEdit }: { canEdit: boolean }) {
  const c = useColors();
  const queryClient = useQueryClient();
  const productsQuery = useListPhytoProducts({
    query: { queryKey: getListPhytoProductsQueryKey() },
  });
  const products = productsQuery.data;

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<ProductForm>(EMPTY_PRODUCT);
  const set = (key: keyof ProductForm) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });

  const createProduct = useCreatePhytoProduct({
    mutation: {
      onSuccess: () => {
        invalidate();
        setAdding(false);
        setForm(EMPTY_PRODUCT);
      },
      onError: (err) => showError('No se pudo guardar', err),
    },
  });

  const deleteProduct = useDeletePhytoProduct({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (err) => showError('No se pudo eliminar', err),
    },
  });

  const expiryValid = !form.expiry.trim() || /^\d{4}-\d{2}-\d{2}$/.test(form.expiry.trim());

  if (productsQuery.isLoading) return <LoadingView label="Cargando catálogo…" />;
  if (productsQuery.isError) return <ErrorView onRetry={() => productsQuery.refetch()} />;

  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.helpText, { color: c.mutedForeground }]}>
        Catálogo compartido con la fecha de fin de cada autorización. El asesor IA lo rellena
        automáticamente al verificar productos.
      </Text>

      {canEdit && !adding ? (
        <PrimaryButton
          title="Añadir producto"
          onPress={() => setAdding(true)}
          testID="button-add-product"
        />
      ) : null}

      {canEdit && adding ? (
        <Card style={{ gap: 12 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>
            Añadir producto al catálogo
          </Text>
          <Field
            label="Producto (nombre comercial) *"
            value={form.name}
            onChange={set('name')}
            placeholder="Ej.: Movento 150 O-TEQ"
            testID="input-product-name"
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                label="Nº registro (MAPA)"
                value={form.registry}
                onChange={set('registry')}
                placeholder="25.318"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Materia activa"
                value={form.active}
                onChange={set('active')}
                placeholder="spirotetramat 15%"
              />
            </View>
          </View>
          <Field
            label="Plagas autorizadas en platanera"
            value={form.pests}
            onChange={set('pests')}
            placeholder="cochinilla, mosca blanca"
          />
          <Field
            label="Dosis y condiciones"
            value={form.dose}
            onChange={set('dose')}
            placeholder="150 ml/hl, intervalo 14 días"
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                label="Máx aplic./año"
                value={form.maxApps}
                onChange={set('maxApps')}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Plazo seg. (días)"
                value={form.safety}
                onChange={set('safety')}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <Field
            label="Autorizado hasta (AAAA-MM-DD)"
            value={form.expiry}
            onChange={set('expiry')}
            placeholder="2027-06-30"
          />
          <Field
            label="Notas"
            value={form.notes}
            onChange={set('notes')}
            multiline
            placeholder="Condiciones, limitaciones, islas…"
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAdding(false)}
                style={[styles.secondaryButton, { borderColor: c.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: c.foreground }]}>Cancelar</Text>
              </Pressable>
            </View>
            <View style={{ flex: 2 }}>
              <PrimaryButton
                title="Guardar producto"
                loading={createProduct.isPending}
                disabled={!form.name.trim() || !expiryValid}
                testID="button-save-product"
                onPress={() =>
                  createProduct.mutate({
                    data: {
                      productName: form.name.trim(),
                      registryNumber: form.registry.trim() || null,
                      activeIngredient: form.active.trim() || null,
                      pests: form.pests.trim() || null,
                      doseInfo: form.dose.trim() || null,
                      maxApplicationsYear:
                        parseNum(form.maxApps) == null ? null : Math.round(parseNum(form.maxApps)!),
                      safetyDays:
                        parseNum(form.safety) == null ? null : Math.round(parseNum(form.safety)!),
                      expiryDate: form.expiry.trim() || null,
                      notes: form.notes.trim() || null,
                    },
                  })
                }
              />
            </View>
          </View>
        </Card>
      ) : null}

      {(products ?? []).length === 0 ? (
        <EmptyState
          icon="book"
          title="Catálogo vacío"
          subtitle="Consulta al asesor IA y guardará automáticamente los productos que verifique en el Registro del MAPA."
        />
      ) : (
        (products ?? []).map((p) => {
          const st = productStatus(p.expiryDate);
          return (
            <Card key={p.id} style={{ gap: 6 }}>
              <View style={styles.itemHeader}>
                <Text
                  style={[styles.itemTitle, { color: c.foreground, flex: 1 }]}
                  numberOfLines={2}
                >
                  {p.productName}
                </Text>
                {canEdit ? (
                  <Pressable
                    accessibilityRole="button"
                    testID={`button-delete-product-${p.id}`}
                    disabled={deleteProduct.isPending}
                    onPress={() =>
                      confirm(
                        '¿Eliminar este producto del catálogo?',
                        'El catálogo es compartido: dejará de estar disponible para todos. Solo el administrador o quien lo añadió puede eliminarlo.',
                        () => deleteProduct.mutate({ productId: p.id }),
                      )
                    }
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
                  >
                    <Feather name="trash-2" size={16} color={c.destructive} />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.chipRow}>
                <Badge label={st.label} tone={st.tone} />
                {p.registryNumber ? <Badge label={`Reg. ${p.registryNumber}`} /> : null}
                {p.exceptional ? <Badge label="Autorización excepcional" tone="destructive" /> : null}
              </View>
              <Text style={[styles.helpText, { color: c.mutedForeground }]}>
                {[
                  p.activeIngredient,
                  p.pests ? `Plagas: ${p.pests}` : null,
                  p.doseInfo ? `Dosis: ${p.doseInfo}` : null,
                  p.maxApplicationsYear ? `Máx ${p.maxApplicationsYear} aplic./año` : null,
                  p.safetyDays != null ? `Plazo seg. ${p.safetyDays} días` : null,
                ]
                  .filter(Boolean)
                  .join(' • ') || 'Sin detalles adicionales'}
              </Text>
              {p.notes ? (
                <Text style={[styles.notesText, { color: c.mutedForeground }]}>{p.notes}</Text>
              ) : null}
              <View style={styles.countRow}>
                <Text style={[styles.helpText, { color: c.mutedForeground, flex: 1 }]}>
                  {p.lastVerifiedAt
                    ? `Verificado el ${formatDate(p.lastVerifiedAt)}`
                    : 'Añadido manualmente (sin verificación IA)'}
                </Text>
                {p.sourceUrl ? (
                  <Pressable onPress={() => Linking.openURL(p.sourceUrl!)}>
                    <Text style={[styles.linkText, { color: c.primary }]}>fuente</Text>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          );
        })
      )}

      {(products ?? []).length > 0 ? (
        <Text style={[styles.helpText, { color: c.mutedForeground }]}>
          Un producto caducado o verificado hace más de 30 días se vuelve a comprobar en las fuentes
          oficiales antes de recomendarse.
        </Text>
      ) : null}
    </View>
  );
}

// ---------- Pantalla ----------

export default function PhytoScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmId = parseInt(id ?? '', 10);

  const [segment, setSegment] = useState<Segment>('asesor');

  const farmQuery = useGetFarm(farmId, {
    query: { queryKey: getGetFarmQueryKey(farmId), enabled: !Number.isNaN(farmId) },
  });
  const queryClient = useQueryClient();

  const farm = farmQuery.data;
  const canEdit = farm?.myRole === 'owner' || farm?.myRole === 'technician';

  const topInset = insets.top;
  const bottomInset = insets.bottom;

  const segments: { key: Segment; label: string }[] = [
    { key: 'asesor', label: 'Asesor' },
    { key: 'cuaderno', label: 'Cuaderno' },
    { key: 'catalogo', label: 'Catálogo' },
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: c.border }]}>
        <Pressable
          testID="button-back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="arrow-left" size={18} color={c.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: c.foreground }]} numberOfLines={1}>
            Fitosanitarios
          </Text>
          <Text style={[styles.headerSub, { color: c.mutedForeground }]} numberOfLines={1}>
            {farm?.name ?? ' '}
          </Text>
        </View>
      </View>

      <View style={[styles.segments, { backgroundColor: c.muted }]}>
        {segments.map((s) => (
          <Pressable
            key={s.key}
            testID={`segment-${s.key}`}
            accessibilityRole="button"
            onPress={() => {
              Haptics.selectionAsync();
              setSegment(s.key);
            }}
            style={[styles.segment, segment === s.key && { backgroundColor: c.card }]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: segment === s.key ? c.foreground : c.mutedForeground },
              ]}
            >
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: bottomInset + 24 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={farmQuery.isRefetching}
            onRefresh={() => {
              farmQuery.refetch();
              queryClient.invalidateQueries({
                queryKey: getListPhytoTreatmentsQueryKey(farmId),
              });
              queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });
            }}
            tintColor={c.primary}
          />
        }
      >
        {farmQuery.isLoading ? (
          <LoadingView label="Cargando…" />
        ) : farmQuery.isError || !farm ? (
          <ErrorView onRetry={() => farmQuery.refetch()} />
        ) : segment === 'asesor' ? (
          <AdvisorSegment farmId={farmId} canEdit={canEdit} />
        ) : segment === 'cuaderno' ? (
          <LogSegment farmId={farmId} canEdit={canEdit} />
        ) : (
          <CatalogSegment canEdit={canEdit} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  headerSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segments: {
    flexDirection: 'row',
    margin: 16,
    marginBottom: 4,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
  },
  segmentText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  body: {
    padding: 16,
    flexGrow: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  label: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  helpText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  notesText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    fontStyle: 'italic',
  },
  answerText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
  },
  linkText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  mutedNote: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  secondaryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
