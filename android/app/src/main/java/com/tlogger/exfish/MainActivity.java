package com.tlogger.exfish;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.provider.MediaStore;
import android.view.KeyEvent;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (bridge != null && bridge.getWebView() != null) {
            WebSettings settings = bridge.getWebView().getSettings();
            settings.setGeolocationEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setJavaScriptCanOpenWindowsAutomatically(true);
            settings.setSupportMultipleWindows(true);

            bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
                @Override
                public boolean onJsAlert(WebView view, String url, String message, final android.webkit.JsResult result) {
                    new android.app.AlertDialog.Builder(view.getContext())
                        .setTitle("알림")
                        .setMessage(message)
                        .setPositiveButton("확인", (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel())
                        .setCancelable(true)
                        .show();
                    return true;
                }

                @Override
                public boolean onJsConfirm(WebView view, String url, String message, final android.webkit.JsResult result) {
                    new android.app.AlertDialog.Builder(view.getContext())
                        .setTitle("확인")
                        .setMessage(message)
                        .setPositiveButton("확인", (dialog, which) -> result.confirm())
                        .setNegativeButton("취소", (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .setCancelable(true)
                        .show();
                    return true;
                }

                @Override
                public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                    // Automatically grant geolocation permission for https://localhost (Capacitor Origin)
                    callback.invoke(origin, true, false);
                }

                @Override
                public boolean onShowFileChooser(
                    final WebView webView,
                    final ValueCallback<Uri[]> filePathCallback,
                    final FileChooserParams fileChooserParams
                ) {
                    final ValueCallback<Uri[]> wrappedCallback = (uris) -> {
                        if (uris == null || uris.length == 0 || uris[0] == null) {
                            filePathCallback.onReceiveValue(uris);
                            return;
                        }
                        String exifJs = extractNativeExifJs(uris[0]);
                        if (exifJs != null && webView != null) {
                            webView.evaluateJavascript(exifJs, (val) -> filePathCallback.onReceiveValue(uris));
                        } else {
                            filePathCallback.onReceiveValue(uris);
                        }
                    };
                    return super.onShowFileChooser(webView, wrappedCallback, fileChooserParams);
                }

                @Override
                public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                    Context context = view.getContext();
                    WebView newWebView = new WebView(context);
                    newWebView.setWebViewClient(new WebViewClient() {
                        @Override
                        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                            try {
                                Intent intent = new Intent(Intent.ACTION_VIEW, request.getUrl());
                                context.startActivity(intent);
                                return true;
                            } catch (Exception e) {
                                return false;
                            }
                        }

                        @Override
                        public boolean shouldOverrideUrlLoading(WebView v, String url) {
                            try {
                                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                                context.startActivity(intent);
                                return true;
                            } catch (Exception e) {
                                return false;
                            }
                        }
                    });

                    WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                    transport.setWebView(newWebView);
                    resultMsg.sendToTarget();
                    return true;
                }
            });
        }
    }

    /**
     * Reads EXIF GPS and DateTime directly on the native Android layer using MediaStore.setRequireOriginal
     * and android.media.ExifInterface, bypassing WebView/PhotoPicker stream EXIF stripping.
     */
    private String extractNativeExifJs(Uri pickedUri) {
        if (pickedUri == null) return null;

        List<Uri> candidateUris = new ArrayList<>();

        // 1. If Android 13+ Photo Picker URI (e.g., content://media/picker/.../media/1000012345)
        //    or Document URI (image:1000012345), map to MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        try {
            String lastSegment = pickedUri.getLastPathSegment();
            if (lastSegment != null) {
                String numericId = lastSegment;
                if (numericId.contains(":")) {
                    String[] parts = numericId.split(":");
                    numericId = parts[parts.length - 1];
                }
                if (numericId.matches("\\d+")) {
                    long mediaId = Long.parseLong(numericId);
                    Uri mediaUri = ContentUris.withAppendedId(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        mediaId
                    );
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        try {
                            candidateUris.add(MediaStore.setRequireOriginal(mediaUri));
                        } catch (Exception ignored) {}
                    }
                    candidateUris.add(mediaUri);
                }
            }
        } catch (Exception ignored) {}

        // 2. Try MediaStore.setRequireOriginal on the picked URI directly (API 29+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                candidateUris.add(MediaStore.setRequireOriginal(pickedUri));
            } catch (Exception ignored) {}
        }

        // 3. Fallback to the raw picked URI
        candidateUris.add(pickedUri);

        Double foundLat = null;
        Double foundLng = null;
        String foundDateTime = null;

        for (Uri candidate : candidateUris) {
            try (InputStream is = getContentResolver().openInputStream(candidate)) {
                if (is == null) continue;
                ExifInterface exif = new ExifInterface(is);
                float[] latLong = new float[2];
                if (foundLat == null && exif.getLatLong(latLong)) {
                    if (latLong[0] != 0.0f || latLong[1] != 0.0f) {
                        foundLat = (double) latLong[0];
                        foundLng = (double) latLong[1];
                    }
                }
                if (foundDateTime == null) {
                    String dt = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL);
                    if (dt == null || dt.trim().isEmpty()) {
                        dt = exif.getAttribute(ExifInterface.TAG_DATETIME);
                    }
                    if (dt == null || dt.trim().isEmpty()) {
                        String gpsDate = exif.getAttribute(ExifInterface.TAG_GPS_DATESTAMP);
                        String gpsTime = exif.getAttribute(ExifInterface.TAG_GPS_TIMESTAMP);
                        if (gpsDate != null && !gpsDate.trim().isEmpty()) {
                            dt = gpsTime != null ? (gpsDate + " " + gpsTime) : gpsDate;
                        }
                    }
                    if (dt != null && !dt.trim().isEmpty()) {
                        foundDateTime = dt.trim();
                    }
                }
                if (foundLat != null && foundDateTime != null) {
                    break;
                }
            } catch (Exception ignored) {}
        }

        if (foundLat == null && foundDateTime == null) {
            return "window.__LAST_NATIVE_EXIF__ = null;";
        }

        String latLiteral = foundLat != null ? String.format(Locale.US, "%.6f", foundLat) : "null";
        String lngLiteral = foundLng != null ? String.format(Locale.US, "%.6f", foundLng) : "null";
        String dtLiteral = foundDateTime != null
            ? "'" + foundDateTime.replace("\\", "\\\\").replace("'", "\\'") + "'"
            : "null";

        return String.format(
            Locale.US,
            "window.__LAST_NATIVE_EXIF__ = { lat: %s, lng: %s, rawDateTime: %s, ts: Date.now() };",
            latLiteral,
            lngLiteral,
            dtLiteral
        );
    }

    /**
     * Physical Volume Key Mapping for Field Fishing (Phase 2):
     * When fishing on rocks or breakwaters with wet/slimy hands,
     * Hardware Volume Keys trigger Map Zoom In / Out directly!
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('exfish:volume-zoom', { detail: { dir: 'in' } }));",
                    null
                );
                return true; // Consume event to prevent OS volume HUD from blocking map
            }
        } else if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('exfish:volume-zoom', { detail: { dir: 'out' } }));",
                    null
                );
                return true; // Consume event
            }
        }
        return super.onKeyDown(keyCode, event);
    }
}
