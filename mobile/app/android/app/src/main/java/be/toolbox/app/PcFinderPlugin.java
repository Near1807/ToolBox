package be.toolbox.app;

// Looks for the PC on the local network (ADR 0044, v0.33.0): Android's
// Network Service Discovery (mDNS / DNS-SD), service « _toolbox-sync._tcp »
// that the PC announces only while its synchronisation is turned on. It only
// returns hints (address, port, the PC's id from the TXT record): the page
// then talks to an address ONLY if its certificate is the pinned one
// (PinnedHttpPlugin). Called by the page (mobile/app/src/pc-finder.ts) when
// no known address answers. Some Wi-Fi networks block multicast: then it
// finds nothing, and the known addresses or « Nouvelle adresse du PC » remain.

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "PcFinder")
public class PcFinderPlugin extends Plugin {

    private static final String TYPE = "_toolbox-sync._tcp";
    private final Handler handler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void find(final PluginCall call) {
        final int timeout = Math.max(1000, Math.min(10000, call.getInt("timeout", 3000)));
        final NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        if (nsd == null) {
            call.resolve(result(new JSArray()));
            return;
        }
        final List<NsdServiceInfo> seen = new ArrayList<>();
        final AtomicBoolean started = new AtomicBoolean(false);
        final NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {
                started.set(true);
            }

            @Override
            public void onServiceFound(NsdServiceInfo info) {
                synchronized (seen) {
                    seen.add(info);
                }
            }

            @Override
            public void onServiceLost(NsdServiceInfo info) {}

            @Override
            public void onDiscoveryStopped(String serviceType) {}

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {}

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {}
        };
        try {
            nsd.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
        } catch (Exception e) {
            call.resolve(result(new JSArray()));
            return;
        }
        handler.postDelayed(
            () -> {
                if (started.get()) {
                    try {
                        nsd.stopServiceDiscovery(listener);
                    } catch (Exception ignored) {
                        // Already stopped.
                    }
                }
                List<NsdServiceInfo> found;
                synchronized (seen) {
                    found = new ArrayList<>(seen);
                }
                resolveAll(nsd, found, 0, new JSArray(), call);
            },
            timeout
        );
    }

    private static JSObject result(JSArray services) {
        JSObject out = new JSObject();
        out.put("services", services);
        return out;
    }

    /** One resolution at a time (older Android refuses two at once), each with its own wait. */
    @SuppressWarnings("deprecation")
    private void resolveAll(
        final NsdManager nsd,
        final List<NsdServiceInfo> found,
        final int index,
        final JSArray out,
        final PluginCall call
    ) {
        if (index >= found.size() || index >= 8) {
            call.resolve(result(out));
            return;
        }
        final AtomicBoolean done = new AtomicBoolean(false);
        final Runnable next = () -> {
            if (done.compareAndSet(false, true)) handler.post(() -> resolveAll(nsd, found, index + 1, out, call));
        };
        handler.postDelayed(next, 2500);
        try {
            nsd.resolveService(
                found.get(index),
                new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo info, int errorCode) {
                        next.run();
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo info) {
                        InetAddress host = info.getHost();
                        if (host != null && host.getAddress().length == 4) {
                            JSObject service = new JSObject();
                            service.put("host", host.getHostAddress());
                            service.put("port", info.getPort());
                            Map<String, byte[]> attributes = info.getAttributes();
                            byte[] id = attributes == null ? null : attributes.get("id");
                            service.put("id", id == null ? "" : new String(id, StandardCharsets.UTF_8));
                            synchronized (out) {
                                out.put(service);
                            }
                        }
                        next.run();
                    }
                }
            );
        } catch (Exception e) {
            next.run();
        }
    }
}
