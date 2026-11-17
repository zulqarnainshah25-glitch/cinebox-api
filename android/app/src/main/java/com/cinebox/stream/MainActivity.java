package com.cinebox.stream;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
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
import android.webkit.JavascriptInterface;
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
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * CineBox Android MainActivity (v1.0.13)
 *
 * 1. Native WebView Real Multi-Layer Iframe Video AdBlocker:
 *    - Loads 3,600+ real ad-serving domains from `assets/adblock_domains.txt` (Peter Lowe + EasyList core)
 *      into an O(1) ConcurrentHashMap set on startup.
 *    - Eliminates async bridge race conditions: blocks ad-network/VAST scripts & `onCreateWindow()` popups
 *      whenever `isAdBlockerEnabled` is true.
 *    - Injects an in-frame `<script data-cinebox-adblock="1">` shield directly into third-party embed HTML
 *      (`VidSrc.sh`, `VidLink.pro`, `VidFast`, `2Embed`, `2vcdn.skin`) inside `shouldInterceptRequest` while
 *      stripping known ad/popunder `<script>` tags and blocking subframe ad redirects in `shouldOverrideUrlLoading`.
 *    - Registers via `getBridge().setWebViewClient(...)` so Capacitor Bridge & WebView share the hardened client.
 *
 * 2. Pure #000000 System Bars & Status Bar Safe-Area Protection.
 * 3. Immersive Fullscreen Taskbar Blending & Native Exit Fullscreen Button (`onShowCustomView`).
 */
public class MainActivity extends BridgeActivity {
    private static final String[] VIDSRC_AD_DOMAINS = new String[] {
        "doubleclick.net",
        "googlesyndication.com",
        "googleadservices.com",
        "googletagmanager.com",
        "google-analytics.com",
        "amazon-adsystem.com",
        "adnxs.com",
        "rubiconproject.com",
        "pubmatic.com",
        "openx.net",
        "criteo.com",
        "smartadserver.com",
        "mgid.com",
        "revcontent.com",
        "adskeeper.com",
        "bidgear.com",
        "adsterra.com",
        "adcash.com",
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
        "s10.histats.com",
        "sstatic1.histats.com",
        "trafficjunky.net",
        "clickadu.com",
        "hilltopads.net",
        "hilltopads.com",
        "admaven.com",
        "galaksion.com",
        "a-ads.com",
        "outbrain.com",
        "taboola.com",
        "mc.yandex.ru",
        "mc.yandex.com",
        "bnhtml.com",
        "roudodu.com",
        "cdn4ads.com",
        "adsco.re",
        "pushame.com",
        "notix.io",
        "tagivi.com",
        "intellipopup.com",
        "adplox.com",
        "rapidadexchange.com",
        "usrpubtrck.com",
        "whos.amung.us",
        "widgets.amung.us",
        "p16-ad-site-sign-sg.tiktokcdn.com",
        "p19-ad-site-sign-sg.tiktokcdn.com",
        "profitablecpmrate.com",
        "highperformanceformat.com",
        "effectiveratecpm.com",
        "monetag.com",
        "alwingulla.com",
        "pubfuture.com",
        "in-page-push.com",
        "clarity.ms",
        "scripts.clarity.ms",
        "rc91gizcl1njbiw.cfd",
        "lhchjg2369ymgg.rest",
        "umami.vidfast.vc",
        "mklwfufdtjbwl.online",
        "jvaxzufsyldqj.space",
        "d3mr7y154d2qg5.cloudfront.net",
        "rxqgeccsz.com",
        "gowwtsfqlwyfxn.com",
        "alchemmauls.com",
        "1414.hexa.su",
        "3omcbggo6pw6x3bn92rlehmtu88b.cfd",
        "ghzfcfwj4ggcqqv7q3lu4rquy.rest",
        "umami.vidcore.net",
        "unfortunatelyejectinflected.com",
        "lahochat.com",
        "createlouisville.org",
        "cloudflareinsights.com",
        "static.cloudflareinsights.com"
    };

    private static final Set<String> SAFE_HOST_ALLOWLIST = new HashSet<>(Arrays.asList(
        "localhost",
        "127.0.0.1",
        "tmdb.org",
        "api.themoviedb.org",
        "image.tmdb.org",
        "supabase.co",
        "vidsrc.sh",
        "vidsrc.me",
        "vidsrc.su",
        "vidsrc.buzz",
        "videm.buzz",
        "vidcore.io",
        "vidlink.pro",
        "vidfast.vc",
        "vidfast.pro",
        "vidfast.in",
        "vidfast.io",
        "vidfast.me",
        "2embed.cc",
        "www.2embed.cc",
        "streamsrcs.2embed.cc",
        "2embed.skin",
        "www.2embed.skin",
        "2vcdn.skin",
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "ajax.googleapis.com"
    ));

    private static final Pattern SCRIPT_TAG_PATTERN = Pattern.compile(
        "<script\\b([^>]*)>([\\s\\S]*?)</script>",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern SCRIPT_SRC_PATTERN = Pattern.compile(
        "\\bsrc\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
        Pattern.CASE_INSENSITIVE
    );

    private static final String ANDROID_IN_FRAME_SHIELD_SCRIPTLET =
        "<script data-cinebox-adblock=\"1\">\n"
        + "(function(){\n"
        + "  if (window.__cineboxFrameShieldInstalled) return;\n"
        + "  window.__cineboxFrameShieldInstalled = true;\n"
        + "  function notify(u,k){\n"
        + "    try{ if(window.CineboxAndroidAdBlocker&&window.CineboxAndroidAdBlocker.reportBlocked) window.CineboxAndroidAdBlocker.reportBlocked(String(u||''),String(k||'popup')); }catch(e){}\n"
        + "  }\n"
        + "  var badRe=/(acscdn\\.com|histats\\.com|tagivi\\.com|intellipopup\\.com|adplox\\.com|rapidadexchange\\.com|usrpubtrck\\.com|popads\\.net|adsterra\\.com|adsco\\.re|mc\\.yandex|clarity\\.ms|whos\\.amung\\.us|mklwfufdtjbwl\\.online|jvaxzufsyldqj\\.space|d3mr7y154d2qg5\\.cloudfront\\.net|rxqgeccsz\\.com|gowwtsfqlwyfxn\\.com|alchemmauls\\.com|1414\\.hexa\\.su|3omcbggo6pw6x3bn92rlehmtu88b\\.cfd|ghzfcfwj4ggcqqv7q3lu4rquy\\.rest|umami\\.vidcore\\.net|unfortunatelyejectinflected\\.com|lahochat\\.com|createlouisville\\.org|cloudflareinsights\\.com|disable-devtool|\\/api\\/(?:mercury|venus)(?:$|\\?)|\\/assets\\/sbx\\.js|\\/vast\\.js|\\/vast\\.xml|\\/vmap\\.xml|\\/popunder|\\/suv5\\.js|\\/aclib\\.js|\\/suurl5\\.php|clickid=|zoneid=|adunit=|cbcdn=|popundersperip|[?&]fmt=suv\\d|\\/vvmro|\\/vgmoo)/i;\n"
        + "  try{ if(typeof console!=='undefined'&&typeof console.table==='function'){ var ot=console.table; function table(d){ if(Array.isArray(d)&&d.length>=25)return; return ot.apply(this,arguments); } var ots=Function.prototype.toString; var pts=function toString(){ if(this===table)return 'function table() { [native code] }'; if(this===pts)return 'function toString() { [native code] }'; return ots.call(this); }; Function.prototype.toString=pts; console.table=table; } }catch(e){}\n"
        + "  var blockedOpen=function(u){ notify(u||'about:blank','popup'); return null; };\n"
        + "  try{ Object.defineProperty(window,'open',{value:blockedOpen,writable:false,configurable:false}); }catch(e){ window.open=blockedOpen; }\n"
        + "  if(window.HTMLIFrameElement&&HTMLIFrameElement.prototype){\n"
        + "    var cwDesc=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'contentWindow');\n"
        + "    if(cwDesc&&cwDesc.get){ Object.defineProperty(HTMLIFrameElement.prototype,'contentWindow',{ get:function(){ var cw=cwDesc.get.call(this); try{ if(cw) Object.defineProperty(cw,'open',{value:blockedOpen,writable:false,configurable:false}); }catch(e){} return cw; }, configurable:true }); }\n"
        + "  }\n"
        + "  if(window.HTMLAnchorElement&&HTMLAnchorElement.prototype){\n"
        + "    var oa=HTMLAnchorElement.prototype.click;\n"
        + "    HTMLAnchorElement.prototype.click=function(){\n"
        + "      var h=this.getAttribute('href')||this.href||'';\n"
        + "      var t=(this.getAttribute('target')||'').toLowerCase();\n"
        + "      if(badRe.test(h)||t==='_blank'){ notify(h||'anchor-popup','popup'); return; }\n"
        + "      return oa.apply(this,arguments);\n"
        + "    };\n"
        + "  }\n"
        + "  document.addEventListener('click',function(ev){\n"
        + "    var a=ev.target&&ev.target.closest?ev.target.closest('a'):null;\n"
        + "    if(a){\n"
        + "      var h=a.getAttribute('href')||a.href||'';\n"
        + "      var t=(a.getAttribute('target')||'').toLowerCase();\n"
        + "      if(badRe.test(h)||(t==='_blank'&&h&&h.indexOf('youtube.com')===-1)){\n"
        + "        ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); notify(h,'popup');\n"
        + "      }\n"
        + "    }\n"
        + "  },true);\n"
        + "  var of=window.fetch;\n"
        + "  if(typeof of==='function'){\n"
        + "    window.fetch=function(inp){\n"
        + "      var u=typeof inp==='string'?inp:(inp&&inp.url?inp.url:'');\n"
        + "      if(badRe.test(u)){ notify(u,'fetch'); return Promise.resolve(new Response(null,{status:204})); }\n"
        + "      return of.apply(this,arguments);\n"
        + "    };\n"
        + "  }\n"
        + "  var os=Element.prototype.setAttribute;\n"
        + "  Element.prototype.setAttribute=function(n,v){\n"
        + "    var a=String(n||'').toLowerCase();\n"
        + "    if((a==='src'||a==='href')&&badRe.test(String(v||''))){ notify(v,'dom-node'); return; }\n"
        + "    return os.call(this,n,v);\n"
        + "  };\n"
        + "  if(typeof MutationObserver!=='undefined'){\n"
        + "    new MutationObserver(function(ms){\n"
        + "      for(var i=0;i<ms.length;i++){\n"
        + "        var ad=ms[i].addedNodes||[];\n"
        + "        for(var j=0;j<ad.length;j++){\n"
        + "          var el=ad[j];\n"
        + "          if(!el||el.nodeType!==1) continue;\n"
        + "          var tag=(el.tagName||'').toUpperCase();\n"
        + "          if(tag==='SCRIPT'||tag==='IFRAME'||tag==='A'||tag==='IMG'||tag==='LINK'){\n"
        + "            var s=el.getAttribute('src')||el.getAttribute('href')||'';\n"
        + "            if(badRe.test(s)){ notify(s,'dom-node'); try{el.remove();}catch(e){} }\n"
        + "          }\n"
        + "        }\n"
        + "      }\n"
        + "    }).observe(document.documentElement||document,{childList:true,subtree:true});\n"
        + "  }\n"
        + "})();\n"
        + "</script>\n";

    private final Set<String> adDomainSet = ConcurrentHashMap.newKeySet();
    private volatile boolean isAdBlockerEnabled = true;
    private volatile boolean isEmbedIframePlayerActive = false;

    private void loadAdBlockDomainsFromAssets() {
        for (String d : VIDSRC_AD_DOMAINS) {
            adDomainSet.add(d.toLowerCase());
        }
        try (InputStream is = getAssets().open("adblock_domains.txt");
             BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String clean = line.trim().toLowerCase();
                if (!clean.isEmpty() && !clean.startsWith("#") && !SAFE_HOST_ALLOWLIST.contains(clean)) {
                    adDomainSet.add(clean);
                }
            }
        } catch (Exception ignored) {
            // Fallback seamlessly to curated VIDSRC_AD_DOMAINS
        }
    }

    private boolean isEmbedAdBlockerActive() {
        return isAdBlockerEnabled && isEmbedIframePlayerActive;
    }

    private boolean isHostInAdBlockSet(String rawHost) {
        if (rawHost == null || rawHost.isEmpty()) return false;
        String host = rawHost.toLowerCase().trim();
        if (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        if (host.isEmpty() || SAFE_HOST_ALLOWLIST.contains(host)) return false;
        if (adDomainSet.contains(host)) return true;

        int dotIdx = host.indexOf('.');
        while (dotIdx != -1) {
            String suffix = host.substring(dotIdx + 1);
            if (!suffix.contains(".")) break;
            if (adDomainSet.contains(suffix) && !SAFE_HOST_ALLOWLIST.contains(suffix)) {
                return true;
            }
            dotIdx = host.indexOf('.', dotIdx + 1);
        }
        return host.endsWith(".u08") || host.endsWith(".olfm") || host.endsWith(".uqa9");
    }

    private boolean isEmbedProviderHost(String rawHost) {
        if (rawHost == null || rawHost.isEmpty()) return false;
        String h = rawHost.toLowerCase().trim();
        return h.equals("vidsrc.sh")
            || h.endsWith(".vidsrc.sh")
            || h.contains("vidsrc")
            || h.contains("cloudnestra")
            || h.contains("stellarconductornexus")
            || h.equals("vidlink.pro")
            || h.endsWith(".vidlink.pro")
            || h.contains("vidfast")
            || h.equals("vidcore.io")
            || h.endsWith(".vidcore.io")
            || h.equals("videm.buzz")
            || h.endsWith(".videm.buzz")
            || h.equals("2embed.cc")
            || h.endsWith(".2embed.cc")
            || h.equals("2embed.skin")
            || h.endsWith(".2embed.skin")
            || h.equals("2vcdn.skin")
            || h.endsWith(".2vcdn.skin")
            || h.contains("multiembed")
            || h.contains("superembed");
    }

    private boolean isVidSrcAdRequest(String url) {
        if (url == null || url.isEmpty()) return false;
        String lower = url.toLowerCase();
        try {
            Uri parsed = Uri.parse(url);
            String host = parsed.getHost();
            if (isHostInAdBlockSet(host)) {
                return true;
            }
            if (host != null && (host.endsWith(".cfd") || host.endsWith(".rest")) && lower.contains("/vvmro")) {
                return true;
            }
        } catch (Exception ignored) {
            // Fall back to substring matching
        }
        for (String domain : VIDSRC_AD_DOMAINS) {
            if (lower.contains(domain)) {
                return true;
            }
        }
        return lower.contains("/popunder")
            || lower.contains("/pop.js")
            || lower.contains("/suv5.js")
            || lower.contains("/aclib.js")
            || lower.contains("/suurl5.php")
            || lower.contains("/adserver")
            || lower.contains("/assets/sbx.js")
            || lower.contains("disable-devtool")
            || lower.contains("/vgmoo")
            || lower.contains("/vvmro")
            || lower.contains("/vast.js")
            || lower.contains("/vast.xml")
            || lower.contains("/vmap.xml")
            || lower.contains("/ad-site-i18n-sg/")
            || lower.contains("clickid=")
            || lower.contains("zoneid=")
            || lower.contains("adunit=")
            || lower.contains("cbcdn=")
            || lower.contains("popundersperip")
            || lower.matches(".*?[?&]fmt=suv\\d.*")
            || lower.matches(".*?/api/(?:mercury|venus)(?:$|\\?).*")
            || lower.contains(".u08/")
            || lower.contains(".olfm/")
            || lower.contains(".uqa9/")
            || lower.matches(".*?/embed/[0-9a-f]{32}\\.js.*")
            || lower.matches(".*?/fc8e8cab-[0-9a-f-]+.*");
    }

    private WebResourceResponse buildBlockedAssetResponse(String reqUrl) {
        String lower = reqUrl == null ? "" : reqUrl.toLowerCase();
        if (lower.contains("vast.xml") || lower.contains("vmap.xml")) {
            return new WebResourceResponse(
                "application/xml",
                "UTF-8",
                new ByteArrayInputStream("<VAST version=\"3.0\"></VAST>".getBytes(StandardCharsets.UTF_8))
            );
        }
        if (lower.matches(".*?\\.(?:js|mjs)(?:[/?#].*|$)")) {
            return new WebResourceResponse(
                "application/javascript",
                "UTF-8",
                new ByteArrayInputStream("/* Blocked by CineBox AdBlocker */".getBytes(StandardCharsets.UTF_8))
            );
        }
        return new WebResourceResponse(
            "text/plain",
            "UTF-8",
            new ByteArrayInputStream("".getBytes(StandardCharsets.UTF_8))
        );
    }

    private boolean isLikelyStaticAssetPath(String path) {
        if (path == null) return false;
        String lower = path.toLowerCase();
        return lower.endsWith(".js")
            || lower.endsWith(".css")
            || lower.endsWith(".png")
            || lower.endsWith(".jpg")
            || lower.endsWith(".jpeg")
            || lower.endsWith(".webp")
            || lower.endsWith(".svg")
            || lower.endsWith(".woff")
            || lower.endsWith(".woff2")
            || lower.endsWith(".m3u8")
            || lower.endsWith(".ts")
            || lower.endsWith(".mp4")
            || lower.endsWith(".vtt")
            || lower.endsWith(".srt")
            || lower.endsWith(".json");
    }

    private String stripAdScriptsAndInjectShield(String html) {
        if (html == null || html.isEmpty()) return html;
        boolean isNextJsDoc = html.contains("/_next/");
        String cleaned = html;
        if (isNextJsDoc) {
            Matcher matcher = SCRIPT_TAG_PATTERN.matcher(html);
            StringBuffer sb = new StringBuffer();
            while (matcher.find()) {
                String attrs = matcher.group(1) == null ? "" : matcher.group(1);
                String body = matcher.group(2) == null ? "" : matcher.group(2);
                boolean hasSrc = SCRIPT_SRC_PATTERN.matcher(attrs).find();
                if (!hasSrc && (body.contains("unloaded_at")
                    || body.contains("shown_at")
                    || body.contains("acscdn.com")
                    || body.contains("popads.net")
                    || body.contains("tagivi.com")
                    || body.contains("intellipopup.com")
                    || body.contains("DisableDevtool"))) {
                    matcher.appendReplacement(sb, Matcher.quoteReplacement("<script" + attrs + ">/* cinebox-adblock: neutralized inline popunder */</script>"));
                } else {
                    matcher.appendReplacement(sb, Matcher.quoteReplacement(matcher.group(0)));
                }
            }
            matcher.appendTail(sb);
            cleaned = sb.toString();
        } else {
            Matcher matcher = SCRIPT_TAG_PATTERN.matcher(html);
            StringBuffer sb = new StringBuffer();
            while (matcher.find()) {
                String attrs = matcher.group(1) == null ? "" : matcher.group(1);
                String body = matcher.group(2) == null ? "" : matcher.group(2);
                boolean drop = false;
                Matcher srcMatcher = SCRIPT_SRC_PATTERN.matcher(attrs);
                if (srcMatcher.find()) {
                    String src = srcMatcher.group(1) != null ? srcMatcher.group(1)
                        : srcMatcher.group(2) != null ? srcMatcher.group(2) : srcMatcher.group(3);
                    if (isVidSrcAdRequest(src)) {
                        drop = true;
                    }
                } else if (
                    body.contains("acscdn.com")
                    || body.contains("histats.com")
                    || body.contains("Histats")
                    || body.contains("rapidadexchange.com")
                    || body.contains("usrpubtrck.com")
                    || body.contains("DisableDevtool")
                    || body.contains("tagivi.com")
                    || body.contains("intellipopup.com")
                    || body.contains("unloaded_at")
                    || body.contains("shown_at")
                ) {
                    drop = true;
                }
                if (drop) {
                    matcher.appendReplacement(sb, "<!-- cinebox-adblock: stripped -->");
                } else {
                    matcher.appendReplacement(sb, Matcher.quoteReplacement(matcher.group(0)));
                }
            }
            matcher.appendTail(sb);
            cleaned = sb.toString();
        }
        String injectedScriptlet = isNextJsDoc
            ? ANDROID_IN_FRAME_SHIELD_SCRIPTLET.replace(
                "window.__cineboxFrameShieldInstalled = true;",
                "window.__cineboxFrameShieldInstalled = true; try{var cs=document.currentScript;if(cs&&cs.parentNode)cs.parentNode.removeChild(cs);}catch(e){}"
              )
            : ANDROID_IN_FRAME_SHIELD_SCRIPTLET;
        if (cleaned.toLowerCase().contains("<head")) {
            return cleaned.replaceFirst("(?i)(<head[^>]*>)", "$1\n" + Matcher.quoteReplacement(injectedScriptlet));
        }
        return injectedScriptlet + cleaned;
    }

    private WebResourceResponse fetchAndInjectEmbedHtmlSafely(WebResourceRequest request) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(request.getUrl().toString());
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(7000);
            conn.setInstanceFollowRedirects(true);
            android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
            String storedCookie = cm != null ? cm.getCookie(url.toString()) : null;
            if (storedCookie != null && !storedCookie.isEmpty()) {
                conn.setRequestProperty("Cookie", storedCookie);
            }
            Map<String, String> headers = request.getRequestHeaders();
            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    if (entry.getKey() != null && entry.getValue() != null) {
                        conn.setRequestProperty(entry.getKey(), entry.getValue());
                    }
                }
            }
            int code = conn.getResponseCode();
            if (cm != null && conn.getHeaderFields() != null) {
                java.util.List<String> setCookies = conn.getHeaderFields().get("Set-Cookie");
                if (setCookies != null) {
                    for (String sc : setCookies) {
                        if (sc != null && !sc.isEmpty()) {
                            cm.setCookie(url.toString(), sc);
                        }
                    }
                }
            }
            String ct = conn.getContentType();
            if (code != 200 || ct == null || !ct.toLowerCase().contains("text/html")) {
                return null;
            }
            InputStream in = conn.getInputStream();
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            int total = 0;
            final int maxBytes = 3 * 1024 * 1024;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > maxBytes) {
                    return null;
                }
                baos.write(buf, 0, n);
            }
            String rawHtml = baos.toString(StandardCharsets.UTF_8.name());
            String injectedHtml = stripAdScriptsAndInjectShield(rawHtml);
            Map<String, String> respHeaders = new HashMap<>();
            respHeaders.put("Access-Control-Allow-Origin", "*");
            respHeaders.put("Referrer-Policy", "origin");
            return new WebResourceResponse(
                "text/html",
                "UTF-8",
                200,
                "OK",
                respHeaders,
                new ByteArrayInputStream(injectedHtml.getBytes(StandardCharsets.UTF_8))
            );
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void notifyWebAdBlocked(WebView view, String url, String kind) {
        if (view == null) return;
        final String safeUrl = url == null ? "" : url.substring(0, Math.min(url.length(), 180));
        final String safeKind = kind == null ? "network" : kind;
        controlsHideHandler.post(() -> {
            try {
                String js = "window.__cineboxOnNativeAdBlocked && window.__cineboxOnNativeAdBlocked("
                    + JSONObject.quote(safeUrl)
                    + ","
                    + JSONObject.quote(safeKind)
                    + ");";
                view.evaluateJavascript(js, null);
            } catch (Exception ignored) {
                // Ignore if WebView is detaching
            }
        });
    }

    public class CineboxAdBlockerBridge {
        @JavascriptInterface
        public void setState(boolean enabled, boolean embedIframeActive) {
            isAdBlockerEnabled = enabled;
            isEmbedIframePlayerActive = embedIframeActive;
        }

        @JavascriptInterface
        public void reportBlocked(String url, String kind) {
            if (getBridge() != null && getBridge().getWebView() != null) {
                notifyWebAdBlocked(getBridge().getWebView(), url, kind);
            }
        }

        @JavascriptInterface
        public void setImmersiveFullscreen(boolean enabled) {
            controlsHideHandler.post(() -> {
                isReactAppFullscreenActive = enabled;
                if (!isCustomFullscreenActive) {
                    configureSystemBarsPureBlack(enabled);
                }
            });
        }
    }

    private static final long NATIVE_EXIT_AUTO_HIDE_MS = 3000L;
    private boolean isCustomFullscreenActive = false;
    private volatile boolean isReactAppFullscreenActive = false;
    private WebChromeClient.CustomViewCallback activeCustomViewCallback = null;
    private View customFullscreenView = null;
    private FrameLayout customFullscreenContainer = null;
    private TextView nativeExitFullscreenButton = null;
    private final Handler controlsHideHandler = new Handler(Looper.getMainLooper());
    private final Runnable finalizeHideExitButtonRunnable = () -> {
        if (nativeExitFullscreenButton != null) {
            nativeExitFullscreenButton.setAlpha(0f);
            nativeExitFullscreenButton.setVisibility(View.GONE);
            nativeExitFullscreenButton.setClickable(false);
        }
    };
    private final Runnable hideExitButtonRunnable = () -> {
        if (nativeExitFullscreenButton != null) {
            nativeExitFullscreenButton.animate().cancel();
            nativeExitFullscreenButton.animate()
                .alpha(0f)
                .setDuration(220)
                .withEndAction(() -> {
                    if (nativeExitFullscreenButton != null) {
                        nativeExitFullscreenButton.setVisibility(View.GONE);
                        nativeExitFullscreenButton.setClickable(false);
                    }
                })
                .start();
            // Guarantee GONE even if device animator duration scale is 0x or interrupted
            controlsHideHandler.removeCallbacks(finalizeHideExitButtonRunnable);
            controlsHideHandler.postDelayed(finalizeHideExitButtonRunnable, 260L);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        loadAdBlockDomainsFromAssets();
        registerPlugin(CineboxLivePlayerPlugin.class);
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

            // Sync toggle state from CineBox React embed player
            webView.addJavascriptInterface(new CineboxAdBlockerBridge(), "CineboxAndroidAdBlocker");

            // 2. Network & Navigation AdBlocker registered via Capacitor's getBridge().setWebViewClient(...)
            getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    if (isAdBlockerEnabled && request != null && request.getUrl() != null) {
                        String reqUrl = request.getUrl().toString();
                        if (isVidSrcAdRequest(reqUrl)) {
                            notifyWebAdBlocked(view, reqUrl, "network");
                            return buildBlockedAssetResponse(reqUrl);
                        }
                        if (
                            !request.isForMainFrame()
                            && "GET".equalsIgnoreCase(request.getMethod())
                            && isEmbedProviderHost(request.getUrl().getHost())
                            && !isLikelyStaticAssetPath(request.getUrl().getPath())
                        ) {
                            WebResourceResponse shielded = fetchAndInjectEmbedHtmlSafely(request);
                            if (shielded != null) {
                                return shielded;
                            }
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (isAdBlockerEnabled && request != null && request.getUrl() != null) {
                        String reqUrl = request.getUrl().toString();
                        String scheme = request.getUrl().getScheme();
                        if (
                            scheme != null &&
                            (
                                scheme.equalsIgnoreCase("intent") ||
                                scheme.equalsIgnoreCase("market") ||
                                scheme.equalsIgnoreCase("android-app")
                            )
                        ) {
                            notifyWebAdBlocked(view, reqUrl, "redirect");
                            return true;
                        }
                        if (isVidSrcAdRequest(reqUrl)) {
                            notifyWebAdBlocked(view, reqUrl, "redirect");
                            return true;
                        }
                        if (isEmbedAdBlockerActive()) {
                            String host = request.getUrl().getHost();
                            if (request.isForMainFrame()) {
                                if (host != null && !host.equalsIgnoreCase("localhost") && !host.equals("127.0.0.1")) {
                                    notifyWebAdBlocked(view, reqUrl, "redirect");
                                    return true;
                                }
                            } else if (host != null && !isEmbedProviderHost(host) && !SAFE_HOST_ALLOWLIST.contains(host.toLowerCase())) {
                                notifyWebAdBlocked(view, reqUrl, "redirect");
                                return true;
                            }
                        }
                    }
                    return super.shouldOverrideUrlLoading(view, request);
                }
            });

            // 3. Extend Capacitor's BridgeWebChromeClient so native HTML5/Iframe fullscreen
            //    blends with the Android taskbar while `onCreateWindow` drops embed popup ads.
            webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public boolean onCreateWindow(
                    WebView view,
                    boolean isDialog,
                    boolean isUserGesture,
                    Message resultMsg
                ) {
                    if (isAdBlockerEnabled) {
                        notifyWebAdBlocked(view, "popup://window.open", "popup");
                        return false;
                    }
                    return super.onCreateWindow(view, isDialog, isUserGesture, resultMsg);
                }

                @Override
                public void onShowCustomView(View view, WebChromeClient.CustomViewCallback callback) {
                    if (view == null) {
                        if (callback != null) callback.onCustomViewHidden();
                        return;
                    }
                    if (customFullscreenView != null) {
                        if (callback != null) callback.onCustomViewHidden();
                        return;
                    }
                    // Do NOT invoke super.onShowCustomView(view, callback): Capacitor's BridgeWebChromeClient
                    // unconditionally calls callback.onCustomViewHidden(), which previously tore down fullscreen
                    // while leaving the native Exit button orphaned with no auto-hide timer.
                    view.setBackgroundColor(Color.BLACK);
                    isCustomFullscreenActive = true;
                    customFullscreenView = view;
                    activeCustomViewCallback = callback;

                    try {
                        ViewGroup decorGroup = (ViewGroup) getWindow().getDecorView();
                        FrameLayout container = new FrameLayout(MainActivity.this);
                        container.setBackgroundColor(Color.BLACK);
                        container.addView(
                            view,
                            new FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                        );
                        decorGroup.addView(
                            container,
                            new FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                        );
                        customFullscreenContainer = container;
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().setVisibility(View.INVISIBLE);
                        }
                    } catch (Exception ignored) {
                        // Continue gracefully with overlay fallback
                    }

                    configureSystemBarsPureBlack(true);
                    attachNativeExitFullscreenOverlay();
                    showNativeExitButtonTemporarily();
                }

                @Override
                public void onHideCustomView() {
                    teardownNativeCustomFullscreenUi(false);
                    super.onHideCustomView();
                }
            });
        }
    }

    private void attachNativeExitFullscreenOverlay() {
        try {
            ViewGroup hostGroup = customFullscreenContainer != null
                ? customFullscreenContainer
                : (ViewGroup) getWindow().getDecorView();
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

            hostGroup.addView(btn, params);
            nativeExitFullscreenButton = btn;
        } catch (Exception ignored) {
            // Safe fallback
        }
    }

    private void removeNativeExitFullscreenOverlay() {
        controlsHideHandler.removeCallbacks(hideExitButtonRunnable);
        controlsHideHandler.removeCallbacks(finalizeHideExitButtonRunnable);
        if (nativeExitFullscreenButton != null) {
            try {
                nativeExitFullscreenButton.animate().cancel();
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
        controlsHideHandler.removeCallbacks(finalizeHideExitButtonRunnable);
        nativeExitFullscreenButton.animate().cancel();
        nativeExitFullscreenButton.setAlpha(1f);
        nativeExitFullscreenButton.setVisibility(View.VISIBLE);
        nativeExitFullscreenButton.setClickable(true);
        nativeExitFullscreenButton.bringToFront();
        controlsHideHandler.postDelayed(hideExitButtonRunnable, NATIVE_EXIT_AUTO_HIDE_MS);
    }

    private void teardownNativeCustomFullscreenUi(boolean invokeCallback) {
        if (invokeCallback && activeCustomViewCallback != null) {
            try {
                activeCustomViewCallback.onCustomViewHidden();
            } catch (Exception ignored) {
                // ignore
            }
        }
        activeCustomViewCallback = null;
        isCustomFullscreenActive = false;
        removeNativeExitFullscreenOverlay();

        if (customFullscreenContainer != null) {
            try {
                customFullscreenContainer.removeAllViews();
                ViewGroup parent = (ViewGroup) customFullscreenContainer.getParent();
                if (parent != null) {
                    parent.removeView(customFullscreenContainer);
                }
            } catch (Exception ignored) {
                // ignore
            }
            customFullscreenContainer = null;
        }
        customFullscreenView = null;

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setVisibility(View.VISIBLE);
        }

        if (!isReactAppFullscreenActive) {
            configureSystemBarsPureBlack(false);
        }
    }

    private void exitNativeCustomFullscreen() {
        teardownNativeCustomFullscreenUi(true);
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(
                    "if (document.fullscreenElement) { document.exitFullscreen().catch(()=>{}); }",
                    null
                );
            }
        } catch (Exception ignored) {
            // ignore
        }
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        if (isCustomFullscreenActive && ev != null && ev.getActionMasked() == MotionEvent.ACTION_DOWN) {
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
