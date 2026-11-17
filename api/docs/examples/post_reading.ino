// ESP32 starter: posts one CONTRACT.md message to the Hollow Twin API every 10 s.
// Lanes 2 and 3 copy this, then swap the fake values for real sensor reads.
// The message is exactly the contract's format, plus "source":"live" (real hardware says so; see api/docs/FIRMWARE.md).
// Not compiled on a board yet: no hardware was at hand when it was written.
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* API = "http://192.168.1.50:8787/ingest";  // the laptop running `npm start` in the api folder
const char* BLOCK = "l7-chalk-cut";                   // a block id from contract/blocks.json
const char* DEVICE = "sensor-l7-chalk-cut";           // CONTRACT.md section 3: sensor-<block id>
unsigned long seq = 0;                                // keep this in flash (Preferences) so ids never repeat after a reboot

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi connected");
  configTime(0, 0, "pool.ntp.org");  // real UTC time for the "time" field
}

String isoNow() {
  struct tm t;
  if (!getLocalTime(&t)) return "1970-01-01T00:00:00Z";  // no clock yet: the API keeps the message and estimates the time
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

void loop() {
  float tds = 250 + random(0, 50);  // replace with the TDS probe reading
  float turbidity = 1.2;            // replace with the turbidity probe reading
  char id[64];
  snprintf(id, sizeof(id), "%s-%06lu", DEVICE, ++seq);  // <device>-<counter>
  String body = String("{\"id\":\"") + id +
                "\",\"device\":\"" + DEVICE + "\",\"block\":\"" + BLOCK +
                "\",\"time\":\"" + isoNow() + "\",\"kind\":\"water\",\"values\":{\"tds_ppm\":" +
                String(tds, 0) + ",\"turbidity_ntu\":" + String(turbidity, 1) +
                "},\"hops\":0,\"via\":[],\"source\":\"live\"}";
  HTTPClient http;
  http.begin(API);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  // 200 {"accepted":1,"duplicates":0,"rejected":[],"warnings":[]} when all is well.
  // 422 means the message was refused: the reply says why. Fix the firmware, do not retry the same message.
  Serial.printf("POST %d: %s\n", code, http.getString().c_str());
  http.end();
  delay(10000);
}
