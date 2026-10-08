package app.parla.talk;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity {
    static final String TAG = "Parla";
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;

    static final int REQ_MIC = 101;
    static final int REQ_WEB_PERM = 102;
    static final int REQ_FILE = 201;

    WebView web;
    Bridge bridge;
    boolean pageLoaded = false;
    String pendingLink = null;

    ValueCallback<Uri[]> fileCallback;
    PermissionRequest pendingWebPermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyInitialBars();

        web = new WebView(this);
        web.setBackgroundColor(isSystemDark() ? Color.parseColor("#0B0B0F") : Color.WHITE);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " ParlaApp/" + Bridge.VERSION);
        WebView.setWebContentsDebuggingEnabled(true);

        bridge = new Bridge(this, web);
        web.addJavascriptInterface(bridge, "ParlaNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u != null && HOST.equals(u.getHost())) {
                    return serveAsset(u.getPath());
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u == null) return false;
                if (HOST.equals(u.getHost())) return false;
                openExternal(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    public void run() { handleWebPermission(request); }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    Intent i = params.createIntent();
                    startActivityForResult(i, REQ_FILE);
                } catch (Exception e) {
                    try {
                        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                        i.addCategory(Intent.CATEGORY_OPENABLE);
                        i.setType("image/*");
                        startActivityForResult(i, REQ_FILE);
                    } catch (Exception e2) {
                        fileCallback = null;
                        return false;
                    }
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "JS: " + m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        handleIntent(getIntent());
        web.loadUrl(ORIGIN + "/index.html");
    }

    // ---------- assets ----------

    WebResourceResponse serveAsset(String path) {
        if (path == null || path.equals("") || path.equals("/")) path = "/index.html";
        if (path.contains("..")) return notFound();
        String assetPath = "www" + path;
        String mime = mimeFor(path);
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-cache");
        headers.put("Access-Control-Allow-Origin", "*");
        try {
            AssetManager am = getAssets();
            InputStream in = am.open(assetPath, AssetManager.ACCESS_STREAMING);
            String enc = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg") ? "utf-8" : null;
            return new WebResourceResponse(mime, enc, 200, "OK", headers, in);
        } catch (Exception e) {
            return notFound();
        }
    }

    WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
    }

    static String mimeFor(String p) {
        String l = p.toLowerCase();
        if (l.endsWith(".html")) return "text/html";
        if (l.endsWith(".js") || l.endsWith(".mjs")) return "application/javascript";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".webp")) return "image/webp";
        if (l.endsWith(".woff2")) return "font/woff2";
        if (l.endsWith(".woff")) return "font/woff";
        if (l.endsWith(".wasm")) return "application/wasm";
        if (l.endsWith(".txt")) return "text/plain";
        if (l.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    // ---------- intents / links ----------

    void handleIntent(Intent intent) {
        if (intent == null) return;
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            String link = intent.getData().toString();
            if (pageLoaded && bridge != null) {
                bridge.emitLink(link);
            } else {
                pendingLink = link;
            }
        }
    }

    String takePendingLink() {
        String l = pendingLink;
        pendingLink = null;
        return l;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    void openExternal(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "No app for " + u);
        }
    }

    // ---------- permissions ----------

    void handleWebPermission(PermissionRequest request) {
        String[] res = request.getResources();
        List<String> needed = new ArrayList<String>();
        for (String r : res) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)
                    && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.CAMERA);
            }
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.RECORD_AUDIO);
            }
        }
        if (needed.isEmpty()) {
            request.grant(res);
            return;
        }
        if (pendingWebPermission != null) {
            try { pendingWebPermission.deny(); } catch (Exception e) { }
        }
        pendingWebPermission = request;
        requestPermissions(needed.toArray(new String[0]), REQ_WEB_PERM);
    }

    void requestMic() {
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean all = grantResults.length > 0;
        for (int g : grantResults) if (g != PackageManager.PERMISSION_GRANTED) all = false;
        if (requestCode == REQ_MIC) {
            bridge.emitPermission("mic", all);
        } else if (requestCode == REQ_WEB_PERM) {
            PermissionRequest p = pendingWebPermission;
            pendingWebPermission = null;
            if (p != null) {
                try {
                    if (all) p.grant(p.getResources()); else p.deny();
                } catch (Exception e) {
                    Log.w(TAG, "perm", e);
                }
            }
            bridge.emitPermission("camera", all);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE) {
            ValueCallback<Uri[]> cb = fileCallback;
            fileCallback = null;
            if (cb != null) {
                Uri[] result = null;
                try {
                    result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                } catch (Exception e) {
                    result = null;
                }
                if (result == null && resultCode == RESULT_OK && data != null && data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
                cb.onReceiveValue(result);
            }
        }
    }

    // ---------- system bars / theme ----------

    boolean isSystemDark() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    void applyInitialBars() {
        boolean dark = isSystemDark();
        setBars(dark ? Color.parseColor("#0B0B0F") : Color.WHITE, !dark);
    }

    void setBars(int color, boolean darkIcons) {
        try {
            Window w = getWindow();
            w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.setStatusBarColor(color);
            w.setNavigationBarColor(color);
            View decor = w.getDecorView();
            int flags = decor.getSystemUiVisibility();
            int lightStatus = 0x00002000; // SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            int lightNav = 0x00000010;    // SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR (API 26)
            if (darkIcons) {
                flags |= lightStatus;
                if (Build.VERSION.SDK_INT >= 26) flags |= lightNav;
            } else {
                flags &= ~lightStatus;
                flags &= ~lightNav;
            }
            decor.setSystemUiVisibility(flags);
            if (web != null) web.setBackgroundColor(color);
        } catch (Exception e) {
            Log.w(TAG, "bars", e);
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (bridge != null) bridge.emitUiMode(isSystemDark());
    }

    // ---------- lifecycle ----------

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(function(){try{return window.__parlaBack&&window.__parlaBack()?'1':'0'}catch(e){return '0'}})()",
                new ValueCallback<String>() {
                    public void onReceiveValue(String value) {
                        if (value == null || !value.contains("1")) {
                            moveTaskToBack(true);
                        }
                    }
                });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (bridge != null) bridge.emitLifecycle("resume");
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (bridge != null) {
            bridge.releaseQuiet();
            if (bridge.voice != null) bridge.voice.stop();
            bridge.emitLifecycle("pause");
        }
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) bridge.destroy();
        if (web != null) {
            try {
                web.destroy();
            } catch (Exception e) { }
        }
        super.onDestroy();
    }
}
