plugins { alias(libs.plugins.android.application) }

android {
    namespace = "com.coloyond"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.coloyond"
        minSdk = 26
        targetSdk = 37
        versionCode = 2
        versionName = "1.1.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            // Supply a private release signing configuration for store distribution.
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    sourceSets {
        // The previous Compose prototype is retained as reference, not shipped.
        getByName("main").java.setSrcDirs(listOf("src/capacitor/java"))
        getByName("test").java.setSrcDirs(emptyList<String>())
        getByName("androidTest").java.setSrcDirs(emptyList<String>())
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation(project(":capacitor-android"))
    implementation(project(":capacitor-app"))
    implementation(project(":capacitor-status-bar"))
}

// A direct Gradle build also packages the current mobile UI, never stale assets.
val bundleMobileWeb by tasks.registering(Exec::class) {
    val repository = rootProject.projectDir.resolve("../..")
    workingDir(repository)
    inputs.dir(repository.resolve("src"))
    inputs.dir(repository.resolve("public"))
    inputs.files(repository.resolve("package.json"), repository.resolve("package-lock.json"),
        repository.resolve("vite.config.ts"), repository.resolve("capacitor.config.ts"), repository.resolve("index.html"))
    outputs.dir(projectDir.resolve("src/main/assets/public"))
    outputs.files(projectDir.resolve("src/main/assets/capacitor.config.json"), projectDir.resolve("src/main/assets/capacitor.plugins.json"))
    commandLine(if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm", "run", "android:sync")
}
tasks.named("preBuild") { dependsOn(bundleMobileWeb) }
