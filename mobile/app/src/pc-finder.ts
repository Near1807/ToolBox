// Looks for the PC on the local network (android/…/PcFinderPlugin.java,
// Android NSD): the addresses announced with THIS PC's id. Only hints: the
// synchronisation talks to an address only if its certificate is the pinned
// one. Nothing found (a Wi-Fi that blocks multicast…): an empty list.
import { registerPlugin } from '@capacitor/core';
import type { Discover } from '../../../packages/phone/sync-client';

const Native = registerPlugin<{
  find(o: { timeout: number }): Promise<{ services: { host: string; port: number; id: string }[] }>;
}>('PcFinder');

export const findPc: Discover = async (pcId) => {
  const { services } = await Native.find({ timeout: 3000 });
  return services.filter((s) => !s.id || s.id === pcId).map((s) => `https://${s.host}:${s.port}`);
};
