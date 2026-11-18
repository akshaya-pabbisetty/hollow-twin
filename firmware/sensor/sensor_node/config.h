// config.h: what this node is, and how it is wired. Change these for your board. Secrets (Wi-Fi password, the
// device key) do NOT go here: copy secrets.example.h to secrets.h, which git ignores.
#ifndef HOLLOW_CONFIG_H
#define HOLLOW_CONFIG_H

// ---- Which block this node sits in: one of the 70 ids in contract/blocks.json. The device id follows the
// contract: sensor-<block id> (CONTRACT.md section 3). The API needs the same id in DEVICE_KEYS to verify it.
#define BLOCK_ID "l7-chalk-cut"
#define DEVICE_ID "sensor-" BLOCK_ID

// ---- Which sensors are fitted. Set a 0 for any you do not have; the node sends the rest.
#ifndef HAS_TDS
#define HAS_TDS 1        // DFRobot Gravity TDS (SEN0244) or a clone
#endif
#ifndef HAS_TURBIDITY
#define HAS_TURBIDITY 1  // DFRobot turbidity (SEN0189) or a clone
#endif
#ifndef HAS_SCD40
#define HAS_SCD40 1      // Sensirion SCD40 or SCD41 (CO2, temperature, humidity) on I2C
#endif
#ifndef HAS_FLOOD
#define HAS_FLOOD 1      // HC-SR04 or waterproof JSN-SR04T ultrasonic, pointing down at the tunnel floor
#endif

// ---- Pins (ESP32 DevKit). Analog sensors MUST be on ADC1 pins (32 to 39): ADC2 stops working while Wi-Fi is on.
#define PIN_TDS 34        // ADC1: TDS board output (0 to 2.3 V; power the board from 3.3 V)
#define PIN_TURBIDITY 35  // ADC1: turbidity output THROUGH a divider (the probe gives up to 4.5 V; the ESP32 takes 3.3)
#define PIN_SDA 21        // I2C to the SCD40
#define PIN_SCL 22
#define PIN_TRIG 5        // ultrasonic trigger (3.3 V is enough)
#define PIN_ECHO 18       // ultrasonic echo THROUGH a divider (the sensor answers at 5 V)
#define PIN_STATUS_LED 2  // the DevKit's own blue LED: on = API reachable, blinking = holding messages
#define PIN_ALARM_LED 25  // red LED (with a resistor): on = danger, slow blink = warning
#define PIN_BUZZER 26     // ACTIVE buzzer module (it beeps on its own when the pin is high)

// ---- Analog front end
// The turbidity divider: probe volts = pin volts x TURBIDITY_DIVIDER. With 10 kOhm (top) and 20 kOhm (bottom):
// (10 + 20) / 20 = 1.5, so 4.5 V at the probe is 3.0 V at the pin.
#define TURBIDITY_DIVIDER 1.5
#define ADC_SAMPLES 32            // readings averaged per analog measurement (median of 3 averages)
#define TURBIDITY_ADC_SAMPLES 256 // the turbidity probe needs far more: 3.7 NTU per millivolt near clear water
// Below this the turbidity probe cannot tell clear water from slightly cloudy on an ESP32 (its few millivolts of
// ADC noise and drift are 10 NTU or more there), so the node reports 0 below it. Visibly cloudy water is far above.
// A design choice for this probe, not a safety limit: the limit (US EPA, 5 NTU) comes from the API.
#define TURBIDITY_DETECTION_LIMIT_NTU 20.0

// ---- Water temperature for TDS compensation. The node has no water thermometer; room-temperature tap water is
// close enough (2% per degree). Change it from the serial monitor with: watertemp 21
#define DEFAULT_WATER_TEMP_C 22.0

// ---- Flood sensor: its height above the dry tunnel floor, in cm. 0 = not set: the node sends NO flood reading
// until it knows, because a wrong height reports a dry floor as flooded. Put the sensor in place over a dry floor and
// type `cal floor` in the serial monitor (saved in flash), or write the measured height here.
// HC-SR04 reads from 2 cm; the JSN-SR04T only from about 25 cm.
#define DEFAULT_MOUNT_HEIGHT_CM 0.0

// ---- When to send (see hollow_core.h, SendRule): each kind once a minute, or at once (at most every 3 s) when a
// value moves this much. These are reporting choices, not safety limits; the limits come from the API.
#define SAMPLE_MS 2000
#define PERIOD_S 60
#define MIN_GAP_S 3
#define DELTA_TDS_PPM 50
#define DELTA_TURBIDITY_NTU 10.0  // above the detection limit, in whole NTU
#define DELTA_CO2_PPM 100
#define DELTA_AIR_TEMP_C 1.0
#define DELTA_HUMIDITY_PCT 5.0
#define DELTA_FLOOD_CM 2.0

// ---- Backlog while the API is unreachable: about 330 bytes a message, so 300 messages is about 100 KB of RAM,
// over an hour of all four sensors at one message a minute each. Uploaded 50 per request.
#define BACKLOG_MAX 300
#define BATCH_MAX 50
#define LIMITS_REFRESH_MS (30UL * 60UL * 1000UL)

#endif  // HOLLOW_CONFIG_H
