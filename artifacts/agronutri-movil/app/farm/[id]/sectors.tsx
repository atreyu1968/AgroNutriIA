import React, { useEffect, useState } from 'react';
import {
  Alert,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFarmSummaryQueryKey,
  getListSectorsQueryKey,
  useCreateSector,
  useDeleteSector,
  useGetFarmSummary,
  useListSectors,
  useUpdateSector,
  type Sector,
  type SectorInput,
  type SectorUpdate,
} from '@workspace/api-client-react';
import { Card, EmptyState, ErrorView, LoadingView, PrimaryButton } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

type FormState = {
  name: string;
  surfaceHa: string;
  plantCount: string;
  weeklyLitresPerPlant: string;
  phenologicalStage: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  surfaceHa: '',
  plantCount: '',
  weeklyLitresPerPlant: '',
  phenologicalStage: '',
  notes: '',
};

function parseNum(v: string): number | undefined {
  const t = v.replace(',', '.').trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function isValidNum(v: string): boolean {
  return parseNum(v) != null;
}

function formatNum(v?: number | null, digits = 2): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(digits).replace(/\.?0+$/, '');
}

function notify(title: string, msg: string) {
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
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
        style={[
          styles.input,
          { backgroundColor: c.card, borderColor: c.border, color: c.foreground },
        ]}
      />
    </View>
  );
}

export default function SectorsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmId = parseInt(id ?? '', 10);
  const invalidFarmId = Number.isNaN(farmId);

  const summaryQuery = useGetFarmSummary(farmId, {
    query: { queryKey: getGetFarmSummaryQueryKey(farmId), enabled: !invalidFarmId },
  });
  const myRole = summaryQuery.data?.farm?.myRole;
  const canEdit = myRole === 'owner' || myRole === 'technician';

  const sectorsQuery = useListSectors(farmId, {
    query: { queryKey: getListSectorsQueryKey(farmId), enabled: !invalidFarmId },
  });

  const [open, setOpen] = useState(false);
  const [editingSector, setEditingSector] = useState<Sector | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (!open) {
      setEditingSector(null);
      setForm(EMPTY_FORM);
    }
  }, [open]);

  const createMutation = useCreateSector({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListSectorsQueryKey(farmId) });
        setOpen(false);
        notify('Sector creado', 'El sector se ha añadido correctamente.');
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? 'No se pudo crear el sector.';
        notify('Error', msg);
      },
    },
  });

  const updateMutation = useUpdateSector({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListSectorsQueryKey(farmId) });
        setOpen(false);
        notify('Sector actualizado', 'Los cambios se han guardado correctamente.');
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? 'No se pudo guardar el sector.';
        notify('Error', msg);
      },
    },
  });

  const deleteMutation = useDeleteSector({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListSectorsQueryKey(farmId) });
        notify('Sector eliminado', 'El sector se ha borrado correctamente.');
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? 'No se pudo eliminar el sector.';
        notify('Error', msg);
      },
    },
  });

  const sectors = sectorsQuery.data ?? [];
  const saving = createMutation.isPending || updateMutation.isPending;

  const startCreate = () => {
    setEditingSector(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const startEdit = (sector: Sector) => {
    setEditingSector(sector);
    setForm({
      name: sector.name ?? '',
      surfaceHa: sector.surfaceHa != null ? String(sector.surfaceHa) : '',
      plantCount: sector.plantCount != null ? String(sector.plantCount) : '',
      weeklyLitresPerPlant:
        sector.weeklyLitresPerPlant != null ? String(sector.weeklyLitresPerPlant) : '',
      phenologicalStage: sector.phenologicalStage ?? '',
      notes: sector.notes ?? '',
    });
    setOpen(true);
  };

  const resetForm = () => {
    setEditingSector(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = () => {
    if (!form.name.trim()) {
      notify('Falta el nombre', 'El nombre del sector es obligatorio.');
      return;
    }

    const dataBase = {
      name: form.name.trim(),
      ...(isValidNum(form.surfaceHa) ? { surfaceHa: parseNum(form.surfaceHa) } : {}),
      ...(isValidNum(form.plantCount) ? { plantCount: Math.round(parseNum(form.plantCount)!) } : {}),
      ...(isValidNum(form.weeklyLitresPerPlant)
        ? { weeklyLitresPerPlant: parseNum(form.weeklyLitresPerPlant) }
        : {}),
      ...(form.phenologicalStage.trim() ? { phenologicalStage: form.phenologicalStage.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    };

    if (editingSector) {
      updateMutation.mutate({
        farmId,
        sectorId: editingSector.id,
        data: dataBase as SectorUpdate,
      });
    } else {
      createMutation.mutate({
        farmId,
        data: dataBase as SectorInput,
      });
    }
  };

  const handleDelete = (sector: Sector) => {
    confirmDelete('¿Eliminar sector?', sector.name, () => {
      deleteMutation.mutate({ farmId, sectorId: sector.id });
    });
  };

  const loading = sectorsQuery.isLoading || summaryQuery.isLoading;
  const error = sectorsQuery.isError || summaryQuery.isError;

  if (invalidFarmId) return <ErrorView message="Finca inválida" />;
  if (loading) return <LoadingView label="Cargando sectores…" />;
  if (error)
    return (
      <ErrorView
        message="No se pudieron cargar los sectores."
        onRetry={async () => {
          await summaryQuery.refetch();
          await sectorsQuery.refetch();
        }}
      />
    );

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: c.border }]}>
        <Pressable
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
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Sectores de riego</Text>
          <Text style={[styles.headerSub, { color: c.mutedForeground }]} numberOfLines={1}>
            {summaryQuery.data?.farm?.name ?? ''}
          </Text>
        </View>
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            onPress={startCreate}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: c.primaryTint, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="plus" size={18} color={c.primary} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={
          <RefreshControl
            refreshing={sectorsQuery.isRefetching}
            onRefresh={() => sectorsQuery.refetch()}
            tintColor={c.primary}
          />
        }
      >
        {sectors.length === 0 ? (
          <EmptyState
            icon="anchor"
            title="No hay sectores"
            subtitle={canEdit ? 'Crea el primer sector para empezar a gestionar el riego.' : 'Todavía no hay sectores registrados.'}
          />
        ) : (
          <View style={{ gap: 12 }}>
            {sectors.map((sector) => (
              <Card key={sector.id} style={{ gap: 10 }}>
                <View style={{ gap: 4 }}>
                  <Text style={[styles.sectorTitle, { color: c.foreground }]}>{sector.name}</Text>
                  <Text style={[styles.metaText, { color: c.mutedForeground }]}>
                    {sector.surfaceHa != null ? `${formatNum(sector.surfaceHa)} ha` : 'Superficie no indicada'}
                    {' · '}
                    {sector.plantCount != null ? `${Math.round(sector.plantCount)} plantas` : 'Plantas no indicadas'}
                  </Text>
                  <Text style={[styles.metaText, { color: c.mutedForeground }]}>
                    {sector.weeklyLitresPerPlant != null
                      ? `${formatNum(sector.weeklyLitresPerPlant)} L/pl/sem`
                      : 'Sin consumo semanal'}
                  </Text>
                  {sector.phenologicalStage ? (
                    <Text style={[styles.metaText, { color: c.mutedForeground }]}>
                      Fase: {sector.phenologicalStage}
                    </Text>
                  ) : null}
                  {sector.notes ? (
                    <Text style={[styles.noteText, { color: c.foreground }]} numberOfLines={3}>
                      {sector.notes}
                    </Text>
                  ) : null}
                </View>

                {canEdit ? (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => startEdit(sector)}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        { backgroundColor: c.muted, opacity: pressed ? 0.75 : 1 },
                      ]}
                    >
                      <Feather name="edit-3" size={15} color={c.foreground} />
                      <Text style={[styles.actionText, { color: c.foreground }]}>Editar</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => handleDelete(sector)}
                      disabled={deleteMutation.isPending}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        { backgroundColor: c.muted, opacity: pressed || deleteMutation.isPending ? 0.75 : 1 },
                      ]}
                    >
                      <Feather name="trash-2" size={15} color={c.destructive} />
                      <Text style={[styles.actionText, { color: c.destructive }]}>Borrar</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {open && canEdit ? (
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.background, borderColor: c.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.modalTitle, { color: c.foreground }]}>
                {editingSector ? 'Editar sector' : 'Nuevo sector'}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
                <Feather name="x" size={20} color={c.mutedForeground} />
              </Pressable>
            </View>

            <View style={{ gap: 12, marginTop: 14 }}>
              <Field label="Nombre" value={form.name} onChange={(name) => setForm((p) => ({ ...p, name }))} placeholder="Sector 1" />
              <Field label="Superficie (ha)" value={form.surfaceHa} onChange={(surfaceHa) => setForm((p) => ({ ...p, surfaceHa }))} placeholder="Opcional" keyboardType="decimal-pad" />
              <Field label="Plantas" value={form.plantCount} onChange={(plantCount) => setForm((p) => ({ ...p, plantCount }))} placeholder="Opcional" keyboardType="number-pad" />
              <Field label="Caudal semanal por planta (L)" value={form.weeklyLitresPerPlant} onChange={(weeklyLitresPerPlant) => setForm((p) => ({ ...p, weeklyLitresPerPlant }))} placeholder="Opcional" keyboardType="decimal-pad" />
              <Field label="Fase fenológica" value={form.phenologicalStage} onChange={(phenologicalStage) => setForm((p) => ({ ...p, phenologicalStage }))} placeholder="Opcional" />
              <Field label="Notas" value={form.notes} onChange={(notes) => setForm((p) => ({ ...p, notes }))} placeholder="Opcional" />

              <PrimaryButton
                title={editingSector ? 'Guardar cambios' : 'Crear sector'}
                onPress={handleSubmit}
                loading={saving}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  resetForm();
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.cancelBtn,
                  { borderColor: c.border, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Text style={[styles.cancelText, { color: c.foreground }]}>Cancelar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
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
  body: { padding: 16, gap: 12 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  headerSub: { fontSize: 13, marginTop: 2 },
  sectorTitle: { fontSize: 17, fontWeight: '800' },
  metaText: { fontSize: 13 },
  noteText: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  actionText: { fontSize: 13, fontWeight: '700' },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  label: { fontSize: 13, fontWeight: '700' },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  cancelBtn: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '700' },
});