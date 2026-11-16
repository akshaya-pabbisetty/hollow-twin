// ESP32 starter: posts one reading in the shared format to the Hollow Twin API every 10 s.
// Lanes 2 and 3 copy this, then swap the fake values for real sensor reads.
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* API = "http://192.168.1.50:8787/ingest";  // laptop running `npm start` in the api folder
const char* DEVICE = "sensor-01";
const char* BLOCK = "L8-deepwell-03";
unsigned long seq = 0;

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi connected");
  configTime(0, 0, "pool.ntp.org");  // real UTC time for the "time" field
}

String isoNow() {
  struct tm t;
  if (!getLocalTime(&t)) return "1970-01-01T00:00:00Z";
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

void loop() {
  float tds = 250 + random(0, 50);  // replace with the TDS probe reading
  String body = String("{\"id\":\"") + DEVICE + "-" + (++seq) +
                "\",\"device\":\"" + DEVICE + "\",\"block\":\"" + BLOCK +
                "\",\"time\":\"" + isoNow() + "\",\"kind\":\"water\",\"values\":{\"tds_ppm\":" +
                String(tds, 0) + ",\"turbidity_ntu\":1.2},\"source\":\"live\"}";  // real hardware says "live"
  HTTPClient http;
  http.begin(API);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf("POST %d: %s\n", code, http.getString().c_str());
  http.end();
  delay(10000);
}
