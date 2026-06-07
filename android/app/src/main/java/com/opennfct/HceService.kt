package com.opennfct

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

class HceService : HostApduService() {

    companion object {
        private val NDEF_AID = byteArrayOf(
            0xD2.toByte(), 0x76, 0x00, 0x00, 0x85.toByte(), 0x01, 0x01
        )
        private const val CC_FILE_ID  = 0xE103
        private const val NDEF_FILE_ID = 0xE104
        private const val FILE_NONE = -1
        private const val FILE_CC   = 0
        private const val FILE_NDEF = 1

        private val OK             = byteArrayOf(0x90.toByte(), 0x00)
        private val NO_APP_FOUND   = byteArrayOf(0x6A.toByte(), 0x82.toByte())
        private val FILE_NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())
        private val WRONG_PARAMS   = byteArrayOf(0x6B.toByte(), 0x00)
        private val UNKNOWN_CMD    = byteArrayOf(0x6D.toByte(), 0x00)

        @Volatile var ndefContent: ByteArray = byteArrayOf()
    }

    private var applicationSelected = false
    private var selectedFile = FILE_NONE

    private val ccFile: ByteArray get() {
        val maxSize = maxOf(ndefContent.size + 2, 15)
        return byteArrayOf(
            0x00, 0x0F,                                                  // CC length = 15
            0x20,                                                         // mapping v2.0
            0x00, 0x7F,                                                   // max R-APDU data
            0x00, 0x7F,                                                   // max C-APDU data
            0x04, 0x06,                                                   // NDEF File Control TLV
            0xE1.toByte(), 0x04,                                          // NDEF File ID
            (maxSize shr 8 and 0xFF).toByte(), (maxSize and 0xFF).toByte(), // max NDEF size
            0x00,                                                         // read: free
            0xFF.toByte()                                                 // write: none
        )
    }

    private val ndefFile: ByteArray get() {
        val n = ndefContent
        val len = n.size
        return byteArrayOf(
            (len shr 8 and 0xFF).toByte(),
            (len and 0xFF).toByte()
        ) + n
    }

    override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray {
        if (apdu.size < 4) return UNKNOWN_CMD
        return when (apdu[1].toInt() and 0xFF) {
            0xA4 -> handleSelect(apdu)
            0xB0 -> handleRead(apdu)
            else -> UNKNOWN_CMD
        }
    }

    private fun handleSelect(apdu: ByteArray): ByteArray {
        val p1 = apdu[2].toInt() and 0xFF
        return when (p1) {
            0x04 -> {
                // SELECT by AID
                if (apdu.size < 5) return UNKNOWN_CMD
                val aidLen = apdu[4].toInt() and 0xFF
                if (apdu.size < 5 + aidLen) return UNKNOWN_CMD
                val aid = apdu.copyOfRange(5, 5 + aidLen)
                if (aid.contentEquals(NDEF_AID) && ndefContent.isNotEmpty()) {
                    applicationSelected = true
                    selectedFile = FILE_NONE
                    OK
                } else NO_APP_FOUND
            }
            0x00 -> {
                // SELECT by File ID
                if (!applicationSelected || apdu.size < 7) return FILE_NOT_FOUND
                val fileId = ((apdu[5].toInt() and 0xFF) shl 8) or (apdu[6].toInt() and 0xFF)
                when (fileId) {
                    CC_FILE_ID   -> { selectedFile = FILE_CC;   OK }
                    NDEF_FILE_ID -> { selectedFile = FILE_NDEF; OK }
                    else         -> FILE_NOT_FOUND
                }
            }
            else -> FILE_NOT_FOUND
        }
    }

    private fun handleRead(apdu: ByteArray): ByteArray {
        if (selectedFile == FILE_NONE) return WRONG_PARAMS
        val p1 = apdu[2].toInt() and 0xFF
        val p2 = apdu[3].toInt() and 0xFF
        val offset = (p1 shl 8) or p2
        val le = if (apdu.size > 4) (apdu[4].toInt() and 0xFF).let { if (it == 0) 256 else it } else 256
        val data = when (selectedFile) {
            FILE_CC   -> ccFile
            FILE_NDEF -> ndefFile
            else      -> return FILE_NOT_FOUND
        }
        if (offset >= data.size) return WRONG_PARAMS
        val end = minOf(offset + le, data.size)
        return data.copyOfRange(offset, end) + OK
    }

    override fun onDeactivated(reason: Int) {
        applicationSelected = false
        selectedFile = FILE_NONE
    }
}
