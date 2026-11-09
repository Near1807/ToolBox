package be.toolbox.app;

// The Timer's ongoing notification (ADR 0044, v0.33.0), like Android's Clock:
// during a session, a notification that stays (not swipeable) in the shade
// and on the lock screen, with the time left of the phase counting down by
// itself (Android's own chronometer) and the phase's name (« Travail · cycle
// 2 sur 4 », « Pause »). Touching it opens the Timer.
// The page gives the WHOLE plan (every phase still to come, its label, its
// end time; texts of modules/timer/shared/notices.ts) at start, resume and
// « +5 min »; from then on this class moves from one phase to the next by
// itself (AlarmManager + TimerOngoingReceiver): the app's Worker sleeps in
// the background. The plan is kept (SharedPreferences) to be rebuilt after a
// restart of the phone, and the notification goes away at the end.
// Its channel is silent: the sound stays the one of the phase-end alerts
// (scheduled separately, unchanged).

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONArray;
import org.json.JSONObject;

final class TimerOngoing {

    static final String CHANNEL = "timer-ongoing";
    static final int NOTIFICATION_ID = 7500;
    static final String PREFS = "toolbox-timer-ongoing";
    static final String KEY_PLAN = "plan";
    /** Extra of the intent that opens the app: the page to show, or the action to do. */
    static final String EXTRA_ROUTE = "toolbox.route";
    static final String EXTRA_ACTION = "toolbox.timerAction";
    static final String ACTION_TICK = "be.toolbox.app.TIMER_ONGOING_TICK";

    private TimerOngoing() {}

    static void save(Context context, String plan) {
        prefs(context).edit().putString(KEY_PLAN, plan).apply();
    }

    static String saved(Context context) {
        return prefs(context).getString(KEY_PLAN, null);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Removes the notification, its next update and the kept plan. */
    static void clear(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(tickIntent(context));
        prefs(context).edit().remove(KEY_PLAN).apply();
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Timer en cours", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Le temps restant de la phase en cours (sans son : les alertes de fin de phase restent à part)");
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    private static PendingIntent tickIntent(Context context) {
        Intent intent = new Intent(context, TimerOngoingReceiver.class).setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(
            context,
            NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /** Opens the app on the Timer; with an action, the page does it (the Timer's server decides). */
    private static PendingIntent openIntent(Context context, String action, int code) {
        Intent intent = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ROUTE, "/m/timer");
        if (action != null) intent.putExtra(EXTRA_ACTION, action);
        return PendingIntent.getActivity(
            context,
            NOTIFICATION_ID + code,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static String clock(long seconds) {
        long s = Math.max(0, seconds);
        long h = s / 3600;
        long m = (s % 3600) / 60;
        long sec = s % 60;
        return h > 0 ? String.format("%d:%02d:%02d", h, m, sec) : String.format("%d:%02d", m, sec);
    }

    /**
     * Shows the kept plan as it stands now, and sets the next update (the end
     * of the current phase). Past the last phase: everything is removed.
     */
    static void refresh(Context context) {
        String text = saved(context);
        if (text == null) return;
        try {
            JSONObject plan = new JSONObject(text);
            String name = plan.optString("name", "Timer");
            String status = plan.optString("status", "running");
            ensureChannel(context);
            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(openIntent(context, null, 0));
            long nextChange = -1;
            if ("paused".equals(status)) {
                builder
                    .setContentTitle("En pause · " + plan.optString("label", ""))
                    .setContentText("Reste " + clock(plan.optLong("remaining", 0)) + " · " + name)
                    .setShowWhen(false)
                    .setUsesChronometer(false)
                    .addAction(0, "Reprendre", openIntent(context, "resume", 1))
                    .addAction(0, "Arrêter", openIntent(context, "stop", 2));
            } else {
                JSONArray steps = plan.optJSONArray("steps");
                long now = System.currentTimeMillis();
                JSONObject current = null;
                if (steps != null)
                    for (int i = 0; i < steps.length(); i++) {
                        JSONObject step = steps.getJSONObject(i);
                        if (step.getLong("endsAt") > now) {
                            current = step;
                            break;
                        }
                    }
                if (current == null) {
                    clear(context);
                    return;
                }
                nextChange = current.getLong("endsAt");
                builder
                    .setContentTitle(current.optString("label", "Timer"))
                    .setContentText(name)
                    .setWhen(nextChange)
                    .setShowWhen(true)
                    .setUsesChronometer(true)
                    .setChronometerCountDown(true)
                    .addAction(0, "Pause", openIntent(context, "pause", 1))
                    .addAction(0, "Arrêter", openIntent(context, "stop", 2));
            }
            try {
                NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
            } catch (SecurityException e) {
                // Notifications not allowed: nothing shown (the Timer page says so).
            }
            schedule(context, nextChange);
        } catch (Exception e) {
            clear(context);
        }
    }

    /** The next update at the end of the current phase (exact when allowed). */
    private static void schedule(Context context, long at) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent tick = tickIntent(context);
        alarms.cancel(tick);
        if (at <= 0) return;
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms();
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, tick);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, tick);
    }
}
