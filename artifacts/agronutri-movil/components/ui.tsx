import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: colors.radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          padding: 16,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Badge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'primary' | 'accent' | 'muted' | 'destructive' | 'warning';
}) {
  const c = useColors();
  const bg =
    tone === 'primary'
      ? '#e3efe7'
      : tone === 'accent'
        ? '#f2e6dc'
        : tone === 'destructive'
          ? '#f7e1de'
          : tone === 'warning'
            ? '#f5edd6'
            : c.muted;
  const fg =
    tone === 'primary'
      ? c.primary
      : tone === 'accent'
        ? c.accent
        : tone === 'destructive'
          ? c.destructive
          : tone === 'warning'
            ? '#8a6a08'
            : c.mutedForeground;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const c = useColors();
  const isDisabled = !!disabled || !!loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: c.primary,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.primaryForeground} />
      ) : (
        <Text style={[styles.buttonText, { color: c.primaryForeground }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function LoadingView({ label }: { label?: string }) {
  const c = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={c.primary} />
      {label ? <Text style={[styles.mutedText, { color: c.mutedForeground }]}>{label}</Text> : null}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const c = useColors();
  return (
    <View style={styles.center}>
      <Feather name="alert-circle" size={32} color={c.destructive} />
      <Text style={[styles.mutedText, { color: c.foreground, fontFamily: 'Inter_500Medium' }]}>
        {message ?? 'No se pudo cargar la información'}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          testID="retry-button"
          style={({ pressed }) => [
            styles.retry,
            { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
            Reintentar
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: keyof typeof Feather.glyphMap; title: string; subtitle?: string }) {
  const c = useColors();
  return (
    <View style={styles.center}>
      <Feather name={icon} size={32} color={c.mutedForeground} />
      <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 10 }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.mutedText, { color: c.mutedForeground }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  button: {
    height: 50,
    borderRadius: colors.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 32,
  },
  mutedText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
});
