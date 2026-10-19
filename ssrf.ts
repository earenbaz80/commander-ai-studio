/**
 * Guardia anti-SSRF para fetches que el servidor hace en nombre del agente.
 *
 * El agente recibe URLs de la entrada del usuario / proyectos / modelos, así que
 * cualquier fetch server-side con URL controlada por el usuario pasa por aquí.
 * Falla CERRADO: ante la duda (DNS caído, formato raro) se bloquea.
 *
 * Decisión de diseño (app local-first):
 * - Loopback (127.0.0.0/8, ::1) PERMITIDO por defecto: Ollama vive en
 *   localhost:11434, los MCP locales también, y los tests usan 127.0.0.1.
 * - Siempre bloqueado: metadata cloud, link-local, privadas RFC1918, CGNAT,
 *   multicast, reservadas, 0.0.0.0, credenciales en la URL, esquemas no http(s).
 * - Modo estricto opt-in (`AGENT_STRICT_NET=1`): también bloquea loopback y
 *   privadas. Para despliegues donde el servidor no sea la máquina del usuario.
 */

import dns from 'dns';
import net from 'net';

const MAX_URL_LEN = 2000;
const DNS_TIMEOUT_MS = 5000;

// Hostnames de metadata cloud: se bloquean ANTES de resolver DNS.
const METADATA_HOST_RE = /(^|\.)metadata\.google(\.|$)|(^|\.)metadata\.googleapis(\.|$)/i;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const v = Number(p);
    if (!Number.isSafeInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function inCidr(ipInt: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base);
  if (b === null) return false;
  const mask = bits === 0 ? 0 : ((~0 << (32 - bits)) >>> 0);
  return (ipInt & mask) === (b & mask);
}

function isStrict(): boolean {
  return process.env.AGENT_STRICT_NET === '1';
}

/** true si la IPv4 está prohibida (con loopback según modo). */
function blockedIPv4(ip: string, strict: boolean): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // forma irreconocible: fail closed
  const blocked: Array<[string, number]> = [
    ['0.0.0.0', 32], // unspecified
    ['169.254.0.0', 16], // link-local (incluye metadata cloud 169.254.169.254)
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['100.64.0.0', 10], // CGNAT
    ['192.0.0.0', 24], // IETF asignaciones
    ['192.0.2.0', 24], // TEST-NET-1
    ['198.51.100.0', 24], // TEST-NET-2
    ['203.0.113.0', 24], // TEST-NET-3
    ['198.18.0.0', 15], // benchmarking
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reservado
  ];
  if (strict) blocked.push(['127.0.0.0', 8]);
  return blocked.some(([base, bits]) => inCidr(n, base, bits));
}

/** true si la IPv6 está prohibida (con loopback según modo). */
function blockedIPv6(ip: string, strict: boolean): boolean {
  const low = ip.toLowerCase();
  // IPv4-mapeada ::ffff:a.b.c.d → se juzga con reglas IPv4.
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blockedIPv4(mapped[1], strict);
  if (low === '::') return true; // unspecified
  if (low === '::1') return strict; // loopback: solo en estricto
  if (low.startsWith('fe80:')) return true; // link-local
  if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique-local
  if (low.startsWith('ff')) return true; // multicast
  return false;
}

function lookupAll(host: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS);
    dns.lookup(host, { all: true, verbatim: true }, (err, addrs) => {
      clearTimeout(timer);
      if (err) return reject(err);
      resolve(addrs.map((a) => a.address));
    });
  });
}

/**
 * Valida una URL de salida. Devuelve la URL original si es segura.
 * Lanza Error (mensaje apto para mostrar) si debe bloquearse.
 */
export async function assertSafeOutboundUrl(raw: unknown): Promise<string> {
  const input = String(raw || '').trim();
  if (!input) throw new Error('URL requerida');
  if (input.length > MAX_URL_LEN) throw new Error('URL demasiado larga');

  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error('URL inválida');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('URL debe ser http/https');
  }
  // userinfo (http://user@host) facilita confusión de parser: se rechaza.
  if (u.username || u.password) throw new Error('URL con credenciales bloqueada');
  if (METADATA_HOST_RE.test(u.hostname)) throw new Error('Destino metadata bloqueado');

  const strict = isStrict();
  const host = u.hostname;

  // Literal IP: se juzga sin DNS.
  const v = net.isIP(host);
  if (v === 4) {
    if (blockedIPv4(host, strict)) throw new Error('Destino de red interna bloqueado');
    return input;
  }
  if (v === 6) {
    if (blockedIPv6(host, strict)) throw new Error('Destino de red interna bloqueado');
    return input;
  }

  // Hostname: se resuelve y TODAS las IPs deben ser permitidas (anti DNS-rebinding).
  let addrs: string[];
  try {
    addrs = await lookupAll(host);
  } catch {
    throw new Error('No se pudo resolver el destino (bloqueado por seguridad)');
  }
  if (!addrs.length) throw new Error('Destino sin dirección (bloqueado)');
  for (const addr of addrs) {
    const av = net.isIP(addr);
    if (av === 4 && blockedIPv4(addr, strict)) throw new Error('Destino de red interna bloqueado');
    else if (av === 6 && blockedIPv6(addr, strict)) throw new Error('Destino de red interna bloqueado');
    else if (av === 0) throw new Error('Dirección irreconocible (bloqueada)');
  }
  return input;
}

const MAX_REDIRECTS = 5;

/**
 * fetch que valida CADA salto de redirección con assertSafeOutboundUrl.
 * Sin esto, un host público podría redirigir a metadata cloud o a IPs privadas.
 */
export async function safeFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  let current = await assertSafeOutboundUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) throw new Error('Demasiadas redirecciones');
      current = await assertSafeOutboundUrl(new URL(location, current).toString());
      continue;
    }
    return res;
  }
}
