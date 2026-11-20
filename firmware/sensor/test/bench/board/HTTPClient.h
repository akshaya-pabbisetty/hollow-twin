// A real HTTP/1.1 client over a socket, behind arduino-esp32's HTTPClient signatures: the bench's node really talks
// to the real API. Wi-Fi down or the API "down" returns -1, as HTTPClient does for a refused connection.
#pragma once
#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>
#include "WiFi.h"

class HTTPClient {
 public:
  bool begin(WiFiClient&, String url) {
    std::string u = url.str();
    if (u.compare(0, 7, "http://") != 0) return false;  // the bench uses http; https is not simulated
    u = u.substr(7);
    size_t slash = u.find('/');
    std::string hostport = u.substr(0, slash);
    path_ = slash == std::string::npos ? "/" : u.substr(slash);
    size_t colon = hostport.find(':');
    host_ = hostport.substr(0, colon);
    port_ = colon == std::string::npos ? "80" : hostport.substr(colon + 1);
    headers_.clear();
    return true;
  }
  void setConnectTimeout(int32_t ms) { connectTimeout_ = ms; }
  void setTimeout(uint16_t ms) { timeout_ = ms; }
  void addHeader(const String& k, const String& v, bool = false, bool = true) { headers_ += k.str() + ": " + v.str() + "\r\n"; }
  int POST(String body) { return request("POST", body.str()); }
  int GET() { return request("GET", ""); }
  String getString() { return String(body_); }
  void end() {}

 private:
  int request(const char* method, const std::string& body) {
    W().httpCalls++;
    W().virtUs += 40000;  // a request takes some time on Wi-Fi
    if (!W().wifiUp || !W().apiUp) return -1;
    addrinfo hints = {}, *res = nullptr;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    if (getaddrinfo(host_.c_str(), port_.c_str(), &hints, &res) != 0) return -1;
    int fd = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    if (fd < 0 || connect(fd, res->ai_addr, res->ai_addrlen) != 0) { freeaddrinfo(res); if (fd >= 0) close(fd); return -1; }
    freeaddrinfo(res);
    std::string req = std::string(method) + " " + path_ + " HTTP/1.1\r\nHost: " + host_ + "\r\nConnection: close\r\n" + headers_;
    if (!body.empty() || std::string(method) == "POST") req += "Content-Length: " + std::to_string(body.size()) + "\r\n";
    req += "\r\n" + body;
    size_t sent = 0;
    while (sent < req.size()) { ssize_t n = send(fd, req.data() + sent, req.size() - sent, 0); if (n <= 0) break; sent += n; }
    std::string resp;
    char buf[8192];
    ssize_t n;
    while ((n = recv(fd, buf, sizeof buf, 0)) > 0) resp.append(buf, n);
    close(fd);
    size_t sp = resp.find(' '), hdrEnd = resp.find("\r\n\r\n");
    if (sp == std::string::npos || hdrEnd == std::string::npos) return -1;
    int status = std::atoi(resp.c_str() + sp + 1);
    std::string head = resp.substr(0, hdrEnd), raw = resp.substr(hdrEnd + 4);
    for (auto& c : head) c = (char)tolower(c);
    body_ = head.find("transfer-encoding: chunked") != std::string::npos ? dechunk(raw) : raw;
    return status;
  }
  static std::string dechunk(const std::string& s) {
    std::string out;
    size_t i = 0;
    while (i < s.size()) {
      size_t eol = s.find("\r\n", i);
      if (eol == std::string::npos) break;
      size_t len = std::strtoul(s.substr(i, eol - i).c_str(), nullptr, 16);
      if (len == 0) break;
      out += s.substr(eol + 2, len);
      i = eol + 2 + len + 2;
    }
    return out;
  }
  std::string host_, port_, path_, headers_, body_;
  int32_t connectTimeout_ = 0;
  uint16_t timeout_ = 0;
};
