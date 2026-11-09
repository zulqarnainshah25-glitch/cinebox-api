package com.cinebox.stream;

import android.os.Bundle;
import android.os.Message;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * CineBox Android MainActivity with Native WebView Popup & Popunder Blocker.
 *
 * Blocks all `window.open()` / `target="_blank"` popup ad windows triggered inside
 * cross-origin video embed iframes (e.g. vidsrc.sh, 2embed.cc, multiembed) WITHOUT
 * adding an HTML `sandbox` attribute (so video players never show "Sandbox Detected"),
 * while preserving full native video fullscreen (`onShowCustomView` / `onHideCustomView`)
 * via Capacitor's `BridgeWebChromeClient`.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();

            // 1. Intercept all multi-window / window.open() attempts in WebView
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setSupportMultipleWindows(true);
            settings.setMediaPlaybackRequiresUserGesture(false);

            // 2. Extend Capacitor's BridgeWebChromeClient so native HTML5/Iframe fullscreen
            //    continues working while `onCreateWindow` silently drops all popup ad windows.
            webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public boolean onCreateWindow(
                    WebView view,
                    boolean isDialog,
                    boolean isUserGesture,
                    Message resultMsg
                ) {
                    // Strictly block any popup / external browser ad window from opening
                    return false;
                }
            });
        }
    }
}
