import React, { useEffect, useState } from 'react';
import {
  Alert,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  getGetFarmSummaryQueryKey,
  getListSectorsQueryKey,
  getListRecommendationsQueryKey,
  useCreateRecommendation,
  useGenerateAiDraftRecommendation,
  useGetFarmSummary,
  useListFertilizers,
  useListSectors,
  useUpdateRecommendation,
  useRunCalculation,
  type CalculationResult,
  type Fertilizer,
  type RecommendationInput,
  type Recommendation,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Card, PrimaryButton } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

// La CE se muestra y edita SIEMPRE en µS/cm; la API trabaja en dS/m.
const ecToUs = (ds: number) => Math.round(ds * 1000);
const ecToDs = (us: number) => us / 1000;

const NUTRIENT_LABELS: [string, string][] = [
  ['n', 'N total'],
  ['nNitric', 'N nítrico'],
  ['nAmmoniacal', 'N amoniacal'],
  ['nUreic', 'N ureico'],
  ['p2o5', 'P₂O₅'],
  ['k2o', 'K₂O'],
  ['cao', 'CaO'],
  ['mgo', 'MgO'],
  ['so3', 'SO₃'],
  ['b', 'B'],
];

type Item = {
  key: number;
  fertilizerId: number | null;
  fertilizerName: string;
  dose: string;
  unit: 'kg' | 'L';
};

type AiDraft = Pick<Recommendation, 'id' | 'title' | 'rationale' | 'sectorId'>;

function formatNumber(v: number): string {
  return v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

function unitFor(f: Fertilizer): 'kg' | 'L' {
  return f.formulaType === 'liquid' ? 'L' : 'kg';
}

function showMessage(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function CalculatorScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmId = parseInt(id ?? '', 10);

  const summaryQuery = useGetFarmSummary(farmId, {
    query: { queryKey: getGetFarmSummaryQueryKey(farmId), enabled: !Number.isNaN(farmId) },
  });
  const farm = summaryQuery.data?.farm;
  const fertilizersQuery = useListFertilizers();
  const sectorsQuery = useListSectors(farmId, {
    query: { queryKey: getListSectorsQueryKey(farmId), enabled: !Number.isNaN(farmId) },
  });
  const fertilizers = fertilizersQuery.data ?? [];
  const sectors = sectorsQuery.data ?? [];

  const [sectorId, setSectorId] = useState<number | null>(null);
  const [stageChoice, setStageChoice] = useState<'auto' | 'pre-floración' | 'engorde' | 'parón invernal' | 'postcosecha'>('auto');
  const [useAcid, setUseAcid] = useState(false);
  const [acidType, setAcidType] = useState<'auto' | 'nitrico' | 'fosforico' | 'sulfurico'>('auto');
  const [targetPh, setTargetPh] = useState('5.8');
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [itemsEdited, setItemsEdited] = useState(false);
  const [plantCount, setPlantCount] = useState('');
  const [weeklyLitres, setWeeklyLitres] = useState('');
  const [maxEcUs, setMaxEcUs] = useState('');
  const [items, setItems] = useState<Item[]>([
    { key: Date.now(), fertilizerId: null, fertilizerName: '', dose: '', unit: 'kg' },
  ]);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [pickerFilter, setPickerFilter] = useState('');
  const [result, setResult] = useState<CalculationResult | null>(null);

  // Precarga los valores de la finca cuando llegan.
  useEffect(() => {
    if (!farm) return;
    setPlantCount((v) => (v === '' && farm.plantCount != null ? String(farm.plantCount) : v));
    setWeeklyLitres((v) =>
      v === '' && farm.weeklyLitresPerPlant != null ? String(farm.weeklyLitresPerPlant) : v,
    );
    setMaxEcUs((v) => (v === '' && farm.maxEcDsM != null ? String(ecToUs(farm.maxEcDsM)) : v));
  }, [farm]);

  const calcMutation = useRunCalculation({
    mutation: {
      onSuccess: (data) => setResult(data),
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ??
          'No se pudo realizar el cálculo. Revisa los datos.';
        showMessage('Error', msg);
      },
    },
  });
  const createRecommendationMutation = useCreateRecommendation({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListRecommendationsQueryKey(farmId) });
        showMessage('Programa guardado', 'El programa de abonado se ha guardado correctamente.');
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ??
          'No se pudo guardar el programa de abonado.';
        showMessage('Error', msg);
      },
    },
  });
  const aiDraftMutation = useGenerateAiDraftRecommendation({
    mutation: {
      onSuccess: async (rec) => {
        setAiDraft({ id: rec.id, title: rec.title, rationale: rec.rationale ?? null, sectorId: rec.sectorId ?? null });
        setItemsEdited(false);
        setItems(
          (rec.items ?? []).map((it, index) => ({
            key: Date.now() + index,
            fertilizerId: it.fertilizerId ?? null,
            fertilizerName: it.fertilizerName ?? '',
            dose: String(it.weeklyDose ?? ''),
            unit: (it.unit ?? 'kg') as 'kg' | 'L',
          })) as Item[],
        );
        await queryClient.invalidateQueries({ queryKey: getListRecommendationsQueryKey(farmId) });
        showMessage('Borrador IA generado', 'Se han cargado los items propuestos por la IA.');
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ??
          'No se pudo generar el borrador IA.';
        showMessage('Error', msg);
      },
    },
  });
  const updateRecommendationMutation = useUpdateRecommendation({
    mutation: {
      onSuccess: async () => {
        setItemsEdited(false);
        await queryClient.invalidateQueries({ queryKey: getListRecommendationsQueryKey(farmId) });
        showMessage('Borrador IA actualizado', 'Se han guardado tus ajustes sobre el borrador.');
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ??
          'No se pudo actualizar el borrador IA.';
        showMessage('Error', msg);
      },
    },
  });

  const validItems = items.filter((it) => it.fertilizerName && parseFloat(it.dose) > 0);
  const plantCountNum = parseInt(plantCount, 10);
  const weeklyLitresNum = parseFloat(weeklyLitres.replace(',', '.'));
  const maxEcNum = parseFloat(maxEcUs.replace(',', '.'));
  const canCalculate = validItems.length > 0 && !calcMutation.isPending;
  const canSaveRecommendation =
    result != null &&
    !createRecommendationMutation.isPending &&
    (result.nutrients.n > 0 ||
      result.nutrients.nNitric > 0 ||
      result.nutrients.nAmmoniacal > 0 ||
      result.nutrients.nUreic > 0 ||
      result.nutrients.p2o5 > 0 ||
      result.nutrients.k2o > 0 ||
      result.nutrients.cao > 0 ||
      result.nutrients.mgo > 0 ||
      result.nutrients.so3 > 0 ||
      result.nutrients.b > 0);

  const buildRecommendationInput = (): RecommendationInput | null => {
    if (!result || !sectorId || validItems.length === 0) return null;
    const recommendationItems = validItems.map((it) => ({
      fertilizerId: it.fertilizerId,
      fertilizerName: it.fertilizerName,
      weeklyDose: parseFloat(it.dose.replace(',', '.')),
      unit: it.unit,
      reason: `Ajuste basado en el cálculo de mezcla para ${farm?.name ?? 'la finca'}.`,
    }));
    return {
      sectorId,
      title: `Programa de abonado - ${farm?.name ?? 'finca'}${result.estimatedEcDsM != null ? ` (${formatNumber(ecToUs(result.estimatedEcDsM))} µS/cm)` : ''}`,
      items: recommendationItems,
      rationale: [
        `Cálculo generado desde la calculadora móvil.`,
        `Plantas: ${Number.isFinite(plantCountNum) ? plantCountNum : '—'}`,
        `L/planta/sem: ${Number.isFinite(weeklyLitresNum) ? weeklyLitresNum : '—'}`,
        `CE máxima: ${Number.isFinite(maxEcNum) ? `${maxEcNum} µS/cm` : '—'}`,
      ].join(' '),
    };
  };

  const buildAiPayload = () => ({
    ...(sectorId != null ? { sectorId } : {}),
    ...(useAcid ? { useAcid: true } : {}),
    ...(useAcid && acidType !== 'auto' ? { acidType } : {}),
    ...(useAcid && Number.isFinite(parseFloat(targetPh)) ? { targetPh: parseFloat(targetPh) } : {}),
  });

  const handleCalculate = () => {
    setResult(null);
    calcMutation.mutate({
      farmId,
      data: {
        ...(sectorId != null ? { sectorId } : {}),
        ...(Number.isFinite(plantCountNum) && plantCountNum > 0 ? { plantCount: plantCountNum } : {}),
        ...(Number.isFinite(weeklyLitresNum) && weeklyLitresNum > 0
          ? { weeklyLitresPerPlant: weeklyLitresNum }
          : {}),
        ...(Number.isFinite(maxEcNum) && maxEcNum > 0 ? { maxEcDsM: ecToDs(maxEcNum) } : {}),
        items: validItems.map((it) => ({
          fertilizerId: it.fertilizerId,
          fertilizerName: it.fertilizerName,
          weeklyDose: parseFloat(it.dose.replace(',', '.')),
          unit: it.unit,
        })),
        ...(stageChoice !== 'auto' ? { phenologicalStage: stageChoice } : {}),
      },
    });
  };

  const handleGenerateAiDraft = () => {
    aiDraftMutation.mutate({ farmId, data: buildAiPayload() });
  };

  const handleUpdateAiDraft = () => {
    if (!aiDraft) return;
    updateRecommendationMutation.mutate({
      farmId,
      recommendationId: aiDraft.id,
      data: { items: validItems.map((it) => ({
        fertilizerId: it.fertilizerId,
        fertilizerName: it.fertilizerName,
        weeklyDose: parseFloat(it.dose.replace(',', '.')),
        unit: it.unit,
      })) },
    });
  };

  const handleSaveRecommendation = () => {
    const data = buildRecommendationInput();
    if (!data) return;
    createRecommendationMutation.mutate({ farmId, data });
  };

  const exceedsCe =
    result?.estimatedEcDsM != null && Number.isFinite(maxEcNum) && maxEcNum > 0
      ? ecToUs(result.estimatedEcDsM) > maxEcNum
      : false;

  const filteredFerts = pickerFilter.trim()
    ? fertilizers.filter((f) => f.name.toLowerCase().includes(pickerFilter.trim().toLowerCase()))
    : fertilizers;

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
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Calculadora de mezcla</Text>
          <Text style={[styles.headerSub, { color: c.mutedForeground }]} numberOfLines={1}>
            {farm?.name ?? ''}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Card style={{ gap: 10 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>Parámetros de riego</Text>
          {sectors.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Sector</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {[{ id: null as number | null, name: 'Toda la finca' }, ...sectors].map((s) => (
                  <Pressable
                    key={s.id ?? 'global'}
                    testID={`chip-sector-${s.id ?? 'global'}`}
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
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Plantas</Text>
              <TextInput
                testID="input-plant-count"
                style={[styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
                value={plantCount}
                onChangeText={setPlantCount}
                keyboardType="number-pad"
                placeholder="1000"
                placeholderTextColor={c.mutedForeground}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>L/planta/sem</Text>
              <TextInput
                testID="input-weekly-litres"
                style={[styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
                value={weeklyLitres}
                onChangeText={setWeeklyLitres}
                keyboardType="decimal-pad"
                placeholder="150"
                placeholderTextColor={c.mutedForeground}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>CE máx (µS/cm)</Text>
              <TextInput
                testID="input-max-ec"
                style={[styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
                value={maxEcUs}
                onChangeText={setMaxEcUs}
                keyboardType="decimal-pad"
                placeholder="2500"
                placeholderTextColor={c.mutedForeground}
              />
            </View>
          </View>
        </Card>

        <Card style={{ gap: 10 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>IA y fenología</Text>
          <View style={{ gap: 6 }}>
            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Fase fenológica del cálculo</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {(['auto', 'pre-floración', 'engorde', 'parón invernal', 'postcosecha'] as const).map((stage) => (
                <Pressable
                  key={stage}
                  accessibilityRole="button"
                  onPress={() => setStageChoice(stage)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: stageChoice === stage ? c.primaryTint : c.muted,
                      borderColor: stageChoice === stage ? c.primary : 'transparent',
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: stageChoice === stage ? c.primary : c.mutedForeground }]}>
                    {stage === 'auto' ? 'Auto' : stage}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Pressable
              accessibilityRole="checkbox"
              onPress={() => setUseAcid((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <View style={[styles.checkbox, { borderColor: c.border, backgroundColor: useAcid ? c.primary : c.card }]} />
              <Text style={[styles.metaText, { color: c.foreground }]}>Uso de ácido para bajar el pH del agua</Text>
            </Pressable>
            {useAcid ? (
              <>
                <Pressable accessibilityRole="button" onPress={() => setAcidType('auto')} style={styles.inlinePill}>
                  <Text style={styles.inlinePillText}>Ácido: auto</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setAcidType('nitrico')} style={styles.inlinePill}>
                  <Text style={styles.inlinePillText}>Nítrico</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setAcidType('fosforico')} style={styles.inlinePill}>
                  <Text style={styles.inlinePillText}>Fosfórico</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setAcidType('sulfurico')} style={styles.inlinePill}>
                  <Text style={styles.inlinePillText}>Sulfúrico</Text>
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.metaText, { color: c.mutedForeground }]}>pH objetivo</Text>
                  <TextInput
                    value={targetPh}
                    onChangeText={setTargetPh}
                    keyboardType="decimal-pad"
                    style={[styles.smallInput, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
                  />
                </View>
              </>
            ) : null}
          </View>
          <PrimaryButton
            testID="button-generate-ai"
            title={aiDraftMutation.isPending ? 'Generando…' : 'Generar con IA'}
            onPress={handleGenerateAiDraft}
            disabled={aiDraftMutation.isPending}
            loading={aiDraftMutation.isPending}
          />
          {aiDraft ? (
            <>
              <View style={[styles.aiDraftBox, { borderColor: c.border, backgroundColor: c.muted }]}>
                <Text style={[styles.metaText, { color: c.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {aiDraft.title}
                </Text>
                {aiDraft.rationale ? (
                  <Text style={[styles.metaText, { color: c.mutedForeground }]}>{aiDraft.rationale}</Text>
                ) : null}
                {itemsEdited ? <Badge label="modificado" tone="accent" /> : null}
              </View>
              <PrimaryButton
                testID="button-update-ai-draft"
                title={updateRecommendationMutation.isPending ? 'Actualizando…' : 'Actualizar borrador con mis ajustes'}
                onPress={handleUpdateAiDraft}
                disabled={!itemsEdited || updateRecommendationMutation.isPending || validItems.length === 0}
                loading={updateRecommendationMutation.isPending}
              />
            </>
          ) : null}
        </Card>

        <Card style={{ gap: 10 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>Abonos semanales</Text>
          {items.map((it) => (
            <View key={it.key} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Pressable
                testID={`button-pick-fertilizer-${it.key}`}
                accessibilityRole="button"
                onPress={() => {
                  setPickerFilter('');
                  setPickerFor(it.key);
                }}
                style={[styles.fertPicker, { borderColor: c.border, backgroundColor: c.card }]}
              >
                <Text
                  style={[
                    styles.fertPickerText,
                    { color: it.fertilizerName ? c.foreground : c.mutedForeground },
                  ]}
                  numberOfLines={1}
                >
                  {it.fertilizerName || 'Elegir abono…'}
                </Text>
                <Feather name="chevron-down" size={16} color={c.mutedForeground} />
              </Pressable>
              <TextInput
                testID={`input-dose-${it.key}`}
                style={[styles.doseInput, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
                value={it.dose}
                onChangeText={(t) =>
                  (setItems((arr) => arr.map((x) => (x.key === it.key ? { ...x, dose: t } : x))),
                  setItemsEdited(true))
                }
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={c.mutedForeground}
              />
              <Text style={[styles.unitText, { color: c.mutedForeground }]}>{it.unit}/sem</Text>
              <Pressable
                testID={`button-remove-item-${it.key}`}
                accessibilityRole="button"
                onPress={() => setItems((arr) => arr.filter((x) => x.key !== it.key))}
                disabled={items.length === 1}
                style={({ pressed }) => ({ opacity: items.length === 1 ? 0.3 : pressed ? 0.5 : 1 })}
              >
                <Feather name="trash-2" size={16} color={c.destructive} />
              </Pressable>
            </View>
          ))}
          <Pressable
            testID="button-add-item"
            accessibilityRole="button"
            onPress={() =>
              setItems((arr) => [
                ...arr,
                { key: Date.now(), fertilizerId: null, fertilizerName: '', dose: '', unit: 'kg' },
              ])
            }
            style={({ pressed }) => [
              styles.addRow,
              { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="plus" size={15} color={c.foreground} />
            <Text style={[styles.addRowText, { color: c.foreground }]}>Añadir abono</Text>
          </Pressable>
          <PrimaryButton
            testID="button-calculate"
            title={calcMutation.isPending ? 'Calculando…' : 'Calcular mezcla'}
            onPress={handleCalculate}
            disabled={!canCalculate}
            loading={calcMutation.isPending}
          />
          {result ? (
            <PrimaryButton
              testID="button-save-recommendation"
              title={createRecommendationMutation.isPending ? 'Guardando…' : 'Guardar como programa'}
              onPress={handleSaveRecommendation}
              disabled={!canSaveRecommendation}
              loading={createRecommendationMutation.isPending}
            />
          ) : null}
        </Card>

        {result ? (
          <Card style={{ gap: 10 }}>
            <Text style={[styles.cardTitle, { color: c.foreground }]}>Resultado</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.resultValue, { color: c.primary }]}>
                  {formatNumber(result.weeklyWaterM3)} m³
                </Text>
                <Text style={[styles.resultLabel, { color: c.mutedForeground }]}>Agua semanal</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.resultValue, { color: exceedsCe ? c.destructive : c.primary }]}
                  testID="text-estimated-ec"
                >
                  {result.estimatedEcDsM != null ? `${formatNumber(ecToUs(result.estimatedEcDsM))} µS/cm` : '—'}
                </Text>
                <Text style={[styles.resultLabel, { color: c.mutedForeground }]}>CE estimada</Text>
              </View>
            </View>
            {exceedsCe ? <Badge label="Supera la CE máxima" tone="destructive" /> : null}
            {result.stageComparison ? (
              <View style={{ gap: 8 }}>
                <View style={styles.stageRow}>
                  <Text style={[styles.metaText, { color: c.foreground }]}>
                    N: {formatNumber(result.stageComparison.nPerPlantG)} g/planta/sem ({result.stageComparison.nMinG}–{result.stageComparison.nMaxG})
                  </Text>
                    <Badge
                    label={result.stageComparison.nStatus === 'ok' ? 'En rango' : result.stageComparison.nStatus === 'high' ? 'Por encima' : 'Por debajo'}
                    tone={result.stageComparison.nStatus === 'ok' ? 'accent' : 'destructive'}
                  />
                </View>
                <View style={styles.stageRow}>
                  <Text style={[styles.metaText, { color: c.foreground }]}>
                    K₂O: {formatNumber(result.stageComparison.k2oPerPlantG)} g/planta/sem ({result.stageComparison.k2oMinG}–{result.stageComparison.k2oMaxG})
                  </Text>
                    <Badge
                    label={result.stageComparison.k2oStatus === 'ok' ? 'En rango' : result.stageComparison.k2oStatus === 'high' ? 'Por encima' : 'Por debajo'}
                    tone={result.stageComparison.k2oStatus === 'ok' ? 'accent' : 'destructive'}
                  />
                </View>
              </View>
            ) : null}
            {result.waterEcDsM != null ? (
              <Text style={[styles.metaText, { color: c.mutedForeground }]}>
                CE del agua de riego: {formatNumber(ecToUs(result.waterEcDsM))} µS/cm
              </Text>
            ) : null}
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <Text style={[styles.subTitle, { color: c.foreground }]}>Aporte semanal (kg)</Text>
            {NUTRIENT_LABELS.filter(([k]) => (result.nutrients[k] ?? 0) > 0).map(([k, label]) => (
              <View key={k} style={styles.nutrientRow}>
                <Text style={[styles.nutrientName, { color: c.foreground }]}>{label}</Text>
                <Text style={[styles.nutrientValue, { color: c.foreground }]}>
                  {formatNumber(result.nutrients[k])}
                </Text>
              </View>
            ))}
            {(result.compatibilityIssues ?? []).map((w, i) => (
              <View key={`ci-${i}`} style={styles.warningRow}>
                <Feather name="alert-octagon" size={14} color={c.destructive} />
                <Text style={[styles.warningText, { color: c.foreground }]}>{w}</Text>
              </View>
            ))}
            {(result.warnings ?? []).map((w, i) => (
              <View key={`w-${i}`} style={styles.warningRow}>
                <Feather name="alert-triangle" size={14} color="#8a6a08" />
                <Text style={[styles.warningText, { color: c.foreground }]}>{w}</Text>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>

      <Modal
        visible={pickerFor != null}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerFor(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: c.background, paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.cardTitle, { color: c.foreground }]}>Elegir abono</Text>
              <Pressable
                testID="button-close-picker"
                accessibilityRole="button"
                onPress={() => setPickerFor(null)}
              >
                <Feather name="x" size={20} color={c.mutedForeground} />
              </Pressable>
            </View>
            <TextInput
              testID="input-fertilizer-filter"
              style={[styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.card, marginBottom: 8 }]}
              placeholder="Buscar…"
              placeholderTextColor={c.mutedForeground}
              value={pickerFilter}
              onChangeText={setPickerFilter}
            />
            <ScrollView style={{ maxHeight: 380 }}>
              {filteredFerts.map((f) => (
                <Pressable
                  key={f.id}
                  testID={`option-fertilizer-${f.id}`}
                  accessibilityRole="button"
                  onPress={() => {
                    setItems((arr) =>
                      arr.map((x) =>
                        x.key === pickerFor
                          ? { ...x, fertilizerId: f.id, fertilizerName: f.name, unit: unitFor(f) }
                          : x,
                      ),
                    );
                    setPickerFor(null);
                  }}
                  style={({ pressed }) => [
                    styles.fertOption,
                    { borderBottomColor: c.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.fertOptionName, { color: c.foreground }]}>{f.name}</Text>
                  <Text style={[styles.metaText, { color: c.mutedForeground }]}>
                    {f.formulaType === 'liquid' ? 'Líquido' : 'Sólido'}
                    {f.usage ? ` · ${f.usage}` : ''}
                  </Text>
                </Pressable>
              ))}
              {filteredFerts.length === 0 ? (
                <Text style={[styles.metaText, { color: c.mutedForeground, padding: 12 }]}>
                  Sin resultados.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 16, gap: 16, flexGrow: 1 },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  subTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
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
  checkbox: { width: 16, height: 16, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  inlinePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#eee' },
  inlinePillText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  smallInput: { width: 70, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  aiDraftBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10, gap: 6 },
  stageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  fertPicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  fertPickerText: { fontSize: 14, fontFamily: 'Inter_500Medium', flex: 1 },
  doseInput: {
    width: 70,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    textAlign: 'right',
  },
  unitText: { fontSize: 12, fontFamily: 'Inter_400Regular', width: 46 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  addRowText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  resultValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  resultLabel: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  metaText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  divider: { height: StyleSheet.hairlineWidth },
  nutrientRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  nutrientName: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  nutrientValue: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  warningText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  modalSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  fertOption: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  fertOptionName: { fontSize: 14, fontFamily: 'Inter_500Medium' },
});
