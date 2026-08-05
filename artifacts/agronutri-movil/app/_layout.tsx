import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BiometricGate } from '@/components/BiometricGate';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider, getStoredToken } from '@/context/AuthContext';
import { BiometricPrefProvider } from '@/context/BiometricPrefContext';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setupPwa } from '@/lib/pwa';

// Registra manifiesto y service worker para que la versión web sea una PWA
// instalable (icono propio, pantalla completa, caché offline).
if (Platform.OS === 'web') setupPwa();

// Expo bundles run outside the web proxy: use absolute URLs + bearer token.
// En un servidor propio (versión web servida en /movil) no hay EXPO_PUBLIC_DOMAIN:
// la API vive en el mismo origen que la página, así que se usa window.location.
setBaseUrl(
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : typeof window !== 'undefined' && window.location
      ? window.location.origin
      : null,
);
setAuthTokenGetter(() => getStoredToken());

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Atrás', headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="farm/form" />
      <Stack.Screen name="farm/[id]/index" />
      <Stack.Screen name="farm/[id]/chat" />
      <Stack.Screen name="farm/[id]/phyto" />
      <Stack.Screen name="farm/[id]/reports" />
      <Stack.Screen name="farm/[id]/calculator" />
      <Stack.Screen name="farm/[id]/analysis-form" />
      <Stack.Screen name="farm/[id]/sectors" />
      <Stack.Screen name="farm/[id]/fertilizers" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <BiometricPrefProvider>
                  <BiometricGate>
                    <RootLayoutNav />
                  </BiometricGate>
                </BiometricPrefProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
