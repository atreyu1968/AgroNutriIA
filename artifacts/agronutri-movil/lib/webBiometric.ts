/**
 * Bloqueo biométrico en la versión web mediante WebAuthn (huella, Face ID,
 * Windows Hello o PIN del dispositivo, según el autenticador de plataforma).
 *
 * No sustituye al login: es un bloqueo local de la sesión, igual que en nativo.
 * La credencial queda ligada al dominio del servidor (rpId implícito).
 */

const CREDENTIAL_KEY = 'agronutri.webauthn.credentialId';

function base64urlEncode(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

/** True si el navegador/dispositivo tiene un autenticador de plataforma. */
export async function isWebBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof PublicKeyCredential === 'undefined') return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** True si ya se registró una credencial en este navegador. */
export function hasWebBiometricEnrollment(): boolean {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage.getItem(CREDENTIAL_KEY);
  } catch {
    return false;
  }
}

/**
 * Registra la credencial de plataforma (pide huella/Face ID/PIN al usuario).
 * Devuelve true si el registro se completó.
 */
export async function enrollWebBiometric(): Promise<boolean> {
  if (!(await isWebBiometricAvailable())) return false;
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'AgroNutri' },
        user: {
          id: randomBytes(16),
          name: 'agronutri-lock',
          displayName: 'Bloqueo de AgroNutri',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!credential) return false;
    localStorage.setItem(CREDENTIAL_KEY, base64urlEncode(credential.rawId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifica al usuario contra la credencial registrada (huella/Face ID/PIN).
 * Devuelve true solo si el autenticador confirma la identidad.
 */
export async function verifyWebBiometric(): Promise<boolean> {
  const stored = (() => {
    try {
      return localStorage.getItem(CREDENTIAL_KEY);
    } catch {
      return null;
    }
  })();
  if (!stored) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [
          { type: 'public-key', id: base64urlDecode(stored), transports: ['internal'] },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

/** Elimina la credencial registrada (al desactivar el bloqueo). */
export function clearWebBiometric(): void {
  try {
    localStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    // sin almacenamiento disponible: no-op
  }
}
