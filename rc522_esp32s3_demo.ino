/**
 * RC522 NDEF-compatible read/write for ESP32-S3
 *
 * Compatible with NFC Tools (Android/iOS) and any NFC Forum app.
 * Reads/writes NDEF Text Records on sector 1, blocks 4/5/6.
 * Tries NFC Forum key D3:F7:D3:F7:D3:F7 first, then 0xFF fallback.
 *
 * Usage:
 *   Type text + Enter in Serial Monitor -> writes on next card tap
 *   Tap card with nothing typed         -> reads and prints text
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

String pendingWrite = "";
bool writeQueued    = false;

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
// NDEF builder — wraps text in a short NDEF Text Record TLV
//
// Wire format (example "hi"):
//   03 0A D1 01 06 54 02 65 6E 68 69 FE 00 00 ...
//   ^^ ^^                                  ^^
//   |  NDEF record len                     Terminator TLV
//   NDEF TLV tag
// -------------------------------------------------------
void buildNDEF(const String& text, byte* buf /*48 bytes*/) {
  memset(buf, 0, 48);
  byte tlen        = min((unsigned int)text.length(), (unsigned int)38);
  byte payload_len = 1 + 2 + tlen;   // status + "en" + text
  byte record_len  = 1 + 1 + 1 + 1 + payload_len; // header+typelen+payloadlen+type+payload

  byte p = 0;
  buf[p++] = 0x03;         // NDEF TLV tag
  buf[p++] = record_len;   // NDEF record length
  buf[p++] = 0xD1;         // MB | ME | SR | TNF=Well-known
  buf[p++] = 0x01;         // type length = 1
  buf[p++] = payload_len;  // payload length
  buf[p++] = 0x54;         // type 'T'  (Text record)
  buf[p++] = 0x02;         // status: UTF-8, language code length = 2
  buf[p++] = 0x65;         // 'e'
  buf[p++] = 0x6E;         // 'n'
  for (byte i = 0; i < tlen; i++) buf[p++] = (byte)text[i];
  buf[p++] = 0xFE;         // Terminator TLV
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
    byte* payload     = type + type_len;  // payload starts right after type bytes

    if (type_len == 1 && type[0] == 0x54) {  // 'T' = Text record
      // payload: [status][lang (lang_len bytes)][text]
      byte lang_len = payload[0] & 0x3F;
      byte text_len = payload_len - 1 - lang_len;
      if (text_len > 0 && 1 + lang_len + text_len <= payload_len) {
        return String((char*)(payload + 1 + lang_len), text_len);
      }
    }

    if (type_len == 1 && type[0] == 0x55) {  // 'U' = URI record
      // payload: [prefix_code][uri_suffix]
      String uri = uriPrefix(payload[0]);
      uri += String((char*)(payload + 1), payload_len - 1);
      return uri;
    }

    break;  // only parse first TLV record
  }
  return "";
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

void writeCard(const String& text) {
  if (!authSector1()) return;

  byte data[48];
  buildNDEF(text, data);

  for (byte i = 0; i < 3; i++) {
    MFRC522::StatusCode s = rfid.MIFARE_Write(DATA_BLOCKS[i], data + i * 16, 16);
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
    Serial.println("Ready. Type text + Enter to write, tap to read.");
  }
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      pendingWrite.trim();
      if (pendingWrite.length() > 0) {
        writeQueued = true;
        Serial.print("Queued: \"");
        Serial.print(pendingWrite);
        Serial.println("\" — tap card now");
      }
    } else if (c != '\r') {
      pendingWrite += c;
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
    readT4TCard(); // Android HCE or any Type 4 Tag — read-only
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

  if (writeQueued) {
    writeCard(pendingWrite);
    pendingWrite = "";
    writeQueued  = false;
  } else {
    readCard();
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(500);
}
