package be.toolbox.app;

// The Timer's ongoing notification moves to the next phase by itself (the
// alarm set by TimerOngoing), and is rebuilt after a restart of the phone or
// an update of the app (from the kept plan; past its end, it is removed).

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class TimerOngoingReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (
            TimerOngoing.ACTION_TICK.equals(action) ||
            Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action) ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        ) TimerOngoing.refresh(context);
    }
}
