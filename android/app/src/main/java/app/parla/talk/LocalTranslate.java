package app.parla.talk;

import android.util.Log;

import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.TranslateRemoteModel;
import com.google.mlkit.nl.translate.Translation;
import com.google.mlkit.nl.translate.Translator;
import com.google.mlkit.nl.translate.TranslatorOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Traducción en el propio móvil con ML Kit de Google: muy rápida y sin conexión.
 * Cada idioma se descarga una vez (unos 30 MB).
 */
public class LocalTranslate {
    static final String TAG = "ParlaLocalTr";

    final Bridge bridge;
    final RemoteModelManager models = RemoteModelManager.getInstance();
    final Set<String> downloaded = new HashSet<String>();
    final Set<String> downloading = new HashSet<String>();
    // Traductores abiertos (como mucho 6 parejas de idiomas)
    final Map<String, Translator> clients = new LinkedHashMap<String, Translator>(8, 0.75f, true) {
        protected boolean removeEldestEntry(Map.Entry<String, Translator> e) {
            if (size() > 6) {
                try { e.getValue().close(); } catch (Throwable t) { }
                return true;
            }
            return false;
        }
    };

    LocalTranslate(Bridge bridge) {
        this.bridge = bridge;
        refresh(null);
    }

    static String code(String tag) {
        if (tag == null) return null;
        return TranslateLanguage.fromLanguageTag(tag);
    }

    /** Idiomas que ML Kit sabe traducir. */
    static JSONArray supported() {
        JSONArray a = new JSONArray();
        for (String l : TranslateLanguage.getAllLanguages()) a.put(l);
        return a;
    }

    void refresh(final String reqId) {
        models.getDownloadedModels(TranslateRemoteModel.class)
                .addOnSuccessListener(new OnSuccessListener<Set<TranslateRemoteModel>>() {
                    public void onSuccess(Set<TranslateRemoteModel> set) {
                        synchronized (downloaded) {
                            downloaded.clear();
                            for (TranslateRemoteModel m : set) downloaded.add(m.getLanguage());
                        }
                        emitModels(reqId);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    public void onFailure(Exception e) {
                        Log.w(TAG, "models", e);
                        emitModels(reqId);
                    }
                });
    }

    void emitModels(String reqId) {
        try {
            JSONObject o = new JSONObject();
            o.put("type", "trmodels");
            if (reqId != null) o.put("id", reqId);
            JSONArray d = new JSONArray();
            synchronized (downloaded) { for (String l : downloaded) d.put(l); }
            o.put("downloaded", d);
            JSONArray g = new JSONArray();
            synchronized (downloading) { for (String l : downloading) g.put(l); }
            o.put("downloading", g);
            o.put("supported", supported());
            bridge.emit(o);
        } catch (Throwable t) {
            Log.w(TAG, "emit", t);
        }
    }

    boolean has(String lang) {
        synchronized (downloaded) { return downloaded.contains(lang); }
    }

    void download(final String tag, boolean wifiOnly) {
        final String lang = code(tag);
        if (lang == null) return;
        synchronized (downloading) {
            if (downloading.contains(lang)) return;
            downloading.add(lang);
        }
        emitModels(null);
        DownloadConditions.Builder c = new DownloadConditions.Builder();
        if (wifiOnly) c.requireWifi();
        models.download(new TranslateRemoteModel.Builder(lang).build(), c.build())
                .addOnSuccessListener(new OnSuccessListener<Void>() {
                    public void onSuccess(Void v) {
                        synchronized (downloading) { downloading.remove(lang); }
                        synchronized (downloaded) { downloaded.add(lang); }
                        emitModels(null);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    public void onFailure(Exception e) {
                        synchronized (downloading) { downloading.remove(lang); }
                        Log.w(TAG, "download " + lang, e);
                        emitModels(null);
                        try {
                            JSONObject o = new JSONObject();
                            o.put("type", "trmodelerror");
                            o.put("lang", lang);
                            o.put("error", String.valueOf(e.getMessage()));
                            bridge.emit(o);
                        } catch (Throwable t) { }
                    }
                });
    }

    void delete(String tag) {
        final String lang = code(tag);
        if (lang == null || TranslateLanguage.ENGLISH.equals(lang)) return;
        models.deleteDownloadedModel(new TranslateRemoteModel.Builder(lang).build())
                .addOnCompleteListener(new com.google.android.gms.tasks.OnCompleteListener<Void>() {
                    public void onComplete(com.google.android.gms.tasks.Task<Void> t) { refresh(null); }
                });
    }

    void translate(final String id, final String text, String slTag, String tlTag) {
        final String sl = code(slTag);
        final String tl = code(tlTag);
        if (sl == null || tl == null) { fail(id, "unsupported"); return; }
        if (sl.equals(tl)) { ok(id, text); return; }
        // Hacen falta los dos idiomas (y el inglés, que se usa de puente)
        if (!has(sl) || !has(tl) || !has(TranslateLanguage.ENGLISH)) { fail(id, "nomodel"); return; }
        Translator t;
        synchronized (clients) {
            String key = sl + ">" + tl;
            t = clients.get(key);
            if (t == null) {
                t = Translation.getClient(new TranslatorOptions.Builder().setSourceLanguage(sl).setTargetLanguage(tl).build());
                clients.put(key, t);
            }
        }
        try {
            t.translate(text)
                    .addOnSuccessListener(new OnSuccessListener<String>() {
                        public void onSuccess(String s) { ok(id, s); }
                    })
                    .addOnFailureListener(new OnFailureListener() {
                        public void onFailure(Exception e) { fail(id, String.valueOf(e.getMessage())); }
                    });
        } catch (Throwable e) {
            fail(id, String.valueOf(e.getMessage()));
        }
    }

    void ok(String id, String text) {
        try {
            JSONObject o = new JSONObject();
            o.put("type", "localtr");
            o.put("id", id);
            o.put("ok", true);
            o.put("text", text);
            bridge.emit(o);
        } catch (Throwable t) { }
    }

    void fail(String id, String err) {
        try {
            JSONObject o = new JSONObject();
            o.put("type", "localtr");
            o.put("id", id);
            o.put("ok", false);
            o.put("error", err);
            bridge.emit(o);
        } catch (Throwable t) { }
    }

    void close() {
        synchronized (clients) {
            for (Translator t : clients.values()) {
                try { t.close(); } catch (Throwable e) { }
            }
            clients.clear();
        }
    }
}
