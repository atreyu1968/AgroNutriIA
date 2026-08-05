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
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFarmSummaryQueryKey,
  getListFarmsQueryKey,
  useDeleteFarm,
  getListAnalysesQueryKey,
  getListRecommendationsQueryKey,
  useGetFarmSummary,
  useListAnalyses,
  useListRecommendations,
  getListWaterSourcesQueryKey,
  useListWaterSources,
  useSetWaterSources,
  type Analysis,
  type Recommendation,
  type WaterSource,
  type WaterSourceInput,
} from '@workspace/api-client-react';
import { Badge, Card, EmptyState, ErrorView, LoadingView } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

type Segment = 'resumen' | 'programa' | 'analiticas';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  pending_review: 'Pendiente de revisión',
  validated: 'Validado',
  applying: 'En aplicación',
  finished: 'Finalizado',
  rejected: 'Rechazado',
};

const STATUS_TONE: Record<string, 'primary' | 'accent' | 'muted' | 'destructive' | 'warning'> = {
  draft: 'muted',
  pending_review: 'warning',
  validated: 'primary',
  applying: 'accent',
  finished: 'muted',
  rejected: 'destructive',
};

const ANALYSIS_LABEL: Record<string, string> = {
  soil: 'Suelo',
  leaf: 'Foliar',
  water: 'Agua',
};

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: c.foreground }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function RecommendationCard({ rec, expanded, onToggle }: { rec: Recommendation; expanded: boolean; onToggle: () => void }) {
  const c = useColors();
  const exceedsCe = rec.warnings?.[0]?.startsWith('SUPERA LA CE MÁXIMA') ?? false;
  const otherWarnings = exceedsCe ? (rec.warnings ?? []).slice(1) : (rec.warnings ?? []);
  return (
    <Card style={{ gap: 0, overflow: 'hidden' }}>
      {exceedsCe && (
        <View style={styles.ceBanner} testID={`banner-ce-exceeded-${rec.id}`}>
          <Feather name="alert-triangle" size={14} color="#b91c1c" />
          <Text style={styles.ceBannerText} numberOfLines={2}>{rec.warnings![0]}</Text>
        </View>
      )}
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        testID={`rec-toggle-${rec.id}`}
        style={[styles.recHeader, { paddingTop: exceedsCe ? 8 : 0 }]}
      >
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.recTitle, { color: c.foreground }]} numberOfLines={2}>
            {rec.title || `Programa #${rec.id}`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={STATUS_LABEL[rec.status] ?? rec.status} tone={STATUS_TONE[rec.status] ?? 'muted'} />
            {rec.source === 'ai' ? <Badge label="IA" tone="accent" /> : null}
            {exceedsCe ? <Badge label="CE máxima" tone="destructive" /> : null}
            <Badge label={formatDate(rec.createdAt)} />
          </View>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={c.mutedForeground} />
      </Pressable>

      {expanded ? (
        <View style={{ gap: 10, paddingBottom: 4 }}>
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          {rec.items.map((item, idx) => (
            <View key={idx} style={[styles.doseRow, { paddingHorizontal: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.doseName, { color: c.foreground }]}>{item.fertilizerName}</Text>
                {item.reason ? (
                  <Text style={[styles.doseReason, { color: c.mutedForeground }]}>{item.reason}</Text>
                ) : null}
              </View>
              <Text style={[styles.doseValue, { color: c.primary }]}>
                {item.weeklyDose} {item.unit}/sem
              </Text>
            </View>
          ))}
          {rec.estimatedEcDsM != null || rec.estimatedWeeklyNKg != null ? (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {rec.estimatedEcDsM != null ? (
                <Badge label={`CE est. ${Math.round(rec.estimatedEcDsM * 1000)} µS/cm`} tone={exceedsCe ? 'destructive' : undefined} />
              ) : null}
              {rec.estimatedWeeklyNKg != null ? <Badge label={`N sem. ${rec.estimatedWeeklyNKg} kg`} /> : null}
            </View>
          ) : null}
          {rec.stageComparison ? (
            <View style={{ gap: 6 }} testID={`rec-stage-comparison-${rec.id}`}>
              <Text style={[styles.stageTitle, { color: c.foreground }]}>
                Fase fenológica: {rec.stageComparison.stageLabel}{' '}
                <Text style={[styles.stageSource, { color: c.mutedForeground }]}>
                  {rec.stageComparison.rangeSource === 'tecnico'
                    ? '(rangos modulados por el técnico)'
                    : '(rangos orientativos)'}
                </Text>
              </Text>
              {(
                [
                  ['N', rec.stageComparison.nPerPlantG, rec.stageComparison.nMinG, rec.stageComparison.nMaxG, rec.stageComparison.nStatus],
                  ['K₂O', rec.stageComparison.k2oPerPlantG, rec.stageComparison.k2oMinG, rec.stageComparison.k2oMaxG, rec.stageComparison.k2oStatus],
                ] as const
              ).map(([label, v, lo, hi, status]) => (
                <View key={label} style={styles.doseRow}>
                  <Text style={[styles.doseName, { color: c.foreground, flex: 1 }]}>
                    {label}: {v} g/planta/sem ({lo}–{hi})
                  </Text>
                  <Badge
                    label={status === 'ok' ? 'En rango' : status === 'high' ? 'Por encima' : 'Por debajo'}
                    tone={status === 'ok' ? 'primary' : 'destructive'}
                  />
                </View>
              ))}
            </View>
          ) : null}
          {otherWarnings.length > 0 ? (
            <View style={{ gap: 4 }}>
              {otherWarnings.map((w, i) => (
                <View key={i} style={styles.warningRow}>
                  <Feather name="alert-triangle" size={14} color="#8a6a08" />
                  <Text style={[styles.warningText, { color: c.foreground }]}>{w}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {rec.rationale ? (
            <Text style={[styles.rationale, { color: c.mutedForeground }]}>{rec.rationale}</Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function WaterMixCard({
  farmId,
  sources,
  canEdit,
}: {
  farmId: number;
  sources: WaterSource[];
  canEdit: boolean;
}) {
  const c = useColors();
  const queryClient = useQueryClient();

  // editing state: sourceId → sharePct
  const [mixEdit, setMixEdit] = useState<Record<number, number>>({});
  const [newSourceName, setNewSourceName] = useState('');

  useEffect(() => {
    setMixEdit(Object.fromEntries(sources.map((s) => [s.id, s.sharePct])));
  }, [sources]);

  const mixTotal = Object.values(mixEdit).reduce((a, b) => a + (b || 0), 0);
  const totalError = mixTotal > 0 && Math.abs(mixTotal - 100) > 0.5;

  const saveMutation = useSetWaterSources({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWaterSourcesQueryKey(farmId) });
        const msg = 'Fuentes de agua guardadas.';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Guardado', msg);
      },
      onError: (err: unknown) => {
        const anyErr = err as { data?: { error?: string } };
        const msg = anyErr?.data?.error ?? 'Revisa los porcentajes e inténtalo de nuevo.';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('No se pudo guardar', msg);
      },
    },
  });

  const currentPayload = (): WaterSourceInput[] =>
    sources.map((s) => ({ id: s.id, name: s.name, sharePct: mixEdit[s.id] ?? s.sharePct }));

  const handleDelete = (sourceId: number) => {
    const payload = currentPayload().filter((x) => x.id !== sourceId);
    const doDelete = () => saveMutation.mutate({ farmId, data: payload });
    if (Platform.OS === 'web') {
      if (window.confirm('¿Eliminar esta fuente?')) doDelete();
    } else {
      Alert.alert('¿Eliminar fuente?', 'Se quitará del reparto de riego.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const handleAddSource = () => {
    const name = newSourceName.trim();
    if (!name) return;
    saveMutation.mutate({
      farmId,
      data: [...currentPayload(), { name, sharePct: 0 }],
    });
    setNewSourceName('');
  };

  const handleSave = () => {
    if (totalError) {
      const msg = `El reparto suma ${mixTotal.toFixed(1)} % y debe sumar exactamente 100 %.`;
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Reparto incorrecto', msg);
      return;
    }
    saveMutation.mutate({ farmId, data: currentPayload() });
  };

  const warnings: string[] = [];
  if (!canEdit && Math.abs(mixTotal - 100) > 0.5 && sources.length > 0) {
    warnings.push(`El reparto suma ${mixTotal} % y debería sumar 100 %.`);
  }
  for (const s of sources) {
    if (s.sharePct > 0 && !s.latestAnalysisDate) {
      warnings.push(`La fuente "${s.name}" no tiene analítica de agua asociada.`);
    }
  }

  return (
    <Card style={{ gap: 8 }}>
      <Text style={[styles.cardTitle, { color: c.foreground }]}>Mezcla de agua de riego</Text>

      {sources.length === 0 && !canEdit ? (
        <Text style={[styles.doseReason, { color: c.mutedForeground }]}>
          Sin fuentes definidas: se usa la analítica de agua más reciente de la finca.
        </Text>
      ) : null}

      {sources.map((s) => (
        <View key={s.id} testID={`water-source-${s.id}`} style={{ gap: 4 }}>
          <View style={styles.doseRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.doseName, { color: c.foreground }]}>{s.name}</Text>
              <Text style={[styles.doseReason, { color: c.mutedForeground }]}>
                {s.latestAnalysisDate
                  ? `Analítica: ${formatDate(s.latestAnalysisDate)}`
                  : 'Sin analítica de agua'}
              </Text>
            </View>
            {canEdit ? (
              <View style={styles.pctInputRow}>
                <TextInput
                  testID={`input-source-pct-${s.id}`}
                  style={[styles.pctInput, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
                  value={String(mixEdit[s.id] ?? s.sharePct)}
                  onChangeText={(t) => {
                    const v = parseFloat(t.replace(',', '.'));
                    setMixEdit((m) => ({ ...m, [s.id]: Number.isNaN(v) ? 0 : v }));
                  }}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  maxLength={6}
                />
                <Text style={[styles.doseReason, { color: c.mutedForeground }]}>%</Text>
                <Pressable
                  testID={`button-delete-source-${s.id}`}
                  accessibilityRole="button"
                  disabled={saveMutation.isPending}
                  onPress={() => handleDelete(s.id)}
                  style={({ pressed }) => ({ opacity: pressed || saveMutation.isPending ? 0.5 : 1 })}
                >
                  <Feather name="trash-2" size={16} color={c.destructive} />
                </Pressable>
              </View>
            ) : (
              <Text style={[styles.doseValue, { color: c.primary }]}>{s.sharePct} %</Text>
            )}
          </View>
        </View>
      ))}

      {canEdit && sources.length > 0 ? (
        <Text style={[styles.doseReason, { color: totalError ? c.destructive : c.mutedForeground }]}>
          {`Reparto total: ${mixTotal.toFixed(1)} %`}
          {totalError ? '  (debe sumar 100 %)' : ''}
        </Text>
      ) : null}

      {canEdit ? (
        <View style={{ gap: 8 }}>
          <View style={styles.addSourceRow}>
            <TextInput
              testID="input-new-source"
              style={[styles.addSourceInput, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
              placeholder="Nueva fuente (pozo, desaladora…)"
              placeholderTextColor={c.mutedForeground}
              value={newSourceName}
              onChangeText={setNewSourceName}
              returnKeyType="done"
              onSubmitEditing={handleAddSource}
            />
            <Pressable
              testID="button-add-source"
              accessibilityRole="button"
              disabled={!newSourceName.trim() || saveMutation.isPending}
              onPress={handleAddSource}
              style={({ pressed }) => [
                styles.addBtn,
                { backgroundColor: c.muted, opacity: !newSourceName.trim() || saveMutation.isPending ? 0.5 : pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="plus" size={16} color={c.foreground} />
              <Text style={[styles.addBtnText, { color: c.foreground }]}>Añadir</Text>
            </Pressable>
          </View>

          {sources.length > 0 ? (
            <Pressable
              testID="button-save-sources"
              accessibilityRole="button"
              disabled={saveMutation.isPending}
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: c.primary, opacity: saveMutation.isPending ? 0.6 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {saveMutation.isPending ? 'Guardando…' : 'Guardar reparto'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Text style={[styles.doseReason, { color: c.mutedForeground }]}>
        El cálculo, la IA y los informes usan la mezcla ponderada de estas fuentes.
      </Text>

      {warnings.length > 0 ? (
        <View style={{ gap: 4 }}>
          {warnings.map((w, i) => (
            <View key={i} style={styles.warningRow}>
              <Feather name="alert-triangle" size={14} color="#8a6a08" />
              <Text style={[styles.warningText, { color: c.foreground }]}>{w}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function AnalysisCard({ analysis, waterSourceName }: { analysis: Analysis; waterSourceName?: string | null }) {
  const c = useColors();
  const [expanded, setExpanded] = useState(false);
  const abnormal = analysis.parameters.filter(
    (p) => p.status && p.status !== 'normal',
  ).length;
  return (
    <Card style={{ gap: 10 }}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        testID={`analysis-toggle-${analysis.id}`}
        style={styles.recHeader}
      >
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.recTitle, { color: c.foreground }]}>
            {ANALYSIS_LABEL[analysis.type] ?? analysis.type}
            {waterSourceName ? ` · ${waterSourceName}` : ''}
            {analysis.laboratory ? ` · ${analysis.laboratory}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={formatDate(analysis.sampleDate)} />
            <Badge label={`${analysis.parameters.length} parámetros`} />
            {abnormal > 0 ? <Badge label={`${abnormal} fuera de rango`} tone="warning" /> : null}
          </View>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={c.mutedForeground} />
      </Pressable>
      {expanded ? (
        <View style={{ gap: 6 }}>
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          {analysis.parameters.map((p, i) => (
            <View key={i} style={styles.doseRow}>
              <Text style={[styles.doseName, { color: c.foreground, flex: 1 }]}>{p.name}</Text>
              <Text
                style={[
                  styles.doseValue,
                  {
                    color:
                      p.status && p.status !== 'normal' ? c.accent : c.foreground,
                  },
                ]}
              >
                {p.value}
                {p.unit ? ` ${p.unit}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export default function FarmDetailScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmId = parseInt(id ?? '', 10);

  const [segment, setSegment] = useState<Segment>('resumen');
  const [expandedRec, setExpandedRec] = useState<number | null>(null);

  const summaryQuery = useGetFarmSummary(farmId, {
    query: { queryKey: getGetFarmSummaryQueryKey(farmId), enabled: !Number.isNaN(farmId) },
  });
  const recsQuery = useListRecommendations(farmId, {
    query: {
      queryKey: getListRecommendationsQueryKey(farmId),
      enabled: !Number.isNaN(farmId) && segment === 'programa',
    },
  });
  const analysesQuery = useListAnalyses(farmId, {
    query: {
      queryKey: getListAnalysesQueryKey(farmId),
      enabled: !Number.isNaN(farmId) && segment === 'analiticas',
    },
  });
  const waterSourcesQuery = useListWaterSources(farmId, {
    query: { queryKey: getListWaterSourcesQueryKey(farmId), enabled: !Number.isNaN(farmId) },
  });
  const waterSources = waterSourcesQuery.data ?? [];
  const waterSourceName = (id: number | null | undefined) =>
    id == null ? null : waterSources.find((s) => s.id === id)?.name ?? `Fuente ${id}`;

  const queryClient = useQueryClient();
  const deleteFarm = useDeleteFarm();

  const topInset = insets.top;
  const bottomInset = insets.bottom;

  const summary = summaryQuery.data;
  const farm = summary?.farm;
  const active = summary?.activeRecommendation ?? null;
  const canEdit = farm?.myRole === 'owner' || farm?.myRole === 'technician';
  const canDelete = farm?.myRole === 'owner';

  const confirmDelete = () => {
    const doDelete = () => {
      deleteFarm.mutate(
        { farmId },
        {
          onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: getListFarmsQueryKey() });
            router.back();
          },
          onError: () => {
            const msg = 'No se pudo eliminar la finca.';
            if (Platform.OS === 'web') window.alert(msg);
            else Alert.alert('Error', msg);
          },
        },
      );
    };
    const title = '¿Eliminar finca?';
    const body = `Se eliminará "${farm?.name}" con sus sectores, analíticas y programas. Esta acción no se puede deshacer.`;
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${body}`)) doDelete();
    } else {
      Alert.alert(title, body, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const segments: { key: Segment; label: string }[] = [
    { key: 'resumen', label: 'Resumen' },
    { key: 'programa', label: 'Programa' },
    { key: 'analiticas', label: 'Analíticas' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
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
            {farm?.name ?? 'Finca'}
          </Text>
          <Text style={[styles.headerSub, { color: c.mutedForeground }]} numberOfLines={1}>
            {[farm?.municipality, farm?.island].filter(Boolean).join(', ') || ' '}
          </Text>
        </View>
        {canEdit ? (
          <Pressable
            testID="button-edit-farm"
            accessibilityRole="button"
            onPress={() => router.push(`/farm/form?id=${farmId}`)}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="edit-2" size={17} color={c.foreground} />
          </Pressable>
        ) : null}
        {canDelete ? (
          <Pressable
            testID="button-delete-farm"
            accessibilityRole="button"
            onPress={confirmDelete}
            disabled={deleteFarm.isPending}
            style={({ pressed }) => [
              styles.iconButton,
              {
                backgroundColor: c.muted,
                opacity: deleteFarm.isPending ? 0.5 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="trash-2" size={17} color={c.destructive} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickActions}
        style={{ flexGrow: 0 }}
      >
        {(
          [
            { key: 'chat', label: 'Chat técnico', icon: 'message-circle', route: `/farm/${farmId}/chat`, primary: true },
            { key: 'phyto', label: 'Fitosanitarios', icon: 'shield', route: `/farm/${farmId}/phyto` },
            { key: 'calculator', label: 'Calculadora', icon: 'sliders', route: `/farm/${farmId}/calculator` },
            { key: 'reports', label: 'Informes', icon: 'file-text', route: `/farm/${farmId}/reports` },
          ] as const
        ).map((a) => (
          <Pressable
            key={a.key}
            testID={`quick-action-${a.key}`}
            accessibilityRole="button"
            onPress={() => router.push(a.route)}
            style={({ pressed }) => [
              styles.quickAction,
              {
                backgroundColor: 'primary' in a && a.primary ? c.primary : c.muted,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Feather
              name={a.icon}
              size={15}
              color={'primary' in a && a.primary ? c.primaryForeground : c.foreground}
            />
            <Text
              style={[
                styles.quickActionText,
                { color: 'primary' in a && a.primary ? c.primaryForeground : c.foreground },
              ]}
            >
              {a.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

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
            style={[
              styles.segment,
              segment === s.key && { backgroundColor: c.card },
            ]}
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
        refreshControl={
          <RefreshControl
            refreshing={summaryQuery.isRefetching}
            onRefresh={() => {
              summaryQuery.refetch();
              waterSourcesQuery.refetch();
              if (segment === 'programa') recsQuery.refetch();
              if (segment === 'analiticas') analysesQuery.refetch();
            }}
            tintColor={c.primary}
          />
        }
      >
        {segment === 'resumen' ? (
          summaryQuery.isLoading ? (
            <LoadingView label="Cargando resumen…" />
          ) : summaryQuery.isError || !summary ? (
            <ErrorView onRetry={() => summaryQuery.refetch()} />
          ) : (
            <View style={{ gap: 12 }}>
              {summary.alerts && summary.alerts.length > 0 ? (
                <Card style={{ gap: 8, borderColor: '#e8d9a0' }}>
                  {summary.alerts.map((a, i) => (
                    <View key={i} style={styles.warningRow}>
                      <Feather name="alert-triangle" size={14} color="#8a6a08" />
                      <Text style={[styles.warningText, { color: c.foreground }]}>{a}</Text>
                    </View>
                  ))}
                </Card>
              ) : null}

              <Card style={{ gap: 4 }}>
                <Text style={[styles.cardTitle, { color: c.foreground }]}>Datos de la finca</Text>
                <InfoRow label="Cultivo" value={farm?.mainCrop ?? '—'} />
                {farm?.variety ? <InfoRow label="Variedad" value={farm.variety} /> : null}
                <InfoRow
                  label="Superficie"
                  value={farm?.surfaceHa != null ? `${farm.surfaceHa} ha` : '—'}
                />
                <InfoRow
                  label="Plantas"
                  value={farm?.plantCount != null ? String(farm.plantCount) : '—'}
                />
                {farm?.phenologicalStage ? (
                  <InfoRow label="Estado fenológico" value={farm.phenologicalStage} />
                ) : null}
                {summary.weeklyWaterM3 != null ? (
                  <InfoRow label="Agua semanal" value={`${summary.weeklyWaterM3} m³`} />
                ) : null}
                {farm?.responsibleTechnician ? (
                  <InfoRow label="Técnico" value={farm.responsibleTechnician} />
                ) : null}
                {farm?.contactName ? (
                  <InfoRow label="Contacto" value={farm.contactName} />
                ) : null}
                {farm?.contactPhone ? (
                  <InfoRow label="Teléfono" value={farm.contactPhone} />
                ) : null}
                {farm?.contactEmail ? (
                  <InfoRow label="Email" value={farm.contactEmail} />
                ) : null}
              </Card>

              <Card style={{ gap: 8 }}>
                <Text style={[styles.cardTitle, { color: c.foreground }]}>Programa vigente</Text>
                {active ? (
                  <RecommendationCard
                    rec={active}
                    expanded={expandedRec === active.id}
                    onToggle={() =>
                      setExpandedRec(expandedRec === active.id ? null : active.id)
                    }
                  />
                ) : (
                  <Text style={[styles.mutedNote, { color: c.mutedForeground }]}>
                    No hay ningún programa de abonado activo.
                  </Text>
                )}
              </Card>

              {waterSources.length > 0 || canEdit ? (
                <WaterMixCard farmId={farmId} sources={waterSources} canEdit={canEdit} />
              ) : null}

              <Card style={{ gap: 4 }}>
                <Text style={[styles.cardTitle, { color: c.foreground }]}>Últimas analíticas</Text>
                <InfoRow
                  label="Suelo"
                  value={
                    summary.latestSoilAnalysis
                      ? formatDate(summary.latestSoilAnalysis.sampleDate)
                      : 'Sin datos'
                  }
                />
                <InfoRow
                  label="Foliar"
                  value={
                    summary.latestLeafAnalysis
                      ? formatDate(summary.latestLeafAnalysis.sampleDate)
                      : 'Sin datos'
                  }
                />
                <InfoRow
                  label="Agua"
                  value={
                    waterSources.length > 0
                      ? `Mezcla de ${waterSources.length} ${waterSources.length === 1 ? 'fuente' : 'fuentes'}`
                      : summary.latestWaterAnalysis
                        ? formatDate(summary.latestWaterAnalysis.sampleDate)
                        : 'Sin datos'
                  }
                />
              </Card>
            </View>
          )
        ) : segment === 'programa' ? (
          recsQuery.isLoading ? (
            <LoadingView label="Cargando programas…" />
          ) : recsQuery.isError ? (
            <ErrorView onRetry={() => recsQuery.refetch()} />
          ) : (recsQuery.data ?? []).length === 0 ? (
            <EmptyState
              icon="clipboard"
              title="Sin programas"
              subtitle="Esta finca aún no tiene programas de abonado."
            />
          ) : (
            <View style={{ gap: 12 }}>
              {(recsQuery.data ?? []).map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  expanded={expandedRec === rec.id}
                  onToggle={() => setExpandedRec(expandedRec === rec.id ? null : rec.id)}
                />
              ))}
            </View>
          )
        ) : (
          <View style={{ gap: 12 }}>
            {canEdit ? (
              <Pressable
                testID="button-new-analysis"
                accessibilityRole="button"
                onPress={() => router.push(`/farm/${farmId}/analysis-form`)}
                style={({ pressed }) => [
                  styles.saveBtn,
                  { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                  Registrar analítica
                </Text>
              </Pressable>
            ) : null}
            {analysesQuery.isLoading ? (
              <LoadingView label="Cargando analíticas…" />
            ) : analysesQuery.isError ? (
              <ErrorView onRetry={() => analysesQuery.refetch()} />
            ) : (analysesQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon="droplet"
                title="Sin analíticas"
                subtitle="Esta finca aún no tiene analíticas registradas."
              />
            ) : (
              (analysesQuery.data ?? []).map((a) => (
                <AnalysisCard
                  key={a.id}
                  analysis={a}
                  waterSourceName={a.type === 'water' ? waterSourceName(a.waterSourceId) : null}
                />
              ))
            )}
          </View>
        )}
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
  quickActions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
  },
  quickActionText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
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
    marginBottom: 4,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    gap: 12,
  },
  infoLabel: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  infoValue: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    flexShrink: 1,
    textAlign: 'right',
  },
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  doseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stageTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  stageSource: {
    fontSize: 11,
    fontWeight: '400',
  },
  doseName: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  doseReason: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  doseValue: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  warningText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },
  pctInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pctInput: {
    width: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    textAlign: 'right',
  },
  addSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addSourceInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  saveBtn: {
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  rationale: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    fontStyle: 'italic',
  },
  mutedNote: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  ceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(185,28,28,0.08)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(185,28,28,0.3)',
  },
  ceBannerText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#b91c1c',
    flex: 1,
  },
});
