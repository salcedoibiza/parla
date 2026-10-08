package app.parla.talk;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Puente entre la interfaz web (JavaScript) y las funciones nativas de Android:
 * reconocimiento de voz, voz sintética, traducción, compartir, permisos, etc.
 * Todos los eventos se envían a JS a través de window.__parlaNative(evento).
 */
public class Bridge {
    static final String TAG = "ParlaBridge";
    static final String VERSION = BuildConfig.VERSION_NAME;

    final MainActivity activity;
    final WebView web;
    final Handler main = new Handler(Looper.getMainLooper());
    final ExecutorService pool = Executors.newFixedThreadPool(4);

    SpeechRecognizer recognizer;
    int speechSession = 0;
    long lastRms = 0;

    TextToSpeech tts;
    boolean ttsReady = false;
    boolean ttsFailed = false;
    final List<String[]> ttsPending = new ArrayList<String[]>();

    Ocr ocr;
    VoiceTracker voice;

    Bridge(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        initTts();
    }

    // ================= lector de texto (ML Kit) =================

    @JavascriptInterface
    public boolean hasOcr() {
        return true;
    }

    @JavascriptInterface
    public void ocrWarmUp() {
        if (ocr == null) ocr = new Ocr(this);
        ocr.warmUp();
    }

    @JavascriptInterface
    public void ocr(String id, String dataUrl) {
        if (ocr == null) ocr = new Ocr(this);
        ocr.process(id, dataUrl);
    }

    // ================= tono de voz (modo escucha) =================

    @JavascriptInterface
    public boolean voiceStart() {
        if (!hasMicPermission()) return false;
        if (voice == null) voice = new VoiceTracker();
        return voice.start();
    }

    @JavascriptInterface
    public void voiceStop() {
        if (voice != null) voice.stop();
    }

    @JavascriptInterface
    public String voiceStats(double t0, double t1) {
        if (voice == null) return "{}";
        return voice.stats((long) t0, (long) t1);
    }

    // ================= eventos hacia JS =================

    void emit(final JSONObject ev) {
        final String js = "window.__parlaNative&&window.__parlaNative(" + ev.toString() + ")";
        main.post(new Runnable() {
            public void run() {
                try {
                    web.evaluateJavascript(js, null);
                } catch (Exception e) {
                    Log.w(TAG, "emit", e);
                }
            }
        });
    }

    JSONObject ev(String type) {
        JSONObject o = new JSONObject();
        try { o.put("type", type); } catch (Exception e) { }
        return o;
    }

    void emitLink(String url) {
        try {
            JSONObject o = ev("link");
            o.put("url", url);
            emit(o);
        } catch (Exception e) { }
    }

    void emitPermission(String perm, boolean granted) {
        try {
            JSONObject o = ev("perm");
            o.put("perm", perm);
            o.put("granted", granted);
            emit(o);
        } catch (Exception e) { }
    }

    void emitUiMode(boolean dark) {
        try {
            JSONObject o = ev("uimode");
            o.put("dark", dark);
            emit(o);
        } catch (Exception e) { }
    }

    void emitLifecycle(String state) {
        try {
            JSONObject o = ev("lifecycle");
            o.put("state", state);
            emit(o);
        } catch (Exception e) { }
    }

    // ================= información =================

    @JavascriptInterface
    public String info() {
        try {
            JSONObject o = new JSONObject();
            o.put("version", VERSION);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
            o.put("locale", Locale.getDefault().toLanguageTag());
            o.put("dark", activity.isSystemDark());
            o.put("speech", SpeechRecognizer.isRecognitionAvailable(activity));
            o.put("mic", hasMicPermission());
            o.put("ocr", true);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public String getInitialLink() {
        String l = activity.takePendingLink();
        return l == null ? "" : l;
    }

    @JavascriptInterface
    public void log(String msg) {
        Log.i(TAG, "js: " + msg);
    }

    // ================= permisos =================

    @JavascriptInterface
    public boolean hasMicPermission() {
        return activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public boolean hasCameraPermission() {
        return activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void requestMicPermission() {
        main.post(new Runnable() {
            public void run() { activity.requestMic(); }
        });
    }

    @JavascriptInterface
    public void openAppSettings() {
        main.post(new Runnable() {
            public void run() {
                try {
                    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    i.setData(Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(i);
                } catch (Exception e) {
                    Log.w(TAG, "settings", e);
                }
            }
        });
    }

    // ================= reconocimiento de voz =================

    @JavascriptInterface
    public void startListening(final int sid, final String bcp, final boolean preferOffline) {
        main.post(new Runnable() {
            public void run() { doStartListening(sid, bcp, preferOffline, false); }
        });
    }

    /** Escucha larga (modo Escucha): en Android 13+ pide sesión por segmentos para no reiniciar. */
    @JavascriptInterface
    public void startContinuous(final int sid, final String bcp) {
        main.post(new Runnable() {
            public void run() { doStartListening(sid, bcp, false, true); }
        });
    }

    void doStartListening(int sid, String bcp, boolean preferOffline, boolean continuous) {
        speechSession = sid;
        if (!hasMicPermission()) {
            sttEvent(sid, "error", null, "permission", 0);
            sttEvent(sid, "end", null, null, 0);
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            sttEvent(sid, "error", null, "unavailable", 0);
            sttEvent(sid, "end", null, null, 0);
            return;
        }
        try {
            if (recognizer == null) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(activity);
            } else {
                recognizer.cancel();
            }
            recognizer.setRecognitionListener(new Listener(sid));
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, bcp);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, bcp);
            i.putExtra("android.speech.extra.EXTRA_ADDITIONAL_LANGUAGES", new String[]{bcp});
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.getPackageName());
            i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline);
            if (continuous) {
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 900L);
                if (Build.VERSION.SDK_INT >= 33) {
                    // Sesión por segmentos: devuelve frases sin cortar la escucha
                    i.putExtra("android.speech.extra.SEGMENTED_SESSION", "android.speech.extras.SPEECH_INPUT_MINIMUM_LENGTH_MILLIS");
                    i.putExtra("android.speech.extras.SPEECH_INPUT_MINIMUM_LENGTH_MILLIS", 30L * 60L * 1000L);
                }
            } else {
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
            }
            recognizer.startListening(i);
        } catch (Exception e) {
            Log.w(TAG, "stt start", e);
            sttEvent(sid, "error", null, "start:" + e.getMessage(), 0);
            sttEvent(sid, "end", null, null, 0);
        }
    }

    @JavascriptInterface
    public void stopListening() {
        main.post(new Runnable() {
            public void run() {
                try {
                    if (recognizer != null) recognizer.stopListening();
                } catch (Exception e) {
                    Log.w(TAG, "stt stop", e);
                }
            }
        });
    }

    @JavascriptInterface
    public void cancelListening() {
        main.post(new Runnable() {
            public void run() {
                try {
                    if (recognizer != null) recognizer.cancel();
                } catch (Exception e) {
                    Log.w(TAG, "stt cancel", e);
                }
            }
        });
    }

    void sttEvent(int sid, String name, String text, String code, float level) {
        try {
            JSONObject o = ev("stt");
            o.put("sid", sid);
            o.put("ev", name);
            if (text != null) o.put("text", text);
            if (code != null) o.put("code", code);
            if (level != 0) o.put("level", level);
            emit(o);
        } catch (Exception e) { }
    }

    static String firstResult(Bundle b) {
        if (b == null) return "";
        ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null || list.isEmpty()) return "";
        String s = list.get(0);
        return s == null ? "" : s;
    }

    static String errorName(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "audio";
            case SpeechRecognizer.ERROR_CLIENT: return "client";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "permission";
            case SpeechRecognizer.ERROR_NETWORK: return "network";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "network";
            case SpeechRecognizer.ERROR_NO_MATCH: return "nomatch";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "busy";
            case SpeechRecognizer.ERROR_SERVER: return "server";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "timeout";
            case 12: return "language";            // ERROR_LANGUAGE_NOT_SUPPORTED (API 31)
            case 13: return "language";            // ERROR_LANGUAGE_UNAVAILABLE (API 31)
            default: return "error" + error;
        }
    }

    class Listener implements RecognitionListener {
        final int sid;
        boolean finished = false;

        Listener(int sid) { this.sid = sid; }

        public void onReadyForSpeech(Bundle params) { sttEvent(sid, "ready", null, null, 0); }

        public void onBeginningOfSpeech() { sttEvent(sid, "begin", null, null, 0); }

        public void onRmsChanged(float rmsdB) {
            long now = System.currentTimeMillis();
            if (now - lastRms < 90) return;
            lastRms = now;
            float level = Math.max(0.01f, Math.min(1f, (rmsdB + 2f) / 12f));
            sttEvent(sid, "level", null, null, level);
        }

        public void onBufferReceived(byte[] buffer) { }

        public void onEndOfSpeech() { sttEvent(sid, "speechend", null, null, 0); }

        public void onError(int error) {
            if (finished) return;
            finished = true;
            sttEvent(sid, "error", null, errorName(error), 0);
            sttEvent(sid, "end", null, null, 0);
        }

        public void onResults(Bundle results) {
            if (finished) return;
            finished = true;
            sttEvent(sid, "final", firstResult(results), null, 0);
            sttEvent(sid, "end", null, null, 0);
        }

        public void onPartialResults(Bundle partialResults) {
            String t = firstResult(partialResults);
            if (t.length() > 0) sttEvent(sid, "partial", t, null, 0);
        }

        public void onEvent(int eventType, Bundle params) { }

        // Android 13+: resultados por segmentos en una sesión larga
        public void onSegmentResults(Bundle segmentResults) {
            if (finished) return;
            String t = firstResult(segmentResults);
            if (t.length() > 0) sttEvent(sid, "final", t, null, 0);
        }

        public void onEndOfSegmentedSession() {
            if (finished) return;
            finished = true;
            sttEvent(sid, "end", null, null, 0);
        }
    }

    // ================= silenciar pitidos del reconocedor =================

    final int[] quietStreams = new int[]{AudioManager.STREAM_NOTIFICATION, AudioManager.STREAM_SYSTEM};
    boolean quiet = false;

    @JavascriptInterface
    public void setQuiet(final boolean on) {
        main.post(new Runnable() {
            public void run() { applyQuiet(on); }
        });
    }

    void applyQuiet(boolean on) {
        if (quiet == on) return;
        quiet = on;
        try {
            AudioManager am = (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
            for (int s : quietStreams) {
                try {
                    am.adjustStreamVolume(s, on ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE, 0);
                } catch (Exception e) {
                    Log.w(TAG, "quiet " + s, e);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "quiet", e);
        }
    }

    // ================= voz sintética (TTS) =================

    void initTts() {
        try {
            tts = new TextToSpeech(activity, new TextToSpeech.OnInitListener() {
                public void onInit(int status) {
                    ttsReady = status == TextToSpeech.SUCCESS;
                    ttsFailed = !ttsReady;
                    if (ttsReady) {
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            public void onStart(String id) { ttsEvent(id, "start", null); }
                            public void onDone(String id) { ttsEvent(id, "done", null); }
                            public void onError(String id) { ttsEvent(id, "error", "error"); }
                            public void onError(String id, int code) { ttsEvent(id, "error", "e" + code); }
                            public void onStop(String id, boolean interrupted) { ttsEvent(id, "done", "stopped"); }
                        });
                        List<String[]> copy = new ArrayList<String[]>(ttsPending);
                        ttsPending.clear();
                        for (String[] p : copy) doSpeak(p[0], p[1], p[2], Float.parseFloat(p[3]));
                    } else {
                        for (String[] p : ttsPending) ttsEvent(p[0], "error", "init");
                        ttsPending.clear();
                    }
                }
            });
        } catch (Exception e) {
            ttsFailed = true;
            Log.w(TAG, "tts init", e);
        }
    }

    void ttsEvent(String id, String name, String code) {
        try {
            JSONObject o = ev("tts");
            o.put("id", id);
            o.put("ev", name);
            if (code != null) o.put("code", code);
            emit(o);
        } catch (Exception e) { }
    }

    @JavascriptInterface
    public void speak(final String id, final String text, final String bcp, final float rate) {
        main.post(new Runnable() {
            public void run() {
                if (ttsFailed || tts == null) {
                    ttsEvent(id, "error", "init");
                    return;
                }
                if (!ttsReady) {
                    ttsPending.add(new String[]{id, text, bcp, String.valueOf(rate)});
                    return;
                }
                doSpeak(id, text, bcp, rate);
            }
        });
    }

    void doSpeak(String id, String text, String bcp, float rate) {
        try {
            Locale loc = Locale.forLanguageTag(bcp);
            int r = tts.setLanguage(loc);
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                // intenta solo con el idioma sin región
                int r2 = tts.setLanguage(new Locale(loc.getLanguage()));
                if (r2 == TextToSpeech.LANG_MISSING_DATA || r2 == TextToSpeech.LANG_NOT_SUPPORTED) {
                    ttsEvent(id, "nolang", r2 == TextToSpeech.LANG_MISSING_DATA ? "missing" : "unsupported");
                    return;
                }
            }
            tts.setSpeechRate(rate);
            Bundle params = new Bundle();
            int res = tts.speak(text, TextToSpeech.QUEUE_ADD, params, id);
            if (res != TextToSpeech.SUCCESS) ttsEvent(id, "error", "speak");
        } catch (Exception e) {
            Log.w(TAG, "tts speak", e);
            ttsEvent(id, "error", "exception");
        }
    }

    @JavascriptInterface
    public void stopSpeaking() {
        main.post(new Runnable() {
            public void run() {
                try {
                    if (tts != null) tts.stop();
                } catch (Exception e) { }
            }
        });
    }

    @JavascriptInterface
    public String ttsLanguages() {
        JSONArray a = new JSONArray();
        try {
            if (tts != null && ttsReady) {
                Set<String> seen = new HashSet<String>();
                Set<Locale> locs = tts.getAvailableLanguages();
                if (locs != null) {
                    for (Locale l : locs) {
                        String tag = l.toLanguageTag();
                        if (seen.add(tag)) a.put(tag);
                    }
                }
            }
        } catch (Exception e) { }
        return a.toString();
    }

    @JavascriptInterface
    public void installTtsData() {
        main.post(new Runnable() {
            public void run() {
                try {
                    Intent i = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(i);
                } catch (Exception e) {
                    try {
                        Intent i = new Intent("com.android.settings.TTS_SETTINGS");
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(i);
                    } catch (Exception e2) { }
                }
            }
        });
    }

    // ================= traducción (Google Translate web) =================

    @JavascriptInterface
    public void translate(final String id, final String text, final String sl, final String tl) {
        pool.execute(new Runnable() {
            public void run() { doTranslate(id, text, sl, tl); }
        });
    }

    void doTranslate(String id, String text, String sl, String tl) {
        JSONObject o = ev("translate");
        HttpURLConnection c = null;
        try {
            o.put("id", id);
            String base = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&ie=UTF-8&oe=UTF-8"
                    + "&sl=" + URLEncoder.encode(sl, "UTF-8")
                    + "&tl=" + URLEncoder.encode(tl, "UTF-8");
            String q = URLEncoder.encode(text, "UTF-8");
            boolean post = q.length() > 1800;
            URL url = new URL(post ? base : base + "&q=" + q);
            c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(6000);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36");
            if (post) {
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
                OutputStream os = c.getOutputStream();
                os.write(("q=" + q).getBytes("UTF-8"));
                os.close();
            }
            int code = c.getResponseCode();
            if (code != 200) throw new Exception("http " + code);
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
            String body = new String(bos.toByteArray(), "UTF-8");
            JSONArray root = new JSONArray(body);
            StringBuilder sb = new StringBuilder();
            JSONArray segs = root.optJSONArray(0);
            if (segs != null) {
                for (int i = 0; i < segs.length(); i++) {
                    JSONArray seg = segs.optJSONArray(i);
                    if (seg != null && !seg.isNull(0)) {
                        Object v = seg.opt(0);
                        if (v instanceof String) sb.append((String) v);
                    }
                }
            }
            o.put("ok", true);
            o.put("text", sb.toString());
            Object det = root.opt(2);
            if (det instanceof String) o.put("detected", det);
        } catch (Exception e) {
            try {
                o.put("ok", false);
                o.put("error", String.valueOf(e.getMessage()));
            } catch (Exception e2) { }
        } finally {
            // Sin disconnect(): así Android reutiliza la conexión y la siguiente traducción es más rápida
            if (c != null) {
                try { c.getInputStream().close(); } catch (Exception e) { }
            }
        }
        emit(o);
    }

    // ================= utilidades =================

    @JavascriptInterface
    public void share(final String text, final String title) {
        main.post(new Runnable() {
            public void run() {
                try {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, text);
                    if (title != null && title.length() > 0) send.putExtra(Intent.EXTRA_SUBJECT, title);
                    activity.startActivity(Intent.createChooser(send, title == null || title.length() == 0 ? null : title));
                } catch (Exception e) {
                    Log.w(TAG, "share", e);
                }
            }
        });
    }

    @JavascriptInterface
    public void copy(final String text) {
        main.post(new Runnable() {
            public void run() {
                try {
                    ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("Parla", text));
                } catch (Exception e) {
                    Log.w(TAG, "copy", e);
                }
            }
        });
    }

    @JavascriptInterface
    public void keepAwake(final boolean on) {
        main.post(new Runnable() {
            public void run() {
                if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }

    @JavascriptInterface
    public void setSystemBars(final String color, final boolean darkIcons) {
        main.post(new Runnable() {
            public void run() {
                try {
                    activity.setBars(Color.parseColor(color), darkIcons);
                } catch (Exception e) {
                    Log.w(TAG, "bars", e);
                }
            }
        });
    }

    @JavascriptInterface
    public boolean isSystemDark() {
        return activity.isSystemDark();
    }

    @JavascriptInterface
    public void vibrate(final int ms) {
        try {
            Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) v.vibrate(ms);
        } catch (Exception e) { }
    }

    @JavascriptInterface
    public void openUrl(final String url) {
        main.post(new Runnable() {
            public void run() { activity.openExternal(Uri.parse(url)); }
        });
    }

    @JavascriptInterface
    public void openHotspotSettings() {
        main.post(new Runnable() {
            public void run() {
                Intent[] options = new Intent[]{
                        new Intent().setComponent(new ComponentName("com.android.settings", "com.android.settings.TetherSettings")),
                        new Intent().setComponent(new ComponentName("com.android.settings", "com.android.settings.Settings$TetherSettingsActivity")),
                        new Intent("android.settings.TETHER_SETTINGS"),
                        new Intent(Settings.ACTION_WIRELESS_SETTINGS),
                        new Intent(Settings.ACTION_SETTINGS)
                };
                for (Intent i : options) {
                    try {
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(i);
                        return;
                    } catch (ActivityNotFoundException e) {
                        // siguiente opción
                    } catch (SecurityException e) {
                        // siguiente opción
                    } catch (Exception e) {
                        // siguiente opción
                    }
                }
            }
        });
    }

    @JavascriptInterface
    public void openVoiceSettings() {
        main.post(new Runnable() {
            public void run() {
                try {
                    Intent i = new Intent("com.android.settings.TTS_SETTINGS");
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(i);
                } catch (Exception e) {
                    try {
                        Intent i = new Intent(Settings.ACTION_SETTINGS);
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(i);
                    } catch (Exception e2) { }
                }
            }
        });
    }

    void releaseQuiet() {
        applyQuiet(false);
    }

    void destroy() {
        releaseQuiet();
        if (voice != null) voice.stop();
        if (ocr != null) ocr.close();
        try {
            if (recognizer != null) recognizer.destroy();
        } catch (Exception e) { }
        try {
            if (tts != null) tts.shutdown();
        } catch (Exception e) { }
        pool.shutdownNow();
    }
}
