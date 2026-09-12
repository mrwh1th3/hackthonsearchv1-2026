/**
 * Verificación básica de origen/CSRF para mutaciones del BFF. No sustituye un
 * token CSRF de doble envío; para este alcance (sesión demo, cookie
 * SameSite=Lax) comprobar que Origin/Referer coincidan con el host de la
 * petición es la mitigación exigida en 16 §6 ("Añadir CSRF/origen").
 */
export function isSameOriginRequest(req: Request): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  // Sin Origin ni Referer (algunos clientes same-origin los omiten): se
  // acepta solo si tampoco hay indicios de origen cruzado explícito.
  return true;
}
