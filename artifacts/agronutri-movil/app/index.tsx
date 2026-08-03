import React from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Redirect, useRouter } from 'expo-router';
import {
  getListFarmsQueryKey,
  useListFarms,
  useLogout,
  type Farm,
} from '@workspace/api-client-react';
import { Badge, Card, EmptyState, ErrorView, LoadingView } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useBiometricPref } from '@/context/BiometricPrefContext';
import { useColors } from '@/hooks/useColors';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario',
  technician: 'Técnico',
  manager: 'Encargado',
  viewer: 'Lectura',
};

export default function FarmsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user, isLoading, signOut } = useAuth();
  const { biometricLockEnabled, setBiometricLockEnabled } = useBiometricPref();

  const farmsQuery = useListFarms({
    query: { queryKey: getListFarmsQueryKey(), enabled: !!token },
  });
  const logout = useLogout();

  if (isLoading) return <LoadingView />;
  if (!token) return <Redirect href="/login" />;

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleLogout = () => {
    logout.mutate(undefined, { onSettled: () => signOut() });
  };

  const farms: Farm[] = farmsQuery.data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 12, borderBottomColor: c.border }]}>
        <Image
          source={require('../assets/images/icon.png')}
          style={styles.headerLogo}
          contentFit="contain"
          accessibilityLabel="Logo de AgroNutri"
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerKicker, { color: c.mutedForeground }]}>
            {user?.name ? `Hola, ${user.name.split(' ')[0]}` : 'AgroNutri'}
          </Text>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Mis fincas</Text>
        </View>
        <Pressable
          testID="button-add-farm"
          accessibilityRole="button"
          onPress={() => router.push('/farm/form')}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1, marginRight: 8 },
          ]}
        >
          <Feather name="plus" size={18} color={c.primaryForeground} />
        </Pressable>
        <Pressable
          testID="button-logout"
          accessibilityRole="button"
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: c.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="log-out" size={18} color={c.foreground} />
        </Pressable>
      </View>

      {farmsQuery.isLoading ? (
        <LoadingView label="Cargando fincas…" />
      ) : farmsQuery.isError ? (
        <ErrorView onRetry={() => farmsQuery.refetch()} />
      ) : (
        <FlatList
          data={farms}
          keyExtractor={(item) => String(item.id)}
          scrollEnabled={farms.length > 0}
          contentContainerStyle={[styles.list, { paddingBottom: bottomInset + 24 }]}
          refreshControl={
            <RefreshControl
              refreshing={farmsQuery.isRefetching}
              onRefresh={() => farmsQuery.refetch()}
              tintColor={c.primary}
            />
          }
          ListFooterComponent={
            Platform.OS !== 'web' ? (
              <Card style={styles.settingsCard}>
                <View style={[styles.farmIcon, { backgroundColor: '#e3efe7' }]}>
                  <Feather name="lock" size={18} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingTitle, { color: c.foreground }]}>
                    Bloqueo biométrico
                  </Text>
                  <Text style={[styles.settingSubtitle, { color: c.mutedForeground }]}>
                    Pide huella o Face ID al abrir la app
                  </Text>
                </View>
                <Switch
                  testID="switch-biometric-lock"
                  value={biometricLockEnabled === true}
                  onValueChange={setBiometricLockEnabled}
                  trackColor={{ true: c.primary }}
                />
              </Card>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="map"
              title="Sin fincas todavía"
              subtitle="Cuando tengas fincas asignadas aparecerán aquí."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`card-farm-${item.id}`}
              accessibilityRole="button"
              onPress={() => router.push(`/farm/${item.id}`)}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Card style={styles.farmCard}>
                <View style={styles.farmHeader}>
                  <View style={[styles.farmIcon, { backgroundColor: '#e3efe7' }]}>
                    <Feather name="map-pin" size={18} color={c.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.farmName, { color: c.foreground }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.farmLocation, { color: c.mutedForeground }]} numberOfLines={1}>
                      {[item.municipality, item.island].filter(Boolean).join(', ') ||
                        'Sin ubicación'}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={c.mutedForeground} />
                </View>
                <View style={styles.farmMeta}>
                  <Badge label={ROLE_LABEL[item.myRole] ?? item.myRole} tone="primary" />
                  {item.mainCrop ? <Badge label={item.mainCrop} tone="accent" /> : null}
                  {item.surfaceHa != null ? <Badge label={`${item.surfaceHa} ha`} /> : null}
                  {item.plantCount != null ? <Badge label={`${item.plantCount} plantas`} /> : null}
                </View>
              </Card>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLogo: {
    width: 40,
    height: 40,
    borderRadius: 10,
    marginRight: 12,
  },
  headerKicker: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  headerTitle: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    marginTop: 2,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: 16,
    gap: 12,
    flexGrow: 1,
  },
  farmCard: {
    gap: 12,
  },
  settingsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  settingTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  settingSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  farmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  farmIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  farmName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  farmLocation: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  farmMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
