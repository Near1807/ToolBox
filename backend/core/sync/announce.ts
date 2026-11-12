// The PC announces itself on the local network (mDNS / DNS-SD, ADR 0044,
// v0.33.0), so that a paired phone finds it again on another Wi-Fi without
// anything to type. ONLY while the synchronisation's listener runs (Thomas
// turned it on): turned off, nothing is announced, nothing listens.
// Service « _toolbox-sync._tcp », with the PC's device id (TXT « id ») and
// the listener's port. What the phone finds is only a hint: it talks to the
// address only if the certificate is the pinned one.
// Some networks (a student residence's Wi-Fi…) block multicast: then the
// phone uses its known addresses or « Nouvelle adresse du PC ».
import Bonjour from 'bonjour-service';

export const SERVICE_TYPE = 'toolbox-sync';

/** Starts the announcement; the function returned stops it. */
export type Announcer = (o: {
  port: number;
  id: string;
  onError: (error: Error) => void;
}) => () => Promise<void>;

export const mdnsAnnouncer: Announcer = ({ port, id, onError }) => {
  const bonjour = new Bonjour({}, (error: Error) => onError(error));
  bonjour.publish({
    name: `ToolBox PC ${id.slice(0, 8)}`,
    type: SERVICE_TYPE,
    port,
    txt: { id },
    disableIPv6: true,
  });
  return () =>
    new Promise<void>((resolve) => {
      bonjour.unpublishAll(() => bonjour.destroy(() => resolve()));
      // unpublishAll never answers when the socket failed: never wait for long.
      setTimeout(resolve, 1500);
    });
};
