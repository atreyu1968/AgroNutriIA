import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BIOMETRIC_PREF_KEY = 'agronutri.biometricLockEnabled';

type BiometricPrefContextValue = {
  /** null = still loading the stored preference */
  biometricLockEnabled: boolean | null;
  setBiometricLockEnabled: (enabled: boolean) => void;
};

const BiometricPrefContext = createContext<BiometricPrefContextValue | undefined>(undefined);

export function BiometricPrefProvider({ children }: { children: React.ReactNode }) {
  const [biometricLockEnabled, setEnabledState] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(BIOMETRIC_PREF_KEY);
        // Enabled by default unless the user explicitly turned it off.
        setEnabledState(stored !== 'false');
      } catch {
        setEnabledState(true);
      }
    })();
  }, []);

  const setBiometricLockEnabled = useCallback((enabled: boolean) => {
    setEnabledState(enabled);
    AsyncStorage.setItem(BIOMETRIC_PREF_KEY, enabled ? 'true' : 'false').catch(() => {
      // Persisting failed; the in-memory value still applies for this session.
    });
  }, []);

  const value = useMemo(
    () => ({ biometricLockEnabled, setBiometricLockEnabled }),
    [biometricLockEnabled, setBiometricLockEnabled],
  );

  return <BiometricPrefContext.Provider value={value}>{children}</BiometricPrefContext.Provider>;
}

export function useBiometricPref(): BiometricPrefContextValue {
  const ctx = useContext(BiometricPrefContext);
  if (!ctx) throw new Error('useBiometricPref must be used within a BiometricPrefProvider');
  return ctx;
}
