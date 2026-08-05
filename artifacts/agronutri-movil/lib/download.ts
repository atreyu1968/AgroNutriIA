import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getStoredToken } from '@/context/AuthContext';

// Misma lógica de base URL que _layout.tsx: en Expo se usa el dominio público;
// en la versión web autoalojada la API vive en el mismo origen.
function baseUrl(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  if (typeof window !== 'undefined' && window.location) return window.location.origin;
  return '';
}

/**
 * Descarga un fichero autenticado (Bearer) desde la API.
 * - Web: descarga vía blob + enlace temporal.
 * - Nativo: descarga al caché y abre la hoja de compartir.
 */
export async function downloadAuthedFile(path: string, fileName: string): Promise<void> {
  const url = path.startsWith('http') ? path : `${baseUrl()}${path}`;
  const token = await getStoredToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers, credentials: 'include' });
    if (!res.ok) throw new Error(`No se pudo descargar (HTTP ${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return;
  }

  const safeName = fileName.replace(/[^\w .()-]+/gu, '_');
  const target = `${FileSystem.cacheDirectory}${safeName}`;
  const result = await FileSystem.downloadAsync(url, target, { headers });
  if (result.status !== 200) throw new Error(`No se pudo descargar (HTTP ${result.status})`);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri);
  } else {
    throw new Error('No hay ninguna app disponible para abrir el fichero.');
  }
}
