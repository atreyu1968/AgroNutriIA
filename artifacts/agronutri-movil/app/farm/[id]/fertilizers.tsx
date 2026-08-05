import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListFertilizersQueryKey,
  useCreateFertilizer,
  useDeleteFertilizer,
  useIdentifyProductSheet,
  useListFertilizers,
  useUpdateFertilizer,
} from '@workspace/api-client-react';
import type { Fertilizer } from '@workspace/api-client-react';
import { Badge, Card, EmptyState, ErrorView, LoadingView, PrimaryButton } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

type FertilizerFormState = {
  name: string;
  formulaType: 'solid' | 'liquid';
  usage: 'fertirrigacion' | 'enmienda';
  nPct: string;
  p2o5Pct: string;
  k2oPct: string;
  caoPct: string;
  mgoPct: string;
  so3Pct: string;
};

const EMPTY_FORM: FertilizerFormState = {
  name: '',
  formulaType: 'solid',
  usage: 'fertirrigacion',
  nPct: '',
  p2o5Pct: '',
  k2oPct: '',
  caoPct: '',
  mgoPct: '',
  so3Pct: '',
};

function toNumber(v: string): number | null {
  const t = v.replace(',', '.').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function formatPct(v?: number | null): string {
  if (v == null) return '—';
  return `${v}%`;
}

function formatEc(v?: number | null): string {
  if (v == null) return '—';
  return `${v.toLocaleString('es-ES', { maximumFractionDigits: 2 })} µS/cm`;
}

function fertilizerEc(f: Fertilizer): number | null {
  const anyF = f as Fertilizer & { ecUsPerGl?: number | null; ec?: number | null };
  const value = anyF.ecUsPerGl ?? anyF.ec ?? null;
  return value == null ? null : Number(value);
}

function nutrientRows(f: Fertilizer) {
  return [
    ['N', f.nPct],
    ['P₂O₅', f.p2o5Pct],
    ['K₂O', f.k2oPct],
    ['CaO', f.caoPct],
    ['MgO', f.mgoPct],
    ['SO₃', f.so3Pct],
  ] as const;
}

function errorMessage(err: unknown): string {
  return (err as { data?: { error?: string } })?.data?.error ?? 'Error inesperado';
}

function showError(title: string, err: unknown) {
  const msg = errorMessage(err);
  if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
}

function confirmDelete(title: string, body: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${body}`)) onConfirm();
  } else {
    Alert.alert(title, body, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: onConfirm },
    ]);
  }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  multiline?: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: c.foreground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { borderColor: c.border, backgroundColor: c.card, color: c.foreground },
        ]}
      />
    </View>
  );
}

function SelectPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={[
        styles.pill,
        {
          borderColor: active ? c.primary : c.border,
          backgroundColor: active ? c.primaryTint : c.card,
        },
      ]}
    >
      <Text style={{ color: active ? c.primary : c.foreground, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function FertilizerFormModal({
  visible,
  initialValue,
  title,
  submitLabel,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initialValue?: Fertilizer | null;
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (data: FertilizerFormState) => Promise<void> | void;
}) {
  const [form, setForm] = useState<FertilizerFormState>(EMPTY_FORM);
  const [scanning, setScanning] = useState(false);

  const identifyMutation = useIdentifyProductSheet({
    mutation: {
      onError: (err) => showError('No se pudo identificar el producto', err),
    },
  });

  React.useEffect(() => {
    if (!visible) return;
    if (!initialValue) {
      setForm(EMPTY_FORM);
      return;
    }
    setForm({
      name: initialValue.name ?? '',
      formulaType: (initialValue as Fertilizer & { formulaType?: 'solid' | 'liquid' }).formulaType ?? 'solid',
      usage: (initialValue as Fertilizer & { usage?: 'fertirrigacion' | 'enmienda' }).usage ?? 'fertirrigacion',
      nPct: String(initialValue.nPct ?? ''),
      p2o5Pct: String(initialValue.p2o5Pct ?? ''),
      k2oPct: String(initialValue.k2oPct ?? ''),
      caoPct: String(initialValue.caoPct ?? ''),
      mgoPct: String(initialValue.mgoPct ?? ''),
      so3Pct: String(initialValue.so3Pct ?? ''),
    });
  }, [visible, initialValue]);

  const scanFromImage = async (asset: ImagePicker.ImagePickerAsset) => {
    setScanning(true);
    try {
      const mime = asset.mimeType ?? 'image/jpeg';
      const ext = mime.split('/')[1] ?? 'jpg';
      let file: Blob;
      if (Platform.OS === 'web') {
        const blob = await (await fetch(asset.uri)).blob();
        file = new File([blob], asset.fileName ?? `producto.${ext}`, { type: mime });
      } else {
        file = {
          uri: asset.uri,
          name: asset.fileName ?? `producto.${ext}`,
          type: mime,
        } as unknown as Blob;
      }
      const result = await identifyMutation.mutateAsync({ data: { file, kind: 'fertilizer' } });
      setForm((p) => ({
        ...p,
        name: result.name ?? p.name,
        formulaType:
          result.formulaType === 'liquid' ? 'liquid' : result.formulaType === 'solid' ? 'solid' : p.formulaType,
        usage:
          result.usage === 'enmienda'
            ? 'enmienda'
            : result.usage === 'fertirrigacion'
            ? 'fertirrigacion'
            : p.usage,
        nPct: result.nPct != null ? String(result.nPct) : p.nPct,
        p2o5Pct: result.p2o5Pct != null ? String(result.p2o5Pct) : p.p2o5Pct,
        k2oPct: result.k2oPct != null ? String(result.k2oPct) : p.k2oPct,
        caoPct: result.caoPct != null ? String(result.caoPct) : p.caoPct,
        mgoPct: result.mgoPct != null ? String(result.mgoPct) : p.mgoPct,
        so3Pct: result.so3Pct != null ? String(result.so3Pct) : p.so3Pct,
      }));
      const notes = result.notes;
      const warnings = result.warnings ?? [];
      if (warnings.length && Platform.OS !== 'web') {
        Alert.alert(
          'Revisa los datos',
          `${warnings.join('\n')}\n\nCorrige los campos antes de guardar.`,
        );
      } else if (warnings.length) {
        window.alert(`Revisa los datos:\n${warnings.join('\n')}\n\nCorrige los campos antes de guardar.`);
      } else if (result.name) {
        if (Platform.OS === 'web') window.alert(`Producto identificado: ${result.name}`);
        else Alert.alert('Producto identificado', `${result.name}. Revisa los datos y guarda.`);
      }
      void notes;
    } catch (err) {
      const anyErr = err as { data?: { error?: string } };
      if (Platform.OS === 'web') window.alert(anyErr?.data?.error ?? 'No se pudo identificar el producto.');
      else Alert.alert('No se pudo identificar el producto', anyErr?.data?.error ?? 'Inténtalo de nuevo.');
    } finally {
      setScanning(false);
    }
  };

  const scanProduct = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      if (Platform.OS === 'web') window.alert('Se necesita permiso de cámara para fotografiar el producto.');
      else Alert.alert('Permiso de cámara', 'Se necesita acceso a la cámara para fotografiar el producto.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || result.assets.length === 0) return;
    await scanFromImage(result.assets[0]);
  };

  const c = useColors();

  const submit = async () => {
    await onSubmit(form);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: c.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.iconButton}>
            <Feather name="x" size={20} color={c.foreground} />
          </Pressable>
          <Text style={[styles.modalTitle, { color: c.foreground }]}>{title}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={scanProduct}
            disabled={scanning}
            style={[styles.iconButton, { backgroundColor: c.muted }]}
          >
            <ActivityIndicator size="small" color={c.primary} animating={scanning} />
            {!scanning ? <Feather name="camera" size={18} color={c.foreground} /> : null}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <Pressable
            accessibilityRole="button"
            onPress={scanProduct}
            disabled={scanning}
            style={[styles.scanBanner, { backgroundColor: c.muted }]}
          >
            <Feather name="camera" size={18} color={c.primary} />
            <Text style={[styles.scanBannerText, { color: c.primary }]}>
              {scanning ? 'Identificando producto con IA…' : 'Fotografiar etiqueta para rellenar la composición'}
            </Text>
          </Pressable>

          <Field label="Nombre" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} placeholder="Ej. Nitrato potásico" />

          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: c.foreground }]}>Tipo de formulación</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <SelectPill label="Sólido" active={form.formulaType === 'solid'} onPress={() => setForm((p) => ({ ...p, formulaType: 'solid' }))} />
              <SelectPill label="Líquido" active={form.formulaType === 'liquid'} onPress={() => setForm((p) => ({ ...p, formulaType: 'liquid' }))} />
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: c.foreground }]}>Uso</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <SelectPill label="Fertirrigación" active={form.usage === 'fertirrigacion'} onPress={() => setForm((p) => ({ ...p, usage: 'fertirrigacion' }))} />
              <SelectPill label="Enmienda" active={form.usage === 'enmienda'} onPress={() => setForm((p) => ({ ...p, usage: 'enmienda' }))} />
            </View>
          </View>

          <Card style={{ gap: 12 }}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Composición</Text>
            <View style={styles.grid}>
              <View style={styles.gridItem}><Field label="N %" value={form.nPct} onChange={(v) => setForm((p) => ({ ...p, nPct: v }))} keyboardType="decimal-pad" /></View>
              <View style={styles.gridItem}><Field label="P₂O₅ %" value={form.p2o5Pct} onChange={(v) => setForm((p) => ({ ...p, p2o5Pct: v }))} keyboardType="decimal-pad" /></View>
              <View style={styles.gridItem}><Field label="K₂O %" value={form.k2oPct} onChange={(v) => setForm((p) => ({ ...p, k2oPct: v }))} keyboardType="decimal-pad" /></View>
              <View style={styles.gridItem}><Field label="CaO %" value={form.caoPct} onChange={(v) => setForm((p) => ({ ...p, caoPct: v }))} keyboardType="decimal-pad" /></View>
              <View style={styles.gridItem}><Field label="MgO %" value={form.mgoPct} onChange={(v) => setForm((p) => ({ ...p, mgoPct: v }))} keyboardType="decimal-pad" /></View>
              <View style={styles.gridItem}><Field label="SO₃ %" value={form.so3Pct} onChange={(v) => setForm((p) => ({ ...p, so3Pct: v }))} keyboardType="decimal-pad" /></View>
            </View>
          </Card>

          <PrimaryButton title={submitLabel} onPress={submit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FertilizerCard({
  item,
  onEdit,
  onDelete,
}: {
  item: Fertilizer;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const c = useColors();
  const ec = fertilizerEc(item);
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>{item.name}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Badge label={(item as Fertilizer & { formulaType?: string }).formulaType === 'liquid' ? 'Líquido' : 'Sólido'} />
            <Badge label={(item as Fertilizer & { usage?: string }).usage === 'enmienda' ? 'Enmienda' : 'Fertirrigación'} />
          </View>
        </View>
        <Text style={[styles.ec, { color: c.mutedForeground }]}>{formatEc(ec)}</Text>
      </View>

      <View style={styles.nutrientRow}>
        {nutrientRows(item).map(([label, value]) => (
          <View key={label} style={[styles.nutrientBox, { borderColor: c.border, backgroundColor: c.muted }]}>
            <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{label}</Text>
            <Text style={{ color: c.foreground, fontWeight: '700' }}>{formatPct(value)}</Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable accessibilityRole="button" onPress={onEdit} style={[styles.actionBtn, { borderColor: c.border, backgroundColor: c.card }]}>
          <Feather name="edit-3" size={16} color={c.foreground} />
          <Text style={{ color: c.foreground, fontWeight: '600' }}>Editar</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onDelete} style={[styles.actionBtn, { borderColor: c.border, backgroundColor: c.card }]}>
          <Feather name="trash-2" size={16} color={c.destructive} />
          <Text style={{ color: c.destructive, fontWeight: '600' }}>Borrar</Text>
        </Pressable>
      </View>
    </Card>
  );
}

export default function FertilizersScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmId = parseInt(id ?? '', 10);

  const fertilizersQuery = useListFertilizers({
    query: { queryKey: getListFertilizersQueryKey() },
  });
  const fertilizers = fertilizersQuery.data ?? [];
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Fertilizer | null>(null);

  const createMutation = useCreateFertilizer({
    mutation: {
      onSuccess: async () => {
        setEditorOpen(false);
        await queryClient.invalidateQueries({ queryKey: getListFertilizersQueryKey() });
      },
      onError: (err) => showError('No se pudo crear el fertilizante', err),
    },
  });
  const updateMutation = useUpdateFertilizer({
    mutation: {
      onSuccess: async () => {
        setEditing(null);
        await queryClient.invalidateQueries({ queryKey: getListFertilizersQueryKey() });
      },
      onError: (err) => showError('No se pudo guardar la composición', err),
    },
  });
  const deleteMutation = useDeleteFertilizer({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListFertilizersQueryKey() });
      },
      onError: (err) => showError('No se pudo borrar el fertilizante', err),
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fertilizers;
    return fertilizers.filter((f) => {
      const anyF = f as Fertilizer & { formulaType?: string; usage?: string };
      return [f.name, anyF.formulaType, anyF.usage].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [fertilizers, search]);

  const submitForm = async (data: FertilizerFormState) => {
    const payload = {
      name: data.name.trim(),
      formulaType: data.formulaType,
      usage: data.usage,
      nPct: toNumber(data.nPct),
      p2o5Pct: toNumber(data.p2o5Pct),
      k2oPct: toNumber(data.k2oPct),
      caoPct: toNumber(data.caoPct),
      mgoPct: toNumber(data.mgoPct),
      so3Pct: toNumber(data.so3Pct),
    };
    if (!payload.name) {
      showError('Nombre obligatorio', 'Indica un nombre para el fertilizante.');
      return;
    }
    await createMutation.mutateAsync({ data: payload as any });
  };

  const submitEdit = async (data: FertilizerFormState) => {
    if (!editing) return;
    const payload = {
      name: data.name.trim(),
      formulaType: data.formulaType,
      usage: data.usage,
      nPct: toNumber(data.nPct),
      p2o5Pct: toNumber(data.p2o5Pct),
      k2oPct: toNumber(data.k2oPct),
      caoPct: toNumber(data.caoPct),
      mgoPct: toNumber(data.mgoPct),
      so3Pct: toNumber(data.so3Pct),
    };
    await updateMutation.mutateAsync({ fertilizerId: editing.id, data: payload as any });
  };

  const bottom = insets.bottom;

  if (fertilizersQuery.isLoading) return <LoadingView label="Cargando catálogo…" />;
  if (fertilizersQuery.isError) return <ErrorView onRetry={() => fertilizersQuery.refetch()} />;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: c.border }]}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={[styles.iconButton, { backgroundColor: c.muted }]}>
          <Feather name="arrow-left" size={18} color={c.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Fertilizantes</Text>
          <Text style={[styles.headerSub, { color: c.mutedForeground }]} numberOfLines={1}>
            Catálogo y composición disponible para la finca {Number.isNaN(farmId) ? '' : `#${farmId}`}
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => setEditorOpen(true)} style={[styles.iconButton, { backgroundColor: c.primary }]}>
          <Feather name="plus" size={18} color={c.primaryForeground} />
        </Pressable>
      </View>

      <View style={{ padding: 16, gap: 12, flex: 1 }}>
        <View style={{ gap: 8 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar por nombre"
            placeholderTextColor={c.mutedForeground}
            style={[styles.search, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
          />
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          refreshing={fertilizersQuery.isRefetching}
          onRefresh={() => fertilizersQuery.refetch()}
          contentContainerStyle={{ paddingBottom: bottom + 20, gap: 12 }}
          ListEmptyComponent={
            <EmptyState
              icon="droplet"
              title="No hay fertilizantes"
              subtitle={search ? 'Prueba con otra búsqueda.' : 'Aún no hay registros en el catálogo.'}
            />
          }
          renderItem={({ item }) => (
            <FertilizerCard
              item={item}
              onEdit={() => setEditing(item)}
              onDelete={() =>
                confirmDelete('¿Borrar fertilizante?', `Se eliminará "${item.name}" del catálogo.`, () =>
                  deleteMutation.mutate({ fertilizerId: item.id }),
                )
              }
            />
          )}
        />
      </View>

      <FertilizerFormModal
        visible={editorOpen}
        title="Nuevo fertilizante"
        submitLabel={createMutation.isPending ? 'Guardando…' : 'Crear fertilizante'}
        onClose={() => setEditorOpen(false)}
        onSubmit={submitForm}
      />
      <FertilizerFormModal
        visible={!!editing}
        initialValue={editing}
        title={editing ? `Editar composición · ${editing.name}` : 'Editar fertilizante'}
        submitLabel={updateMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
        onClose={() => setEditing(null)}
        onSubmit={submitEdit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  headerSub: { fontSize: 13, marginTop: 2 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 16,
  },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  ec: { fontSize: 12, fontWeight: '600' },
  nutrientRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nutrientBox: {
    width: '31%',
    minWidth: 86,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  actionBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: { fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  inputMultiline: { minHeight: 92, textAlignVertical: 'top' },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridItem: { width: '48%' },
  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  scanBannerText: { fontWeight: '600', textAlign: 'center', flexShrink: 1 },
});
