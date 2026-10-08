package app.parla.talk;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Process;
import android.util.Log;

import org.json.JSONObject;

import java.util.Arrays;

/**
 * Mide el tono de voz (frecuencia fundamental) del micrófono mientras se usa el modo escucha,
 * para distinguir aproximadamente a quién pertenece cada frase (voces graves, agudas…).
 * No graba ni guarda audio: solo conserva el tono y el volumen de los últimos segundos.
 */
public class VoiceTracker {
    static final String TAG = "ParlaVoice";
    static final int SR = 16000;
    static final int WIN = 1024;
    static final int HOP = 512;
    static final int TAU_MIN = SR / 400;  // 400 Hz
    static final int TAU_MAX = SR / 70;   // 70 Hz
    static final int RING = 2600;         // ~83 s

    final long[] times = new long[RING];
    final float[] f0s = new float[RING];
    final float[] rmss = new float[RING];
    final boolean[] zeros = new boolean[RING];
    int head = 0;
    int count = 0;

    volatile boolean running = false;
    Thread thread;
    AudioRecord rec;

    synchronized boolean start() {
        if (running) return true;
        try {
            int min = AudioRecord.getMinBufferSize(SR, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SR, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT, Math.max(min * 4, WIN * 8));
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
                rec.release();
                rec = null;
                return false;
            }
            rec.startRecording();
        } catch (Throwable t) {
            Log.w(TAG, "start", t);
            if (rec != null) { try { rec.release(); } catch (Throwable t2) { } }
            rec = null;
            return false;
        }
        running = true;
        thread = new Thread(new Runnable() {
            public void run() { loop(); }
        }, "parla-voice");
        thread.start();
        return true;
    }

    synchronized void stop() {
        running = false;
        if (thread != null) {
            try { thread.join(400); } catch (InterruptedException e) { }
            thread = null;
        }
        if (rec != null) {
            try { rec.stop(); } catch (Throwable t) { }
            try { rec.release(); } catch (Throwable t) { }
            rec = null;
        }
    }

    void loop() {
        try { Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO); } catch (Throwable t) { }
        short[] buf = new short[HOP];
        float[] win = new float[WIN];
        float[] diff = new float[TAU_MAX + 2];
        int filled = 0;
        while (running) {
            AudioRecord r = rec;
            if (r == null) break;
            int n = r.read(buf, 0, HOP);
            if (n <= 0) {
                try { Thread.sleep(10); } catch (InterruptedException e) { break; }
                continue;
            }
            // desplazar ventana
            System.arraycopy(win, n, win, 0, WIN - n);
            boolean allZero = true;
            for (int i = 0; i < n; i++) {
                float v = buf[i] / 32768f;
                win[WIN - n + i] = v;
                if (buf[i] != 0) allZero = false;
            }
            filled = Math.min(WIN, filled + n);
            if (filled < WIN) continue;
            double sum = 0;
            for (int i = 0; i < WIN; i++) sum += win[i] * win[i];
            float rms = (float) Math.sqrt(sum / WIN);
            float f0 = rms > 0.006f ? yin(win, diff) : 0f;
            synchronized (this) {
                times[head] = System.currentTimeMillis();
                f0s[head] = f0;
                rmss[head] = rms;
                zeros[head] = allZero;
                head = (head + 1) % RING;
                if (count < RING) count++;
            }
        }
    }

    /** Algoritmo YIN: devuelve la frecuencia fundamental en Hz o 0 si no es voz. */
    static float yin(float[] x, float[] d) {
        int n = WIN - TAU_MAX;
        d[0] = 1;
        for (int tau = 1; tau <= TAU_MAX; tau++) {
            double s = 0;
            for (int j = 0; j < n; j++) {
                float delta = x[j] - x[j + tau];
                s += delta * delta;
            }
            d[tau] = (float) s;
        }
        // diferencia normalizada acumulada
        double running = 0;
        for (int tau = 1; tau <= TAU_MAX; tau++) {
            running += d[tau];
            d[tau] = running == 0 ? 1 : (float) (d[tau] * tau / running);
        }
        int best = -1;
        for (int tau = TAU_MIN; tau <= TAU_MAX; tau++) {
            if (d[tau] < 0.15f) {
                while (tau + 1 <= TAU_MAX && d[tau + 1] < d[tau]) tau++;
                best = tau;
                break;
            }
        }
        if (best < 0) return 0f;
        float t = best;
        if (best > 1 && best < TAU_MAX) {
            float a = d[best - 1], b = d[best], c = d[best + 1];
            float den = a + c - 2 * b;
            if (den != 0) t = best + (a - c) / (2 * den);
        }
        return SR / t;
    }

    /** Resumen de un intervalo de tiempo: mediana del tono, cuántos tramos con voz, volumen, silencio forzado. */
    synchronized String stats(long t0, long t1) {
        float[] tmp = new float[count];
        int k = 0;
        int frames = 0;
        int zeroFrames = 0;
        double rmsSum = 0;
        for (int i = 0; i < count; i++) {
            int idx = (head - 1 - i + RING) % RING;
            long t = times[idx];
            if (t < t0) break;
            if (t > t1) continue;
            frames++;
            rmsSum += rmss[idx];
            if (zeros[idx]) zeroFrames++;
            if (f0s[idx] > 0) tmp[k++] = f0s[idx];
        }
        try {
            JSONObject o = new JSONObject();
            o.put("frames", frames);
            o.put("n", k);
            if (k > 0) {
                float[] v = Arrays.copyOf(tmp, k);
                Arrays.sort(v);
                o.put("median", v[k / 2]);
                o.put("p25", v[k / 4]);
                o.put("p75", v[(3 * k) / 4]);
            }
            o.put("rms", frames > 0 ? rmsSum / frames : 0);
            o.put("zeroFrac", frames > 0 ? (double) zeroFrames / frames : 0);
            return o.toString();
        } catch (Throwable t) {
            return "{}";
        }
    }
}
