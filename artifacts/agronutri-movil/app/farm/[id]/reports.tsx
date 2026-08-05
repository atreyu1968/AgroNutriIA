import React, { useState } from 'react';
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
  getListReportsQueryKey,
  useCreateReport,
  useDeleteReport,
  useGetFarmSummary,
  useListReports,
  type Report,
} from '@workspace/api-client-react';
import { Badge, Card, EmptyState, ErrorView, LoadingView, PrimaryButton } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { downloadAuthedFile } from '@/lib/download';

type ReportKind = 'fertirrigacion' | 'enmiendas_arranque' | 'enmiendas_lluvias';

const KIND_OPTIONS: { key: ReportKind; label: string }[] = [
  { key: 'fertirrigacion', label: 'Fertirrigación' },
  { key: 'enmiendas_arranque', label: 'Enmiendas · arranque' },
  { key: 'enmiendas_lluvias', label: 'Enmiendas · lluvias' },
];

const TYPE_LABEL: Record<string, string> = {
  fertirrigacion: 'Fertirrigación',
  enmiendas: 'Enmiendas',
  plan_fitosanitario: 'Plan fitosanitario',
};

function notify(title: string, msg: string) {
  if (Platform.OS === 'web') window.alert(msg);
  else Alert.alert(title, msg);
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ReportRow({ report, farmId }: { report: Report; farmId: number }) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);

  const deleteMutation = useDeleteReport({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(farmId) }),
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ?? 'No se pudo eliminar el informe.';
        notify('Error', msg);
      },
    },
  });

  const handleDownload = async () => {
    if (!report.downloadUrl) return;
    setDownloading(true);
    try {
      await downloadAuthedFile(report.downloadUrl, `${report.title}.${report.format}`);
    } catch (err) {
      notify('Error', err instanceof Error ? err.message : 'No se pudo descargar el informe.');
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = () => {
    const doDelete = () => deleteMutation.mutate({ farmId, reportId: report.id });
    if (Platform.OS === 'web') {
      if (window.confirm('¿Eliminar este informe?')) doDelete();
    } else {
      Alert.alert('¿Eliminar informe?', report.title, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  return (
    <Card style={{ gap: 8 }}>
      <Text style={[styles.reportTitle, { color: c.foreground }]} numberOfLines={2}>
        {report.title}
      </Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Badge label={TYPE_LABEL[report.reportType ?? 'fertirrigacion'] ?? report.reportType ?? ''} />
        <Badge label={report.format.toUpperCase()} />
        <Badge label={formatDate(report.createdAt)} />
        {report.status === 'generating' ? (
          <Badge label="Generando…" tone="warning" />
        ) : report.status === 'error' ? (
          <Badge label="Error" tone="destructive" />
        ) : null}
      </View>
      {report.createdByName ? (
        <Text style={[styles.metaText, { color: c.mutedForeground }]}>
          Creado por {report.createdByName}
        </Text>
      ) : null}
      {(report.warnings ?? []).map((w, i) => (
        <View key={i} style={styles.warningRow}>
          <Feather name="alert-triangle" size={13} color="#8a6a08" />
          <Text style={[styles.warningText, { color: c.foreground }]}>{w}</Text>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        {report.status === 'ready' && report.downloadUrl ? (
          <Pressable
            testID={`button-download-report-${report.id}`}
            accessibilityRole="button"
            disabled={downloading}
            onPress={handleDownload}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: c.primaryTint, opacity: downloading ? 0.5 : pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="download" size={15} color={c.primary} />
            <Text style={[styles.actionBtnText, { color: c.primary }]}>
              {downloading ? 'Descargando…' : 'Descargar'}
            </Text>
          </Pressable>
        ) : null}
        {report.status !== 'generating' ? (
          <Pressable
            testID={`button-delete-report-${report.id}`}
            accessibilityRole="button"
            disabled={deleteMutation.isPending}
            onPress={handleDelete}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: c.muted, opacity: deleteMutation.isPending ? 0.5 : pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="trash-2" size={15} color={c.destructive} />
            <Text style={[styles.actionBtnText, { color: c.destructive }]}>Eliminar</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

export default function ReportsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmId = parseInt(id ?? '', 10);
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ReportKind>('fertirrigacion');

  const summaryQuery = useGetFarmSummary(farmId, {
    query: { queryKey: getGetFarmSummaryQueryKey(farmId), enabled: !Number.isNaN(farmId) },
  });
  const myRole = summaryQuery.data?.farm?.myRole;
  const canEdit = myRole === 'owner' || myRole === 'technician';

  const reportsQuery = useListReports(farmId, {
    query: {
      queryKey: getListReportsQueryKey(farmId),
      enabled: !Number.isNaN(farmId),
      // Mientras haya informes generándose, refresca la lista periódicamente.
      refetchInterval: (query) =>
        (query.state.data ?? []).some((r) => r.status === 'generating') ? 4000 : false,
    },
  });

  const createMutation = useCreateReport({
    mutation: {
      onSuccess: () => {
        setTitle('');
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(farmId) });
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ??
          'No se pudo iniciar la generación del informe.';
        notify('Error', msg);
      },
    },
  });

  const handleCreate = () => {
    createMutation.mutate({
      farmId,
      data: {
        format: 'pdf',
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(kind === 'fertirrigacion'
          ? { reportType: 'fertirrigacion' as const }
          : {
              reportType: 'enmiendas' as const,
              scenario: kind === 'enmiendas_arranque' ? ('arranque_siembra' as const) : ('lluvias' as const),
            }),
      },
    });
  };

  const reports = reportsQuery.data ?? [];

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
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Informes</Text>
          <Text style={[styles.headerSub, { color: c.mutedForeground }]} numberOfLines={1}>
            {summaryQuery.data?.farm?.name ?? ''}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={
          <RefreshControl
            refreshing={reportsQuery.isRefetching}
            onRefresh={() => reportsQuery.refetch()}
            tintColor={c.primary}
          />
        }
      >
        {canEdit ? (
          <Card style={{ gap: 10 }}>
            <Text style={[styles.cardTitle, { color: c.foreground }]}>Generar informe PDF</Text>
            <TextInput
              testID="input-report-title"
              style={[styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
              placeholder="Título (opcional)"
              placeholderTextColor={c.mutedForeground}
              value={title}
              onChangeText={setTitle}
            />
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {KIND_OPTIONS.map((o) => (
                <Pressable
                  key={o.key}
                  testID={`chip-report-${o.key}`}
                  accessibilityRole="button"
                  onPress={() => setKind(o.key)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: kind === o.key ? c.primaryTint : c.muted,
                      borderColor: kind === o.key ? c.primary : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: kind === o.key ? c.primary : c.mutedForeground },
                    ]}
                  >
                    {o.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <PrimaryButton
              testID="button-generate-report"
              title={createMutation.isPending ? 'Iniciando…' : 'Generar informe'}
              onPress={handleCreate}
              disabled={createMutation.isPending}
              loading={createMutation.isPending}
            />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              El informe usa el programa vigente, la mezcla de agua y las últimas analíticas de la finca.
            </Text>
          </Card>
        ) : null}

        {reportsQuery.isLoading ? (
          <LoadingView label="Cargando informes…" />
        ) : reportsQuery.isError ? (
          <ErrorView onRetry={() => reportsQuery.refetch()} />
        ) : reports.length === 0 ? (
          <EmptyState
            icon="file-text"
            title="Sin informes"
            subtitle="Esta finca aún no tiene informes generados."
          />
        ) : (
          <View style={{ gap: 12 }}>
            {reports.map((r) => (
              <ReportRow key={r.id} report={r} farmId={farmId} />
            ))}
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
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
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
  reportTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  metaText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  warningText: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
