package be.toolbox.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin: HTTPS to the PC with its pinned certificate (synchronisation).
        registerPlugin(PinnedHttpPlugin.class);
        // Finds the PC on the local network (mDNS), only hints checked by the pinned certificate.
        registerPlugin(PcFinderPlugin.class);
        // The live channel to the PC (automatic synchronisation, app on screen only).
        registerPlugin(LiveChannelPlugin.class);
        // The Timer's ongoing notification (shade and lock screen).
        registerPlugin(TimerOngoingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
