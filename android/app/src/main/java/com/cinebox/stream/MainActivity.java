package com.cinebox.stream;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

/**
 * CineBox Android MainActivity (v1.0.2)
 *
 * 1. Native WebView Popup, Redirect & VidSrc.sh Ad-Network Blocker:
 *    Blocks all `window.open()` / `target="_blank"` popup ad windows (`onCreateWindow -> false`)
 *    and intercepts VidSrc.sh ad-network scripts (`shouldInterceptRequest` / `shouldOverrideUrlLoading`).
 *
 * 2. Pure #000000 System Bars & Status Bar Safe-Area Protection:
 *    Sets both Status Bar and Bottom Navigation Bar (Taskbar) to pure #000000 black
 *    and enables `setDecorFitsSystemWindows(window, true)` in normal mode so the Android
 *    status bar never overlaps the top header.
 *
 * 3. Immersive Fullscreen Taskbar Blending & Native Exit Fullscreen Button (`onShowCustomView`):
 *    When any HTML5 or Iframe video (e.g. VidSrc.sh) enters fullscreen, hides system status &
 *    navigation bars so the player blends edge-to-edge into pure #000000 black, and attaches
 *    a floating "← Back / Exit Fullscreen (✕)" button that appears whenever the user taps the
 *    screen and auto-hides after 3.5 seconds alongside the player controls.
 */
public class MainActivity extends BridgeActivity {
    private static final String[] VIDSRC_AD_DOMAINS = new String[] {
        "doubleclick.net",
        "googlesyndication.com",
        "adsterra.com",
        "popads.net",
        "popcash.net",
        "propellerads.com",
        "onclickads.net",
        "onclickperformance.com",
        "acscdn.com",
        "exoclick.com",
        "juicyads.com",
        "tsyndicate.com",
        "rtmark.net",
        "histats.com",
        "trafficjunky.net",
        "clickadu.com",
        "hilltopads.net",
        "admaven.com",
        "galaksion.com",
        "bnhtml.com",
        "roudodu.com",
        "cdn4ads.com",
        "adsco.re",
        "pushame.com",
        "notix.io"
    };

    private boolean isVidSrcAdRequest(String url) {
        if (url == null || url.isEmpty()) return false;
        String lower = url.toLowerCase();
        for (String domain : VIDSRC_AD_DOMAINS) {
            if (lower.contains(domain)) {
                return true;
            }
        }
        return lower.contains("/popunder") || lower.contains("/pop.js") || lower.contains("/adserver");
    }

    private boolean isCustomFullscreenActive = false;
    private WebChromeClient.CustomViewCallback activeCustomViewCallback = null;
    private TextView nativeExitFullscreenButton = null;
    private final Handler controlsHideHandler = new Handler(Looper.getMainLooper());
    private final Runnable hideExitButtonRunnable = () -> {
        if (nativeExitFullscreenButton != null) {
            nativeExitFullscreenButton.animate()
                .alpha(0f)
                .setDuration(220)
                .withEndAction(() -> {
                    if (nativeExitFullscreenButton != null) {
                        nativeExitFullscreenButton.setVisibility(View.GONE);
                    }
                })
                .start();
        }
        if (isCustomFullscreenActive) {
            configureSystemBarsPureBlack(true);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        configureSystemBarsPureBlack(false);

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.setBackgroundColor(Color.BLACK);
            WebSettings settings = webView.getSettings();

            // 1. Intercept all multi-window / window.open() attempts in WebView
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setSupportMultipleWindows(true);
            settings.setMediaPlaybackRequiresUserGesture(false);

            // 2. Network & Navigation AdBlocker for VidSrc.sh popup/popunder ad networks
            webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    if (request != null && request.getUrl() != null) {
                        String reqUrl = request.getUrl().toString();
                        if (isVidSrcAdRequest(reqUrl)) {
                            return new WebResourceResponse(
                                "text/plain",
                                "UTF-8",
                                new ByteArrayInputStream("".getBytes(StandardCharsets.UTF_8))
                            );
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (request != null && request.getUrl() != null) {
                        String reqUrl = request.getUrl().toString();
                        if (isVidSrcAdRequest(reqUrl)) {
                            return true;
                        }
                    }
                    return super.shouldOverrideUrlLoading(view, request);
                }
            });

            // 3. Extend Capacitor's BridgeWebChromeClient so native HTML5/Iframe fullscreen
            //    blends with the Android taskbar while `onCreateWindow` drops all popup ads.
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

                @Override
                public void onShowCustomView(View view, WebChromeClient.CustomViewCallback callback) {
                    if (view != null) {
                        view.setBackgroundColor(Color.BLACK);
                    }
                    isCustomFullscreenActive = true;
                    activeCustomViewCallback = callback;
                    configureSystemBarsPureBlack(true);
                    super.onShowCustomView(view, callback);
                    attachNativeExitFullscreenOverlay();
                    showNativeExitButtonTemporarily();
                }

                @Override
                public void onHideCustomView() {
                    isCustomFullscreenActive = false;
                    activeCustomViewCallback = null;
                    removeNativeExitFullscreenOverlay();
                    configureSystemBarsPureBlack(false);
                    super.onHideCustomView();
                }
            });
        }
    }

    private void attachNativeExitFullscreenOverlay() {
        try {
            ViewGroup decorGroup = (ViewGroup) getWindow().getDecorView();
            removeNativeExitFullscreenOverlay();

            TextView btn = new TextView(this);
            btn.setText("← Exit Fullscreen  ✕");
            btn.setTextColor(Color.WHITE);
            btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
            int padH = dpToPx(14);
            int padV = dpToPx(9);
            btn.setPadding(padH, padV, padH, padV);

            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.parseColor("#D9000000"));
            bg.setCornerRadius(dpToPx(999));
            bg.setStroke(dpToPx(1), Color.parseColor("#6610D97B"));
            btn.setBackground(bg);

            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            params.gravity = Gravity.TOP | Gravity.START;
            params.topMargin = dpToPx(18);
            params.leftMargin = dpToPx(18);

            btn.setOnClickListener(v -> exitNativeCustomFullscreen());

            decorGroup.addView(btn, params);
            nativeExitFullscreenButton = btn;
        } catch (Exception ignored) {
            // Safe fallback
        }
    }

    private void removeNativeExitFullscreenOverlay() {
        controlsHideHandler.removeCallbacks(hideExitButtonRunnable);
        if (nativeExitFullscreenButton != null) {
            try {
                ViewGroup parent = (ViewGroup) nativeExitFullscreenButton.getParent();
                if (parent != null) {
                    parent.removeView(nativeExitFullscreenButton);
                }
            } catch (Exception ignored) {
                // ignore
            }
            nativeExitFullscreenButton = null;
        }
    }

    private void showNativeExitButtonTemporarily() {
        if (!isCustomFullscreenActive || nativeExitFullscreenButton == null) return;
        controlsHideHandler.removeCallbacks(hideExitButtonRunnable);
        nativeExitFullscreenButton.animate().cancel();
        nativeExitFullscreenButton.setAlpha(1f);
        nativeExitFullscreenButton.setVisibility(View.VISIBLE);
        nativeExitFullscreenButton.bringToFront();
        controlsHideHandler.postDelayed(hideExitButtonRunnable, 3500);
    }

    private void exitNativeCustomFullscreen() {
        try {
            if (activeCustomViewCallback != null) {
                activeCustomViewCallback.onCustomViewHidden();
                activeCustomViewCallback = null;
            }
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(
                    "if (document.fullscreenElement) { document.exitFullscreen().catch(()=>{}); }",
                    null
                );
            }
        } catch (Exception ignored) {
            // ignore
        }
        isCustomFullscreenActive = false;
        removeNativeExitFullscreenOverlay();
        configureSystemBarsPureBlack(false);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        if (isCustomFullscreenActive && ev != null && ev.getAction() == MotionEvent.ACTION_DOWN) {
            showNativeExitButtonTemporarily();
        }
        return super.dispatchTouchEvent(ev);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (isCustomFullscreenActive) {
            exitNativeCustomFullscreen();
            return;
        }
        super.onBackPressed();
    }

    private int dpToPx(int dp) {
        return Math.round(
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                dp,
                getResources().getDisplayMetrics()
            )
        );
    }

    private void configureSystemBarsPureBlack(boolean immersiveFullscreen) {
        try {
            Window window = getWindow();
            if (window == null) return;

            window.setStatusBarColor(Color.BLACK);
            window.setNavigationBarColor(Color.BLACK);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                window.setNavigationBarDividerColor(Color.BLACK);
            }

            View decorView = window.getDecorView();
            decorView.setBackgroundColor(Color.BLACK);

            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, decorView);

            if (immersiveFullscreen) {
                WindowCompat.setDecorFitsSystemWindows(window, false);
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (controller != null) {
                    controller.setSystemBarsBehavior(
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    );
                    controller.hide(WindowInsetsCompat.Type.systemBars());
                }
            } else {
                WindowCompat.setDecorFitsSystemWindows(window, true);
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (controller != null) {
                    controller.show(WindowInsetsCompat.Type.systemBars());
                    controller.setAppearanceLightStatusBars(false);
                    controller.setAppearanceLightNavigationBars(false);
                }
            }
        } catch (Exception ignored) {
            // Safe fallback on older Android OEM skins
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && isCustomFullscreenActive) {
            configureSystemBarsPureBlack(true);
        }
    }
}
