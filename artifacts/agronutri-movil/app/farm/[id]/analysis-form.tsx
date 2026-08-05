import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFarmSummaryQueryKey,
  getListAnalysesQueryKey,
  getListSectorsQueryKey,
  getListWaterSourcesQueryKey,
  useCreateAnalysis,
  useGetAnalysis,
  useListSectors,
  useListWaterSources,
  useUpdateAnalysis,
} from '@workspace/api-client-react';
import { Card, PrimaryButton } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

type AnalysisType = 'soil' | 'leaf' | 'water';

const TYPE_OPTIONS: { key: AnalysisType; label: string }[] = [
  { key: 'soil', label: 'Suelo' },
  { key: 'leaf', label: 'Foliar' },
  { key: 'water', label: 'Agua' },
];

type ParamRow = { key: number; name: string; value: string; unit: string; status: string };
type AnalysisStatus = 'muy_bajo' | 'bajo' | 'normal' | 'alto' | 'muy_alto' | '';

function notify(title: string, msg: string) {
  if (Platform.OS === 'web') window.alert(msg);
  else Alert.alert(title, msg);
}

function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function AnalysisFormScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, analysisId } = useLocalSearchParams<{ id: string; analysisId?: string }>();
  const farmId = parseInt(id ?? '', 10);
  const queryClient = useQueryClient();
  const parsedAnalysisId = useMemo(() => {
    const raw = analysisId ?? null;
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [analysisId]);
  const isEditMode = parsedAnalysisId != null;

  const [type, setType] = useState<AnalysisType>('soil');
  const [sectorId, setSectorId] = useState<number | null>(null);
  const [waterSourceId, setWaterSourceId] = useState<number | null>(null);
  const [sampleDate, setSampleDate] = useState(todayIso());
  const [laboratory, setLaboratory] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [params, setParams] = useState<ParamRow[]>([
    { key: Date.now(), name: '', value: '', unit: '', status: '' },
  ]);

  const analysisQuery = useGetAnalysis(farmId, parsedAnalysisId ?? 0, {
    query: {
      queryKey: ['analysis-form-edit', farmId, parsedAnalysisId],
      enabled: isEditMode && !Number.isNaN(farmId) && parsedAnalysisId != null,
    },
  });

  const sectorsQuery = useListSectors(farmId, {
    query: { queryKey: getListSectorsQueryKey(farmId), enabled: !Number.isNaN(farmId) },
  });
  const waterSourcesQuery = useListWaterSources(farmId, {
    query: {
      queryKey: getListWaterSourcesQueryKey(farmId),
      enabled: !Number.isNaN(farmId) && type === 'water',
    },
  });
  const sectors = sectorsQuery.data ?? [];
  const waterSources = waterSourcesQuery.data ?? [];
  const pendingEdit = isEditMode && analysisQuery.isLoading;

  if (isEditMode && analysisQuery.isError) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: c.border }]}>
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
          <Text style={[styles.headerTitle, { color: c.foreground, flex: 1 }]}>Editar analítica</Text>
        </View>
        <View style={{ padding: 16, gap: 12 }}>
          <Text style={{ color: c.foreground }}>No se pudo cargar la analítica.</Text>
          <PrimaryButton title="Volver" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  if (pendingEdit) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: c.border }]}>
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
          <Text style={[styles.headerTitle, { color: c.foreground, flex: 1 }]}>Editar analítica</Text>
        </View>
        <View style={{ padding: 16 }}>
          <Text style={{ color: c.mutedForeground }}>Cargando analítica…</Text>
        </View>
      </View>
    );
  }

  const createMutation = useCreateAnalysis({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(farmId) });
        queryClient.invalidateQueries({ queryKey: getGetFarmSummaryQueryKey(farmId) });
        router.back();
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ??
          'No se pudo guardar la analítica. Revisa los datos.';
        notify('Error', msg);
      },
    },
  });
  const updateMutation = useUpdateAnalysis({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(farmId) });
        queryClient.invalidateQueries({ queryKey: getGetFarmSummaryQueryKey(farmId) });
        router.back();
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ??
          'No se pudo guardar la analítica. Revisa los datos.';
        notify('Error', msg);
      },
    },
  });

  useEffect(() => {
    if (!analysisQuery.data) return;
    const a = analysisQuery.data;
    setType(a.type);
    setSectorId(a.sectorId ?? null);
    setWaterSourceId(a.waterSourceId ?? null);
    setSampleDate(String(a.sampleDate).slice(0, 10));
    setLaboratory(a.laboratory ?? '');
    setReference(a.reference ?? '');
    setNotes(a.notes ?? '');
    setParams(
      (a.parameters ?? []).map((p, index) => ({
        key: Date.now() + index,
        name: p.name,
        value: String(p.value),
        unit: p.unit ?? '',
        status: (p.status ?? '') as AnalysisStatus,
      })),
    );
  }, [analysisQuery.data]);

  const validParams = params
    .map((p) => ({
      name: p.name.trim(),
      value: parseFloat(p.value.replace(',', '.')),
      unit: p.unit.trim(),
      status: p.status.trim() as AnalysisStatus,
    }))
    .filter((p) => p.name && Number.isFinite(p.value));

  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(sampleDate.trim());
  const canSave = validParams.length > 0 && dateOk && !(isEditMode ? updateMutation.isPending : createMutation.isPending);

  const handleSave = () => {
    if (!dateOk) {
      notify('Fecha incorrecta', 'Usa el formato AAAA-MM-DD, por ejemplo 2026-08-04.');
      return;
    }
    if (validParams.length === 0) {
      notify('Faltan parámetros', 'Añade al menos un parámetro con nombre y valor numérico.');
      return;
    }
    const data = {
        type,
        sampleDate: sampleDate.trim(),
        ...(sectorId != null ? { sectorId } : {}),
        ...(type === 'water' && waterSourceId != null ? { waterSourceId } : {}),
        ...(type === 'water' ? {} : sectorId == null ? {} : {}),
        ...(laboratory.trim() ? { laboratory: laboratory.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        parameters: validParams.map((p) => ({
          name: p.name,
          value: p.value,
          ...(p.unit ? { unit: p.unit } : {}),
          ...(p.status ? { status: p.status } : {}),
        })),
      };
    if (isEditMode && parsedAnalysisId != null) updateMutation.mutate({ farmId, analysisId: parsedAnalysisId, data });
    else createMutation.mutate({ farmId, data });
  };

  const inputStyle = [
    styles.input,
    { borderColor: c.border, color: c.foreground, backgroundColor: c.card },
  ];

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: c.border }]}>
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
        <Text style={[styles.headerTitle, { color: c.foreground, flex: 1 }]}>
          {isEditMode ? 'Editar analítica' : 'Registrar analítica'}
        </Text>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Card style={{ gap: 10 }}>
          <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Tipo</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {TYPE_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                testID={`chip-type-${o.key}`}
                accessibilityRole="button"
                onPress={() => setType(o.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: type === o.key ? c.primaryTint : c.muted,
                    borderColor: type === o.key ? c.primary : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[styles.chipText, { color: type === o.key ? c.primary : c.mutedForeground }]}
                >
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {type === 'water' && waterSources.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Fuente de agua</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {[{ id: null as number | null, name: 'Sin fuente' }, ...waterSources].map((s) => (
                  <Pressable
                    key={s.id ?? 'none'}
                    testID={`chip-water-source-${s.id ?? 'none'}`}
                    accessibilityRole="button"
                    onPress={() => setWaterSourceId(s.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: waterSourceId === s.id ? c.primaryTint : c.muted,
                        borderColor: waterSourceId === s.id ? c.primary : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: waterSourceId === s.id ? c.primary : c.mutedForeground },
                      ]}
                    >
                      {s.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {type !== 'water' && sectors.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Sector</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {[{ id: null as number | null, name: 'Toda la finca' }, ...sectors].map((s) => (
                  <Pressable
                    key={s.id ?? 'global'}
                    testID={`chip-analysis-sector-${s.id ?? 'global'}`}
                    accessibilityRole="button"
                    onPress={() => setSectorId(s.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: sectorId === s.id ? c.primaryTint : c.muted,
                        borderColor: sectorId === s.id ? c.primary : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: sectorId === s.id ? c.primary : c.mutedForeground },
                      ]}
                    >
                      {s.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Fecha de muestra</Text>
              <TextInput
                testID="input-sample-date"
                style={inputStyle}
                value={sampleDate}
                onChangeText={setSampleDate}
                placeholder="AAAA-MM-DD"
                placeholderTextColor={c.mutedForeground}
                autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Laboratorio</Text>
              <TextInput
                testID="input-laboratory"
                style={inputStyle}
                value={laboratory}
                onChangeText={setLaboratory}
                placeholder="Opcional"
                placeholderTextColor={c.mutedForeground}
              />
            </View>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Referencia</Text>
            <TextInput
              testID="input-reference"
              style={inputStyle}
              value={reference}
              onChangeText={setReference}
              placeholder="Nº de informe del laboratorio (opcional)"
              placeholderTextColor={c.mutedForeground}
            />
          </View>
        </Card>

        <Card style={{ gap: 10 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>Parámetros</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={[styles.colHeader, { color: c.mutedForeground, flex: 1 }]}>Parámetro</Text>
            <Text style={[styles.colHeader, { color: c.mutedForeground, width: 70 }]}>Valor</Text>
            <Text style={[styles.colHeader, { color: c.mutedForeground, width: 64 }]}>Unidad</Text>
            <View style={{ width: 20 }} />
          </View>
          {params.map((p) => (
            <View key={p.key} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput
                testID={`input-param-name-${p.key}`}
                style={[...inputStyle, { flex: 1 }]}
                value={p.name}
                onChangeText={(t) =>
              setParams((arr) => arr.map((x) => (x.key === p.key ? { ...x, name: t } : x)))
                }
                placeholder="pH, CE, Nitratos…"
                placeholderTextColor={c.mutedForeground}
              />
              <TextInput
                testID={`input-param-value-${p.key}`}
                style={[...inputStyle, { width: 70, textAlign: 'right' }]}
                value={p.value}
                onChangeText={(t) =>
              setParams((arr) => arr.map((x) => (x.key === p.key ? { ...x, value: t } : x)))
                }
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={c.mutedForeground}
              />
              <TextInput
                testID={`input-param-unit-${p.key}`}
                style={[...inputStyle, { width: 64 }]}
                value={p.unit}
                onChangeText={(t) =>
              setParams((arr) => arr.map((x) => (x.key === p.key ? { ...x, unit: t } : x)))
                }
                placeholder="mg/L"
                placeholderTextColor={c.mutedForeground}
                autoCapitalize="none"
              />
              <Pressable
                testID={`button-remove-param-${p.key}`}
                accessibilityRole="button"
                onPress={() => setParams((arr) => arr.filter((x) => x.key !== p.key))}
                disabled={params.length === 1}
                style={({ pressed }) => ({ opacity: params.length === 1 ? 0.3 : pressed ? 0.5 : 1 })}
              >
                <Feather name="trash-2" size={16} color={c.destructive} />
              </Pressable>
            </View>
          ))}
          <Pressable
            testID="button-add-param"
            accessibilityRole="button"
            onPress={() =>
              setParams((arr) => [...arr, { key: Date.now(), name: '', value: '', unit: '', status: '' }])
            }
            style={({ pressed }) => [
              styles.addRow,
              { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="plus" size={15} color={c.foreground} />
            <Text style={[styles.addRowText, { color: c.foreground }]}>Añadir parámetro</Text>
          </Pressable>
        </Card>

        <Card style={{ gap: 6 }}>
          <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Notas</Text>
          <TextInput
            testID="input-notes"
            style={[...inputStyle, { minHeight: 70, textAlignVertical: 'top' }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Observaciones (opcional)"
            placeholderTextColor={c.mutedForeground}
            multiline
          />
        </Card>

        <PrimaryButton
          testID="button-save-analysis"
          title={
            isEditMode
              ? updateMutation.isPending
                ? 'Guardando…'
                : 'Guardar cambios'
              : createMutation.isPending
                ? 'Guardando…'
                : 'Guardar analítica'
          }
          onPress={handleSave}
          disabled={!canSave}
          loading={isEditMode ? updateMutation.isPending : createMutation.isPending}
        />
      </ScrollView>
    </View>
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
  headerTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 16, gap: 16, flexGrow: 1 },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  colHeader: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  addRowText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
