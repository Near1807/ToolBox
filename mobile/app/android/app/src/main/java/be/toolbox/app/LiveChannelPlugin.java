package be.toolbox.app;

// The live channel to the PC (ADR 0044, v0.33.0, automatic synchronisation):
// a WebSocket on the PC's synchronisation listener (wss://<PC>/sync/live),
// with the SAME pinned certificate as PinnedHttpPlugin (first 16 bytes of
// its SHA-256, from the QR code) and the device's token. The PC only says
// « changed » on it; the page then runs a normal synchronisation. Open only
// while the app is on screen; closed in the background (no background sync).

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

@CapacitorPlugin(name = "LiveChannel")
public class LiveChannelPlugin extends Plugin {

    private WebSocket socket = null;
    /** Each open gets a number: events of an older socket are ignored by the page. */
    private int generation = 0;

    @PluginMethod
    public void open(final PluginCall call) {
        final String url = call.getString("url");
        final String pin = call.getString("pin", "");
        final String token = call.getString("token", "");
        if (url == null || !url.startsWith("https://") || pin.length() != 32 || token.isEmpty()) {
            call.reject("Canal de synchro invalide");
            return;
        }
        closeSocket();
        final int mine = ++generation;
        try {
            X509TrustManager trust = PinnedHttpPlugin.pinned(pin);
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, new TrustManager[] { trust }, null);
            OkHttpClient client = new OkHttpClient.Builder()
                .sslSocketFactory(context.getSocketFactory(), trust)
                .hostnameVerifier((host, session) -> true)
                .connectTimeout(4, TimeUnit.SECONDS)
                .pingInterval(20, TimeUnit.SECONDS)
                .build();
            Request request = new Request.Builder()
                .url(url + "/sync/live")
                .header("Authorization", "Bearer " + token)
                .build();
            socket = client.newWebSocket(
                request,
                new WebSocketListener() {
                    @Override
                    public void onOpen(WebSocket webSocket, Response response) {
                        emit("open", mine, null, 0);
                    }

                    @Override
                    public void onMessage(WebSocket webSocket, String text) {
                        emit("message", mine, text, 0);
                    }

                    @Override
                    public void onClosing(WebSocket webSocket, int code, String reason) {
                        webSocket.close(1000, null);
                    }

                    @Override
                    public void onClosed(WebSocket webSocket, int code, String reason) {
                        emit("closed", mine, reason, code);
                    }

                    @Override
                    public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                        emit("closed", mine, t == null ? "" : String.valueOf(t.getMessage()), response == null ? 0 : response.code());
                    }
                }
            );
            JSObject result = new JSObject();
            result.put("generation", mine);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Canal de synchro : " + e.getMessage());
        }
    }

    @PluginMethod
    public void close(final PluginCall call) {
        closeSocket();
        call.resolve();
    }

    private void closeSocket() {
        if (socket != null) {
            socket.close(1000, null);
            socket = null;
        }
    }

    private void emit(String type, int mine, String text, int code) {
        JSObject event = new JSObject();
        event.put("type", type);
        event.put("generation", mine);
        event.put("text", text == null ? "" : text);
        event.put("code", code);
        notifyListeners("live", event);
    }

    @Override
    protected void handleOnDestroy() {
        closeSocket();
    }
}
