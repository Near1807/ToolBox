// v0.41.0 (PC): the networks the PC is on, READ ONLY: its local addresses by
// interface, and for each the network's name and its Windows profile
// (Privé / Public / Domaine), from `Get-NetConnectionProfile` (PowerShell,
// read only). Never changes a profile nor the firewall. Elsewhere than on
// Windows (tests, CI), no profile: the names and types stay unknown.
import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';

export type ProfileCategory = 'private' | 'public' | 'domain';

/** A Windows network profile (one per connected interface). */
export interface NetworkProfile {
  /** The network's name (« ECAM-WiFi », « Réseau 3 »), or null. */
  name: string | null;
  /** The interface (« Wi-Fi », « Ethernet »). */
  alias: string;
  category: ProfileCategory | null;
}

/** One local address of the PC, with what Windows says of its network. */
export interface PcNetwork {
  alias: string;
  address: string;
  name: string | null;
  category: ProfileCategory | null;
}

const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** The PC's IPv4 addresses on a local network, by interface. */
export function localInterfaces(): { alias: string; address: string }[] {
  const out: { alias: string; address: string }[] = [];
  for (const [alias, list] of Object.entries(networkInterfaces()))
    for (const a of list ?? [])
      if (a.family === 'IPv4' && !a.internal && PRIVATE_IPV4.test(a.address))
        out.push({ alias, address: a.address });
  return out;
}

const CATEGORIES: Record<string, ProfileCategory> = {
  '0': 'public',
  public: 'public',
  '1': 'private',
  private: 'private',
  '2': 'domain',
  domainauthenticated: 'domain',
};

/** `Get-NetConnectionProfile | ConvertTo-Json` (one object or a list) → the profiles. */
export function parseProfiles(json: string): NetworkProfile[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((p) => {
    if (!p || typeof p !== 'object') return [];
    const o = p as Record<string, unknown>;
    const alias = typeof o.InterfaceAlias === 'string' ? o.InterfaceAlias : '';
    if (!alias) return [];
    return [
      {
        alias,
        name: typeof o.Name === 'string' && o.Name.trim() ? o.Name.trim() : null,
        category: CATEGORIES[String(o.NetworkCategory ?? '').toLowerCase()] ?? null,
      },
    ];
  });
}

/** Reads the Windows profiles (read only); none elsewhere, or when PowerShell fails. */
export function readWindowsProfiles(): Promise<NetworkProfile[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-NetConnectionProfile | Select-Object Name,InterfaceAlias,NetworkCategory | ConvertTo-Json -Compress',
      ],
      { timeout: 8000, windowsHide: true },
      (error, stdout) => resolve(error ? [] : parseProfiles(String(stdout))),
    );
  });
}

/** The PC's local addresses with their network's name and profile. */
export function pcNetworks(
  interfaces: { alias: string; address: string }[],
  profiles: NetworkProfile[],
): PcNetwork[] {
  return interfaces.map((i) => {
    const p = profiles.find((x) => x.alias === i.alias);
    return { ...i, name: p?.name ?? null, category: p?.category ?? null };
  });
}

/** Every local network of the PC is « Public » (and known): Windows blocks the listener there. */
export const allPublic = (networks: PcNetwork[]) =>
  networks.length > 0 && networks.every((n) => n.category === 'public');
