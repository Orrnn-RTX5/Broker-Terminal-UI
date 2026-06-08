const CLEAR_TEXT_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// Hosts for which an opt-in (VITE_FORCE_HTTP_ONLY) https->http downgrade is safe:
// loopback and RFC1918/link-local private ranges only. Public broker hosts must
// never be silently downgraded to cleartext.
export const isCleartextDowngradeAllowedHost = (hostname: string): boolean => {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  if (CLEAR_TEXT_LOCAL_HOSTS.has(host) || host === '0.0.0.0') return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (host === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe80:/.test(host)) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return false;
};
