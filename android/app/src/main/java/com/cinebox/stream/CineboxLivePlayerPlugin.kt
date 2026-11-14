package com.cinebox.stream

import android.content.Intent
import android.net.Uri
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor Bridge for CineBox Native Android Media3 ExoPlayer (HLS + DASH).
 */
@CapacitorPlugin(name = "CineboxLivePlayer")
class CineboxLivePlayerPlugin : Plugin() {

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val result = JSObject()
        result.put("available", true)
        result.put("engine", "androidx-media3-1.11.1")
        call.resolve(result)
    }

    @PluginMethod
    fun playStream(call: PluginCall) {
        launchOrSwitchPlayer(call, isSwitch = false)
    }

    @PluginMethod
    fun switchChannel(call: PluginCall) {
        launchOrSwitchPlayer(call, isSwitch = true)
    }

    @PluginMethod
    fun stopPlayback(call: PluginCall) {
        val intent = Intent(LiveTvPlayerActivity.ACTION_STOP_LIVE_PLAYER)
        context.sendBroadcast(intent)
        val result = JSObject()
        result.put("stopped", true)
        call.resolve(result)
    }

    private fun launchOrSwitchPlayer(call: PluginCall, isSwitch: Boolean) {
        val streamUrl = call.getString("streamUrl")?.trim().orEmpty()
        val channelName = call.getString("channelName")?.trim().orEmpty().ifEmpty { "Live TV" }
        val channelId = call.getString("channelId")?.trim().orEmpty()
        val format = call.getString("format")?.trim()?.lowercase().orEmpty().ifEmpty { "hls" }
        val category = call.getString("category")?.trim().orEmpty()
        val country = call.getString("country")?.trim().orEmpty()
        val epgTitle = call.getString("epgTitle")?.trim().orEmpty()
        val alternateSourcesJson = call.getString("alternateSourcesJson")?.trim().orEmpty()

        val uri = try {
            Uri.parse(streamUrl)
        } catch (_: Exception) {
            null
        }
        val scheme = uri?.scheme?.lowercase().orEmpty()
        if (streamUrl.isEmpty() || (scheme != "https" && scheme != "http")) {
            val res = JSObject()
            res.put(if (isSwitch) "switched" else "started", false)
            res.put("error", "Invalid or non-HTTP(S) stream URL.")
            call.resolve(res)
            return
        }

        if (format == "unknown" && !streamUrl.contains(".m3u8", ignoreCase = true) && !streamUrl.contains(".mpd", ignoreCase = true)) {
            val res = JSObject()
            res.put(if (isSwitch) "switched" else "started", false)
            res.put("error", "Unsupported live stream format for native Media3 player.")
            call.resolve(res)
            return
        }

        val currentActivity = activity ?: run {
            call.reject("Host Android Activity is unavailable.")
            return
        }

        val intent = Intent(currentActivity, LiveTvPlayerActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra(LiveTvPlayerActivity.EXTRA_CHANNEL_ID, channelId)
            putExtra(LiveTvPlayerActivity.EXTRA_CHANNEL_NAME, channelName)
            putExtra(LiveTvPlayerActivity.EXTRA_STREAM_URL, streamUrl)
            putExtra(LiveTvPlayerActivity.EXTRA_FORMAT, format)
            putExtra(LiveTvPlayerActivity.EXTRA_CATEGORY, category)
            putExtra(LiveTvPlayerActivity.EXTRA_COUNTRY, country)
            putExtra(LiveTvPlayerActivity.EXTRA_EPG_TITLE, epgTitle)
            putExtra(LiveTvPlayerActivity.EXTRA_ALTERNATE_SOURCES_JSON, alternateSourcesJson)
        }

        currentActivity.runOnUiThread {
            currentActivity.startActivity(intent)
        }

        val result = JSObject()
        result.put(if (isSwitch) "switched" else "started", true)
        call.resolve(result)
    }
}
