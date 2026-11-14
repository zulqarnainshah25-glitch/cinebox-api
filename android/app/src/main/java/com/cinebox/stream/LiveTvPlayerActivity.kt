package com.cinebox.stream

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import org.json.JSONArray

/**
 * Native Android Media3 ExoPlayer Activity for CineBox Live TV.
 * Supports HLS (.m3u8) + DASH (.mpd), audio/subtitle track selection,
 * live edge jumping, fullscreen immersive bars, orientation switching,
 * alternate source switching, reconnection/retry, and strict lifecycle cleanup.
 */
@OptIn(UnstableApi::class)
class LiveTvPlayerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_CHANNEL_ID = "extra_channel_id"
        const val EXTRA_CHANNEL_NAME = "extra_channel_name"
        const val EXTRA_STREAM_URL = "extra_stream_url"
        const val EXTRA_FORMAT = "extra_format"
        const val EXTRA_CATEGORY = "extra_category"
        const val EXTRA_COUNTRY = "extra_country"
        const val EXTRA_EPG_TITLE = "extra_epg_title"
        const val EXTRA_ALTERNATE_SOURCES_JSON = "extra_alternate_sources_json"
        const val ACTION_STOP_LIVE_PLAYER = "com.cinebox.stream.ACTION_STOP_LIVE_PLAYER"
    }

    private lateinit var playerView: PlayerView
    private lateinit var channelTitleView: TextView
    private lateinit var epgTitleView: TextView
    private lateinit var loadingIndicator: ProgressBar
    private lateinit var errorContainer: LinearLayout
    private lateinit var errorMessageView: TextView
    private lateinit var retryButton: Button
    private lateinit var backButton: ImageButton
    private lateinit var orientationButton: ImageButton
    private lateinit var audioTrackButton: Button
    private lateinit var subtitleTrackButton: Button
    private lateinit var liveEdgeButton: Button
    private lateinit var sourceSwitchButton: Button

    private var player: ExoPlayer? = null
    private var currentStreamUrl: String = ""
    private var currentFormat: String = "hls"
    private var isLandscapeLocked = false
    private var retryAttempt = 0
    private val alternateSources = mutableListOf<Triple<String, String, String>>() // id, url, format

    private val stopReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ACTION_STOP_LIVE_PLAYER) {
                finish()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_live_tv_player)

        playerView = findViewById(R.id.live_player_view)
        channelTitleView = findViewById(R.id.live_channel_title)
        epgTitleView = findViewById(R.id.live_epg_title)
        loadingIndicator = findViewById(R.id.live_loading_spinner)
        errorContainer = findViewById(R.id.live_error_overlay)
        errorMessageView = findViewById(R.id.live_error_message)
        retryButton = findViewById(R.id.live_retry_btn)
        backButton = findViewById(R.id.live_back_btn)
        orientationButton = findViewById(R.id.live_orientation_btn)
        audioTrackButton = findViewById(R.id.live_audio_track_btn)
        subtitleTrackButton = findViewById(R.id.live_subtitle_track_btn)
        liveEdgeButton = findViewById(R.id.live_edge_btn)
        sourceSwitchButton = findViewById(R.id.live_source_switch_btn)

        configureImmersiveSystemBars()
        bindControls()
        registerStopReceiver()
        loadFromIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        loadFromIntent(intent)
    }

    private fun registerStopReceiver() {
        val filter = IntentFilter(ACTION_STOP_LIVE_PLAYER)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stopReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(stopReceiver, filter)
        }
    }

    private fun bindControls() {
        backButton.setOnClickListener { finish() }

        retryButton.setOnClickListener {
            retryAttempt = 0
            startOrReloadStream(currentStreamUrl, currentFormat)
        }

        orientationButton.setOnClickListener {
            isLandscapeLocked = !isLandscapeLocked
            requestedOrientation = if (isLandscapeLocked) {
                ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            } else {
                ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }

        liveEdgeButton.setOnClickListener {
            player?.let { p ->
                if (p.isCurrentMediaItemLive) {
                    p.seekToDefaultPosition()
                    p.playWhenReady = true
                }
            }
        }

        audioTrackButton.setOnClickListener { showTrackSelectionDialog(C.TRACK_TYPE_AUDIO, "Select Audio Track") }
        subtitleTrackButton.setOnClickListener { showTrackSelectionDialog(C.TRACK_TYPE_TEXT, "Select Subtitles") }

        sourceSwitchButton.setOnClickListener {
            if (alternateSources.isEmpty()) return@setOnClickListener
            val labels = alternateSources.mapIndexed { idx, item ->
                "Source ${idx + 1} (${item.third.uppercase()})"
            }.toTypedArray()
            AlertDialog.Builder(this)
                .setTitle("Switch Approved Source")
                .setItems(labels) { _, which ->
                    val chosen = alternateSources[which]
                    currentStreamUrl = chosen.second
                    currentFormat = chosen.third
                    startOrReloadStream(currentStreamUrl, currentFormat)
                }
                .show()
        }
    }

    private fun loadFromIntent(intent: Intent?) {
        if (intent == null) {
            showError("Missing channel stream parameters.")
            return
        }
        val channelName = intent.getStringExtra(EXTRA_CHANNEL_NAME).orEmpty().ifEmpty { "Live TV" }
        val epgTitle = intent.getStringExtra(EXTRA_EPG_TITLE).orEmpty()
        currentStreamUrl = intent.getStringExtra(EXTRA_STREAM_URL).orEmpty()
        currentFormat = intent.getStringExtra(EXTRA_FORMAT).orEmpty().ifEmpty { "hls" }

        channelTitleView.text = channelName
        epgTitleView.text = if (epgTitle.isNotEmpty()) "Now: $epgTitle" else "Live Stream"

        alternateSources.clear()
        val altJson = intent.getStringExtra(EXTRA_ALTERNATE_SOURCES_JSON).orEmpty()
        if (altJson.isNotEmpty()) {
            try {
                val arr = JSONArray(altJson)
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val id = obj.optString("id")
                    val url = obj.optString("url")
                    val fmt = obj.optString("format", "hls")
                    if (url.startsWith("http")) {
                        alternateSources.add(Triple(id, url, fmt))
                    }
                }
            } catch (_: Exception) {
                // ignore malformed extras cleanly
            }
        }
        sourceSwitchButton.visibility = if (alternateSources.size > 1) View.VISIBLE else View.GONE

        startOrReloadStream(currentStreamUrl, currentFormat)
    }

    private fun initializePlayerIfNeeded(): ExoPlayer {
        player?.let { return it }

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(15_000, 45_000, 2_500, 5_000)
            .build()

        val exo = ExoPlayer.Builder(this)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this))
            .build()

        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_BUFFERING -> {
                        loadingIndicator.visibility = View.VISIBLE
                    }
                    Player.STATE_READY -> {
                        loadingIndicator.visibility = View.GONE
                        errorContainer.visibility = View.GONE
                        retryAttempt = 0
                    }
                    Player.STATE_ENDED -> {
                        loadingIndicator.visibility = View.GONE
                        showError("Live stream ended or connection closed.")
                    }
                    Player.STATE_IDLE -> {
                        loadingIndicator.visibility = View.GONE
                    }
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                loadingIndicator.visibility = View.GONE
                if (retryAttempt < 1) {
                    retryAttempt += 1
                    exo.prepare()
                    exo.playWhenReady = true
                    return
                }
                val codeName = error.errorCodeName
                val humanMessage = when {
                    codeName.contains("IO_NETWORK_CONNECTION_TIMEOUT") ->
                        "Stream connection timed out. Tap Retry or try another source."
                    codeName.contains("PARSING") ->
                        "Stream playlist or manifest is invalid or corrupted."
                    codeName.contains("BAD_HTTP_STATUS") ->
                        "Channel stream returned an HTTP error or is temporarily offline."
                    else ->
                        "Playback failed (${codeName})."
                }
                showError(humanMessage)
            }
        })

        playerView.player = exo
        player = exo
        return exo
    }

    private fun startOrReloadStream(url: String, format: String) {
        if (url.isBlank() || (!url.startsWith("https://") && !url.startsWith("http://"))) {
            showError("Invalid live stream URL.")
            return
        }

        errorContainer.visibility = View.GONE
        loadingIndicator.visibility = View.VISIBLE

        val mimeType = when {
            format.equals("dash", ignoreCase = true) || url.contains(".mpd", ignoreCase = true) ->
                MimeTypes.APPLICATION_MPD
            else ->
                MimeTypes.APPLICATION_M3U8
        }

        val mediaItem = MediaItem.Builder()
            .setUri(Uri.parse(url))
            .setMimeType(mimeType)
            .setLiveConfiguration(
                MediaItem.LiveConfiguration.Builder()
                    .setTargetOffsetMs(4000)
                    .setMaxPlaybackSpeed(1.04f)
                    .build()
            )
            .build()

        val exo = initializePlayerIfNeeded()
        exo.setMediaItem(mediaItem)
        exo.prepare()
        exo.playWhenReady = true
    }

    private fun showTrackSelectionDialog(trackType: Int, title: String) {
        val exo = player ?: return
        val groups = exo.currentTracks.groups.filter { it.type == trackType }
        val options = mutableListOf<Pair<String, Tracks.Group?>>()
        if (trackType == C.TRACK_TYPE_TEXT) {
            options.add("Subtitles Off" to null)
        }
        groups.forEachIndexed { idx, group ->
            val fmt = group.getTrackFormat(0)
            val label = listOfNotNull(fmt.label, fmt.language?.uppercase())
                .distinct()
                .joinToString(" · ")
                .ifEmpty { "Track ${idx + 1}" }
            options.add(label to group)
        }

        if (options.isEmpty()) {
            AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage("No selectable tracks available in this broadcast.")
                .setPositiveButton("OK", null)
                .show()
            return
        }

        val labels = options.map { it.first }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(title)
            .setItems(labels) { _, which ->
                val selectedGroup = options[which].second
                val builder = exo.trackSelectionParameters.buildUpon()
                if (selectedGroup == null) {
                    builder.setTrackTypeDisabled(trackType, true)
                } else {
                    builder.setTrackTypeDisabled(trackType, false)
                    builder.setOverrideForType(TrackSelectionOverride(selectedGroup.mediaTrackGroup, 0))
                }
                exo.trackSelectionParameters = builder.build()
            }
            .show()
    }

    private fun showError(msg: String) {
        loadingIndicator.visibility = View.GONE
        errorContainer.visibility = View.VISIBLE
        errorMessageView.text = msg
    }

    private fun configureImmersiveSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    override fun onStop() {
        super.onStop()
        player?.pause()
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(stopReceiver)
        } catch (_: Exception) {
            // ignore
        }
        playerView.player = null
        player?.release()
        player = null
        super.onDestroy()
    }
}
