import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Card } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import {
  getInstallPrompt,
  isInstalledPwa,
  isIosSafari,
  onInstallPromptChange,
} from '@/lib/pwa';

/**
 * Tarjeta «Instalar aplicación» para la versión web (PWA).
 * - Android/Chrome/Edge: botón que lanza el prompt nativo del navegador.
 * - iOS Safari: instrucciones (iOS no ofrece prompt programático).
 * - Si ya está instalada o el navegador no lo soporta: no se muestra.
 * En nativo no renderiza nada.
 */
export function InstallAppCard() {
  const c = useColors();
  const [promptAvailable, setPromptAvailable] = useState(
    Platform.OS === 'web' ? getInstallPrompt() != null : false,
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    return onInstallPromptChange(() => setPromptAvailable(getInstallPrompt() != null));
  }, []);

  if (Platform.OS !== 'web' || isInstalledPwa()) return null;
  const ios = isIosSafari();
  if (!promptAvailable && !ios) return null;

  const handleInstall = async () => {
    const promptEvent = getInstallPrompt();
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') setPromptAvailable(false);
  };

  return (
    <Card style={styles.card}>
      <View style={[styles.icon, { backgroundColor: c.primaryTint }]}>
        <Feather name="download" size={18} color={c.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: c.foreground }]}>Instalar aplicación</Text>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
          {ios
            ? 'En Safari: pulsa Compartir y luego «Añadir a pantalla de inicio»'
            : 'Añádela a tu pantalla de inicio para usarla como una app'}
        </Text>
      </View>
      {promptAvailable ? (
        <Pressable
          testID="button-install-app"
          accessibilityRole="button"
          onPress={handleInstall}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: c.primaryForeground }]}>Instalar</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  subtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  button: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  buttonText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
});
