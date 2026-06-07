package com.opennfct

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class HceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "Hce"

    @ReactMethod
    fun start(hexBytes: String, promise: Promise) {
        try {
            val bytes = hexBytes.trim()
                .split(Regex("[\\s,:\\n]+"))
                .filter { it.isNotEmpty() }
                .map { it.toInt(16).toByte() }
                .toByteArray()
            HceService.ndefContent = bytes
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PARSE_ERROR", "Invalid hex: ${e.message}")
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        HceService.ndefContent = byteArrayOf()
        promise.resolve(null)
    }
}
