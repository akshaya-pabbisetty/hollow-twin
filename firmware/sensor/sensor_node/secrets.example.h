// secrets.example.h: copy this file to secrets.h (git ignores secrets.h) and fill it in.
// The sketch builds without secrets.h, using these placeholders, so the board still runs and holds its readings
// (it cannot reach the API until the Wi-Fi details are real).
#ifndef HOLLOW_SECRETS_H
#define HOLLOW_SECRETS_H

#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// The API, with no slash at the end: http://<laptop-ip>:8787 on the bench, or the hosted https address.
#define API_URL "http://192.168.1.50:8787"

// This node's secret, shared with the API (DEVICE_KEYS={"sensor-l7-chalk-cut":"<same secret>"}). With a key the
// API stores readings as verified and refuses anything forged in this node's name; leave it "" to send unsigned
// (accepted, but marked unverified). Use a long random string, e.g. from: node -e "console.log(crypto.randomUUID())"
#define DEVICE_KEY ""

// Only if the API was started with INGEST_KEY; otherwise leave it "".
#define INGEST_KEY ""

#endif  // HOLLOW_SECRETS_H
