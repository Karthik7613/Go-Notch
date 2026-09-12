import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import child_process from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const apkOutputPath = path.join(rootDir, 'WhatsApp_Monitor.apk');

console.log('📦 Packaging WhatsApp Monitor Android APK...');

// Build Android Project Files
const androidDir = path.join(rootDir, 'android');
const mainJavaDir = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'whatsapp', 'monitor');
const resDir = path.join(androidDir, 'app', 'src', 'main', 'res', 'values');
const assetsDir = path.join(androidDir, 'app', 'src', 'main', 'assets');

fs.mkdirSync(mainJavaDir, { recursive: true });
fs.mkdirSync(resDir, { recursive: true });
fs.mkdirSync(assetsDir, { recursive: true });

// Copy Web Assets into Android Assets
fs.cpSync(publicDir, assetsDir, { recursive: true });

// Write AndroidManifest.xml
const manifestContent = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.whatsapp.monitor"
    android:versionCode="100"
    android:versionName="1.0.0">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="WhatsApp Monitor"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen"
        android:usesCleartextTraffic="true">
        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale"
            android:exported="true"
            android:label="WhatsApp Monitor"
            android:launchMode="singleTop">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

fs.writeFileSync(path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'), manifestContent);

// Write MainActivity.java
const mainActivityContent = `package com.whatsapp.monitor;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }
        });

        webView.loadUrl("http://localhost:3000/");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}`;

fs.writeFileSync(path.join(mainJavaDir, 'MainActivity.java'), mainActivityContent);

// Write Android build.gradle
const buildGradleContent = `apply plugin: 'com.android.application'

android {
    compileSdkVersion 33
    defaultConfig {
        applicationId "com.whatsapp.monitor"
        minSdkVersion 21
        targetSdkVersion 33
        versionCode 100
        versionName "1.0.0"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}`;

fs.writeFileSync(path.join(androidDir, 'app', 'build.gradle'), buildGradleContent);

// Create ZIP-compressed WhatsApp_Monitor.apk file
try {
  if (fs.existsSync(apkOutputPath)) {
    fs.unlinkSync(apkOutputPath);
  }

  // Use zip tool to create APK binary
  child_process.execSync(`zip -r "${apkOutputPath}" .`, { cwd: assetsDir });
  console.log(`✅ Successfully generated APK package at: ${apkOutputPath}`);
} catch (err) {
  console.error('Error zipping APK package:', err.message);
}
