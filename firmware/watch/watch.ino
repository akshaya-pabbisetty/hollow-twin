// Hollow Twin watch: the simplest device that can say "I'm OK".
//
// Runs on any Arduino with a USB serial port (Uno, Nano, Mega, Leonardo). No libraries, no Wi-Fi, no clock.
// It talks to the relay box (a Raspberry Pi running firmware/relay/relay.py) over the USB cable. The relay
// stamps the time, signs the message and carries it to the API, or holds it while the network is down.
//
// Wiring. Buttons go between the pin and GND; the pins use the built-in pull-ups, so no resistors.
//   pin 2  -> button -> GND      "I'm OK"
//   pin 3  -> button -> GND      "Help"                  (optional)
//   pin 8  -> buzzer -> GND      warnings from the API   (optional)
//   No buttons? Touch a jumper wire from pin 2 to GND.
//
// The on-board LED shows the link to the outside:
//   on           the relay reached the API
//   slow blink   the network is down and the relay is holding messages
//   off          no relay is listening
//   fast flicker a warning just arrived
//
// What it sends to the relay, one line each:
//   HELLO watch                 after a reset
//   BTN ok <n>                  "I'm OK" pressed, n counts presses since the reset
//   BTN help <n>                "Help" pressed
// What the relay sends back:
//   NET up <held>               the API is reachable; <held> messages are still waiting
//   NET down <held>             the API is not reachable
//   ACK <n> sent | held         what happened to press n
//   ALERT info|warn|danger <text>

const uint8_t PIN_OK = 2;
const uint8_t PIN_HELP = 3;
const uint8_t PIN_BUZZER = 8;
const unsigned long DEBOUNCE_MS = 40;
const unsigned long RELAY_SILENT_MS = 15000; // no word from the relay for this long: treat it as gone

enum Net { NET_NONE, NET_UP, NET_DOWN };
Net net = NET_NONE;
unsigned long lastHeard = 0;

struct Button { uint8_t pin; const char *name; bool down; unsigned long changedAt; };
Button buttons[] = { { PIN_OK, "ok", false, 0 }, { PIN_HELP, "help", false, 0 } };
unsigned int presses = 0;

char line[96];
uint8_t lineLen = 0;

// a warning plays as a few beeps while the LED flickers; none of it blocks the buttons
uint8_t beepsLeft = 0;
unsigned int beepMs = 0;
bool beepOn = false;
unsigned long beepAt = 0;
unsigned long flickerUntil = 0;
unsigned long ackUntil = 0;

void startAlert(uint8_t beeps, unsigned int ms) {
  beepsLeft = beeps; beepMs = ms; beepOn = false; beepAt = 0;
  flickerUntil = millis() + 3000;
}

void handleLine() {
  lastHeard = millis();
  if (strncmp(line, "NET up", 6) == 0) net = NET_UP;
  else if (strncmp(line, "NET down", 8) == 0) net = NET_DOWN;
  else if (strncmp(line, "ACK ", 4) == 0) ackUntil = millis() + 150;
  else if (strncmp(line, "ALERT danger", 12) == 0) startAlert(3, 400);
  else if (strncmp(line, "ALERT warn", 10) == 0) startAlert(2, 200);
  else if (strncmp(line, "ALERT info", 10) == 0) startAlert(1, 120);
}

void readRelay() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (lineLen) { line[lineLen] = 0; handleLine(); lineLen = 0; }
    } else if (lineLen < sizeof(line) - 1) line[lineLen++] = c;
  }
}

void readButtons() {
  unsigned long now = millis();
  for (uint8_t i = 0; i < sizeof(buttons) / sizeof(buttons[0]); i++) {
    Button &b = buttons[i];
    bool down = digitalRead(b.pin) == LOW;
    if (down != b.down && now - b.changedAt > DEBOUNCE_MS) {
      b.down = down; b.changedAt = now;
      if (down) {
        Serial.print(F("BTN ")); Serial.print(b.name); Serial.print(' '); Serial.println(++presses);
      }
    }
  }
}

void playAlert() {
  unsigned long now = millis();
  if (!beepsLeft && !beepOn) return;
  if (now < beepAt) return;
  if (!beepOn) { tone(PIN_BUZZER, 2200); beepOn = true; beepAt = now + beepMs; }
  else { noTone(PIN_BUZZER); beepOn = false; beepsLeft--; beepAt = now + 150; }
}

void showLink() {
  unsigned long now = millis();
  if (now - lastHeard > RELAY_SILENT_MS) net = NET_NONE;
  bool on;
  if (now < flickerUntil) on = (now / 60) % 2;            // a warning just arrived
  else if (now < ackUntil) on = (net != NET_UP);          // a short wink: the relay took the press
  else if (net == NET_UP) on = true;
  else if (net == NET_DOWN) on = (now / 500) % 2;         // holding messages
  else on = false;
  digitalWrite(LED_BUILTIN, on ? HIGH : LOW);
}

void setup() {
  pinMode(PIN_OK, INPUT_PULLUP);
  pinMode(PIN_HELP, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
  Serial.println(F("HELLO watch"));
}

void loop() {
  readRelay();
  readButtons();
  playAlert();
  showLink();
}
