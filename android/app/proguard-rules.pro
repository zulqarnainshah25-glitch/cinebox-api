# Preserve Capacitor Plugin bridge methods & CineBox native classes under R8 release shrinking
-keep class com.cinebox.stream.MainActivity { *; }
-keep class com.cinebox.stream.CineboxLivePlayerPlugin { *; }
-keep class com.cinebox.stream.LiveTvPlayerActivity { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
}
