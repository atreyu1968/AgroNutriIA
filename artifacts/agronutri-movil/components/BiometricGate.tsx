import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as LocalAuthentication from 'expo-local-authentication';
import { PrimaryButton } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useBiometricPref } from '@/context/BiometricPrefContext';
import { useColors } from '@/hooks/useColors';

/**
 * Locks the app behind biometrics (Face ID / huella) when there is an active
 * session on a device with biometrics configured. Falls back to the device
 * passcode if biometrics fail. Web is never locked (not supported there).
 */
export function BiometricGate({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { token, isLoading, signOut } = useAuth();
  const { biometricLockEnabled } = useBiometricPref();

  // null = still checking device capabilities
  const [supported, setSupported] = useState<boolean | null>(Platform.OS === 'web' ? false : null);
  const [locked, setLocked] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(
    Platform.OS === 'web' ? true : AppState.currentState === 'active',
  );
  const authInProgress = useRef(false);
  const prevLockEnabled = useRef<boolean | null>(null);

  // When the user turns the lock ON during this session, they just passed a
  // confirmation prompt (see the farms screen), so don't prompt a second time.
  useEffect(() => {
    if (prevLockEnabled.current === false && biometricLockEnabled === true) {
      setLocked(false);
    }
    prevLockEnabled.current = biometricLockEnabled;
  }, [biometricLockEnabled]);

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
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquea AgroNutri',
        cancelLabel: 'Cancelar',
      });
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

  const needsLock = !!token && supported === true && biometricLockEnabled === true && locked;

  // Prompt automatically when the lock screen appears (only while foregrounded:
  // prompting from the background fails silently on both platforms).
  useEffect(() => {
    if (needsLock && !isLoading && appActive) authenticate();
  }, [needsLock, isLoading, appActive, authenticate]);

  // Re-lock immediately whenever the app is sent to the background, so
  // reopening always requires biometrics (no grace window).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state === 'background') setLocked(true);
    });
    return () => sub.remove();
  }, []);

  if (isLoading) return null;
  // Still checking capabilities/preference with an active session: avoid flashing content.
  if (token && (supported === null || biometricLockEnabled === null)) return null;

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
