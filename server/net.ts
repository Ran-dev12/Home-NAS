import os from 'node:os';

export interface LanAddress {
  name: string;
  address: string;
  kind: 'lan' | 'tailscale' | 'other';
}

const VIRTUAL = /(vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|vpn|bluetooth|zerotier)/i;

function rank(a: LanAddress): number {
  if (a.kind === 'tailscale') return 5;
  if (a.address.startsWith('192.168.')) return 0;
  if (a.address.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) return 2;
  return 3;
}

/** IPv4 addresses a phone on the same Wi-Fi could reach, best guess first. */
export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal || info.address.startsWith('169.254.')) continue;
      const isTailscale = /tailscale/i.test(name) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(info.address);
      if (!isTailscale && VIRTUAL.test(name)) continue;
      out.push({ name, address: info.address, kind: isTailscale ? 'tailscale' : 'lan' });
    }
  }
  return out.sort((a, b) => rank(a) - rank(b));
}
