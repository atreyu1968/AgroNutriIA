import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useLogin } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { PrimaryButton } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

export default function LoginScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const login = useLogin({
    mutation: {
      onSuccess: async (profile) => {
        await signIn(profile);
        router.replace('/');
      },
      onError: (err) => {
        const anyErr = err as { data?: { error?: string } };
        setErrorMsg(anyErr?.data?.error ?? 'No se pudo iniciar sesión. Comprueba tus datos.');
      },
    },
  });

  const canSubmit = email.trim().length > 3 && password.length > 0;

  const topInset = Platform.OS === 'web' ? 67 + 24 : insets.top + 24;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.content,
          { paddingTop: topInset, paddingBottom: bottomInset + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <View style={[styles.logoCircle, { backgroundColor: c.primary }]}>
          <Feather name="feather" size={30} color={c.primaryForeground} />
        </View>
        <Text style={[styles.title, { color: c.foreground }]}>AgroNutri</Text>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
          Tu técnico virtual, a pie de finca
        </Text>

        <View style={styles.form}>
          <Text style={[styles.label, { color: c.foreground }]}>Correo electrónico</Text>
          <TextInput
            testID="input-email"
            style={[
              styles.input,
              { borderColor: c.input, backgroundColor: c.card, color: c.foreground },
            ]}
            placeholder="nombre@finca.es"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              setErrorMsg(null);
            }}
          />
          <Text style={[styles.label, { color: c.foreground }]}>Contraseña</Text>
          <TextInput
            testID="input-password"
            style={[
              styles.input,
              { borderColor: c.input, backgroundColor: c.card, color: c.foreground },
            ]}
            placeholder="••••••••"
            placeholderTextColor={c.mutedForeground}
            secureTextEntry
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setErrorMsg(null);
            }}
          />

          {errorMsg ? (
            <Text style={[styles.error, { color: c.destructive }]}>{errorMsg}</Text>
          ) : null}

          <PrimaryButton
            testID="button-login"
            title="Iniciar sesión"
            disabled={!canSubmit}
            loading={login.isPending}
            onPress={() =>
              login.mutate({ data: { email: email.trim().toLowerCase(), password } })
            }
          />
          <Text style={[styles.hint, { color: c.mutedForeground }]}>
            Usa la misma cuenta que en la aplicación web de AgroNutri.
          </Text>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
    marginBottom: 28,
  },
  form: {
    width: '100%',
    maxWidth: 420,
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginTop: 8,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: colors.radius,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
  error: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    marginTop: 4,
  },
  hint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 12,
  },
});
