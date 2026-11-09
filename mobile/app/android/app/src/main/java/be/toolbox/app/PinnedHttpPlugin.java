package be.toolbox.app;

// The phone's HTTPS call to the PC (ADR 0044): it accepts ONLY the PC's
// certificate, pinned by the first 16 bytes of its SHA-256 (read in the QR
// code). Any other certificate: the connection is refused before anything
// is sent. The PC's address is a local IP, so no host name is checked: the
// certificate itself is what is trusted. Called by the page
// (mobile/app/src/pinned-http.ts), never by the modules.

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

@CapacitorPlugin(name = "PinnedHttp")
public class PinnedHttpPlugin extends Plugin {

    private static String hex(byte[] bytes, int count) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < count && i < bytes.length; i++) out.append(String.format("%02x", bytes[i]));
        return out.toString();
    }

    private static X509TrustManager pinned(final String pin) {
        return new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                throw new CertificateException("client");
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                if (chain == null || chain.length == 0) throw new CertificateException("certificat absent");
                try {
                    byte[] digest = MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded());
                    if (!hex(digest, 16).equals(pin)) throw new CertificateException("certificat refusé (empreinte différente)");
                } catch (java.security.NoSuchAlgorithmException e) {
                    throw new CertificateException(e);
                }
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        };
    }

    @PluginMethod
    public void post(final PluginCall call) {
        final String url = call.getString("url");
        final String body = call.getString("body", "");
        final String pin = call.getString("pin", "");
        final String token = call.getString("token", "");
        final int connectTimeout = Math.max(1000, Math.min(15000, call.getInt("connectTimeout", 8000)));
        if (url == null || !url.startsWith("https://") || pin.length() != 32) {
            call.reject("Requête de synchro invalide");
            return;
        }
        getBridge().execute(() -> {
            HttpsURLConnection connection = null;
            try {
                SSLContext context = SSLContext.getInstance("TLS");
                context.init(null, new TrustManager[] { pinned(pin) }, null);
                connection = (HttpsURLConnection) new URL(url).openConnection();
                connection.setSSLSocketFactory(context.getSocketFactory());
                connection.setHostnameVerifier((host, session) -> true);
                connection.setConnectTimeout(connectTimeout);
                connection.setReadTimeout(120000);
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("content-type", "application/json; charset=utf-8");
                if (token != null && !token.isEmpty()) connection.setRequestProperty("authorization", "Bearer " + token);
                byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(payload.length);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(payload);
                }
                int status = connection.getResponseCode();
                InputStream in = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                if (in != null) {
                    byte[] chunk = new byte[16384];
                    int n;
                    while ((n = in.read(chunk)) > 0) buffer.write(chunk, 0, n);
                    in.close();
                }
                JSObject result = new JSObject();
                result.put("status", status);
                result.put("body", buffer.toString("UTF-8"));
                call.resolve(result);
            } catch (javax.net.ssl.SSLHandshakeException e) {
                call.reject("certificat refusé : " + e.getMessage());
            } catch (Exception e) {
                call.reject("réseau : " + e.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }
}
