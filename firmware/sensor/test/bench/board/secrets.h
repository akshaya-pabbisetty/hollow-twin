// The bench's secrets: the API address and the key come from the environment (bench.mjs sets them per run).
#pragma once
#include <cstdlib>
inline const char* benchEnv(const char* k, const char* d) { const char* v = std::getenv(k); return v ? v : d; }
#define WIFI_SSID "bench"
#define WIFI_PASSWORD "bench"
#define API_URL benchEnv("BENCH_API", "http://127.0.0.1:1")
#define DEVICE_KEY benchEnv("BENCH_KEY", "")
#define INGEST_KEY ""
