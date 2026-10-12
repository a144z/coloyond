plugins { alias(libs.plugins.android.application) apply false }

// Keep the shell and Capacitor plugin modules on one Android SDK level.
extra["compileSdkVersion"] = 37
extra["targetSdkVersion"] = 37
extra["minSdkVersion"] = 26
