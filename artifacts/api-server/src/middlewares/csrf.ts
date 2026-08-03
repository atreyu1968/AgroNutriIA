import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE } from "./auth";
import { logger } from "../lib/logger";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Hosts propios adicionales de confianza, a partir de la configuración.
 * (APP_URL en instalaciones propias; REPLIT_DOMAINS / REPLIT_DEV_DOMAIN en
 * el entorno de Replit.)
 */
export function trustedHosts(): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    for (const part of value.split(",")) {
      const raw = part.trim();
      if (!raw) continue;
      try {
        hosts.add(new URL(raw.includes("://") ? raw : `https://${raw}`).host);
      } catch {
        /* valor no válido: se ignora */
      }
    }
  };
  add(process.env.APP_URL);
  add(process.env.REPLIT_DOMAINS);
  add(process.env.REPLIT_DEV_DOMAIN);
  return hosts;
}

function requestHost(req: Request): string | null {
  // Detrás del proxy de desarrollo/producción el host original llega en
  // X-Forwarded-Host; si no, usamos Host directamente.
  const forwarded = req.headers["x-forwarded-host"];
  const value = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers.host;
  if (!value) return null;
  return value.split(",")[0].trim().toLowerCase();
}

function headerHost(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

export function isTrustedBrowserOrigin(req: Request, originValue: string): boolean {
  const originHost = headerHost(originValue);
  if (!originHost) return false;
  if (originHost === requestHost(req)) return true;
  return trustedHosts().has(originHost);
}

/**
 * Protección CSRF basada en Origin/Referer.
 *
 * Solo aplica a peticiones que mutan estado (POST/PUT/PATCH/DELETE) y que se
 * autentican mediante la cookie de sesión: son las únicas que otra web podría
 * disparar en nombre del usuario, porque el navegador adjunta la cookie
 * automáticamente. Las peticiones con token Bearer (móvil, tests, scripts)
 * no son vulnerables a CSRF y se dejan pasar.
 *
 * Los navegadores siempre envían Origin en peticiones POST entre sitios, así
 * que una petición sin Origin ni Referer no procede de una web de terceros.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  // Sin cookie de sesión no hay nada que un tercero pueda aprovechar.
  if (!req.cookies?.[SESSION_COOKIE]) {
    next();
    return;
  }
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const source = origin ?? referer;
  if (!source) {
    next();
    return;
  }
  if (isTrustedBrowserOrigin(req, source)) {
    next();
    return;
  }
  logger.warn(
    { origin, referer, host: requestHost(req), url: req.originalUrl },
    "Petición mutadora rechazada por origen no permitido (posible CSRF)",
  );
  res.status(403).json({ error: "Origen no permitido" });
}

/**
 * Comprobación de origen para CORS: permite peticiones sin Origin (curl,
 * móvil, misma origin en algunos navegadores) y orígenes del propio dominio
 * o de la lista de confianza.
 */
export function corsOriginCheck(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin) {
    callback(null, true);
    return;
  }
  const host = headerHost(origin);
  if (host && trustedHosts().has(host)) {
    callback(null, true);
    return;
  }
  // Sin acceso al Host de la petición aquí; los orígenes desconocidos no
  // reciben cabeceras CORS (el navegador bloqueará la lectura), pero la
  // petición simple sigue pasando por csrfProtection.
  callback(null, false);
}
