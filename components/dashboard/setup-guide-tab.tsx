"use client";

import * as React from "react";
import { Check, Copy, Terminal, Cpu, Wifi, Key } from "lucide-react";
import { toast } from "sonner";

export function SetupGuideTab() {
  const [copiedCurl, setCopiedCurl] = React.useState(false);
  const [copiedCpp, setCopiedCpp] = React.useState(false);

  const host = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  const curlCommand = `curl -X GET "${host}/api/esp32/super_secret__ROUTE" \\
  -H "x-api-key: esp_live_YOUR_DEVICE_API_KEY"`;

  const cppSketch = `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

const char* serverUrl = "${host}/api/esp32/super_secret__ROUTE";
const char* deviceApiKey = "esp_live_YOUR_DEVICE_API_KEY";

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\\nWiFi connected");
  syncTotpAccounts();
}

void syncTotpAccounts() {
  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("x-api-key", deviceApiKey);
  
  int httpResponseCode = http.GET();
  if (httpResponseCode == 200) {
    String payload = http.getString();
    Serial.println("TOTP Accounts Synced Successfully:");
    Serial.println(payload);
  } else {
    Serial.printf("Sync failed with error: %d\\n", httpResponseCode);
  }
  http.end();
}

void loop() {
  delay(1000);
}`;

  const copyCurl = async () => {
    await navigator.clipboard.writeText(curlCommand);
    setCopiedCurl(true);
    toast.success("cURL command copied to clipboard");
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  const copyCpp = async () => {
    await navigator.clipboard.writeText(cppSketch);
    setCopiedCpp(true);
    toast.success("Arduino C++ sketch copied to clipboard");
    setTimeout(() => setCopiedCpp(false), 2000);
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 pb-20">
      <div className="px-1">
        <h2 className="text-xl font-normal text-[#e3e3e3] tracking-tight">
          ESP32 Firmware & Setup
        </h2>
        <p className="text-xs text-[#8e918f] mt-0.5">
          Program your physical ESP32 microcontroller to fetch and calculate TOTP verification codes.
        </p>
      </div>

      <div className="rounded-3xl bg-[#1e1f20] border border-[#282a2c] p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-[#004a77] text-[#c2e7ff] flex items-center justify-center shrink-0">
            <Terminal className="h-5 w-5 text-[#8ab4f8]" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[#e3e3e3]">
              1. Test Sync with cURL
            </h3>
            <p className="text-xs text-[#8e918f]">
              Verify your API key against the sync endpoint from a command prompt.
            </p>
          </div>
        </div>

        <div className="relative rounded-2xl bg-[#131314] p-4 font-mono text-xs text-[#c4c7c5] overflow-x-auto border border-[#282a2c]">
          <pre>{curlCommand}</pre>
          <button
            type="button"
            onClick={copyCurl}
            className="absolute top-3 right-3 h-8 px-3 rounded-full bg-[#282a2c] hover:bg-[#3c4043] text-xs font-medium text-[#e3e3e3] flex items-center gap-1.5 transition-colors"
          >
            {copiedCurl ? <Check className="h-3.5 w-3.5 text-[#81c995]" /> : <Copy className="h-3.5 w-3.5" />}
            Copy
          </button>
        </div>
      </div>

      <div className="rounded-3xl bg-[#1e1f20] border border-[#282a2c] p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-[#004a77] text-[#c2e7ff] flex items-center justify-center shrink-0">
            <Cpu className="h-5 w-5 text-[#8ab4f8]" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[#e3e3e3]">
              2. ESP32 Arduino Sketch
            </h3>
            <p className="text-xs text-[#8e918f]">
              Flash this sketch using the Arduino IDE or PlatformIO.
            </p>
          </div>
        </div>

        <div className="relative rounded-2xl bg-[#131314] p-4 font-mono text-xs text-[#c4c7c5] overflow-x-auto border border-[#282a2c] max-h-80">
          <pre>{cppSketch}</pre>
          <button
            type="button"
            onClick={copyCpp}
            className="absolute top-3 right-3 h-8 px-3 rounded-full bg-[#282a2c] hover:bg-[#3c4043] text-xs font-medium text-[#e3e3e3] flex items-center gap-1.5 transition-colors"
          >
            {copiedCpp ? <Check className="h-3.5 w-3.5 text-[#81c995]" /> : <Copy className="h-3.5 w-3.5" />}
            Copy Sketch
          </button>
        </div>
      </div>
    </div>
  );
}
