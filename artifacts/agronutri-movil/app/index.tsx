import React, { useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Redirect, useRouter } from 'expo-router';
import {
  getGetAuthConfigQueryKey,
  getListFarmsQueryKey,
  useGetAuthConfig,
  useListFarms,
  type Farm,
} from '@workspace/api-client-react';
import { Badge, Card, EmptyState, ErrorView, LoadingView } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { InstallAppCard } from '@/components/InstallAppCard';
import { UserMenuModal } from '@/components/UserMenuModal';

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
  const { token, user, isLoading } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);

  const farmsQuery = useListFarms({
    query: { queryKey: getListFarmsQueryKey(), enabled: !!token },
  });
  const authConfigQuery = useGetAuthConfig({
    query: { queryKey: getGetAuthConfigQueryKey() },
  });
  const demoMode = authConfigQuery.data?.demoMode === true;

  if (isLoading) return <LoadingView />;
  if (!token) return <Redirect href="/login" />;

  const topInset = insets.top;
  const bottomInset = insets.bottom;

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
          testID="button-account"
          accessibilityRole="button"
          onPress={() => setAccountOpen(true)}
          style={({ pressed }) => [
            styles.avatarBtn,
            { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.avatarText, { color: c.primaryForeground }]}>
            {(user?.name || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')}
          </Text>
        </Pressable>
      </View>

      {demoMode && (
        <Pressable
          testID="banner-demo-mode"
          accessibilityRole="link"
          onPress={() =>
            Linking.openURL(
              process.env.EXPO_PUBLIC_DOMAIN
                ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/landing`
                : typeof window !== 'undefined' && window.location
                  ? `${window.location.origin}/landing`
                  : '/landing',
            )
          }
          style={[styles.demoBanner, { backgroundColor: '#fef3c7', borderBottomColor: '#fde68a' }]}
        >
          <Feather name="info" size={14} color="#92400e" style={{ marginTop: 2 }} />
          <Text style={styles.demoBannerText}>
            Instalación de demostración — limitada a 1 finca y 1 informe de cada tipo.{' '}
            <Text style={styles.demoBannerLink}>Contrata AgroNutri AI</Text>
          </Text>
        </Pressable>
      )}

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
            <View style={{ gap: 12 }}>
              <InstallAppCard />
            </View>
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
                  <View style={[styles.farmIcon, { backgroundColor: c.primaryTint }]}>
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

      <UserMenuModal visible={accountOpen} onClose={() => setAccountOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  demoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  demoBannerText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#92400e',
  },
  demoBannerLink: {
    fontFamily: 'Inter_600SemiBold',
    textDecorationLine: 'underline',
    color: '#92400e',
  },
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
  avatarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  list: {
    padding: 16,
    gap: 12,
    flexGrow: 1,
  },
  farmCard: {
    gap: 12,
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
