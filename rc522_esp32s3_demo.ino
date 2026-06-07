/**
 * RC522 NDEF-compatible reader for ESP32-S3
 *
 * Compatible with NFC Tools (Android/iOS), OpenNFCT, and any NFC Forum app.
 * Reads NDEF Text/URI Records from Mifare Classic (sector 1, blocks 4/5/6)
 * and from ISO-DEP Type 4 Tags (including Android HCE).
 *
 * Wiring:
 *  RC522 SDA  --> GPIO 10
 *  RC522 SCK  --> GPIO 12
 *  RC522 MOSI --> GPIO 11
 *  RC522 MISO --> GPIO 13
 *  RC522 RST  --> GPIO 9
 *  RC522 3.3V --> 3.3V (NOT 5V)
 */

#include <SPI.h>
#include <MFRC522.h>

#define SS_PIN   10
#define RST_PIN  9
#define SCK_PIN  12
#define MOSI_PIN 11
#define MISO_PIN 13

MFRC522 rfid(SS_PIN, RST_PIN);

// NFC Tools uses sector 1 for NDEF data
static const byte DATA_BLOCKS[3] = {4, 5, 6};

// NFC Forum key for data sectors (set by NFC Tools format), then 0xFF fallback
static const byte KEYS[][6] = {
  {0xD3, 0xF7, 0xD3, 0xF7, 0xD3, 0xF7},
  {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF},
};

// -------------------------------------------------------
// Write state — set by Serial command, consumed on next card tap
// -------------------------------------------------------
static bool hasPendingWrite = false;
static byte writeData[48];   // pre-built NDEF TLV ready to go to the card
static byte writeDataLen = 0;

// Build a Mifare-NDEF TLV Text record into buf[48].
// Layout: 03 <recordLen> D1 01 <payloadLen> 54 02 "en" <text> FE 00...
// Returns number of meaningful bytes (rest of buf is already zeroed).
byte buildNDEFText(const String& text, byte* buf) {
  byte textLen    = (byte)min((int)text.length(), 38); // 48 - 10 header bytes
  byte payloadLen = 3 + textLen;                        // status(1) + "en"(2) + text
  byte recordLen  = 4 + payloadLen;                     // hdr+type_len+payload_len+type + payload
  memset(buf, 0, 48);
  byte i = 0;
  buf[i++] = 0x03;        // NDEF TLV tag
  buf[i++] = recordLen;   // NDEF message length
  buf[i++] = 0xD1;        // MB=1 ME=1 SR=1 TNF=01 (Well-known)
  buf[i++] = 0x01;        // type length = 1
  buf[i++] = payloadLen;  // payload length
  buf[i++] = 0x54;        // type 'T' (Text)
  buf[i++] = 0x02;        // status: UTF-8, lang len = 2
  buf[i++] = 'e';
  buf[i++] = 'n';
  memcpy(buf + i, text.c_str(), textLen);
  i += textLen;
  buf[i++] = 0xFE;        // Terminator TLV
  return i;
}

// -------------------------------------------------------
// ISO-DEP (Type 4 Tag) support — for Android HCE
// -------------------------------------------------------

static byte t4tBlock = 0; // alternating I-block number

// Send one APDU wrapped in an ISO-DEP I-block.
// Returns response bytes including SW1+SW2, excludes PCB and CRC.
bool sendIBlock(byte* apdu, byte apduLen, byte* resp, byte& respLen) {
  byte buf[66];
  buf[0] = 0x02 | (t4tBlock & 0x01);  // PCB
  memcpy(buf + 1, apdu, apduLen);
  rfid.PCD_CalculateCRC(buf, 1 + apduLen, buf + 1 + apduLen);

  byte rx[64];
  byte rxLen = sizeof(rx);
  MFRC522::StatusCode s = rfid.PCD_TransceiveData(
      buf, 1 + apduLen + 2, rx, &rxLen, nullptr, 0, true);
  if (s != MFRC522::STATUS_OK || rxLen < 3) return false;

  // rx = [PCB][data+SW][CRC×2] — checkCRC=true verifies but does not strip CRC
  respLen = rxLen - 3;          // drop PCB(1) and CRC(2)
  memcpy(resp, rx + 1, respLen);
  t4tBlock ^= 1;
  return true;
}

// Parse a raw NDEF message (no TLV wrapper — T4T format)
String parseNDEFMessage(byte* msg, byte len) {
  if (len < 3) return "";
  byte type_len    = msg[1];
  byte payload_len = msg[2];
  byte* type       = msg + 3;
  byte* payload    = type + type_len;
  if (payload + payload_len > msg + len) return "";

  if (type_len == 1 && type[0] == 0x54) { // Text
    byte lang_len = payload[0] & 0x3F;
    byte text_len = payload_len - 1 - lang_len;
    if (text_len > 0) return String((char*)(payload + 1 + lang_len), text_len);
  }
  if (type_len == 1 && type[0] == 0x55) { // URI
    String uri = uriPrefix(payload[0]);
    uri += String((char*)(payload + 1), payload_len - 1);
    return uri;
  }
  return "";
}

void readT4TCard() {
  Serial.println("ISO-DEP / phone HCE detected");
  t4tBlock = 0;

  // Activate ISO 14443-4 layer with RATS
  byte rats[4] = {0xE0, 0x50, 0, 0};
  rfid.PCD_CalculateCRC(rats, 2, rats + 2);
  byte ats[32];
  byte atsLen = sizeof(ats);
  if (rfid.PCD_TransceiveData(rats, 4, ats, &atsLen, nullptr, 0, true) != MFRC522::STATUS_OK) {
    Serial.println("  RATS failed");
    return;
  }

  byte resp[64];
  byte respLen;

  // SELECT NDEF Application (AID: D2 76 00 00 85 01 01)
  byte selApp[] = {0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00};
  if (!sendIBlock(selApp, sizeof(selApp), resp, respLen) ||
      resp[respLen-2] != 0x90 || resp[respLen-1] != 0x00) {
    Serial.println("  No NDEF app — load content in the emulator first");
    return;
  }

  // SELECT CC file (0xE103)
  byte selCC[] = {0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x03};
  if (!sendIBlock(selCC, sizeof(selCC), resp, respLen) ||
      resp[respLen-2] != 0x90 || resp[respLen-1] != 0x00) {
    Serial.println("  Select CC failed");
    return;
  }

  // READ CC (15 bytes)
  byte rdCC[] = {0x00, 0xB0, 0x00, 0x00, 0x0F};
  if (!sendIBlock(rdCC, sizeof(rdCC), resp, respLen) ||
      resp[respLen-2] != 0x90 || resp[respLen-1] != 0x00) {
    Serial.println("  Read CC failed");
    return;
  }
  byte ndefFID[2] = {resp[9], resp[10]}; // NDEF file ID from CC bytes 9-10

  // SELECT NDEF file
  byte selNdef[] = {0x00, 0xA4, 0x00, 0x0C, 0x02, ndefFID[0], ndefFID[1]};
  if (!sendIBlock(selNdef, sizeof(selNdef), resp, respLen) ||
      resp[respLen-2] != 0x90 || resp[respLen-1] != 0x00) {
    Serial.println("  Select NDEF file failed");
    return;
  }

  // READ NLEN (2 bytes at offset 0)
  byte rdNlen[] = {0x00, 0xB0, 0x00, 0x00, 0x02};
  if (!sendIBlock(rdNlen, sizeof(rdNlen), resp, respLen) ||
      resp[respLen-2] != 0x90 || resp[respLen-1] != 0x00) {
    Serial.println("  Read NLEN failed");
    return;
  }
  uint16_t ndefLen = ((uint16_t)resp[0] << 8) | resp[1];
  if (ndefLen == 0) { Serial.println("  Empty tag"); return; }

  // READ NDEF message (offset 2, skip NLEN field)
  byte readSize = (byte)min(ndefLen, (uint16_t)54);
  byte rdNdef[] = {0x00, 0xB0, 0x00, 0x02, readSize};
  if (!sendIBlock(rdNdef, sizeof(rdNdef), resp, respLen) ||
      resp[respLen-2] != 0x90 || resp[respLen-1] != 0x00) {
    Serial.println("  Read NDEF failed");
    return;
  }

  byte dataLen = respLen - 2; // strip SW1 SW2
  String text = parseNDEFMessage(resp, dataLen);
  if (text.length() > 0) {
    Serial.print("  ");
    Serial.println(text);
  } else {
    Serial.print("  NDEF (");
    Serial.print(dataLen);
    Serial.print(" bytes): ");
    for (byte i = 0; i < dataLen; i++) {
      if (resp[i] < 0x10) Serial.print("0");
      Serial.print(resp[i], HEX);
      Serial.print(" ");
    }
    Serial.println();
  }
}

// -------------------------------------------------------
// Auth sector 1 — tries both keys, returns true on success
// -------------------------------------------------------
bool authSector1() {
  for (byte k = 0; k < 2; k++) {
    MFRC522::MIFARE_Key key;
    memcpy(key.keyByte, KEYS[k], 6);
    rfid.PCD_StopCrypto1();
    MFRC522::StatusCode s = rfid.PCD_Authenticate(
        MFRC522::PICC_CMD_MF_AUTH_KEY_A, DATA_BLOCKS[0], &key, &rfid.uid);
    if (s == MFRC522::STATUS_OK) return true;
  }
  Serial.println("Auth failed — try formatting the card with NFC Tools first");
  return false;
}

// -------------------------------------------------------
// NDEF URI prefix table (NFC Forum URI Record spec)
// -------------------------------------------------------
const char* uriPrefix(byte code) {
  switch (code) {
    case 0x01: return "http://www.";
    case 0x02: return "https://www.";
    case 0x03: return "http://";
    case 0x04: return "https://";
    case 0x05: return "tel:";
    case 0x06: return "mailto:";
    case 0x07: return "ftp://anonymous:anonymous@";
    case 0x08: return "ftp://ftp.";
    case 0x09: return "ftps://";
    case 0x0D: return "ftp://";
    default:   return "";
  }
}

// -------------------------------------------------------
// NDEF parser — handles Text ('T') and URI ('U') records
//
// NDEF record layout at data[i] where data[i]==0x03:
//   [i+0] 0x03       TLV tag
//   [i+1] record_len TLV length
//   [i+2] header     (D1 = MB|ME|SR|TNF=Well-known)
//   [i+3] type_len
//   [i+4] payload_len
//   [i+5] type bytes  (type_len bytes)
//   [i+5+type_len] payload bytes  (payload_len bytes)
// -------------------------------------------------------
String parseNDEF(byte* data, byte len) {
  for (byte i = 0; i + 1 < len; i++) {
    if (data[i] == 0xFE) break;
    if (data[i] != 0x03) continue;

    byte  type_len    = data[i + 3];
    byte  payload_len = data[i + 4];
    byte* type        = data + i + 5;
    byte* payload     = type + type_len;

    if (type_len == 1 && type[0] == 0x54) {  // 'T' = Text record
      byte lang_len = payload[0] & 0x3F;
      byte text_len = payload_len - 1 - lang_len;
      if (text_len > 0 && 1 + lang_len + text_len <= payload_len) {
        return String((char*)(payload + 1 + lang_len), text_len);
      }
    }

    if (type_len == 1 && type[0] == 0x55) {  // 'U' = URI record
      String uri = uriPrefix(payload[0]);
      uri += String((char*)(payload + 1), payload_len - 1);
      return uri;
    }

    break;
  }
  return "";
}

// -------------------------------------------------------
// Write pre-built NDEF TLV (writeData) to sector 1 (blocks 4/5/6).
// NFC Forum-formatted cards (via NFC Tools) protect writes with Key B,
// so we try Key A first (both NFC Forum and factory), then Key B (factory).
// -------------------------------------------------------
void writeCard() {
  static const byte KEY_B_FACTORY[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

  // Try Key A (both NFC Forum and factory defaults via authSector1)
  bool authed = authSector1();

  if (!authed) {
    // Try Key B with factory default
    MFRC522::MIFARE_Key keyB;
    memcpy(keyB.keyByte, KEY_B_FACTORY, 6);
    rfid.PCD_StopCrypto1();
    authed = (rfid.PCD_Authenticate(
        MFRC522::PICC_CMD_MF_AUTH_KEY_B, DATA_BLOCKS[0], &keyB, &rfid.uid)
        == MFRC522::STATUS_OK);
    if (!authed) {
      Serial.println("Auth failed for write — card may use a non-default Key B");
      return;
    }
  }

  for (byte i = 0; i < 3; i++) {
    MFRC522::StatusCode s = rfid.MIFARE_Write(DATA_BLOCKS[i], writeData + i * 16, 16);
    if (s != MFRC522::STATUS_OK) {
      Serial.print("Write block ");
      Serial.print(DATA_BLOCKS[i]);
      Serial.print(" failed: ");
      Serial.println(rfid.GetStatusCodeName(s));
      rfid.PCD_StopCrypto1();
      return;
    }
  }
  rfid.PCD_StopCrypto1();
  Serial.println("Write OK");
}

// -------------------------------------------------------

void readCard() {
  if (!authSector1()) return;

  byte raw[48];
  for (byte i = 0; i < 3; i++) {
    byte buf[18], size = sizeof(buf);
    MFRC522::StatusCode s = rfid.MIFARE_Read(DATA_BLOCKS[i], buf, &size);
    if (s != MFRC522::STATUS_OK) {
      Serial.print("Read block ");
      Serial.print(DATA_BLOCKS[i]);
      Serial.print(" failed: ");
      Serial.println(rfid.GetStatusCodeName(s));
      rfid.PCD_StopCrypto1();
      return;
    }
    memcpy(raw + i * 16, buf, 16);
  }
  rfid.PCD_StopCrypto1();

  String text = parseNDEF(raw, 48);
  if (text.length() > 0) {
    Serial.print("Text: \"");
    Serial.print(text);
    Serial.println("\"");
  } else {
    Serial.println("No NDEF text found. Raw hex:");
    for (byte i = 0; i < 48; i++) {
      if (raw[i] < 0x10) Serial.print("0");
      Serial.print(raw[i], HEX);
      Serial.print(i % 16 == 15 ? "\n" : ":");
    }
  }
}

// -------------------------------------------------------

void setup() {
  Serial.begin(9600);
  while (!Serial);

  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, SS_PIN);
  rfid.PCD_Init();
  delay(50);
  rfid.PCD_SetAntennaGain(rfid.RxGain_max);

  byte ver = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print("RC522 version: 0x");
  Serial.println(ver, HEX);
  if (ver == 0x00 || ver == 0xFF) {
    Serial.println("ERROR: RC522 not responding. Check wiring.");
  } else {
    Serial.println("Ready. Tap a card to read NDEF.");
    Serial.println("To write: type  write Hello World  then tap a Mifare card.");
  }
}

void loop() {
  // Handle Serial write commands: "write <text>"
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.startsWith("write ")) {
      String text = line.substring(6);
      if (text.length() > 38) {
        Serial.println("Text too long (max 38 chars)");
      } else if (text.length() > 0) {
        writeDataLen = buildNDEFText(text, writeData);
        hasPendingWrite = true;
        Serial.print("Queued NDEF text \"");
        Serial.print(text);
        Serial.println("\" — tap a Mifare card to write.");
      }
    } else if (line.length() > 0) {
      Serial.println("Unknown command. Use: write <text>  (max 38 chars)");
    }
  }

  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  MFRC522::PICC_Type t = rfid.PICC_GetType(rfid.uid.sak);

  // Check the ISO-DEP bit (bit 5 = 0x20) directly in SAK.
  // Some MFRC522 library versions misclassify SAK=0x28 (common on Samsung/NXP phones
  // in HCE mode) as PICC_TYPE_MIFARE_1K, causing Mifare auth to be attempted instead
  // of ISO-DEP. Checking the bit directly covers SAK=0x20 and SAK=0x28.
  if (rfid.uid.sak & 0x20) {
    readT4TCard();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    delay(500);
    return;
  }

  if (t != MFRC522::PICC_TYPE_MIFARE_1K &&
      t != MFRC522::PICC_TYPE_MIFARE_4K &&
      t != MFRC522::PICC_TYPE_MIFARE_MINI) {
    Serial.print("Unsupported card type (SAK=0x");
    Serial.print(rfid.uid.sak, HEX);
    Serial.println(")");
    rfid.PICC_HaltA();
    delay(500);
    return;
  }

  if (hasPendingWrite) {
    writeCard();
    hasPendingWrite = false;
  } else {
    readCard();
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(500);
}
