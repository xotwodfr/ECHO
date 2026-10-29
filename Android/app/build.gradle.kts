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
    versionCode = 1
    versionName = "0.1.0"
    // Fixed to the owner's server (2026-10-29). Debug builds may point at a test server instead:
    // ./gradlew assembleDebug -Pecho.devUrl=http://10.0.2.2:18797
    buildConfigField("String", "ECHO_URL", "\"https://echo.folk3s.com\"")
  }

  buildTypes {
    debug {
      (project.findProperty("echo.devUrl") as String?)?.let { buildConfigField("String", "ECHO_URL", "\"$it\"") }
    }
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      // Sideloaded builds use the local debug key; a Play release needs its own (docs/ANDROID_CLIENT.md).
      signingConfig = signingConfigs.getByName("debug")
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
  testImplementation(libs.junit)
}
