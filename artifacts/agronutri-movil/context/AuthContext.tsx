import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import type { UserProfile } from '@workspace/api-client-react';

const TOKEN_KEY = 'agronutri_token';
const USER_KEY = 'agronutri_user';

// Module-level token so the auth token getter is synchronous and race-free.
let currentToken: string | null = null;
export function getStoredToken(): string | null {
  return currentToken;
}

interface AuthContextValue {
  token: string | null;
  user: UserProfile | null;
  isLoading: boolean;
  signIn: (user: UserProfile) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (storedToken) {
          currentToken = storedToken;
          setToken(storedToken);
        }
        if (storedUser) setUser(JSON.parse(storedUser) as UserProfile);
      } catch {
        // Ignore storage errors; user will just need to log in again.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(
    async (profile: UserProfile) => {
      const newToken = profile.token ?? null;
      currentToken = newToken;
      setToken(newToken);
      setUser(profile);
      await Promise.all([
        newToken ? AsyncStorage.setItem(TOKEN_KEY, newToken) : AsyncStorage.removeItem(TOKEN_KEY),
        AsyncStorage.setItem(USER_KEY, JSON.stringify(profile)),
      ]);
    },
    [],
  );

  const signOut = useCallback(async () => {
    currentToken = null;
    setToken(null);
    setUser(null);
    queryClient.clear();
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
  }, [queryClient]);

  const value = useMemo(
    () => ({ token, user, isLoading, signIn, signOut }),
    [token, user, isLoading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
