import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as LocalAuthentication from 'expo-local-authentication';
import { PrimaryButton } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

const BACKGROUND_LOCK_MS = 60_000;

/**
 * Locks the app behind biometrics (Face ID / huella) when there is an active
 * session on a device with biometrics configured. Falls back to the device
 * passcode if biometrics fail. Web is never locked (not supported there).
 */
export function BiometricGate({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { token, isLoading, signOut } = useAuth();

  // null = still checking device capabilities
  const [supported, setSupported] = useState<boolean | null>(Platform.OS === 'web' ? false : null);
  const [locked, setLocked] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const authInProgress = useRef(false);
  const backgroundedAt = useRef<number | null>(null);
  // Lock epoch: invalidates any pending authentication result from a previous
  // foreground session so a stale success cannot bypass a re-lock.
  const lockEpoch = useRef(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      try {
        const [hasHardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        setSupported(hasHardware && enrolled);
      } catch {
        setSupported(false);
      }
    })();
  }, []);

  const authenticate = useCallback(async () => {
    if (authInProgress.current) return;
    authInProgress.current = true;
    setAuthError(null);
    const epoch = lockEpoch.current;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquea AgroNutri',
        cancelLabel: 'Cancelar',
      });
      // Ignore results from a previous foreground session (app was re-locked).
      if (epoch !== lockEpoch.current) return;
      if (result.success) {
        setLocked(false);
      } else {
        setAuthError('No se pudo verificar tu identidad. Inténtalo de nuevo.');
      }
    } catch {
      setAuthError('No se pudo iniciar la verificación. Inténtalo de nuevo.');
    } finally {
      authInProgress.current = false;
    }
  }, []);

  const needsLock = !!token && supported === true && locked;

  // Prompt automatically when the lock screen appears.
  useEffect(() => {
    if (needsLock && !isLoading) authenticate();
  }, [needsLock, isLoading, authenticate]);

  // Re-lock after the app spends a while in background.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        // Record the first departure from active (covers iOS 'inactive' and
        // Android 'background'); do not reset on intermediate transitions.
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
      } else if (backgroundedAt.current != null) {
        if (Date.now() - backgroundedAt.current > BACKGROUND_LOCK_MS) {
          lockEpoch.current += 1;
          setLocked(true);
        }
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  if (isLoading) return null;
  // Still checking capabilities with an active session: avoid flashing content.
  if (token && supported === null) return null;

  if (!needsLock) return <>{children}</>;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: c.background,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <Image
        source={require('../assets/images/logo.png')}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel="Logotipo de AgroNutri"
      />
      <Text style={[styles.title, { color: c.foreground }]}>Aplicación bloqueada</Text>
      <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
        Usa tu huella o Face ID para continuar.
      </Text>
      {authError ? (
        <Text style={[styles.error, { color: c.destructive }]}>{authError}</Text>
      ) : null}
      <View style={styles.actions}>
        <PrimaryButton testID="button-unlock" title="Desbloquear" onPress={authenticate} />
        <Text
          testID="button-lock-signout"
          accessibilityRole="button"
          onPress={() => {
            setLocked(false);
            signOut();
          }}
          style={[styles.signOut, { color: c.mutedForeground }]}
        >
          Cerrar sesión y entrar con otra cuenta
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: 240,
    height: 56,
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    marginTop: 6,
    textAlign: 'center',
  },
  error: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    marginTop: 12,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    maxWidth: 320,
    marginTop: 28,
    gap: 16,
  },
  signOut: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
});
