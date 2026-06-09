package com.opennfct

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.OutputStreamWriter

class SaveFileModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val SAVE_REQUEST_CODE        = 0x5AFE
        private const val OPEN_REQUEST_CODE        = 0x5AFD
        private const val SAVE_BINARY_REQUEST_CODE = 0x5AFC
        private const val OPEN_BINARY_REQUEST_CODE = 0x5AFB
    }

    private var pendingCallback: Callback? = null
    private var pendingContent: String? = null
    private var pendingOpenCallback: Callback? = null
    private var pendingBinaryCallback: Callback? = null
    private var pendingBinaryContent: ByteArray? = null
    private var pendingOpenBinaryCallback: Callback? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = "SaveFile"

    @ReactMethod
    fun save(content: String, filename: String, mimeType: String, callback: Callback) {
        val activity = getReactApplicationContext().getCurrentActivity()
        if (activity == null) {
            val err = Arguments.createMap().apply {
                putString("code", "NO_ACTIVITY")
                putString("message", "No current activity")
            }
            callback.invoke(err)
            return
        }
        pendingCallback = callback
        pendingContent = content

        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
            putExtra(Intent.EXTRA_TITLE, filename)
        }
        activity.startActivityForResult(intent, SAVE_REQUEST_CODE)
    }

    @ReactMethod
    fun open(mimeType: String, callback: Callback) {
        val activity = getReactApplicationContext().getCurrentActivity()
        if (activity == null) {
            val err = Arguments.createMap().apply {
                putString("code", "NO_ACTIVITY")
                putString("message", "No current activity")
            }
            callback.invoke(err)
            return
        }
        pendingOpenCallback = callback

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
        }
        activity.startActivityForResult(intent, OPEN_REQUEST_CODE)
    }

    @ReactMethod
    fun saveBinary(base64Content: String, filename: String, mimeType: String, callback: Callback) {
        val activity = getReactApplicationContext().getCurrentActivity()
        if (activity == null) {
            val err = Arguments.createMap().apply {
                putString("code", "NO_ACTIVITY")
                putString("message", "No current activity")
            }
            callback.invoke(err)
            return
        }
        val bytes = try {
            Base64.decode(base64Content, Base64.DEFAULT)
        } catch (e: Exception) {
            val err = Arguments.createMap().apply {
                putString("code", "DECODE_ERROR")
                putString("message", e.message ?: "Base64 decode failed")
            }
            callback.invoke(err)
            return
        }
        pendingBinaryCallback = callback
        pendingBinaryContent = bytes

        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
            putExtra(Intent.EXTRA_TITLE, filename)
        }
        activity.startActivityForResult(intent, SAVE_BINARY_REQUEST_CODE)
    }

    @ReactMethod
    fun openBinary(mimeType: String, callback: Callback) {
        val activity = getReactApplicationContext().getCurrentActivity()
        if (activity == null) {
            val err = Arguments.createMap().apply {
                putString("code", "NO_ACTIVITY")
                putString("message", "No current activity")
            }
            callback.invoke(err)
            return
        }
        pendingOpenBinaryCallback = callback

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
        }
        activity.startActivityForResult(intent, OPEN_BINARY_REQUEST_CODE)
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        when (requestCode) {
            SAVE_REQUEST_CODE        -> handleSaveResult(resultCode, data)
            OPEN_REQUEST_CODE        -> handleOpenResult(resultCode, data)
            SAVE_BINARY_REQUEST_CODE -> handleSaveBinaryResult(resultCode, data)
            OPEN_BINARY_REQUEST_CODE -> handleOpenBinaryResult(resultCode, data)
        }
    }

    private fun handleSaveBinaryResult(resultCode: Int, data: Intent?) {
        val callback = pendingBinaryCallback ?: return
        val content = pendingBinaryContent ?: ByteArray(0)
        pendingBinaryCallback = null
        pendingBinaryContent = null

        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            val err = Arguments.createMap().apply {
                putString("code", "CANCELLED")
                putString("message", "User cancelled")
            }
            callback.invoke(err)
            return
        }

        try {
            val uri: Uri = data.data!!
            getReactApplicationContext().contentResolver.openOutputStream(uri)?.use { stream ->
                stream.write(content)
            } ?: run {
                val err = Arguments.createMap().apply {
                    putString("code", "WRITE_ERROR")
                    putString("message", "Could not open output stream")
                }
                callback.invoke(err)
                return
            }
            callback.invoke(null, uri.toString())
        } catch (e: Exception) {
            val err = Arguments.createMap().apply {
                putString("code", "WRITE_ERROR")
                putString("message", e.message ?: "Unknown write error")
            }
            callback.invoke(err)
        }
    }

    private fun handleOpenBinaryResult(resultCode: Int, data: Intent?) {
        val callback = pendingOpenBinaryCallback ?: return
        pendingOpenBinaryCallback = null

        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            val err = Arguments.createMap().apply {
                putString("code", "CANCELLED")
                putString("message", "User cancelled")
            }
            callback.invoke(err)
            return
        }

        try {
            val uri: Uri = data.data!!
            val bytes = getReactApplicationContext().contentResolver
                .openInputStream(uri)
                ?.use { it.readBytes() }
                ?: run {
                    val err = Arguments.createMap().apply {
                        putString("code", "READ_ERROR")
                        putString("message", "Could not open input stream")
                    }
                    callback.invoke(err)
                    return
                }
            callback.invoke(null, Base64.encodeToString(bytes, Base64.NO_WRAP))
        } catch (e: Exception) {
            val err = Arguments.createMap().apply {
                putString("code", "READ_ERROR")
                putString("message", e.message ?: "Unknown read error")
            }
            callback.invoke(err)
        }
    }

    private fun handleSaveResult(resultCode: Int, data: Intent?) {
        val callback = pendingCallback ?: return
        val content = pendingContent ?: ""
        pendingCallback = null
        pendingContent = null

        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            val err = Arguments.createMap().apply {
                putString("code", "CANCELLED")
                putString("message", "User cancelled")
            }
            callback.invoke(err)
            return
        }

        try {
            val uri: Uri = data.data!!
            getReactApplicationContext().contentResolver.openOutputStream(uri)?.use { stream ->
                OutputStreamWriter(stream, Charsets.UTF_8).use { it.write(content) }
            } ?: run {
                val err = Arguments.createMap().apply {
                    putString("code", "WRITE_ERROR")
                    putString("message", "Could not open output stream")
                }
                callback.invoke(err)
                return
            }
            callback.invoke(null, uri.toString())
        } catch (e: Exception) {
            val err = Arguments.createMap().apply {
                putString("code", "WRITE_ERROR")
                putString("message", e.message ?: "Unknown write error")
            }
            callback.invoke(err)
        }
    }

    private fun handleOpenResult(resultCode: Int, data: Intent?) {
        val callback = pendingOpenCallback ?: return
        pendingOpenCallback = null

        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            val err = Arguments.createMap().apply {
                putString("code", "CANCELLED")
                putString("message", "User cancelled")
            }
            callback.invoke(err)
            return
        }

        try {
            val uri: Uri = data.data!!
            val text = getReactApplicationContext().contentResolver
                .openInputStream(uri)
                ?.bufferedReader(Charsets.UTF_8)
                ?.use { it.readText() }
                ?: run {
                    val err = Arguments.createMap().apply {
                        putString("code", "READ_ERROR")
                        putString("message", "Could not open input stream")
                    }
                    callback.invoke(err)
                    return
                }
            callback.invoke(null, text)
        } catch (e: Exception) {
            val err = Arguments.createMap().apply {
                putString("code", "READ_ERROR")
                putString("message", e.message ?: "Unknown read error")
            }
            callback.invoke(err)
        }
    }

    override fun onNewIntent(intent: Intent) {}
}
