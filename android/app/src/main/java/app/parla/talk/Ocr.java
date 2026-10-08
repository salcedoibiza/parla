package app.parla.talk;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Point;
import android.graphics.Rect;
import android.util.Base64;
import android.util.Log;

import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lector de texto en imágenes con ML Kit de Google (funciona sin conexión).
 * Recibe una imagen en JPEG (base64) desde la página y devuelve los bloques de texto con su posición.
 */
public class Ocr {
    static final String TAG = "ParlaOcr";

    final Bridge bridge;
    final ExecutorService decoder = Executors.newSingleThreadExecutor();
    TextRecognizer recognizer;

    Ocr(Bridge bridge) {
        this.bridge = bridge;
    }

    TextRecognizer get() {
        if (recognizer == null) {
            recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        }
        return recognizer;
    }

    /** Prepara el lector para que la primera lectura sea rápida. */
    void warmUp() {
        decoder.execute(new Runnable() {
            public void run() {
                try {
                    Bitmap b = Bitmap.createBitmap(64, 32, Bitmap.Config.ARGB_8888);
                    get().process(InputImage.fromBitmap(b, 0));
                } catch (Throwable t) {
                    Log.w(TAG, "warm", t);
                }
            }
        });
    }

    void process(final String id, final String dataUrl) {
        decoder.execute(new Runnable() {
            public void run() {
                final long t0 = System.currentTimeMillis();
                Bitmap bmp;
                try {
                    String b64 = dataUrl;
                    int comma = b64.indexOf(',');
                    if (comma >= 0) b64 = b64.substring(comma + 1);
                    byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                    bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                    if (bmp == null) throw new Exception("decode");
                } catch (Throwable t) {
                    fail(id, "decode: " + t.getMessage());
                    return;
                }
                final int w = bmp.getWidth();
                final int h = bmp.getHeight();
                try {
                    get().process(InputImage.fromBitmap(bmp, 0))
                            .addOnSuccessListener(new OnSuccessListener<Text>() {
                                public void onSuccess(Text text) {
                                    emit(id, text, w, h, System.currentTimeMillis() - t0);
                                }
                            })
                            .addOnFailureListener(new OnFailureListener() {
                                public void onFailure(Exception e) {
                                    fail(id, String.valueOf(e.getMessage()));
                                }
                            });
                } catch (Throwable t) {
                    fail(id, String.valueOf(t.getMessage()));
                }
            }
        });
    }

    static JSONArray box(Rect r) throws Exception {
        JSONArray a = new JSONArray();
        a.put(r == null ? 0 : r.left);
        a.put(r == null ? 0 : r.top);
        a.put(r == null ? 0 : r.right);
        a.put(r == null ? 0 : r.bottom);
        return a;
    }

    static JSONArray corners(Point[] pts) throws Exception {
        JSONArray a = new JSONArray();
        if (pts == null) return a;
        for (Point p : pts) {
            a.put(p.x);
            a.put(p.y);
        }
        return a;
    }

    void emit(String id, Text text, int w, int h, long ms) {
        try {
            JSONObject o = new JSONObject();
            o.put("type", "ocr");
            o.put("id", id);
            o.put("ok", true);
            o.put("w", w);
            o.put("h", h);
            o.put("ms", ms);
            JSONArray blocks = new JSONArray();
            for (Text.TextBlock b : text.getTextBlocks()) {
                JSONObject bo = new JSONObject();
                bo.put("text", b.getText());
                bo.put("lang", b.getRecognizedLanguage());
                bo.put("box", box(b.getBoundingBox()));
                bo.put("corners", corners(b.getCornerPoints()));
                JSONArray lines = new JSONArray();
                for (Text.Line l : b.getLines()) {
                    JSONObject lo = new JSONObject();
                    lo.put("text", l.getText());
                    lo.put("box", box(l.getBoundingBox()));
                    try {
                        lo.put("conf", l.getConfidence());
                        lo.put("angle", l.getAngle());
                    } catch (Throwable t) {
                        // versiones antiguas sin estos datos
                    }
                    lines.put(lo);
                }
                bo.put("lines", lines);
                blocks.put(bo);
            }
            o.put("blocks", blocks);
            bridge.emit(o);
        } catch (Throwable t) {
            fail(id, "json: " + t.getMessage());
        }
    }

    void fail(String id, String msg) {
        try {
            JSONObject o = new JSONObject();
            o.put("type", "ocr");
            o.put("id", id);
            o.put("ok", false);
            o.put("error", msg);
            bridge.emit(o);
        } catch (Throwable t) {
            Log.w(TAG, "fail", t);
        }
    }

    void close() {
        try {
            if (recognizer != null) recognizer.close();
        } catch (Throwable t) { }
        decoder.shutdownNow();
    }
}
