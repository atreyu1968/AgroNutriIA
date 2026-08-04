import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFarmQueryKey,
  getGetFarmSummaryQueryKey,
  getListFarmsQueryKey,
  useCreateFarm,
  useGetFarm,
  useUpdateFarm,
  type FarmInput,
} from '@workspace/api-client-react';
import { Card, ErrorView, LoadingView, PrimaryButton } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

type FormState = {
  name: string;
  companyName: string;
  island: string;
  municipality: string;
  surfaceHa: string;
  mainCrop: string;
  variety: string;
  plantCount: string;
  phenologicalStage: string;
  soilType: string;
  weeklyLitresPerPlant: string;
  maxEcDsM: string;
  responsibleTechnician: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  managementNotes: string;
  foliarAllowed: boolean;
  hasDrainage: boolean;
};

const EMPTY: FormState = {
  name: '',
  companyName: '',
  island: '',
  municipality: '',
  surfaceHa: '',
  mainCrop: '',
  variety: '',
  plantCount: '',
  phenologicalStage: '',
  soilType: '',
  weeklyLitresPerPlant: '',
  maxEcDsM: '',
  responsibleTechnician: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  managementNotes: '',
  foliarAllowed: true,
  hasDrainage: false,
};

function parseNum(v: string): number | undefined {
  const t = v.replace(',', '.').trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function parseInteger(v: string): number | undefined {
  const n = parseNum(v);
  return n == null ? undefined : Math.round(n);
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
          {
            backgroundColor: c.card,
            borderColor: c.border,
            color: c.foreground,
          },
        ]}
      />
    </View>
  );
}

export default function FarmFormScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const farmId = id ? parseInt(id, 10) : null;
  const isEdit = farmId != null && !Number.isNaN(farmId);

  const farmQuery = useGetFarm(farmId ?? 0, {
    query: { queryKey: getGetFarmQueryKey(farmId ?? 0), enabled: isEdit },
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loadedFromFarm, setLoadedFromFarm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const farm = farmQuery.data;
    if (isEdit && farm && !loadedFromFarm) {
      setForm({
        name: farm.name ?? '',
        companyName: farm.companyName ?? '',
        island: farm.island ?? '',
        municipality: farm.municipality ?? '',
        surfaceHa: farm.surfaceHa != null ? String(farm.surfaceHa) : '',
        mainCrop: farm.mainCrop ?? '',
        variety: farm.variety ?? '',
        plantCount: farm.plantCount != null ? String(farm.plantCount) : '',
        phenologicalStage: farm.phenologicalStage ?? '',
        soilType: farm.soilType ?? '',
        weeklyLitresPerPlant:
          farm.weeklyLitresPerPlant != null ? String(farm.weeklyLitresPerPlant) : '',
        maxEcDsM:
          farm.maxEcDsM != null
            ? String(Math.round(farm.maxEcDsM > 10 ? farm.maxEcDsM : farm.maxEcDsM * 1000))
            : '',
        responsibleTechnician: farm.responsibleTechnician ?? '',
        contactName: farm.contactName ?? '',
        contactPhone: farm.contactPhone ?? '',
        contactEmail: farm.contactEmail ?? '',
        managementNotes: farm.managementNotes ?? '',
        foliarAllowed: farm.foliarAllowed ?? true,
        hasDrainage: farm.hasDrainage ?? false,
      });
      setLoadedFromFarm(true);
    }
  }, [isEdit, farmQuery.data, loadedFromFarm]);

  const createFarm = useCreateFarm();
  const updateFarm = useUpdateFarm();
  const saving = createFarm.isPending || updateFarm.isPending;

  const set = (key: keyof FormState) => (value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const buildPayload = (): FarmInput => ({
    name: form.name.trim(),
    companyName: form.companyName.trim() || undefined,
    island: form.island.trim() || undefined,
    municipality: form.municipality.trim() || undefined,
    surfaceHa: parseNum(form.surfaceHa),
    mainCrop: form.mainCrop.trim() || undefined,
    variety: form.variety.trim() || undefined,
    plantCount: parseInteger(form.plantCount),
    phenologicalStage: form.phenologicalStage.trim() || undefined,
    soilType: form.soilType.trim() || undefined,
    weeklyLitresPerPlant: parseNum(form.weeklyLitresPerPlant),
    // La CE se teclea en µS/cm; la API trabaja en dS/m (valores ≤10 se asumen ya en dS/m).
    maxEcDsM: (() => {
      const v = parseNum(form.maxEcDsM);
      return v != null && v > 10 ? v / 1000 : v;
    })(),
    responsibleTechnician: form.responsibleTechnician.trim() || undefined,
    contactName: form.contactName.trim() || undefined,
    contactPhone: form.contactPhone.trim() || undefined,
    contactEmail: form.contactEmail.trim() || undefined,
    managementNotes: form.managementNotes.trim() || undefined,
    foliarAllowed: form.foliarAllowed,
    hasDrainage: form.hasDrainage,
  });

  const handleSave = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('El nombre de la finca es obligatorio.');
      return;
    }
    try {
      const data = buildPayload();
      if (isEdit && farmId != null) {
        await updateFarm.mutateAsync({ farmId, data });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListFarmsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetFarmQueryKey(farmId) }),
          queryClient.invalidateQueries({ queryKey: getGetFarmSummaryQueryKey(farmId) }),
        ]);
        router.back();
      } else {
        const farm = await createFarm.mutateAsync({ data });
        await queryClient.invalidateQueries({ queryKey: getListFarmsQueryKey() });
        router.replace(`/farm/${farm.id}`);
      }
    } catch (e: any) {
      const msg =
        e?.data?.error || e?.message || 'No se pudo guardar la finca. Inténtalo de nuevo.';
      setError(typeof msg === 'string' ? msg : 'No se pudo guardar la finca.');
      if (Platform.OS !== 'web') Alert.alert('Error', String(msg));
    }
  };

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  if (isEdit && farmQuery.isLoading) return <LoadingView label="Cargando finca…" />;
  if (isEdit && farmQuery.isError)
    return <ErrorView onRetry={() => farmQuery.refetch()} />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: c.border }]}>
        <Pressable
          testID="button-back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: c.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="arrow-left" size={18} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>
          {isEdit ? 'Editar finca' : 'Nueva finca'}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: bottomInset + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={{ gap: 14 }}>
          <Field
            label="Nombre *"
            value={form.name}
            onChange={set('name')}
            placeholder="Ej. Bajo Cuadras"
            testID="input-farm-name"
          />
          <Field
            label="Empresa"
            value={form.companyName}
            onChange={set('companyName')}
            placeholder="Ej. AGROSABINA SL"
            testID="input-farm-company"
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field label="Isla" value={form.island} onChange={set('island')} placeholder="Tenerife" />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Municipio"
                value={form.municipality}
                onChange={set('municipality')}
                placeholder="Buenavista"
              />
            </View>
          </View>
        </Card>

        <Card style={{ gap: 14 }}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Cultivo</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field label="Cultivo" value={form.mainCrop} onChange={set('mainCrop')} placeholder="Platanera" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Variedad" value={form.variety} onChange={set('variety')} placeholder="Pequeña enana" />
            </View>
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                label="Superficie (ha)"
                value={form.surfaceHa}
                onChange={set('surfaceHa')}
                keyboardType="decimal-pad"
                placeholder="2.5"
                testID="input-farm-surface"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Nº plantas"
                value={form.plantCount}
                onChange={set('plantCount')}
                keyboardType="number-pad"
                placeholder="4500"
              />
            </View>
          </View>
          <Field
            label="Estado fenológico"
            value={form.phenologicalStage}
            onChange={set('phenologicalStage')}
            placeholder="Engorde de racimo"
          />
          <Field label="Tipo de suelo" value={form.soilType} onChange={set('soilType')} placeholder="Sorriba" />
        </Card>

        <Card style={{ gap: 14 }}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Riego y manejo</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                label="Litros/planta/semana"
                value={form.weeklyLitresPerPlant}
                onChange={set('weeklyLitresPerPlant')}
                keyboardType="decimal-pad"
                placeholder="120"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="CE máx (µS/cm)"
                value={form.maxEcDsM}
                onChange={set('maxEcDsM')}
                keyboardType="decimal-pad"
                placeholder="1800"
              />
            </View>
          </View>
          <View style={styles.switchRow}>
            <Text style={[styles.label, { color: c.foreground }]}>Permite abonado foliar</Text>
            <Switch
              value={form.foliarAllowed}
              onValueChange={set('foliarAllowed')}
              trackColor={{ true: c.primary }}
              testID="switch-foliar"
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={[styles.label, { color: c.foreground }]}>Tiene drenaje</Text>
            <Switch
              value={form.hasDrainage}
              onValueChange={set('hasDrainage')}
              trackColor={{ true: c.primary }}
              testID="switch-drainage"
            />
          </View>
          <Field
            label="Técnico responsable"
            value={form.responsibleTechnician}
            onChange={set('responsibleTechnician')}
            placeholder="Nombre del técnico"
          />
          <Field
            label="Persona de contacto"
            value={form.contactName}
            onChange={set('contactName')}
            placeholder="Nombre de contacto"
            testID="input-contact-name"
          />
          <Field
            label="Teléfono de contacto"
            value={form.contactPhone}
            onChange={set('contactPhone')}
            placeholder="+34 …"
            testID="input-contact-phone"
          />
          <Field
            label="Email de contacto"
            value={form.contactEmail}
            onChange={set('contactEmail')}
            placeholder="correo@ejemplo.com"
            testID="input-contact-email"
          />
          <Field
            label="Notas de manejo"
            value={form.managementNotes}
            onChange={set('managementNotes')}
            multiline
            placeholder="Observaciones…"
          />
        </Card>

        {error ? (
          <Text style={[styles.error, { color: c.destructive }]} testID="text-farm-form-error">
            {error}
          </Text>
        ) : null}

        <PrimaryButton
          title={isEdit ? 'Guardar cambios' : 'Crear finca'}
          onPress={handleSave}
          loading={saving}
          testID="button-save-farm"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  error: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
});
