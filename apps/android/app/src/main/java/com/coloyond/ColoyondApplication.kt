package com.coloyond

import android.app.Application
import com.coloyond.di.AppContainer

/** Owns the single [AppContainer]; registered in AndroidManifest.xml (ruleset 41: wire it once, early). */
class ColoyondApplication : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
