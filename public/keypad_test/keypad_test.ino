#include <Arduino.h>
#include <Keypad.h>

const byte ROW_COUNT = 4;
const byte COLUMN_COUNT = 4;

char KEY_MATRIX[ROW_COUNT][COLUMN_COUNT] = {
  { '1', '2', '3', 'A' },
  { '4', '5', '6', 'B' },
  { '7', '8', '9', 'C' },
  { '*', '0', '#', 'D' }
};

byte ROW_PIN_NUMBERS[ROW_COUNT] = { 15, 13, 33, 32 };
byte COLUMN_PIN_NUMBERS[COLUMN_COUNT] = { 14, 27, 26, 25 };

Keypad customKeypad = Keypad(makeKeymap(KEY_MATRIX), ROW_PIN_NUMBERS, COLUMN_PIN_NUMBERS, ROW_COUNT, COLUMN_COUNT);

void checkPinIsolation() {
  Serial.println("Running pin isolation diagnostics...");
  bool shortFound = false;

  for (byte i = 0; i < ROW_COUNT; ++i) {
    for (byte j = i + 1; j < ROW_COUNT; ++j) {
      byte pinOne = ROW_PIN_NUMBERS[i];
      byte pinTwo = ROW_PIN_NUMBERS[j];

      pinMode(pinOne, OUTPUT);
      digitalWrite(pinOne, LOW);
      pinMode(pinTwo, INPUT_PULLUP);
      delayMicroseconds(50);

      if (digitalRead(pinTwo) == LOW) {
        shortFound = true;
        Serial.print("[ALERT] Short detected between Row ");
        Serial.print(i + 1);
        Serial.print(" (GPIO ");
        Serial.print(pinOne);
        Serial.print(") and Row ");
        Serial.print(j + 1);
        Serial.print(" (GPIO ");
        Serial.print(pinTwo);
        Serial.println(")");
        Serial.println("Wires are touching or sharing the same breadboard tie row.");
        Serial.println("Suggestion: Move Row 4 wire to GPIO 4 or GPIO 18.");
      }

      pinMode(pinOne, INPUT_PULLUP);
      pinMode(pinTwo, INPUT_PULLUP);
    }
  }

  if (!shortFound) {
    Serial.println("All row pins are electrically isolated.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("========================================");
  Serial.println("ESP32 KEYPAD.H TEST FIRMWARE");
  Serial.println("Row Pins:    15, 13, 33, 32");
  Serial.println("Column Pins: 14, 27, 26, 25");

  checkPinIsolation();

  Serial.println("Press any key on the keypad to test...");
  Serial.println("========================================");

  customKeypad.setDebounceTime(50);
}

void loop() {
  char pressedKey = customKeypad.getKey();

  if (pressedKey) {
    Serial.print("[KEYPAD.H] Key Pressed: '");
    Serial.print(pressedKey);
    Serial.println("'");
  }
}
