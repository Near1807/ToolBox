// The app's native HTTPS call to the PC (android/…/PinnedHttpPlugin.java):
// only the PC's certificate, pinned by the fingerprint of the QR code.
import { registerPlugin } from '@capacitor/core';
import type { PinnedHttp } from '../../../packages/phone/sync-client';

const Native = registerPlugin<{
  post(o: {
    url: string;
    body: string;
    pin: string;
    token?: string;
    connectTimeout?: number;
  }): Promise<{ status: number; body: string }>;
}>('PinnedHttp');

export const pinnedHttp: PinnedHttp = (request) => Native.post(request);
