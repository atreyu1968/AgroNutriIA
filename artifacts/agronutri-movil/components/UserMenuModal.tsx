import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
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
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  getGetMeQueryKey,
  useGetMe,
  useLogout,
  useUpdateMe,
  type UserProfileUpdate,
} from '@workspace/api-client-react';
import { Badge } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useBiometricPref } from '@/context/BiometricPrefContext';
import { useColors } from '@/hooks/useColors';
import {
  clearWebBiometric,
  enrollWebBiometric,
  isWebBiometricAvailable,
} from '@/lib/webBiometric';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario',
  technician: 'Técnico',
  manager: 'Encargado',
  viewer: 'Lectura',
  admin: 'Administrador',
};

function initialsOf(name?: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function UserMenuModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { user, updateUser, signOut } = useAuth();
  const { biometricLockEnabled, setBiometricLockEnabled } = useBiometricPref();

  // Perfil
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [company, setCompany] = useState(user?.company ?? '');
  const [unitsPreference, setUnitsPreference] = useState(
    user?.unitsPreference ?? 'metric',
  );

  // Biometría
  const biometricCheckInProgress = useRef(false);
  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);

  const meQuery = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: !!user },
  });
  const updateMe = useUpdateMe();
  const logout = useLogout();

  useEffect(() => {
    if (!visible) return;
    // Sincroniza el formulario con el perfil actual al abrir.
    setName(meQuery.data?.name ?? user?.name ?? '');
    setPhone(meQuery.data?.phone ?? user?.phone ?? '');
    setCompany(meQuery.data?.company ?? user?.company ?? '');
    setUnitsPreference(meQuery.data?.unitsPreference ?? user?.unitsPreference ?? 'metric');
  }, [visible, meQuery.data, user]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === 'web') {
          const available = await isWebBiometricAvailable();
          if (!cancelled) setBiometricAvailable(available);
          return;
        }
        const [hasHardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (!cancelled) setBiometricAvailable(hasHardware && enrolled);
      } catch {
        if (!cancelled) setBiometricAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const handleBiometricToggle = async (enabled: boolean) => {
    if (!enabled) {
      if (Platform.OS === 'web') clearWebBiometric();
      setBiometricLockEnabled(false);
      return;
    }
    if (biometricCheckInProgress.current) return;
    biometricCheckInProgress.current = true;
    try {
      const success =
        Platform.OS === 'web'
          ? await enrollWebBiometric()
          : (
              await LocalAuthentication.authenticateAsync({
                promptMessage: 'Confirma tu identidad para activar el bloqueo',
                cancelLabel: 'Cancelar',
              })
            ).success;
      setBiometricLockEnabled(success);
    } catch {
      setBiometricLockEnabled(false);
    } finally {
      biometricCheckInProgress.current = false;
    }
  };

  const canSave = name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    const data: UserProfileUpdate = { name: name.trim() };
    if (phone.trim()) data.phone = phone.trim();
    if (company.trim()) data.company = company.trim();
    data.unitsPreference = unitsPreference;

    updateMe.mutate(
      { data },
      {
        onSuccess: (profile) => {
          void updateUser(profile);
          meQuery.refetch().catch(() => {});
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Guardado', 'Tus datos se han actualizado correctamente.');
          onClose();
        },
        onError: (err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'data' in err
              ? String((err as { data?: { error?: string } }).data?.error ?? '')
              : '';
          Alert.alert('Error', msg || 'No se pudieron guardar los datos.');
        },
      },
    );
  };

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        void signOut();
        onClose();
      },
    });
    onClose();
  };

  const email = user?.email ?? meQuery.data?.email ?? '';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.background, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: c.foreground }]}>Mi cuenta</Text>
            <Pressable
              testID="button-close-account"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="x" size={18} color={c.foreground} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.identity}>
              <View style={[styles.avatar, { backgroundColor: c.primary }]}>
                <Text style={[styles.avatarText, { color: c.primaryForeground }]}>
                  {initialsOf(meQuery.data?.name ?? user?.name)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.identityName, { color: c.foreground }]} numberOfLines={1}>
                  {meQuery.data?.name ?? user?.name ?? 'Usuario'}
                </Text>
                {email ? (
                  <Text style={[styles.identityEmail, { color: c.mutedForeground }]} numberOfLines={1}>
                    {email}
                  </Text>
                ) : null}
              </View>
              <Badge label={ROLE_LABEL[meQuery.data?.role ?? user?.role ?? ''] ?? (meQuery.data?.role ?? user?.role ?? '')} tone="primary" />
            </View>

            {/* Bloqueo biométrico */}
            <View style={[styles.section, { borderColor: c.border, backgroundColor: c.card }]}>
              <View style={styles.sectionIconWrap}>
                <Feather name="lock" size={18} color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, { color: c.foreground }]}>
                  Bloqueo biométrico
                </Text>
                <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>
                  {biometricAvailable === false
                    ? 'Este dispositivo no tiene biometría configurada'
                    : 'Pide huella, Face ID o el desbloqueo del dispositivo al abrir la app'}
                </Text>
              </View>
              <Switch
                testID="switch-account-biometric"
                value={biometricAvailable !== false && biometricLockEnabled === true}
                onValueChange={handleBiometricToggle}
                disabled={biometricAvailable !== true}
                trackColor={{ true: c.primary }}
              />
            </View>

            {/* Editar mis datos */}
            <Text style={[styles.formLabel, { color: c.foreground }]}>Editar mis datos</Text>
            <Text style={[styles.formHint, { color: c.mutedForeground }]}>
              Actualiza tu nombre, teléfono, empresa y unidades preferidas.
            </Text>

            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Nombre</Text>
            <TextInput
              testID="input-account-name"
              value={name}
              onChangeText={setName}
              placeholder="Tu nombre"
              placeholderTextColor={c.mutedForeground}
              style={[styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
            />

            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Teléfono</Text>
            <TextInput
              testID="input-account-phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="Opcional"
              placeholderTextColor={c.mutedForeground}
              keyboardType="phone-pad"
              style={[styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
            />

            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Empresa</Text>
            <TextInput
              testID="input-account-company"
              value={company}
              onChangeText={setCompany}
              placeholder="Opcional"
              placeholderTextColor={c.mutedForeground}
              style={[styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
            />

            <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Sistema de unidades</Text>
            <View style={styles.unitsRow}>
              {(['metric', 'imperial'] as const).map((u) => (
                <Pressable
                  key={u}
                  testID={`unit-option-${u}`}
                  accessibilityRole="button"
                  onPress={() => setUnitsPreference(u)}
                  style={[
                    styles.unitOption,
                    { backgroundColor: unitsPreference === u ? c.primary : c.muted },
                  ]}
                >
                  <Text style={[styles.unitText, { color: unitsPreference === u ? c.primaryForeground : c.foreground }]}>
                    {u === 'metric' ? 'Métrico (Kg, L, Ha)' : 'Imperial (lb, gal, ac)'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              testID="button-save-account"
              accessibilityRole="button"
              disabled={!canSave || updateMe.isPending}
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: c.primary, opacity: !canSave || updateMe.isPending ? 0.5 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {updateMe.isPending ? 'Guardando…' : 'Guardar cambios'}
              </Text>
            </Pressable>

            <Pressable
              testID="button-logout-account"
              accessibilityRole="button"
              onPress={handleLogout}
              style={({ pressed }) => [
                styles.logoutBtn,
                { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="log-out" size={16} color={c.destructive} />
              <Text style={[styles.logoutText, { color: c.destructive }]}>Cerrar sesión</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,120,120,0.35)',
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    gap: 10,
    paddingBottom: 8,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  identityName: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  identityEmail: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  sectionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dde8e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  sectionSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  formLabel: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    marginTop: 10,
  },
  formHint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    marginTop: 4,
  },
  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
  },
  unitsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  unitOption: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  unitText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  saveBtn: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  logoutText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
