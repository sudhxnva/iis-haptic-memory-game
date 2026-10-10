#include <cassert>
#include <deque>
#include <sstream>
#include <string>
#include <cstdint>
#include <algorithm>
#define OUTPUT 1
#define INPUT 0
#define INPUT_PULLUP 2
#define HIGH 1
#define LOW 0
#define ADC_11db 3
uint32_t fakeNow=0;
int outputs[40]={0}, raw[40]={0};
bool overlappingEnables=false;
uint32_t millis() { return fakeNow; }
void pinMode(int,int) {}
void digitalWrite(int pin,int value) { outputs[pin]=value; }
int digitalRead(int pin) { return pin==17 ? raw[pin] : outputs[pin]; }
int analogRead(int pin) { return raw[pin]; }
void analogWrite(int pin,unsigned value) { outputs[pin]=value; if(outputs[13] && outputs[25]) overlappingEnables=true; }
void analogReadResolution(int) {}
void analogSetPinAttenuation(int,int) {}
float constrain(float x,float a,float b) { return std::max(a,std::min(b,x)); }
struct FakeSerial {
  std::deque<char> input; std::ostringstream output;
  void begin(int) {} int available() { return input.size(); }
  char read() { char c=input.front(); input.pop_front(); return c; }
  template<typename T> void print(T value) { output<<value; }
  void print(float value,int) { output<<value; }
  template<typename T> void println(T value) { output<<value<<'\n'; }
  void feed(const std::string& s) { for(char c:s) input.push_back(c); }
  std::string take() { auto s=output.str(); output.str(""); return s; }
} Serial;
#include "../vibration-lab.ino"
void send(const std::string& line) { Serial.feed(line+"\n"); while(Serial.available()) loop(); }
void advance(uint32_t amount) { fakeNow+=amount; loop(); }
int main() {
  raw[36]=raw[39]=2048; raw[17]=1; setup(); assert(outputs[13]==0 && outputs[25]==0);
  assert(outputs[12]==0 && outputs[14]==0 && outputs[27]==0 && outputs[26]==0);
  send("STATUS"); assert(Serial.take().find("PINS 13=0 12=0 14=0 25=0 27=0 26=0")!=std::string::npos);
  send("HELLO"); assert(Serial.take().find("READY 2")!=std::string::npos);
  send("CAL"); for(int i=0;i<40;i++) advance(20); assert(calibrated);
  assert(Serial.take().find("CALIBRATED 2048 2048")!=std::string::npos);
  send("PLAY 7 R 180 300 600 200"); assert(outputs[13]==200 && outputs[25]==0);
  advance(180); assert(outputs[13]==0 && outputs[25]==0 && outputs[12]==0 && outputs[27]==0);
  advance(299); assert(outputs[13]==0 && outputs[25]==0);
  advance(1); assert(outputs[13]==0 && outputs[25]==200);
  send("STOP"); assert(outputs[13]==0 && outputs[25]==0);
  assert(outputs[12]==0 && outputs[14]==0 && outputs[27]==0 && outputs[26]==0);
  send("PLAY 8 L 180 300 600 200"); assert(outputs[25]==200);
  advance(480); assert(outputs[13]==200 && outputs[25]==0);
  assert(!overlappingEnables);
  send("PLAY 9 LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL 180 300 600 200"); assert(!playback.active && outputs[25]==0);
  send("PLAY 10 LR 180 300 600 200"); send(std::string(200,'Z')); assert(!playback.active);
  assert(Serial.take().find("line_too_long")!=std::string::npos);
  send("PING"); send("PLAY 11 R 180 300 600 200"); advance(1260); assert(!playback.active);
  assert(Serial.take().find("DONE 11")!=std::string::npos);
  send("ARM 11"); advance(20); assert(Serial.take().find("CENTER 11")!=std::string::npos);
  raw[36]=0; for(int i=0;i<10;i++) advance(20);
  auto events=Serial.take(); assert(events.find("INPUT 11 L")!=std::string::npos);
  for(int i=0;i<10;i++) advance(20); assert(Serial.take().find("INPUT")==std::string::npos);
  raw[36]=2048; for(int i=0;i<10;i++) advance(20); Serial.take();
  raw[36]=0; for(int i=0;i<10;i++) advance(20); assert(Serial.take().find("INPUT 11 L")!=std::string::npos);
  send("PING"); send("PLAY 12 RRRRRRRR 180 300 600 200"); advance(2600);
  assert(!session && !armed && outputs[13]==0 && outputs[25]==0);
  assert(outputs[12]==0 && outputs[14]==0 && outputs[27]==0 && outputs[26]==0);
  assert(Serial.take().find("heartbeat_timeout")!=std::string::npos);
  send("HELLO"); send("CAL"); send("STOP"); assert(!calibrating);
}
