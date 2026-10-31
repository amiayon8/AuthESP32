/**
 * ============================================================================
 * Project: ESP32 Physical TOTP Authenticator with 4x4 Keypad & Deep Sleep (v3.0)
 * Target:  ESP32-WROOM-32 (Arduino Framework)
 * ============================================================================
 * Key Features:
 *  - 4x4 Matrix Membrane Keypad Driver (Non-blocking scan + debounce):
 *      * '0'-'9': Password digit entry
 *      * '*'    : Clear current password input buffer
 *      * '#'    : Submit unlock password / Confirm & Save new password
 *      * 'A'    : Put device into Deep Sleep / Wake device from Deep Sleep
 *      * 'B'    : Enter New Password Setup mode (when unlocked) / Cancel setup
 *      * 'C'    : Previous Account (Left)
 *      * 'D'    : Next Account (Right)
 *  - Power Saving & Deep Sleep:
 *      * Automatic Deep Sleep after 5 minutes of keypad inactivity
 *      * Turns off LCD backlight & display controller before sleeping
 *      * EXT0 RTC GPIO wake on Key 'A' (Row 0 = GPIO 25 held LOW, Col 3 = GPIO 15)
 *      * Fast-wake from Deep Sleep (skips Wi-Fi/API sync if RTC & cache are valid)
 *  - Boot GMT+6 Clock Display:
 *      * If DS3231 RTC or NTP time is valid on boot, displays GMT+6 date & time
 *        instead of generic RTC status text.
 * ============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <FS.h>
#include <LittleFS.h>
#include <LiquidCrystal_I2C.h>
#include <RTClib.h>
#include <time.h>

// ESP-IDF MbedTLS & Deep Sleep / RTC GPIO primitives
#include "mbedtls/md.h"
#include "mbedtls/pkcs5.h"
#include "mbedtls/aes.h"
#include "mbedtls/sha256.h"
#include "esp_system.h"
#include "esp_sleep.h"
#include "driver/rtc_io.h"

// ============================================================================
// 1. PIN & SYSTEM CONFIGURATION
// ============================================================================
namespace Config {
  // 4x4 Matrix Keypad GPIO Pins
  // IMPORTANT: ROW_0 (GPIO 25) and COL_3 (GPIO 15) MUST be RTC-capable GPIOs
  // so Key 'A' (Row 0, Col 3) can wake the ESP32 from Deep Sleep via EXT0.
  constexpr uint8_t KEYPAD_ROWS = 4;
  constexpr uint8_t KEYPAD_COLS = 4;

  constexpr uint8_t PIN_KP_ROW0 = 25; // R1 (Row with 1, 2, 3, A) - RTC_GPIO6
  constexpr uint8_t PIN_KP_ROW1 = 26; // R2 (Row with 4, 5, 6, B)
  constexpr uint8_t PIN_KP_ROW2 = 27; // R3 (Row with 7, 8, 9, C)
  constexpr uint8_t PIN_KP_ROW3 = 14; // R4 (Row with *, 0, #, D)

  constexpr uint8_t PIN_KP_COL0 = 32; // C1 (Col with 1, 4, 7, *)
  constexpr uint8_t PIN_KP_COL1 = 33; // C2 (Col with 2, 5, 8, 0)
  constexpr uint8_t PIN_KP_COL2 = 13; // C3 (Col with 3, 6, 9, #)
  constexpr uint8_t PIN_KP_COL3 = 15; // C4 (Col with A, B, C, D) - RTC_GPIO13 (EXT0 Wake)

  constexpr uint8_t ROW_PINS[KEYPAD_ROWS] = {
    PIN_KP_ROW0, PIN_KP_ROW1, PIN_KP_ROW2, PIN_KP_ROW3
  };
  constexpr uint8_t COL_PINS[KEYPAD_COLS] = {
    PIN_KP_COL0, PIN_KP_COL1, PIN_KP_COL2, PIN_KP_COL3
  };

  constexpr char KEYMAP[KEYPAD_ROWS][KEYPAD_COLS] = {
    { '1', '2', '3', 'A' },
    { '4', '5', '6', 'B' },
    { '7', '8', '9', 'C' },
    { '*', '0', '#', 'D' }
  };

  // Shared I2C Bus Pins (16x2 LCD & DS3231 RTC)
  constexpr uint8_t PIN_I2C_SDA = 21;
  constexpr uint8_t PIN_I2C_SCL = 22;

  // I2C Addresses & Display Geometry
  constexpr uint8_t LCD_I2C_ADDR    = 0x27;
  constexpr uint8_t LCD_COLS        = 16;
  constexpr uint8_t LCD_ROWS        = 2;
  constexpr uint8_t DS3231_I2C_ADDR = 0x68;

  // Wi-Fi, NTP, DS3231 & Remote Account Sync Configuration
  constexpr char     WIFI_SSID[]                = "Ayon";
  constexpr char     WIFI_PASSWORD[]            = "Ayon.2008";
  constexpr char     SERVER_DOMAIN[]            = "authesp.thenciedev.xyz";
  constexpr char     DEVICE_API_KEY[]           = "esp_live_m98p1aJviwyrMFw2vCc1Ls7pM7SSYtQY_VvE6RdSen0";
  constexpr char     ACCOUNTS_API_URL[]         = "https://authesp.thenciedev.xyz/api/esp32/super_secret__ROUTE";
  constexpr uint32_t HTTP_SYNC_TIMEOUT_MS       = 10000;
  constexpr char     NTP_SERVER_1[]             = "pool.ntp.org";
  constexpr char     NTP_SERVER_2[]             = "time.cloudflare.com";
  constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS    = 8000;
  constexpr uint32_t NTP_RESYNC_INTERVAL_MS     = 3600000UL; // Re-sync NTP every 1 hour
  constexpr uint32_t RTC_DRIFT_SYNC_INTERVAL_MS = 300000UL;  // Re-discipline ESP32 clock from DS3231 every 5 min
  constexpr time_t   MIN_VALID_UNIX_EPOCH       = 1704067200;// 2024-01-01 00:00:00 UTC
  constexpr int32_t  GMT_PLUS_6_OFFSET_SEC      = 6 * 3600;  // GMT+6 (Dhaka) offset in seconds

  // Keypad, Sleep & UI Timings
  constexpr uint32_t DEBOUNCE_MS                = 35;
  constexpr uint32_t INACTIVITY_SLEEP_TIMEOUT_MS= 300000UL;  // 5 minutes (300,000 ms) auto deep sleep
  constexpr uint32_t TRANSIENT_MSG_DURATION_MS  = 1500;
  constexpr uint32_t BOOT_TIME_SPLASH_MS        = 1500;
  constexpr uint32_t UI_REFRESH_INTERVAL_MS     = 100;

  // Password & Rate-Limiting Policy
  constexpr size_t   MIN_PASS_LEN               = 4;
  constexpr size_t   MAX_PASS_LEN               = 8;
  constexpr char     DEFAULT_PASSWORD[]         = "1234";    // Default 4-digit keypad password on fresh NVS
  constexpr char     LEGACY_DEFAULT_PASSWORD[]  = "LRLR";
  constexpr uint32_t BASE_FAIL_COOLDOWN_MS      = 2000;
  constexpr uint32_t MAX_FAIL_COOLDOWN_MS       = 30000;
  constexpr uint32_t PBKDF2_ITERATIONS          = 10000;

  // TOTP Parameters
  constexpr uint32_t TOTP_TIME_STEP_SEC         = 30;
  constexpr size_t   MAX_ACCOUNTS               = 200;
}

// ============================================================================
// 2. CRYPTOGRAPHIC HELPERS (Constant-Time Comparison & Zeroization)
// ============================================================================
namespace CryptoUtils {
  bool constantTimeEqual(const uint8_t* a, const uint8_t* b, size_t len) {
    volatile uint8_t diff = 0;
    for (size_t i = 0; i < len; ++i) {
      diff |= (a[i] ^ b[i]);
    }
    return diff == 0;
  }

  bool constantTimeStrEqual(const char* a, size_t lenA, const char* b, size_t lenB) {
    volatile uint8_t diff = (lenA == lenB) ? 0 : 1;
    size_t maxCheck = Config::MAX_PASS_LEN;
    for (size_t i = 0; i < maxCheck; ++i) {
      char ca = (i < lenA) ? a[i] : 0;
      char cb = (i < lenB) ? b[i] : 0;
      diff |= static_cast<uint8_t>(ca ^ cb);
    }
    return diff == 0;
  }

  void secureZero(void* ptr, size_t len) {
    volatile uint8_t* p = static_cast<volatile uint8_t*>(ptr);
    while (len--) {
      *p++ = 0;
    }
  }
}

// ============================================================================
// 3. MODULE: KeypadManager (4x4 Matrix Scanner + Deep Sleep EXT0 Wake Setup)
// ============================================================================
class KeypadManager {
public:
  void begin() {
    // Release RTC GPIO holds in case we just woke up from Deep Sleep
    rtc_gpio_hold_dis(static_cast<gpio_num_t>(Config::PIN_KP_ROW0));
    rtc_gpio_deinit(static_cast<gpio_num_t>(Config::PIN_KP_ROW0));
    rtc_gpio_deinit(static_cast<gpio_num_t>(Config::PIN_KP_COL3));

    for (uint8_t r = 0; r < Config::KEYPAD_ROWS; ++r) {
      pinMode(Config::ROW_PINS[r], OUTPUT);
      digitalWrite(Config::ROW_PINS[r], HIGH);
    }
    for (uint8_t c = 0; c < Config::KEYPAD_COLS; ++c) {
      pinMode(Config::COL_PINS[c], INPUT_PULLUP);
    }

    lastChangeMs_ = millis();
    rawKey_       = '\0';
    stableKey_    = '\0';

    // If the user is still holding 'A' from waking the device, wait for release
    // so it doesn't immediately trigger sleep again!
    waitForAllKeysReleased(1500);
  }

  // Returns the character of a newly pressed key (emitted once per press) or '\0'
  char update(uint32_t nowMs) {
    char scanned = scanMatrix();

    if (scanned != rawKey_) {
      rawKey_       = scanned;
      lastChangeMs_ = nowMs;
    }

    if ((nowMs - lastChangeMs_) >= Config::DEBOUNCE_MS) {
      if (stableKey_ != rawKey_) {
        stableKey_ = rawKey_;
        if (stableKey_ != '\0') {
          return stableKey_;
        }
      }
    }
    return '\0';
  }

  void waitForAllKeysReleased(uint32_t maxWaitMs) {
    uint32_t start = millis();
    while ((millis() - start) < maxWaitMs) {
      if (scanMatrix() == '\0') {
        delay(25);
        if (scanMatrix() == '\0') break;
      }
      delay(10);
    }
    rawKey_       = '\0';
    stableKey_    = '\0';
    lastChangeMs_ = millis();
  }

  // Configures Row 0 (GPIO 25) LOW and Col 3 (GPIO 15) as EXT0 LOW wakeup
  // so pressing 'A' wakes the ESP32 from Deep Sleep.
  void prepareForDeepSleep() {
    // 1. Wait until user releases 'A' before arming the wakeup trigger
    waitForAllKeysReleased(2000);

    // 2. Set non-wakeup rows high-impedance to eliminate leakage
    for (uint8_t r = 1; r < Config::KEYPAD_ROWS; ++r) {
      pinMode(Config::ROW_PINS[r], INPUT);
    }
    for (uint8_t c = 0; c < 3; ++c) {
      pinMode(Config::COL_PINS[c], INPUT);
    }

    // 3. Drive Row 0 (GPIO 25) LOW in the RTC domain and hold it during Deep Sleep
    gpio_num_t row0Gpio = static_cast<gpio_num_t>(Config::PIN_KP_ROW0);
    rtc_gpio_init(row0Gpio);
    rtc_gpio_set_direction(row0Gpio, RTC_GPIO_MODE_OUTPUT_ONLY);
    rtc_gpio_set_level(row0Gpio, 0);
    rtc_gpio_hold_en(row0Gpio);

    // 4. Configure Col 3 (GPIO 15) with RTC internal pull-up and arm EXT0 wake on LOW
    gpio_num_t col3Gpio = static_cast<gpio_num_t>(Config::PIN_KP_COL3);
    rtc_gpio_init(col3Gpio);
    rtc_gpio_set_direction(col3Gpio, RTC_GPIO_MODE_INPUT_ONLY);
    rtc_gpio_pullup_en(col3Gpio);
    rtc_gpio_pulldown_dis(col3Gpio);

    esp_sleep_enable_ext0_wakeup(col3Gpio, 0);
  }

private:
  char scanMatrix() {
    char detected = '\0';
    for (uint8_t r = 0; r < Config::KEYPAD_ROWS; ++r) {
      digitalWrite(Config::ROW_PINS[r], LOW);
      delayMicroseconds(10); // Settle membrane capacitance

      for (uint8_t c = 0; c < Config::KEYPAD_COLS; ++c) {
        if (digitalRead(Config::COL_PINS[c]) == LOW) {
          detected = Config::KEYMAP[r][c];
          break;
        }
      }

      digitalWrite(Config::ROW_PINS[r], HIGH);
      if (detected != '\0') {
        break;
      }
    }
    return detected;
  }

  char     rawKey_       = '\0';
  char     stableKey_    = '\0';
  uint32_t lastChangeMs_ = 0;
};

// ============================================================================
// 4. MODULE: CredentialStore
// ============================================================================
enum class StorageStatus : uint8_t {
  OK_DEFAULT_PASSWORD = 0,
  OK_CUSTOM_PASSWORD,
  ERROR_CORRUPTED
};

class CredentialStore {
public:
  StorageStatus begin() {
    Preferences prefs;
    if (!prefs.begin(NVS_NAMESPACE, true)) {
      if (!prefs.begin(NVS_NAMESPACE, false)) {
        status_ = StorageStatus::ERROR_CORRUPTED;
        return status_;
      }
      prefs.end();
      if (!prefs.begin(NVS_NAMESPACE, true)) {
        status_ = StorageStatus::ERROR_CORRUPTED;
        return status_;
      }
    }

    uint8_t configuredMarker = prefs.getUChar(KEY_CFG_MARKER, MARKER_UNCONFIGURED);
    size_t blobLen = prefs.getBytesLength(KEY_CRED_BLOB);

    if (configuredMarker == MARKER_UNCONFIGURED && blobLen == 0) {
      prefs.end();
      status_ = StorageStatus::OK_DEFAULT_PASSWORD;
      return status_;
    }

    if (configuredMarker != MARKER_CONFIGURED || blobLen != sizeof(CredentialRecord)) {
      prefs.end();
      status_ = StorageStatus::ERROR_CORRUPTED;
      return status_;
    }

    CredentialRecord rec{};
    size_t readBytes = prefs.getBytes(KEY_CRED_BLOB, &rec, sizeof(CredentialRecord));
    prefs.end();

    if (readBytes != sizeof(CredentialRecord) || !verifyRecordIntegrity(rec)) {
      status_ = StorageStatus::ERROR_CORRUPTED;
      return status_;
    }

    cachedRecord_ = rec;
    status_ = StorageStatus::OK_CUSTOM_PASSWORD;
    return status_;
  }

  StorageStatus getStatus() const { return status_; }

  bool verifyPassword(const char* candidate, size_t len) const {
    if (status_ == StorageStatus::ERROR_CORRUPTED) return false;

    if (status_ == StorageStatus::OK_DEFAULT_PASSWORD) {
      return CryptoUtils::constantTimeStrEqual(
        candidate, len,
        Config::DEFAULT_PASSWORD, strlen(Config::DEFAULT_PASSWORD));
    }

    uint8_t derived[HASH_LEN] = { 0 };
    if (!derivePbkdf2(candidate, len, cachedRecord_.salt, cachedRecord_.iterations, derived)) {
      CryptoUtils::secureZero(derived, sizeof(derived));
      return false;
    }

    bool match = CryptoUtils::constantTimeEqual(derived, cachedRecord_.verifier, HASH_LEN);
    CryptoUtils::secureZero(derived, sizeof(derived));
    return match;
  }

  bool commitNewPassword(const char* newPass, size_t len) {
    if (len < Config::MIN_PASS_LEN || len > Config::MAX_PASS_LEN) return false;

    CredentialRecord newRec{};
    newRec.magic      = RECORD_MAGIC;
    newRec.version    = RECORD_VERSION;
    newRec.iterations = Config::PBKDF2_ITERATIONS;
    esp_fill_random(newRec.salt, SALT_LEN);

    if (!derivePbkdf2(newPass, len, newRec.salt, newRec.iterations, newRec.verifier)) {
      CryptoUtils::secureZero(&newRec, sizeof(newRec));
      return false;
    }
    computeRecordChecksum(newRec, newRec.checksum);

    Preferences prefs;
    if (!prefs.begin(NVS_NAMESPACE, false)) {
      CryptoUtils::secureZero(&newRec, sizeof(newRec));
      return false;
    }

    size_t written = prefs.putBytes(KEY_CRED_BLOB, &newRec, sizeof(CredentialRecord));
    if (written != sizeof(CredentialRecord)) {
      prefs.end();
      CryptoUtils::secureZero(&newRec, sizeof(newRec));
      return false;
    }

    CredentialRecord verifyRec{};
    size_t readBack = prefs.getBytes(KEY_CRED_BLOB, &verifyRec, sizeof(CredentialRecord));
    if (readBack != sizeof(CredentialRecord) ||
        !CryptoUtils::constantTimeEqual(
          reinterpret_cast<const uint8_t*>(&newRec),
          reinterpret_cast<const uint8_t*>(&verifyRec),
          sizeof(CredentialRecord)) ||
        !verifyRecordIntegrity(verifyRec)) {
      prefs.end();
      CryptoUtils::secureZero(&newRec, sizeof(newRec));
      CryptoUtils::secureZero(&verifyRec, sizeof(verifyRec));
      return false;
    }

    prefs.putUChar(KEY_CFG_MARKER, MARKER_CONFIGURED);
    uint8_t markerCheck = prefs.getUChar(KEY_CFG_MARKER, MARKER_UNCONFIGURED);
    prefs.end();

    if (markerCheck != MARKER_CONFIGURED) {
      CryptoUtils::secureZero(&newRec, sizeof(newRec));
      CryptoUtils::secureZero(&verifyRec, sizeof(verifyRec));
      return false;
    }

    cachedRecord_ = verifyRec;
    status_       = StorageStatus::OK_CUSTOM_PASSWORD;
    CryptoUtils::secureZero(&newRec, sizeof(newRec));
    CryptoUtils::secureZero(&verifyRec, sizeof(verifyRec));
    return true;
  }

  uint32_t getFailedAttempts() {
    Preferences prefs;
    if (!prefs.begin(NVS_NAMESPACE, true)) return 0;
    uint32_t count = prefs.getUInt(KEY_FAIL_COUNT, 0);
    prefs.end();
    return count;
  }

  void setFailedAttempts(uint32_t count) {
    Preferences prefs;
    if (!prefs.begin(NVS_NAMESPACE, false)) return;
    prefs.putUInt(KEY_FAIL_COUNT, count);
    prefs.end();
  }

private:
  static constexpr char     NVS_NAMESPACE[]     = "totp_lock";
  static constexpr char     KEY_CFG_MARKER[]    = "cfg_mkr";
  static constexpr char     KEY_CRED_BLOB[]     = "cred_rec";
  static constexpr char     KEY_FAIL_COUNT[]    = "fail_cnt";
  static constexpr uint8_t  MARKER_UNCONFIGURED = 0x00;
  static constexpr uint8_t  MARKER_CONFIGURED   = 0xA5;
  static constexpr uint32_t RECORD_MAGIC        = 0x544F5450;
  static constexpr uint16_t RECORD_VERSION      = 1;
  static constexpr size_t   SALT_LEN            = 16;
  static constexpr size_t   HASH_LEN            = 32;

  struct __attribute__((packed)) CredentialRecord {
    uint32_t magic;
    uint16_t version;
    uint32_t iterations;
    uint8_t  salt[SALT_LEN];
    uint8_t  verifier[HASH_LEN];
    uint8_t  checksum[HASH_LEN];
  };

  static bool derivePbkdf2(const char* pass, size_t passLen,
                           const uint8_t* salt, uint32_t iterations,
                           uint8_t outKey[HASH_LEN]) {
    int ret = mbedtls_pkcs5_pbkdf2_hmac_ext(
      MBEDTLS_MD_SHA256,
      reinterpret_cast<const unsigned char*>(pass),
      passLen,
      salt,
      SALT_LEN,
      iterations,
      HASH_LEN,
      outKey);
    return (ret == 0);
  }

  static void computeRecordChecksum(const CredentialRecord& rec, uint8_t outSha256[HASH_LEN]) {
    size_t payloadLen = offsetof(CredentialRecord, checksum);
    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts(&sha, 0);
    mbedtls_sha256_update(&sha, reinterpret_cast<const unsigned char*>(&rec), payloadLen);
    mbedtls_sha256_finish(&sha, outSha256);
    mbedtls_sha256_free(&sha);
  }

  static bool verifyRecordIntegrity(const CredentialRecord& rec) {
    if (rec.magic != RECORD_MAGIC || rec.version != RECORD_VERSION || rec.iterations < 1000) {
      return false;
    }
    uint8_t expected[HASH_LEN] = { 0 };
    computeRecordChecksum(rec, expected);
    bool valid = CryptoUtils::constantTimeEqual(expected, rec.checksum, HASH_LEN);
    CryptoUtils::secureZero(expected, sizeof(expected));
    return valid;
  }

  StorageStatus    status_ = StorageStatus::ERROR_CORRUPTED;
  CredentialRecord cachedRecord_{};
};

// ============================================================================
// 5. MODULE: TotpEngine (RFC 4648 Base32 + RFC 6238 TOTP + RFC Vector Self-Test)
// ============================================================================
class TotpEngine {
public:
  static bool runRfcSelfTest() {
    static constexpr char RFC_BASE32_SEED[] = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    static constexpr char EXPECTED_ASCII[]  = "12345678901234567890";

    uint8_t decoded[32] = { 0 };
    size_t decodedLen   = 0;
    if (!decodeBase32(RFC_BASE32_SEED, decoded, sizeof(decoded), decodedLen)) {
      return false;
    }
    if (decodedLen != 20 || memcmp(decoded, EXPECTED_ASCII, 20) != 0) {
      return false;
    }

    struct RfcVector {
      uint64_t unixTime;
      uint32_t expected8Digit;
      uint32_t expected6Digit;
    };

    static constexpr RfcVector vectors[] = {
      { 59ULL,          94287082UL, 287082UL },
      { 1111111109ULL,   7081804UL,  81804UL },
      { 1111111111ULL,  14050471UL,  50471UL },
      { 1234567890ULL,  89005924UL,   5924UL },
      { 2000000000ULL,  69279037UL, 279037UL },
      { 20000000000ULL, 65353130UL, 353130UL }
    };

    for (size_t i = 0; i < (sizeof(vectors) / sizeof(vectors[0])); ++i) {
      uint32_t rawTruncated = 0;
      if (!computeRawTruncated(RFC_BASE32_SEED, vectors[i].unixTime, rawTruncated)) {
        return false;
      }
      uint32_t code8 = rawTruncated % 100000000UL;
      uint32_t code6 = rawTruncated % 1000000UL;
      if (code8 != vectors[i].expected8Digit || code6 != vectors[i].expected6Digit) {
        return false;
      }
    }

    return true;
  }

  static bool generateCode(const char* base32Secret, time_t unixTime, uint32_t& outCode) {
    if (!base32Secret || unixTime < Config::MIN_VALID_UNIX_EPOCH) {
      return false;
    }
    uint32_t rawTruncated = 0;
    if (!computeRawTruncated(base32Secret, static_cast<uint64_t>(unixTime), rawTruncated)) {
      return false;
    }
    outCode = rawTruncated % 1000000UL;
    return true;
  }

  static uint8_t getRemainingSeconds(time_t unixTime) {
    return static_cast<uint8_t>(
      Config::TOTP_TIME_STEP_SEC - (static_cast<uint64_t>(unixTime) % Config::TOTP_TIME_STEP_SEC));
  }

  static bool isValidBase32(const char* secret) {
    if (!secret || secret[0] == '\0') return false;
    uint8_t dummy[64];
    size_t outLen = 0;
    bool ok = decodeBase32(secret, dummy, sizeof(dummy), outLen);
    CryptoUtils::secureZero(dummy, sizeof(dummy));
    return (ok && outLen > 0);
  }

private:
  static bool computeRawTruncated(const char* base32Secret, uint64_t unixTime, uint32_t& outTruncated) {
    uint8_t decodedKey[64] = { 0 };
    size_t keyLen = 0;
    if (!decodeBase32(base32Secret, decodedKey, sizeof(decodedKey), keyLen) || keyLen == 0) {
      CryptoUtils::secureZero(decodedKey, sizeof(decodedKey));
      return false;
    }

    uint64_t timeStep = unixTime / Config::TOTP_TIME_STEP_SEC;
    uint8_t counterBytes[8];
    for (int i = 7; i >= 0; --i) {
      counterBytes[i] = static_cast<uint8_t>(timeStep & 0xFF);
      timeStep >>= 8;
    }

    uint8_t digest[20] = { 0 };
    mbedtls_md_context_t sha1Ctx;
    mbedtls_md_init(&sha1Ctx);
    const mbedtls_md_info_t* mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA1);
    if (!mdInfo || mbedtls_md_setup(&sha1Ctx, mdInfo, 1) != 0) {
      mbedtls_md_free(&sha1Ctx);
      CryptoUtils::secureZero(decodedKey, sizeof(decodedKey));
      return false;
    }

    mbedtls_md_hmac_starts(&sha1Ctx, decodedKey, keyLen);
    mbedtls_md_hmac_update(&sha1Ctx, counterBytes, sizeof(counterBytes));
    mbedtls_md_hmac_finish(&sha1Ctx, digest);
    mbedtls_md_free(&sha1Ctx);

    uint8_t offset = digest[19] & 0x0F;
    outTruncated =
      ((static_cast<uint32_t>(digest[offset]     & 0x7F) << 24) |
       (static_cast<uint32_t>(digest[offset + 1] & 0xFF) << 16) |
       (static_cast<uint32_t>(digest[offset + 2] & 0xFF) << 8)  |
       (static_cast<uint32_t>(digest[offset + 3] & 0xFF)));

    CryptoUtils::secureZero(decodedKey, sizeof(decodedKey));
    CryptoUtils::secureZero(digest, sizeof(digest));
    return true;
  }

  static bool decodeBase32(const char* input, uint8_t* output, size_t maxOutLen, size_t& outLen) {
    uint32_t buffer   = 0;
    uint8_t  bitsLeft = 0;
    outLen            = 0;

    for (size_t i = 0; input[i] != '\0'; ++i) {
      char c = input[i];
      if (c == ' ' || c == '-' || c == '\t') continue;
      if (c == '=') break;

      int8_t val = -1;
      if (c >= 'A' && c <= 'Z')      val = c - 'A';
      else if (c >= 'a' && c <= 'z') val = c - 'a';
      else if (c >= '2' && c <= '7') val = (c - '2') + 26;
      else return false;

      buffer = (buffer << 5) | static_cast<uint32_t>(val);
      bitsLeft += 5;

      if (bitsLeft >= 8) {
        bitsLeft -= 8;
        if (outLen >= maxOutLen) return false;
        output[outLen++] = static_cast<uint8_t>((buffer >> bitsLeft) & 0xFF);
      }
    }
    return true;
  }
};

// ============================================================================
// 6. MODULE: AccountStore (Up to 200 Accounts on LittleFS + Remote HTTPS Sync)
// ============================================================================
struct __attribute__((packed)) TotpAccount {
  char name[13];          // Up to 12 display chars + null terminator
  char base32Secret[65];  // Up to 64 Base32 chars + null terminator
};

class AccountStore {
public:
  bool begin() {
    if (!LittleFS.begin(true)) {
      return false;
    }

    Preferences prefs;
    if (!prefs.begin(NVS_NAMESPACE, false)) {
      return false;
    }

    if (prefs.getBytesLength(KEY_DEVICE_SECRET) != KEY_LEN) {
      esp_fill_random(deviceKey_, KEY_LEN);
      if (prefs.putBytes(KEY_DEVICE_SECRET, deviceKey_, KEY_LEN) != KEY_LEN) {
        prefs.end();
        return false;
      }
    } else {
      prefs.getBytes(KEY_DEVICE_SECRET, deviceKey_, KEY_LEN);
    }
    prefs.end();

    if (!LittleFS.exists(FILE_PATH)) {
      return provisionDefaultAccounts();
    }

    return loadAccountsFromFlash();
  }

  bool syncFromRemoteApiIfConnected() {
    if (WiFi.status() != WL_CONNECTED) {
      return false;
    }

    WiFiClientSecure client;
    client.setInsecure();
    client.setTimeout(Config::HTTP_SYNC_TIMEOUT_MS / 1000);

    HTTPClient http;
    http.setTimeout(Config::HTTP_SYNC_TIMEOUT_MS);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

    String requestUrl = Config::ACCOUNTS_API_URL;
    bool hasCustomKey = (strlen(Config::DEVICE_API_KEY) > 0 && strcmp(Config::DEVICE_API_KEY, "esp_live_YOUR_DEVICE_API_KEY") != 0);

    if (requestUrl.indexOf("apiKey=") == -1 && hasCustomKey) {
      requestUrl += (requestUrl.indexOf('?') == -1 ? "?apiKey=" : "&apiKey=");
      requestUrl += Config::DEVICE_API_KEY;
    }

    if (!http.begin(client, requestUrl)) {
      return false;
    }

    if (hasCustomKey) {
      http.addHeader("x-api-key", Config::DEVICE_API_KEY);
    }
    http.addHeader("Accept", "application/json");
    http.addHeader("User-Agent", "ESP32-TOTP-Authenticator/3.0");

    int httpCode = http.GET();
    if (httpCode != HTTP_CODE_OK) {
      http.end();
      return false;
    }

    String jsonBody = http.getString();
    http.end();

    if (jsonBody.isEmpty()) {
      return false;
    }

    TotpAccount* parsedList = static_cast<TotpAccount*>(
      calloc(Config::MAX_ACCOUNTS, sizeof(TotpAccount)));
    if (!parsedList) {
      CryptoUtils::secureZero(const_cast<char*>(jsonBody.c_str()), jsonBody.length());
      return false;
    }

    size_t parsedCount = parseJsonAccounts(jsonBody.c_str(), jsonBody.length(), parsedList, Config::MAX_ACCOUNTS);
    CryptoUtils::secureZero(const_cast<char*>(jsonBody.c_str()), jsonBody.length());

    if (parsedCount == 0) {
      CryptoUtils::secureZero(parsedList, Config::MAX_ACCOUNTS * sizeof(TotpAccount));
      free(parsedList);
      return false;
    }

    CryptoUtils::secureZero(accounts_, sizeof(accounts_));
    accountCount_ = parsedCount;
    for (size_t i = 0; i < parsedCount; ++i) {
      accounts_[i] = parsedList[i];
    }

    CryptoUtils::secureZero(parsedList, Config::MAX_ACCOUNTS * sizeof(TotpAccount));
    free(parsedList);

    return saveAccountsToFlash();
  }

  size_t getAccountCount() const { return accountCount_; }

  bool getAccountMeta(size_t index, char* outName, size_t maxNameLen) const {
    if (index >= accountCount_ || !outName || maxNameLen == 0) return false;
    strncpy(outName, accounts_[index].name, maxNameLen - 1);
    outName[maxNameLen - 1] = '\0';
    return true;
  }

  bool getAccountSecret(size_t index, char* outSecret, size_t maxSecretLen) const {
    if (index >= accountCount_ || !outSecret || maxSecretLen == 0) return false;
    strncpy(outSecret, accounts_[index].base32Secret, maxSecretLen - 1);
    outSecret[maxSecretLen - 1] = '\0';
    return true;
  }

private:
  static constexpr char     NVS_NAMESPACE[]     = "totp_accts";
  static constexpr char     KEY_DEVICE_SECRET[] = "dev_key";
  static constexpr char     FILE_PATH[]         = "/accts.enc";
  static constexpr char     TEMP_FILE_PATH[]    = "/accts.tmp";
  static constexpr uint32_t FILE_MAGIC          = 0x41435432;
  static constexpr uint16_t FILE_VERSION        = 2;
  static constexpr size_t   KEY_LEN             = 32;
  static constexpr size_t   IV_LEN              = 16;
  static constexpr size_t   MAC_LEN             = 32;

  struct __attribute__((packed)) FileHeader {
    uint32_t magic;
    uint16_t version;
    uint16_t count;
    uint8_t  iv[IV_LEN];
  };

  bool provisionDefaultAccounts() {
    CryptoUtils::secureZero(accounts_, sizeof(accounts_));
    accountCount_ = 4;

    strncpy(accounts_[0].name, "GitHub", sizeof(accounts_[0].name) - 1);
    strncpy(accounts_[0].base32Secret, "JBSWY3DPEHPK3PXP", sizeof(accounts_[0].base32Secret) - 1);

    strncpy(accounts_[1].name, "Google", sizeof(accounts_[1].name) - 1);
    strncpy(accounts_[1].base32Secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", sizeof(accounts_[1].base32Secret) - 1);

    strncpy(accounts_[2].name, "AWS Root", sizeof(accounts_[2].name) - 1);
    strncpy(accounts_[2].base32Secret, "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U", sizeof(accounts_[2].base32Secret) - 1);

    strncpy(accounts_[3].name, "Cloudflare", sizeof(accounts_[3].name) - 1);
    strncpy(accounts_[3].base32Secret, "ORSXG5A=", sizeof(accounts_[3].base32Secret) - 1);

    return saveAccountsToFlash();
  }

  bool saveAccountsToFlash() {
    if (accountCount_ == 0 || accountCount_ > Config::MAX_ACCOUNTS) return false;

    FileHeader hdr{};
    hdr.magic   = FILE_MAGIC;
    hdr.version = FILE_VERSION;
    hdr.count   = static_cast<uint16_t>(accountCount_);
    esp_fill_random(hdr.iv, IV_LEN);

    size_t payloadBytes = accountCount_ * sizeof(TotpAccount);
    uint8_t* cipherBuf  = static_cast<uint8_t*>(malloc(payloadBytes));
    if (!cipherBuf) return false;

    if (!aes256CtrCrypt(hdr.iv, reinterpret_cast<const uint8_t*>(accounts_), cipherBuf, payloadBytes)) {
      free(cipherBuf);
      return false;
    }

    uint8_t hmacTag[MAC_LEN] = { 0 };
    computeFileHmac(hdr, cipherBuf, payloadBytes, hmacTag);

    File f = LittleFS.open(TEMP_FILE_PATH, FILE_WRITE);
    if (!f) {
      free(cipherBuf);
      return false;
    }

    bool writeOk =
      (f.write(reinterpret_cast<const uint8_t*>(&hdr), sizeof(FileHeader)) == sizeof(FileHeader)) &&
      (f.write(cipherBuf, payloadBytes) == payloadBytes) &&
      (f.write(hmacTag, MAC_LEN) == MAC_LEN);
    f.close();
    free(cipherBuf);

    if (!writeOk) {
      LittleFS.remove(TEMP_FILE_PATH);
      return false;
    }

    if (LittleFS.exists(FILE_PATH)) {
      LittleFS.remove(FILE_PATH);
    }
    return LittleFS.rename(TEMP_FILE_PATH, FILE_PATH);
  }

  bool loadAccountsFromFlash() {
    File f = LittleFS.open(FILE_PATH, FILE_READ);
    if (!f) return false;

    FileHeader hdr{};
    if (f.read(reinterpret_cast<uint8_t*>(&hdr), sizeof(FileHeader)) != sizeof(FileHeader)) {
      f.close();
      return false;
    }

    if (hdr.magic != FILE_MAGIC || hdr.version != FILE_VERSION || hdr.count == 0 || hdr.count > Config::MAX_ACCOUNTS) {
      f.close();
      return false;
    }

    size_t payloadBytes     = static_cast<size_t>(hdr.count) * sizeof(TotpAccount);
    size_t expectedFileSize = sizeof(FileHeader) + payloadBytes + MAC_LEN;
    if (f.size() != expectedFileSize) {
      f.close();
      return false;
    }

    uint8_t* cipherBuf = static_cast<uint8_t*>(malloc(payloadBytes));
    if (!cipherBuf) {
      f.close();
      return false;
    }

    uint8_t storedMac[MAC_LEN] = { 0 };
    bool readOk =
      (f.read(cipherBuf, payloadBytes) == payloadBytes) &&
      (f.read(storedMac, MAC_LEN) == MAC_LEN);
    f.close();

    if (!readOk) {
      free(cipherBuf);
      return false;
    }

    uint8_t expectedMac[MAC_LEN] = { 0 };
    computeFileHmac(hdr, cipherBuf, payloadBytes, expectedMac);
    if (!CryptoUtils::constantTimeEqual(storedMac, expectedMac, MAC_LEN)) {
      free(cipherBuf);
      CryptoUtils::secureZero(expectedMac, sizeof(expectedMac));
      return false;
    }

    CryptoUtils::secureZero(accounts_, sizeof(accounts_));
    bool decOk = aes256CtrCrypt(hdr.iv, cipherBuf, reinterpret_cast<uint8_t*>(accounts_), payloadBytes);
    free(cipherBuf);

    if (!decOk) {
      CryptoUtils::secureZero(accounts_, sizeof(accounts_));
      accountCount_ = 0;
      return false;
    }

    accountCount_ = hdr.count;
    for (size_t i = 0; i < accountCount_; ++i) {
      accounts_[i].name[sizeof(accounts_[i].name) - 1] = '\0';
      accounts_[i].base32Secret[sizeof(accounts_[i].base32Secret) - 1] = '\0';
    }
    return true;
  }

  bool aes256CtrCrypt(const uint8_t iv[IV_LEN], const uint8_t* input, uint8_t* output, size_t len) const {
    mbedtls_aes_context aes;
    mbedtls_aes_init(&aes);
    if (mbedtls_aes_setkey_enc(&aes, deviceKey_, 256) != 0) {
      mbedtls_aes_free(&aes);
      return false;
    }
    size_t ncOff = 0;
    uint8_t nonceCounter[IV_LEN];
    uint8_t streamBlock[IV_LEN] = { 0 };
    memcpy(nonceCounter, iv, IV_LEN);

    int ret = mbedtls_aes_crypt_ctr(&aes, len, &ncOff, nonceCounter, streamBlock, input, output);
    mbedtls_aes_free(&aes);
    CryptoUtils::secureZero(streamBlock, sizeof(streamBlock));
    return (ret == 0);
  }

  void computeFileHmac(const FileHeader& hdr, const uint8_t* cipher, size_t cipherLen, uint8_t outMac[MAC_LEN]) const {
    mbedtls_md_context_t ctx;
    mbedtls_md_init(&ctx);
    const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    mbedtls_md_setup(&ctx, info, 1);
    mbedtls_md_hmac_starts(&ctx, deviceKey_, KEY_LEN);
    mbedtls_md_hmac_update(&ctx, reinterpret_cast<const uint8_t*>(&hdr), sizeof(FileHeader));
    mbedtls_md_hmac_update(&ctx, cipher, cipherLen);
    mbedtls_md_hmac_finish(&ctx, outMac);
    mbedtls_md_free(&ctx);
  }

  static size_t parseJsonAccounts(const char* json, size_t len, TotpAccount* outList, size_t maxCount) {
    size_t count = 0;
    size_t pos   = 0;

    while (pos < len && count < maxCount) {
      while (pos < len && json[pos] != '{') pos++;
      if (pos >= len) break;
      pos++;

      char nameBuf[13]   = { 0 };
      char secretBuf[65] = { 0 };

      while (pos < len && json[pos] != '}') {
        char key[24] = { 0 };
        if (!extractNextJsonString(json, len, pos, key, sizeof(key))) break;

        while (pos < len && json[pos] != ':' && json[pos] != '}') pos++;
        if (pos >= len || json[pos] == '}') break;
        pos++;

        while (pos < len && (json[pos] == ' ' || json[pos] == '\t' || json[pos] == '\r' || json[pos] == '\n')) pos++;

        if (pos < len && (json[pos] == '[' || json[pos] == '{')) {
          break;
        }

        if (pos < len && json[pos] == '"') {
          char val[65] = { 0 };
          if (extractNextJsonString(json, len, pos, val, sizeof(val))) {
            if (strcasecmp(key, "name") == 0 || strcasecmp(key, "label") == 0 ||
                strcasecmp(key, "issuer") == 0 || strcasecmp(key, "account") == 0 ||
                strcasecmp(key, "title") == 0) {
              if (nameBuf[0] == '\0') {
                strncpy(nameBuf, val, sizeof(nameBuf) - 1);
              }
            } else if (strcasecmp(key, "secret") == 0 || strcasecmp(key, "base32Secret") == 0 ||
                       strcasecmp(key, "base32") == 0 || strcasecmp(key, "seed") == 0 ||
                       strcasecmp(key, "totpSecret") == 0) {
              strncpy(secretBuf, val, sizeof(secretBuf) - 1);
            }
          }
          CryptoUtils::secureZero(val, sizeof(val));
        } else {
          while (pos < len && json[pos] != ',' && json[pos] != '}') pos++;
        }
      }

      if (pos < len && json[pos] == '}') pos++;

      if (nameBuf[0] != '\0' && TotpEngine::isValidBase32(secretBuf)) {
        strncpy(outList[count].name, nameBuf, sizeof(outList[count].name) - 1);
        strncpy(outList[count].base32Secret, secretBuf, sizeof(outList[count].base32Secret) - 1);
        count++;
      }
      CryptoUtils::secureZero(secretBuf, sizeof(secretBuf));
    }

    return count;
  }

  static bool extractNextJsonString(const char* json, size_t len, size_t& pos, char* out, size_t maxOut) {
    while (pos < len && json[pos] != '"' && json[pos] != '}') pos++;
    if (pos >= len || json[pos] != '"') return false;
    pos++;

    size_t outIdx = 0;
    while (pos < len && json[pos] != '"') {
      char c = json[pos++];
      if (c == '\\' && pos < len) {
        c = json[pos++];
      }
      if (outIdx + 1 < maxOut) {
        out[outIdx++] = c;
      }
    }
    out[outIdx] = '\0';
    if (pos < len && json[pos] == '"') pos++;
    return true;
  }

  uint8_t     deviceKey_[KEY_LEN] = { 0 };
  TotpAccount accounts_[Config::MAX_ACCOUNTS]{};
  size_t      accountCount_ = 0;
};

// ============================================================================
// 7. MODULE: ClockManager (Full DS3231 RTC via Adafruit RTClib + NTP Sync)
// ============================================================================
enum class ClockSource : uint8_t {
  INVALID = 0,
  RTC_DS3231,
  NTP_SYNCED
};

enum class RtcHardwareStatus : uint8_t {
  NOT_FOUND = 0,
  LOST_POWER_UNSYNCED,
  OK_VALID
};

class ClockManager {
public:
  RtcHardwareStatus initRtc() {
    rtcPresent_ = rtc_.begin(&Wire);
    if (!rtcPresent_) {
      rtcStatus_ = RtcHardwareStatus::NOT_FOUND;
      return rtcStatus_;
    }

    rtc_.writeSqwPinMode(DS3231_OFF);
    rtc_.disable32K();

    if (rtc_.lostPower()) {
      rtcStatus_ = RtcHardwareStatus::LOST_POWER_UNSYNCED;
      return rtcStatus_;
    }

    DateTime nowDt = rtc_.now();
    time_t rtcEpoch = static_cast<time_t>(nowDt.unixtime());
    if (rtcEpoch >= Config::MIN_VALID_UNIX_EPOCH) {
      setSystemClock(rtcEpoch);
      clockSource_        = ClockSource::RTC_DS3231;
      rtcStatus_          = RtcHardwareStatus::OK_VALID;
      lastRtcDriftSyncMs_ = millis();
      return rtcStatus_;
    }

    rtcStatus_ = RtcHardwareStatus::LOST_POWER_UNSYNCED;
    return rtcStatus_;
  }

  bool connectWiFiAndSyncNtp() {
    bool wifiConnected = connectWiFi(Config::WIFI_CONNECT_TIMEOUT_MS);
    if (wifiConnected) {
      syncNtpAndUpdateDs3231();
    }
    lastNtpAttemptMs_ = millis();
    return wifiConnected;
  }

  void disconnectWiFi() {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
  }

  void update(uint32_t nowMs) {
    if (rtcPresent_ && rtcStatus_ == RtcHardwareStatus::OK_VALID &&
        (nowMs - lastRtcDriftSyncMs_) >= Config::RTC_DRIFT_SYNC_INTERVAL_MS) {
      lastRtcDriftSyncMs_ = nowMs;
      if (!rtc_.lostPower()) {
        DateTime dt = rtc_.now();
        time_t rtcEpoch = static_cast<time_t>(dt.unixtime());
        if (rtcEpoch >= Config::MIN_VALID_UNIX_EPOCH) {
          setSystemClock(rtcEpoch);
        }
      }
    }

    if ((nowMs - lastNtpAttemptMs_) >= Config::NTP_RESYNC_INTERVAL_MS) {
      lastNtpAttemptMs_ = nowMs;
      if (connectWiFi(3500)) {
        syncNtpAndUpdateDs3231();
        disconnectWiFi();
      }
    }
  }

  bool getValidUnixTime(time_t& outEpoch) {
    time_t sysEpoch = time(nullptr);
    if (clockSource_ != ClockSource::INVALID && sysEpoch >= Config::MIN_VALID_UNIX_EPOCH) {
      outEpoch = sysEpoch;
      return true;
    }

    if (rtcPresent_ && !rtc_.lostPower()) {
      DateTime dt = rtc_.now();
      time_t rtcEpoch = static_cast<time_t>(dt.unixtime());
      if (rtcEpoch >= Config::MIN_VALID_UNIX_EPOCH) {
        setSystemClock(rtcEpoch);
        clockSource_ = ClockSource::RTC_DS3231;
        rtcStatus_   = RtcHardwareStatus::OK_VALID;
        outEpoch     = rtcEpoch;
        return true;
      }
    }

    outEpoch = 0;
    return false;
  }

  RtcHardwareStatus getRtcStatus() const { return rtcStatus_; }
  ClockSource       getClockSource() const { return clockSource_; }

private:
  static void setSystemClock(time_t epoch) {
    struct timeval tv {};
    tv.tv_sec  = epoch;
    tv.tv_usec = 0;
    settimeofday(&tv, nullptr);
  }

  bool connectWiFi(uint32_t timeoutMs) {
    if (strlen(Config::WIFI_SSID) == 0 || strcmp(Config::WIFI_SSID, "YOUR_WIFI_SSID") == 0) {
      return false;
    }
    WiFi.mode(WIFI_STA);
    WiFi.begin(Config::WIFI_SSID, Config::WIFI_PASSWORD);

    uint32_t startMs = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < timeoutMs) {
      delay(50);
    }
    if (WiFi.status() != WL_CONNECTED) {
      disconnectWiFi();
      return false;
    }
    return true;
  }

  bool syncNtpAndUpdateDs3231() {
    configTime(0, 0, Config::NTP_SERVER_1, Config::NTP_SERVER_2);
    struct tm timeinfo {};
    if (getLocalTime(&timeinfo, 4000)) {
      time_t ntpEpoch = time(nullptr);
      if (ntpEpoch >= Config::MIN_VALID_UNIX_EPOCH) {
        clockSource_ = ClockSource::NTP_SYNCED;
        if (rtcPresent_) {
          rtc_.adjust(DateTime(static_cast<uint32_t>(ntpEpoch)));
          rtcStatus_          = RtcHardwareStatus::OK_VALID;
          lastRtcDriftSyncMs_ = millis();
        }
        return true;
      }
    }
    return false;
  }

  RTC_DS3231        rtc_;
  bool              rtcPresent_         = false;
  RtcHardwareStatus rtcStatus_          = RtcHardwareStatus::NOT_FOUND;
  ClockSource       clockSource_        = ClockSource::INVALID;
  uint32_t          lastNtpAttemptMs_   = 0;
  uint32_t          lastRtcDriftSyncMs_ = 0;
};

// ============================================================================
// 8. MODULE: DisplayManager
// ============================================================================
class DisplayManager {
public:
  DisplayManager()
    : lcd_(Config::LCD_I2C_ADDR, Config::LCD_COLS, Config::LCD_ROWS) {}

  void begin() {
    lcd_.init();
    lcd_.backlight();
    lcd_.display();
    registerCustomCharacters();
    clearCache();
  }

  // Power down LCD backlight and controller before ESP32 enters Deep Sleep
  void powerDownForSleep() {
    writeRows("Going to sleep..", "Press A to wake");
    delay(600);
    lcd_.clear();
    lcd_.noBacklight();
    lcd_.noDisplay();
  }

  // Displays current time in GMT+6 on boot whenever RTC or NTP time is valid
  void renderBootGmtPlus6Time(time_t utcEpoch) {
    time_t bdtEpoch = utcEpoch + Config::GMT_PLUS_6_OFFSET_SEC;
    struct tm tmBdt {};
    gmtime_r(&bdtEpoch, &tmBdt);

    char row1[17];
    char row2[17];
    snprintf(row1, sizeof(row1), "GMT+6 %04d-%02d-%02d",
             tmBdt.tm_year + 1900, tmBdt.tm_mon + 1, tmBdt.tm_mday);
    snprintf(row2, sizeof(row2), "TIME: %02d:%02d:%02d",
             tmBdt.tm_hour, tmBdt.tm_min, tmBdt.tm_sec);
    writeRows(row1, row2);
  }

  void renderLockedScreen(size_t enteredCount, uint32_t cooldownRemainingMs) {
    if (cooldownRemainingMs > 0) {
      uint32_t secs = (cooldownRemainingMs + 999) / 1000;
      char row2[17];
      snprintf(row2, sizeof(row2), "Wait %2lus...", static_cast<unsigned long>(secs));
      writeRows("AUTHENTICATOR", row2);
      return;
    }

    char row2[17];
    if (enteredCount <= 4) {
      char s0 = (enteredCount >= 1) ? '*' : '_';
      char s1 = (enteredCount >= 2) ? '*' : '_';
      char s2 = (enteredCount >= 3) ? '*' : '_';
      char s3 = (enteredCount >= 4) ? '*' : '_';
      snprintf(row2, sizeof(row2), "PIN: %c %c %c %c  #", s0, s1, s2, s3);
    } else {
      char mask[9];
      for (size_t i = 0; i < 8; ++i) {
        mask[i] = (i < enteredCount) ? '*' : '_';
      }
      mask[8] = '\0';
      snprintf(row2, sizeof(row2), "PIN: %s #", mask);
    }
    writeRows("AUTHENTICATOR", row2);
  }

  void renderWrongPassword() {
    writeRows("Wrong password", "Try again");
  }

  void renderNewPasswordEntry(size_t enteredCount) {
    char row2[17];
    snprintf(row2, sizeof(row2), "Len:%u/8  #=Save", static_cast<unsigned int>(enteredCount));
    writeRows("New password", row2);
  }

  void renderPasswordTooShort() {
    writeRows("Min 4 digits!", "Try again");
  }

  void renderConfirmPasswordEntry(size_t enteredCount) {
    char row2[17];
    snprintf(row2, sizeof(row2), "Len:%u/8  #=Save", static_cast<unsigned int>(enteredCount));
    writeRows("Confirm password", row2);
  }

  void renderPasswordMismatch() {
    writeRows("Passwords differ", "Start again");
  }

  void renderPasswordSaved() {
    writeRows("Password saved", "Device unlocked");
  }

  void renderAuthenticator(const char* accountName, size_t accountIdx, size_t totalAccounts,
                           uint32_t totpCode, uint8_t remainingSec) {
    uint8_t phase = 0;
    if (remainingSec >= 26)      phase = 0;
    else if (remainingSec >= 21) phase = 1;
    else if (remainingSec >= 16) phase = 2;
    else if (remainingSec >= 11) phase = 3;
    else if (remainingSec >= 6)  phase = 4;
    else                         phase = 5;

    char idxBuf[8];
    if (totalAccounts < 10) {
      snprintf(idxBuf, sizeof(idxBuf), "%u/%u",
               static_cast<unsigned int>(accountIdx + 1),
               static_cast<unsigned int>(totalAccounts));
    } else {
      snprintf(idxBuf, sizeof(idxBuf), "#%03u", static_cast<unsigned int>(accountIdx + 1));
    }

    size_t idxLen    = strlen(idxBuf);
    size_t nameWidth = (14 > idxLen) ? (14 - idxLen) : 8;

    char row1[17];
    snprintf(row1, sizeof(row1), "%-*.*s %s%c",
             static_cast<int>(nameWidth),
             static_cast<int>(nameWidth),
             accountName,
             idxBuf,
             static_cast<char>(phase + 1));

    char row2[17];
    uint32_t part1 = totpCode / 1000;
    uint32_t part2 = totpCode % 1000;
    snprintf(row2, sizeof(row2), "%03lu %03lu   %c %02us",
             static_cast<unsigned long>(part1),
             static_cast<unsigned long>(part2),
             static_cast<char>(phase + 1),
             static_cast<unsigned int>(remainingSec));

    writeRows(row1, row2);
  }

  void renderClockInvalid() { writeRows("CLOCK INVALID", "Sync NTP or RTC"); }
  void renderStorageError() { writeRows("STORAGE ERROR", "Lock Corrupted!"); }
  void renderRfcError()     { writeRows("CRYPTO ERROR", "RFC Test Failed!"); }
  void renderBootSync()     { writeRows("AUTHENTICATOR", "Syncing NTP..."); }
  void renderApiSync()      { writeRows("AUTHENTICATOR", "Syncing API..."); }

private:
  void registerCustomCharacters() {
    uint8_t circleFull[8] = { 0b01110, 0b11111, 0b11111, 0b11111, 0b11111, 0b11111, 0b01110, 0b00000 };
    uint8_t circle5_6[8]  = { 0b00110, 0b00111, 0b00111, 0b11111, 0b11111, 0b11111, 0b01110, 0b00000 };
    uint8_t circle4_6[8]  = { 0b00110, 0b00111, 0b00111, 0b00111, 0b01111, 0b01111, 0b00110, 0b00000 };
    uint8_t circle3_6[8]  = { 0b00110, 0b00111, 0b00111, 0b00111, 0b00111, 0b00111, 0b00110, 0b00000 };
    uint8_t circle2_6[8]  = { 0b00110, 0b00111, 0b00111, 0b00111, 0b00000, 0b00000, 0b00000, 0b00000 };
    uint8_t circle1_6[8]  = { 0b01110, 0b10001, 0b10101, 0b10101, 0b10001, 0b10001, 0b01110, 0b00000 };

    lcd_.createChar(1, circleFull);
    lcd_.createChar(2, circle5_6);
    lcd_.createChar(3, circle4_6);
    lcd_.createChar(4, circle3_6);
    lcd_.createChar(5, circle2_6);
    lcd_.createChar(6, circle1_6);
  }

  void clearCache() {
    memset(lastRow1_, 0, sizeof(lastRow1_));
    memset(lastRow2_, 0, sizeof(lastRow2_));
  }

  void writeRows(const char* r1, const char* r2) {
    char padded1[Config::LCD_COLS + 1];
    char padded2[Config::LCD_COLS + 1];
    formatFixed16(r1, padded1);
    formatFixed16(r2, padded2);

    updateLineDiff(0, padded1, lastRow1_);
    updateLineDiff(1, padded2, lastRow2_);
  }

  static void formatFixed16(const char* src, char out[Config::LCD_COLS + 1]) {
    size_t i = 0;
    if (src) {
      for (; i < Config::LCD_COLS && src[i] != '\0'; ++i) {
        out[i] = src[i];
      }
    }
    for (; i < Config::LCD_COLS; ++i) {
      out[i] = ' ';
    }
    out[Config::LCD_COLS] = '\0';
  }

  void updateLineDiff(uint8_t row, const char* newLine, char* cachedLine) {
    for (uint8_t col = 0; col < Config::LCD_COLS; ++col) {
      if (newLine[col] != cachedLine[col]) {
        lcd_.setCursor(col, row);
        lcd_.write(static_cast<uint8_t>(newLine[col]));
        cachedLine[col] = newLine[col];
      }
    }
  }

  LiquidCrystal_I2C lcd_;
  char              lastRow1_[Config::LCD_COLS + 1] = { 0 };
  char              lastRow2_[Config::LCD_COLS + 1] = { 0 };
};

// ============================================================================
// 9. MODULE: LockManager (Keypad Entry + '#' Save/Submit + 'B' Password Setup)
// ============================================================================
enum class SetupSubState : uint8_t {
  INACTIVE = 0,
  STATE_A_ENTER_NEW,
  STATE_A_TOO_SHORT_MSG,
  STATE_B_CONFIRM_NEW,
  STATE_B_MISMATCH_MSG,
  STATE_C_COMMIT_SUCCESS_MSG
};

enum class UnlockResult : uint8_t {
  PENDING = 0,
  UNLOCKED,
  WRONG_PASSWORD,
  RATE_LIMITED
};

class LockManager {
public:
  explicit LockManager(CredentialStore& store)
    : credStore_(store) {}

  void begin(uint32_t nowMs) {
    isUnlocked_     = false;
    setupSubState_  = SetupSubState::INACTIVE;
    resetEntryBuffer();
    failedAttempts_ = credStore_.getFailedAttempts();
    if (failedAttempts_ > 0) {
      applyCooldown(nowMs);
    }
  }

  bool isUnlocked() const { return isUnlocked_; }
  SetupSubState getSetupSubState() const { return setupSubState_; }
  size_t getEnteredLength() const { return entryLen_; }

  uint32_t getCooldownRemainingMs(uint32_t nowMs) const {
    if (!cooldownActive_) return 0;
    if ((nowMs - cooldownStartMs_) >= cooldownDurationMs_) return 0;
    return cooldownDurationMs_ - (nowMs - cooldownStartMs_);
  }

  // Handles keypad keys ('0'-'9', '*', '#') while device is LOCKED
  UnlockResult handleLockedKey(char key, uint32_t nowMs) {
    if (getCooldownRemainingMs(nowMs) > 0) {
      return UnlockResult::RATE_LIMITED;
    }
    cooldownActive_ = false;

    // '*' clears current input buffer
    if (key == '*') {
      resetEntryBuffer();
      return UnlockResult::PENDING;
    }

    // '#' submits the entered password explicitly
    if (key == '#') {
      if (entryLen_ == 0) {
        return UnlockResult::PENDING;
      }
      return evaluateLockedBuffer(nowMs);
    }

    // Accept '0'-'9' (and 'C'/'D' if someone has an old L/R sequence)
    if (key >= '0' && key <= '9') {
      if (entryLen_ < Config::MAX_PASS_LEN) {
        entryBuf_[entryLen_++] = key;
        entryBuf_[entryLen_]   = '\0';
      }
      // Also auto-unlock if exact match is reached without needing '#'
      if (credStore_.verifyPassword(entryBuf_, entryLen_)) {
        resetEntryBuffer();
        if (failedAttempts_ != 0) {
          failedAttempts_ = 0;
          credStore_.setFailedAttempts(0);
        }
        isUnlocked_ = true;
        return UnlockResult::UNLOCKED;
      }
    }

    return UnlockResult::PENDING;
  }

  void pollCooldown(uint32_t nowMs) {
    if (cooldownActive_ && getCooldownRemainingMs(nowMs) == 0) {
      cooldownActive_ = false;
    }
  }

  // Triggered when user presses 'B' while unlocked
  void startPasswordSetup() {
    setupSubState_ = SetupSubState::STATE_A_ENTER_NEW;
    resetEntryBuffer();
    CryptoUtils::secureZero(candidateBuf_, sizeof(candidateBuf_));
    candidateLen_ = 0;
  }

  // Handles keypad keys while in Password Setup Mode ('0'-'9', '*', '#', 'B')
  void handleSetupKey(char key, uint32_t nowMs) {
    // Pressing 'B' cancels password setup and returns to unlocked screen
    if (key == 'B') {
      resetEntryBuffer();
      CryptoUtils::secureZero(candidateBuf_, sizeof(candidateBuf_));
      candidateLen_  = 0;
      setupSubState_ = SetupSubState::INACTIVE;
      return;
    }

    if (setupSubState_ != SetupSubState::STATE_A_ENTER_NEW &&
        setupSubState_ != SetupSubState::STATE_B_CONFIRM_NEW) {
      return;
    }

    // '*' clears current digits
    if (key == '*') {
      resetEntryBuffer();
      return;
    }

    // '0'-'9' appends digit (up to 8 digits)
    if (key >= '0' && key <= '9') {
      if (entryLen_ < Config::MAX_PASS_LEN) {
        entryBuf_[entryLen_++] = key;
        entryBuf_[entryLen_]   = '\0';
      }
      return;
    }

    // '#' saves / advances password setup stage
    if (key == '#') {
      if (setupSubState_ == SetupSubState::STATE_A_ENTER_NEW) {
        if (entryLen_ < Config::MIN_PASS_LEN) {
          resetEntryBuffer();
          setupSubState_   = SetupSubState::STATE_A_TOO_SHORT_MSG;
          stateMsgStartMs_ = nowMs;
        } else {
          memcpy(candidateBuf_, entryBuf_, entryLen_ + 1);
          candidateLen_  = entryLen_;
          resetEntryBuffer();
          setupSubState_ = SetupSubState::STATE_B_CONFIRM_NEW;
        }
      } else if (setupSubState_ == SetupSubState::STATE_B_CONFIRM_NEW) {
        bool matches = CryptoUtils::constantTimeStrEqual(
          candidateBuf_, candidateLen_, entryBuf_, entryLen_);
        resetEntryBuffer();

        if (!matches) {
          CryptoUtils::secureZero(candidateBuf_, sizeof(candidateBuf_));
          candidateLen_    = 0;
          setupSubState_   = SetupSubState::STATE_B_MISMATCH_MSG;
          stateMsgStartMs_ = nowMs;
        } else {
          bool committed = credStore_.commitNewPassword(candidateBuf_, candidateLen_);
          CryptoUtils::secureZero(candidateBuf_, sizeof(candidateBuf_));
          candidateLen_ = 0;

          if (committed) {
            setupSubState_   = SetupSubState::STATE_C_COMMIT_SUCCESS_MSG;
            stateMsgStartMs_ = nowMs;
          } else {
            setupSubState_ = SetupSubState::INACTIVE;
          }
        }
      }
    }
  }

  // Manages transient error/success message timers during password setup
  bool updateSetupStateMachine(uint32_t nowMs) {
    switch (setupSubState_) {
      case SetupSubState::INACTIVE:
        return true;

      case SetupSubState::STATE_A_TOO_SHORT_MSG:
        if ((nowMs - stateMsgStartMs_) >= Config::TRANSIENT_MSG_DURATION_MS) {
          resetEntryBuffer();
          setupSubState_ = SetupSubState::STATE_A_ENTER_NEW;
        }
        return false;

      case SetupSubState::STATE_B_MISMATCH_MSG:
        if ((nowMs - stateMsgStartMs_) >= Config::TRANSIENT_MSG_DURATION_MS) {
          resetEntryBuffer();
          setupSubState_ = SetupSubState::STATE_A_ENTER_NEW;
        }
        return false;

      case SetupSubState::STATE_C_COMMIT_SUCCESS_MSG:
        if ((nowMs - stateMsgStartMs_) >= Config::TRANSIENT_MSG_DURATION_MS) {
          setupSubState_ = SetupSubState::INACTIVE;
          return true;
        }
        return false;

      default:
        return false;
    }
  }

private:
  UnlockResult evaluateLockedBuffer(uint32_t nowMs) {
    bool valid = credStore_.verifyPassword(entryBuf_, entryLen_);
    resetEntryBuffer();

    if (valid) {
      if (failedAttempts_ != 0) {
        failedAttempts_ = 0;
        credStore_.setFailedAttempts(0);
      }
      isUnlocked_ = true;
      return UnlockResult::UNLOCKED;
    }
    return registerFailedUnlock(nowMs);
  }

  UnlockResult registerFailedUnlock(uint32_t nowMs) {
    resetEntryBuffer();
    failedAttempts_++;
    credStore_.setFailedAttempts(failedAttempts_);
    applyCooldown(nowMs);
    return UnlockResult::WRONG_PASSWORD;
  }

  void applyCooldown(uint32_t nowMs) {
    if (failedAttempts_ < 3) {
      cooldownActive_     = false;
      cooldownDurationMs_ = 0;
      return;
    }
    uint32_t shift = (failedAttempts_ - 3);
    if (shift > 4) shift = 4;
    uint32_t penalty = Config::BASE_FAIL_COOLDOWN_MS * (1UL << shift);
    if (penalty > Config::MAX_FAIL_COOLDOWN_MS) {
      penalty = Config::MAX_FAIL_COOLDOWN_MS;
    }
    cooldownActive_     = true;
    cooldownStartMs_    = nowMs;
    cooldownDurationMs_ = penalty;
  }

  void resetEntryBuffer() {
    CryptoUtils::secureZero(entryBuf_, sizeof(entryBuf_));
    entryLen_ = 0;
  }

  CredentialStore& credStore_;
  bool             isUnlocked_                             = false;
  SetupSubState    setupSubState_                          = SetupSubState::INACTIVE;
  char             entryBuf_[Config::MAX_PASS_LEN + 1]     = { 0 };
  size_t           entryLen_                               = 0;
  char             candidateBuf_[Config::MAX_PASS_LEN + 1] = { 0 };
  size_t           candidateLen_                           = 0;
  uint32_t         stateMsgStartMs_                        = 0;
  uint32_t         failedAttempts_                         = 0;
  bool             cooldownActive_                         = false;
  uint32_t         cooldownStartMs_                        = 0;
  uint32_t         cooldownDurationMs_                     = 0;
};

// ============================================================================
// 10. MODULE: MainController
// ============================================================================
enum class SystemState : uint8_t {
  LOCKED = 0,
  LOCKED_ERROR_MSG,
  UNLOCKED_AUTH,
  PASSWORD_SETUP,
  STORAGE_RECOVERY_ERROR,
  RFC_SELFTEST_ERROR
};

class MainController {
public:
  MainController()
    : lockMgr_(credStore_) {}

  void begin() {
    Wire.begin(Config::PIN_I2C_SDA, Config::PIN_I2C_SCL);
    display_.begin();
    keypad_.begin();

    // 1. Mandatory RFC 4648 & RFC 6238 Test Vector Verification on Boot
    if (!TotpEngine::runRfcSelfTest()) {
      state_ = SystemState::RFC_SELFTEST_ERROR;
      lastActivityMs_ = millis();
      return;
    }

    // 2. Initialize Encrypted Account Store & Lock Credentials
    StorageStatus credStatus = credStore_.begin();
    bool acctOk              = accountStore_.begin();

    // 3. Initialize DS3231 Hardware RTC
    clock_.initRtc();
    time_t bootEpoch = 0;
    bool rtcTimeValid = clock_.getValidUnixTime(bootEpoch);

    // Check if we woke from Deep Sleep via Key 'A'
    esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();
    bool wokeFromDeepSleep = (wakeCause == ESP_SLEEP_WAKEUP_EXT0);

    // 4. On cold boot (or if clock is invalid), connect Wi-Fi for NTP & API sync.
    //    On wake from Deep Sleep with valid DS3231 time, skip Wi-Fi to save battery!
    if (!wokeFromDeepSleep || !rtcTimeValid) {
      if (!rtcTimeValid) {
        display_.renderBootSync();
      }
      bool wifiOnline = clock_.connectWiFiAndSyncNtp();
      if (wifiOnline) {
        display_.renderApiSync();
        accountStore_.syncFromRemoteApiIfConnected();
        clock_.disconnectWiFi();
      }
    }

    // 5. Requirement: On boot, if RTC OK or Time OK, display time in GMT+6
    //    instead of "RTC: DS3231 OK" or any status message.
    if (clock_.getValidUnixTime(bootEpoch)) {
      uint32_t splashStart = millis();
      while ((millis() - splashStart) < Config::BOOT_TIME_SPLASH_MS) {
        time_t currentUtc = 0;
        if (clock_.getValidUnixTime(currentUtc)) {
          display_.renderBootGmtPlus6Time(currentUtc);
        }
        delay(100);
      }
    }

    uint32_t nowMs = millis();
    lockMgr_.begin(nowMs);
    lastActivityMs_ = nowMs;

    if (credStatus == StorageStatus::ERROR_CORRUPTED || !acctOk) {
      state_ = SystemState::STORAGE_RECOVERY_ERROR;
    } else {
      state_ = SystemState::LOCKED;
    }
  }

  void update() {
    uint32_t nowMs = millis();
    char key = keypad_.update(nowMs);
    clock_.update(nowMs);

    // Any key press resets the 5-minute inactivity auto-sleep timer
    if (key != '\0') {
      lastActivityMs_ = nowMs;

      // Requirement: Pressing 'A' puts the device to Deep Sleep immediately
      if (key == 'A') {
        enterDeepSleep();
        return;
      }
    }

    // Requirement: Auto put to Deep Sleep after 5 minutes of inactivity
    if ((nowMs - lastActivityMs_) >= Config::INACTIVITY_SLEEP_TIMEOUT_MS) {
      enterDeepSleep();
      return;
    }

    switch (state_) {
      case SystemState::RFC_SELFTEST_ERROR:
      case SystemState::STORAGE_RECOVERY_ERROR:
        break;

      case SystemState::LOCKED:
        handleLockedState(key, nowMs);
        break;

      case SystemState::LOCKED_ERROR_MSG:
        if ((nowMs - transientStartMs_) >= Config::TRANSIENT_MSG_DURATION_MS) {
          state_ = SystemState::LOCKED;
        }
        break;

      case SystemState::UNLOCKED_AUTH:
        handleUnlockedAuthState(key);
        break;

      case SystemState::PASSWORD_SETUP:
        handlePasswordSetupState(key, nowMs);
        break;
    }

    if ((nowMs - lastUiRenderMs_) >= Config::UI_REFRESH_INTERVAL_MS || key != '\0') {
      lastUiRenderMs_ = nowMs;
      renderCurrentState(nowMs);
    }
  }

private:
  void enterDeepSleep() {
    clock_.disconnectWiFi();
    display_.powerDownForSleep();
    keypad_.prepareForDeepSleep();
    esp_deep_sleep_start();
  }

  void handleLockedState(char key, uint32_t nowMs) {
    lockMgr_.pollCooldown(nowMs);
    if (key == '\0') return;

    UnlockResult res = lockMgr_.handleLockedKey(key, nowMs);
    if (res == UnlockResult::UNLOCKED) {
      state_ = SystemState::UNLOCKED_AUTH;
    } else if (res == UnlockResult::WRONG_PASSWORD) {
      state_            = SystemState::LOCKED_ERROR_MSG;
      transientStartMs_ = nowMs;
    }
  }

  void handleUnlockedAuthState(char key) {
    if (key == '\0') return;

    // Requirement: Pressing 'B' prompts to enter new password if logged in
    if (key == 'B') {
      lockMgr_.startPasswordSetup();
      state_ = SystemState::PASSWORD_SETUP;
      return;
    }

    size_t total = accountStore_.getAccountCount();
    if (total == 0) return;

    // Requirement: 'C' and 'D' for Left / Right switching of accounts
    if (key == 'C') {
      selectedAccount_ = (selectedAccount_ == 0) ? (total - 1) : (selectedAccount_ - 1);
    } else if (key == 'D') {
      selectedAccount_ = (selectedAccount_ + 1) % total;
    }
  }

  void handlePasswordSetupState(char key, uint32_t nowMs) {
    if (key != '\0') {
      lockMgr_.handleSetupKey(key, nowMs);
    }

    if (lockMgr_.updateSetupStateMachine(nowMs)) {
      if (credStore_.getStatus() == StorageStatus::ERROR_CORRUPTED) {
        state_ = SystemState::STORAGE_RECOVERY_ERROR;
      } else {
        state_ = SystemState::UNLOCKED_AUTH;
      }
    }
  }

  void renderCurrentState(uint32_t nowMs) {
    switch (state_) {
      case SystemState::RFC_SELFTEST_ERROR:
        display_.renderRfcError();
        break;

      case SystemState::STORAGE_RECOVERY_ERROR:
        display_.renderStorageError();
        break;

      case SystemState::LOCKED:
        display_.renderLockedScreen(
          lockMgr_.getEnteredLength(),
          lockMgr_.getCooldownRemainingMs(nowMs));
        break;

      case SystemState::LOCKED_ERROR_MSG:
        display_.renderWrongPassword();
        break;

      case SystemState::PASSWORD_SETUP:
        renderSetupSubState();
        break;

      case SystemState::UNLOCKED_AUTH:
        renderAuthenticatorView();
        break;
    }
  }

  void renderSetupSubState() {
    switch (lockMgr_.getSetupSubState()) {
      case SetupSubState::STATE_A_ENTER_NEW:
        display_.renderNewPasswordEntry(lockMgr_.getEnteredLength());
        break;
      case SetupSubState::STATE_A_TOO_SHORT_MSG:
        display_.renderPasswordTooShort();
        break;
      case SetupSubState::STATE_B_CONFIRM_NEW:
        display_.renderConfirmPasswordEntry(lockMgr_.getEnteredLength());
        break;
      case SetupSubState::STATE_B_MISMATCH_MSG:
        display_.renderPasswordMismatch();
        break;
      case SetupSubState::STATE_C_COMMIT_SUCCESS_MSG:
        display_.renderPasswordSaved();
        break;
      default:
        break;
    }
  }

  void renderAuthenticatorView() {
    time_t nowEpoch = 0;
    if (!clock_.getValidUnixTime(nowEpoch)) {
      display_.renderClockInvalid();
      return;
    }

    if (selectedAccount_ >= accountStore_.getAccountCount()) {
      selectedAccount_ = 0;
    }

    char acctName[13]  = { 0 };
    char base32Sec[65] = { 0 };
    if (!accountStore_.getAccountMeta(selectedAccount_, acctName, sizeof(acctName)) ||
        !accountStore_.getAccountSecret(selectedAccount_, base32Sec, sizeof(base32Sec))) {
      display_.renderStorageError();
      return;
    }

    uint32_t code = 0;
    bool ok = TotpEngine::generateCode(base32Sec, nowEpoch, code);
    CryptoUtils::secureZero(base32Sec, sizeof(base32Sec));

    if (!ok) {
      display_.renderStorageError();
      return;
    }

    uint8_t remSec = TotpEngine::getRemainingSeconds(nowEpoch);
    display_.renderAuthenticator(
      acctName,
      selectedAccount_,
      accountStore_.getAccountCount(),
      code,
      remSec);
  }

  KeypadManager   keypad_;
  CredentialStore credStore_;
  AccountStore    accountStore_;
  ClockManager    clock_;
  DisplayManager  display_;
  LockManager     lockMgr_;

  SystemState     state_            = SystemState::LOCKED;
  size_t          selectedAccount_  = 0;
  uint32_t        transientStartMs_ = 0;
  uint32_t        lastUiRenderMs_   = 0;
  uint32_t        lastActivityMs_   = 0;
};

// ============================================================================
// 11. ARDUINO ENTRY POINTS
// ============================================================================
static MainController g_app;

void setup() {
  g_app.begin();
}

void loop() {
  g_app.update();
}