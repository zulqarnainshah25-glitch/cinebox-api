# CineBox — Android APK Build Guide & `AndroidManifest.xml` Configuration

## 1. Required `AndroidManifest.xml` Permissions
Place the following permissions inside `android/app/src/main/AndroidManifest.xml` (right above `<application>`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- Network & Streaming Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <!-- Offline Storage & Public Downloads Folder Export Permissions -->
    <!-- For Android 9 (API 28) and below -->
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />

    <!-- For Android 13+ (API 33+) Media Access -->
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />

    <!-- Foreground Download Notification Support -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true"
        android:requestLegacyExternalStorage="true"
        android:hardwareAccelerated="true"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
    </application>
</manifest>
```

---

## 2. Step-by-Step Terminal Commands to Compile the Android APK

```bash
# Step 1: Install dependencies
npm install

# Step 2: Install Capacitor CLI and Android platform
npm install -D @capacitor/cli
npm install @capacitor/android

# Step 3: Initialize Capacitor (if capacitor.config.json is not already present)
npx cap init "CineBox" "com.cinebox.stream" --web-dir=dist

# Step 4: Build the production React + Vite bundle
npm run build

# Step 5: Add the Android native project and sync web assets + native plugins
npx cap add android
npx cap sync android

# Step 6: Open in Android Studio OR build the APK directly via Gradle CLI
npx cap open android

# Optional: Direct CLI Debug APK Build (Output in android/app/build/outputs/apk/debug/app-debug.apk)
cd android && ./gradlew assembleDebug
```
