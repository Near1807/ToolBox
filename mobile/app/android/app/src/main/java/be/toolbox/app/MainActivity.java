package be.toolbox.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin: HTTPS to the PC with its pinned certificate (synchronisation).
        registerPlugin(PinnedHttpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
