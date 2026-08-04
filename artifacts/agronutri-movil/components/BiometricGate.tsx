import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as LocalAuthentication from 'expo-local-authentication';
import { PrimaryButton } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useBiometricPref } from '@/context/BiometricPrefContext';
import { useColors } from '@/hooks/useColors';
import {
  hasWebBiometricEnrollment,
  isWebBiometricAvailable,
  verifyWebBiometric,
} from '@/lib/webBiometric';

/**
 * Locks the app behind biometrics (Face ID / huella / Windows Hello) when there
 * is an active session on a device with biometrics configured. Falls back to
 * the device passcode if biometrics fail. En web usa WebAuthn con el
 * autenticador de plataforma del dispositivo.
 */
export function BiometricGate({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { token, isLoading, signOut } = useAuth();
  const { biometricLockEnabled } = useBiometricPref();

  // null = still checking device capabilities
  const [supported, setSupported] = useState<boolean | null>(null);
  const [locked, setLocked] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
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

  // Re-check capabilities/enrollment whenever the preference changes, so that
  // on web the lock engages right after enrollWebBiometric() without a reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === 'web') {
          const [available, enrolled] = await Promise.all([
            isWebBiometricAvailable(),
            Promise.resolve(hasWebBiometricEnrollment()),
          ]);
          if (!cancelled) setSupported(available && enrolled);
          return;
        }
        const [hasHardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (!cancelled) setSupported(hasHardware && enrolled);
      } catch {
        if (!cancelled) setSupported(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [biometricLockEnabled]);

  const authenticate = useCallback(async () => {
    if (authInProgress.current) return;
    authInProgress.current = true;
    setAuthError(null);
    try {
      const success =
        Platform.OS === 'web'
          ? await verifyWebBiometric()
          : (
              await LocalAuthentication.authenticateAsync({
                promptMessage: 'Desbloquea AgroNutri',
                cancelLabel: 'Cancelar',
              })
            ).success;
      if (success) {
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
  // reopening always requires biometrics (no grace window). En web AppState
  // refleja la visibilidad de la pestaña.
  useEffect(() => {
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
        Usa tu huella, Face ID o el desbloqueo del dispositivo para continuar.
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
