package be.toolbox.app;

// The page's side of the Timer's ongoing notification (TimerOngoing): it
// gives the whole plan (show) or removes it (clear). Touching the
// notification or one of its buttons opens the app; the page reads where to
// go and what to do (« pause », « resume », « stop ») with `pending` and the
// event « open », and does it through the Timer's server, which stays the
// only truth (the Worker runs only while the app is open).

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TimerOngoing")
public class TimerOngoingPlugin extends Plugin {

    @PluginMethod
    public void show(final PluginCall call) {
        JSObject plan = call.getObject("plan");
        if (plan == null) {
            call.reject("Plan absent");
            return;
        }
        TimerOngoing.save(getContext(), plan.toString());
        TimerOngoing.refresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clear(final PluginCall call) {
        TimerOngoing.clear(getContext());
        call.resolve();
    }

    /** The app was opened from the notification: where to go, what to do (read once). */
    @PluginMethod
    public void pending(final PluginCall call) {
        JSObject result = new JSObject();
        Intent intent = getActivity() == null ? null : getActivity().getIntent();
        if (intent != null && intent.hasExtra(TimerOngoing.EXTRA_ROUTE)) {
            result.put("route", intent.getStringExtra(TimerOngoing.EXTRA_ROUTE));
            result.put("action", intent.getStringExtra(TimerOngoing.EXTRA_ACTION));
            intent.removeExtra(TimerOngoing.EXTRA_ROUTE);
            intent.removeExtra(TimerOngoing.EXTRA_ACTION);
        }
        call.resolve(result);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || !intent.hasExtra(TimerOngoing.EXTRA_ROUTE)) return;
        JSObject event = new JSObject();
        event.put("route", intent.getStringExtra(TimerOngoing.EXTRA_ROUTE));
        event.put("action", intent.getStringExtra(TimerOngoing.EXTRA_ACTION));
        notifyListeners("open", event);
    }
}
