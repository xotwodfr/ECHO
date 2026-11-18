plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
}

android {
  namespace = "com.folk3s.echo"
  compileSdk {
    version = release(37) { minorApiLevel = 2 }
  }

  defaultConfig {
    applicationId = "com.folk3s.echo"
    minSdk = 29
    targetSdk = 36
    versionCode = 9
    versionName = "0.6.0"
    // Fixed to the owner's server (2026-10-29). Debug builds may point at a test server instead:
    // ./gradlew assembleDebug -Pecho.devUrl=http://10.0.2.2:18797
    buildConfigField("String", "ECHO_URL", "\"https://echo.folk3s.com\"")
    manifestPlaceholders["cleartext"] = "false"
  }

  // A release key from the environment when there is one (CI: the ECHO_KEYSTORE_* secrets), so every
  // release installs over the last; otherwise the local debug key, fine for sideloading.
  val releaseKey = System.getenv("ECHO_KEYSTORE")?.takeIf { it.isNotBlank() && file(it).exists() }
  signingConfigs {
    if (releaseKey != null)
      create("release") {
        storeFile = file(releaseKey)
        storePassword = System.getenv("ECHO_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("ECHO_KEY_ALIAS")
        keyPassword = System.getenv("ECHO_KEY_PASSWORD")
      }
  }

  // A test server (-Pecho.devUrl, plain HTTP allowed) for debug and qa builds only; release is fixed.
  val devUrl = project.findProperty("echo.devUrl") as String?
  buildTypes {
    debug {
      devUrl?.let { buildConfigField("String", "ECHO_URL", "\"$it\"") }
      manifestPlaceholders["cleartext"] = "true"
    }
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      // The release key when the environment has one, else the local debug key (docs/ANDROID_CLIENT.md).
      signingConfig = signingConfigs.getByName(if (releaseKey != null) "release" else "debug")
    }
    // The release build, minified the same way, against a test server: R8 problems show here first.
    create("qa") {
      initWith(getByName("release"))
      devUrl?.let { buildConfigField("String", "ECHO_URL", "\"$it\"") }
      manifestPlaceholders["cleartext"] = "true"
    }
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }
}

dependencies {
  implementation(platform(libs.compose.bom))
  implementation(libs.compose.ui)
  implementation(libs.compose.foundation)
  implementation(libs.compose.material3)
  implementation(libs.activity.compose)
  implementation(libs.lifecycle.runtime.compose)
  implementation(libs.lifecycle.viewmodel.compose)
  implementation(libs.core.ktx)
  implementation(libs.media3.exoplayer)
  implementation(libs.media3.session)
  implementation(libs.media3.datasource.okhttp)
  implementation(libs.coil.compose)
  implementation(libs.coil.network.okhttp)
  implementation(libs.okhttp)
  implementation(libs.serialization.json)
  implementation(libs.materialkolor)
  implementation(libs.haze)
  testImplementation(libs.junit)
}
