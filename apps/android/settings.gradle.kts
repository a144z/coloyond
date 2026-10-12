pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
        // Ruleset 4: most Web3 Android artifacts ship through JitPack.
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "coloyond"
include(":app")

apply(from = "capacitor.settings.gradle")
