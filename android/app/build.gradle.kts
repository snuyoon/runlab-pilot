plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.snuyoon.runlab"
    compileSdk = 36 // Health Connect 1.1.0 요구 (AGP 8.9.1+와 함께)

    defaultConfig {
        applicationId = "com.snuyoon.runlab" // iOS 번들과 동일 식별자
        minSdk = 26                          // Android 8.0 — 적응형 아이콘·VibrationEffect·Health Connect 지원 하한
        targetSdk = 35                       // Android 15
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    // Health Connect — 러닝 세션(거리·심박) 읽기 (1.1.0 = 첫 정식 안정판, 2025-10)
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
