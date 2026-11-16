# Zeblaze Btalk 4 Pro ↔ Zeblaze Connect — Verified BLE Protocol & Hardware Reference

> **Version:** 2.2.0 (2026-11-16) — Health re-verification over wireless ADB (supersedes v2.1.0)
> **Device:** Zeblaze Btalk 4 Pro, address `FD:99:E2:BB:76:D0` (dual-mode: same address for BLE and BR/EDR), firmware **1.10**
> **Official app:** `com.watch.zeblaze` v1.1.0 (versionCode 12), bundled SDK `com.antjy.sdk.*` + Jieli SDK `com.jieli.*`
> **Test phone:** POCO X3 Pro, Android 12, HCI snoop log = full

## 0. How this document was verified

Every protocol fact below is tagged:

| Tag | Meaning |
|-----|---------|
| ✅ **LIVE** | Seen byte-for-byte in a live HCI capture of the *official* app talking to this watch **and** matches the SDK bytecode |
| 🟦 **DEX** | Read directly from the official SDK bytecode (`dexdump -d` of `classes.dex`), not yet seen live |
| ⚠️ **UNVERIFIED** | Marketing / third-party claim; no evidence on the device or in the app |

Evidence:
* Bytecode: [`official_app/classes.dex`](official_app/classes.dex) (from [`official_app/zeblaze_connect_base.apk`](official_app/zeblaze_connect_base.apk)), disassembled with Android build-tools `dexdump -d`. Method names below are the obfuscated SDK names (e.g. `DeviceReportEventParser.a(B[B)V @0x01af` = bytecode PC).
* Live captures:
  * Fresh verified session: [`captures/official_app_session_fresh.txt`](captures/official_app_session_fresh.txt) & [`captures/test_time_marks_fresh.txt`](captures/test_time_marks_fresh.txt), decoded from full snoop [`captures/btsnoop_hci_fresh.log`](captures/btsnoop_hci_fresh.log) with [`tools/btsnoop-att.js`](tools/btsnoop-att.js). Tests executed: single HR measurement (86 bpm), single SpO2 measurement (98 %), 24h continuous HR toggle (01 35), full pull-down health sync (steps 44, sleep 0, HR 24h history).
  * **Health verification run (v2.2.0, 21:36–21:52, wireless ADB):** notes [`captures/health_verification_2026-11-16.md`](captures/health_verification_2026-11-16.md), snoop [`captures/btsnoop_hci_health_2026-11-16_2136.log`](captures/btsnoop_hci_health_2026-11-16_2136.log), decoded [`captures/att_health_2026-11-16_2136.txt`](captures/att_health_2026-11-16_2136.txt). Bluetooth was turned on fresh at 21:36:40, so the log holds only this session. HR 66/78 bpm, SpO2 97/99 %, sync with 4673 steps and 58 HR slots. All 65 0xAA CRCs pass. History decoded with [`tools/verify-analyze.js`](tools/verify-analyze.js). Screenshots: `screenshots/29_…`, `30_…`, `31_…`.
  * Prior reference session: archived in `old/captures_prev/`.
  * Live screenshots: [`screenshots/08_hr_single_result.png`](screenshots/08_hr_single_result.png) (HR 86 bpm), [`screenshots/11_spo2_done_result.png`](screenshots/11_spo2_done_result.png) (SpO2 98 %), [`screenshots/14_home_synced.png`](screenshots/14_home_synced.png) (synced dashboard).

> **Why v1.1.0 was wrong in places:** its byte-level "evidence" (`scratch/all_att_packets.txt`, `btsnoop_hr.txt`) came from the truncated `dumpsys bluetooth_manager` *BTSNOOP_LOG_SUMMARY*, parsed without L2CAP reassembly. That splices HCI/L2CAP headers into payloads (e.g. `… 06 20 0c 00 08 00 04 00 1b 18 00 …` is an ACL+L2CAP+ATT header, not data), which produced the fake `04 08` / `0F 00` bytes. In addition, many "captured" commands (`00 33 04 08`, `FE EA 10 …`) were sent by **our own React Native app** (`src/bleConstants.ts`), not by Zeblaze Connect; the watch never answers them.

---

## 1. Hardware

| Item | Status | Notes |
|------|--------|-------|
| Dual-mode Bluetooth (BLE + BR/EDR) | ✅ | Bonded as `[DUAL] Btalk 4 Pro`; eSCO (call audio) and BLE GATT links both observed in `dumpsys bluetooth_manager`. ATT MTU negotiated to 247 (`0xF7`). |
| Jieli platform | ✅ | Watch's own function list reports platform = 1 = JIELI (§9). App bundles the Jieli SDK (`com.jieli.jl`, `com.jieli.ota`, `com.jieli.bmp`) and the antjy SDK has a Jieli GATT profile (`AE00/AE01/AE02`). |
| Exact SoC part "AC7013 / JL7013A", "BLE 5.3" | ⚠️ | No evidence found in app or device. No public spec sheet names the chip. |
| Optical HR + SpO2 sensor | ✅ functional | Live single-measurement results (HR 127 bpm, SpO2 99 % and 88 %) and real-time HR stream received. |
| "4-LED + 4-PD OHR Fusion", "Tianyi Hexin", 525/660/940 nm, "HR Algorithm 2.0" | ⚠️ | Not verifiable from software. (v1.1.0's diagram even drew 3 PDs while claiming 4.) |
| 3-axis accelerometer, 3-axis gyroscope | ⚠️ (retail listing) | Listed by retailers. Step reports exist in protocol (§6.1). The DSP pedometer details in v1.1.0 (10-step hysteresis etc.) are generic and unverified. |
| Version block (`00 0E`) | ✅ | productId **3**, projectId **350**, boot **1.0**, firmware **1.10**, image **1.7**, font **1.2** (§5.1). |

The PPG / pulse-oximetry physics in v1.1.0 §1.2 (AC/DC ratio-of-ratios `R`, Beer-Lambert) is correct *general* background, but nothing on the wire exposes raw PPG. The watch only sends finished values.

---

## 2. Official app architecture (`com.antjy.sdk`)

```
BluetoothGattCallback
  └─ BytesDataConnect.j()  ← onCharacteristicChanged (FF03)
       └─ BytesDataConnect.L([B)   – logs "接收到蓝牙数据", multi-pack wait via MultiPackParseUtil
            └─ EventParseHandler.a([B)   – requires len ≥ 4; routes on byte[0], passes byte[1] as key
                 ├─ 0x00 → DeviceInfoEventParser
                 ├─ 0x01 → DeviceSetEventParser
                 ├─ 0x02 → DeviceRemindEventParser
                 ├─ 0x03 → SyncDataV1EventParser   (→ MultiPackParseUtil)
                 ├─ 0x04 → DeviceTestEventParser
                 ├─ 0x05 → DeviceOtaEventParser
                 ├─ 0x80 → DeviceReportEventParser (unsolicited watch→phone events)
                 └─ 0xAA → MultiPackEventParser    (→ NewBaseMultiPackParser)
Outgoing: BaseCmd (ReadCmd / WriteCmd / MultiPackCmd …) → queue → BytesDataConnect.I() → O([B) → writeCharacteristic(FF02)
```
Source: `EventParseHandler.<clinit>` and `EventParseHandler.a([B)V` ✅. The command queue is serial: one command in flight, a timeout from `BLEProtocolConfig.b` (2000 ms for `MessageCmd`), retry on write failure (`BytesDataConnect.M`).

**v1.1.0's diagram was wrong:** `0x00` is not a step parser, there is no "`0x00/0x33` StepDataParser" route, and `StepDataParser` lives in `com.antjy.sdk.util.parser.version.v1/v2`, not `protocol.parser.data`.

---

## 3. GATT transport

The SDK knows three profiles (`UUIDConfig.<clinit>` 🟦). This watch uses **profile B** (✅ writes to handle `0x0016`, notifications from `0x0018`, CCCD `0x0019` ← `01 00`):

| Profile | Service | Write | Notify |
|---|---|---|---|
| A (Nordic UART) | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` | `6e400002-…` | `6e400003-…` |
| **B (this watch)** | `000001ff-3c17-d293-8e48-14fe2e4da212` | `0000ff02-0000-1000-8000-00805f9b34fb` | `0000ff03-0000-1000-8000-00805f9b34fb` |
| C (Jieli) | `0000ae00-0000-1000-8000-00805f9b34fb` | `0000ae01-…` | `0000ae02-…` |

CCCD `00002902-0000-1000-8000-00805f9b34fb`. The app writes with `writeCharacteristic` (write-without-response on FF02 ✅ `ATT Write Command`). The watch requests MTU 247. The app requests 512 and settles on 247 ✅.

---

## 4. Frame format (groups 0x00–0x05, 0x80)

Built by `BaseCmdWrapper.createCmd(BB[B)` + `createDataCmd(I)` 🟦, confirmed ✅:

```
Phone → watch:   [group] [key] [len] [0x00] [param0] [param1] …
Watch → phone:   [group] [key|0x80] [len] [0x00] [status] [data0] …
```

| Byte | Meaning |
|---|---|
| 0 | **group** (router key, §2) |
| 1 | **key / command id**. Responses set bit 7 (`0x08` → `0x88`). |
| 2 | **total frame length** (`createDataCmd(n)` stores `n+2`). Plain reads use the fixed payload `04 00`. Some multi-chunk responses reuse this byte as a chunk index (§8.2). |
| 3 | `0x00` (always zero in every captured frame) |
| 4 | **status** in responses (`0x01` = OK). It is the 1st parameter in commands. Event parsers forward `byte[4]` as the result code (`BaseEventParser.d/e`). |
| 5… | data |

Multi-byte numbers are **little-endian unsigned** (`ByteDataConvertUtil.f([BII)I` 🟦). Exceptions are noted inline. There is **no checksum** in this frame format; 0xAA frames have one (§8).

---

## 5. Command catalogue

### 5.1 Group 0x00 — device info (`DeviceInfoCmdWrapper`, `DeviceInfoEventParser` packed-switch @0x0010)

| Request | Response key | Meaning | Response decoding | Status |
|---|---|---|---|---|
| `00 00 04 00` | `0x80` | Device name | ASCII from byte 5 (`StringUtil.a` = `b(bytes,5)`) | 🟦 |
| `00 02 04 00` | `0x82` | Firmware version | ASCII from byte 5. Live: `00 82 09 00 01 31 2E 31 30` = **"1.10"** | ✅ |
| `00 04 04 00` | `0x84` | Serial number | ASCII from byte 5 | 🟦 |
| `00 06 04 00` | `0x86` | **MAC address** | 6 bytes from byte 5 | 🟦 |
| `00 08 04 00` | `0x88` | **Battery %** | `byte[5]`. Live: `00 88 06 00 01 39` = **57 %**, `…3A` = 58 %, `…34` = 52 % (app shows 52 %, 21:43:36) | ✅ |
| `00 09 0B 00 YY yy MM DD hh mm ss` | `0x89` | Set time | `YY`=year/100, `yy`=year%100. Live: `00 09 0B 00 14 1A 0B 10 10 07 03` = 2026-11-16 16:07:03 | ✅ |
| `00 0A 04 00` | `0x8A` | Function list (new style) | → callback type 6 | 🟦 |
| `00 0C 04 00` / `00 0D …` | `0x8C` / `0x8D` | Get / set all settings | | 🟦 |
| `00 0E 04 00` | `0x8E` | **Version block** (*not* MAC) | productId=u16@5, projectId=u16@7, boot=`b9.b10`, firmware=`b11.b12`, image=`b13.b14`, font=`b15.b16`. Live: `00 8E 11 00 01 03 00 5E 01 01 00 01 0A 01 07 01 02` → 3 / 350 / 1.0 / 1.10 / 1.7 / 1.2 | ✅ |

### 5.2 Group 0x01 — settings (`DeviceSetCmdWrapper`, `DeviceSetEventParser` packed-switch @0x0010, 66 keys)

Request key = response key & 0x7F. Response `01 <key|80> 05 00 01` = OK.

| Key | Function | Command bytes | Status |
|---|---|---|---|
| 0x00 / 0x01 | Get / set user profile | | 🟦 |
| 0x02 / 0x03 | Get / set 12/24 h format | | 🟦 |
| 0x04 / 0x05 | Get / set metric-imperial | `01 05 05 00 00` (metric) | ✅ |
| 0x07 | Set weather | | 🟦 |
| 0x0B | Find watch | `01 0B 04 00` → ack `01 8B 05 00 01` | ✅ |
| 0x0C / 0x0D | Get / set raise-to-wake | `01 0D 05 00 <0/1>` → ack `01 8D 05 00 01` | ✅ |
| 0x0E / 0x0F | Get / set brightness | | 🟦 |
| 0x12 / 0x13 | Get / set alarms | | 🟦 |
| 0x14 / 0x15 | Get / set language | `01 14 04 00` → `01 94 06 00 01 00` | ✅ |
| 0x16 / 0x17 | Get / set step goal | `01 17 08 00 10 27 00 00` = 10000 (u32 LE @4) | ✅ |
| 0x1A / 0x1B | Get / set wearing hand | | 🟦 |
| **0x1D** | **Start/stop single measurement** | `01 1D 06 00 <type> <on>` (`M(IZ)`) — §7 | ✅ |
| 0x1E / 0x1F | Get / set exercise mode | | 🟦 |
| 0x22 / 0x23 | Get / set time zone | | 🟦 |
| 0x25 | Set phone type | `01 25 05 00 01` (Android) | ✅ |
| 0x28 / **0x29** | Get / set **weather temperature unit** | `01 29 05 00 00` | ✅ |
| **0x2B** | **Set real-time report flag** (`J(I)`) | `01 2B 05 00 01` (official app sends `01` at connect) | ✅ |
| 0x2C / 0x2D | Get / set custom dial | `01 2C 04 00` → `01 AC 0B 00 01 …` | ✅ |
| 0x32 / 0x33 | Get / set screen-on time | `01 32 04 00` → `01 B2 05 00 05` (5s) | ✅ |
| 0x34 / **0x35** | Get / set **24 h HR monitoring** (`x(Z)`) | Get: `01 34 04 00` → `01 B4 06 00 01 <0/1>` (value @5) ✅ v2.2.0. Set: `01 35 05 00 <0/1>` → ack `01 B5 05 00 01` (✅ 17:38–17:39). In the 21:46 run the switch was toggled but the screen's ✓ save was never pressed, so nothing was sent. That is expected, not a contradiction. | ✅ |
| 0x37 | Camera mode enter/exit | | 🟦 |
| 0x39 | Set UUID / bind token | `01 39 14 00 <16 bytes>` | ✅ |
| 0x3A | Query BT (classic) connection switch | | 🟦 |
| 0x3D / 0x3F / 0x41 | Clear all data / bind / unbind | | 🟦 |

### 5.3 Group 0x02 — reminders (`DeviceRemindEventParser` @0x001d)
0x01 message/notification switches (live `02 01 06 00 FC FF 00 07 FF FF`, ✅ ack `02 81 05 00 01`; note its length byte is 6 while the frame is 10 bytes), 0x03 sedentary, 0x04/0x05 anti-loss, 0x07 do-not-disturb, 0x09 HR alarm, 0x0A/0x0B menstrual cycle, 0x0D hand-wash, 0x0F drink water, 0x13 contacts, 0x15 low-battery, 0x17 LED params, 0x1B vibration, 0x1C/0x1D LED custom, 0x1E vibration custom. 🟦

### 5.4 Group 0x05 — OTA
`05 03 06 00 xx xx` → `05 83 08 00 00 01 F1 14` and spontaneous `05 81 0A 00 F4 00 F4 00 A3 66` at connect ✅ (bytes seen, semantics not decoded; `DeviceOtaEventParser` keys 0x80/0x82/0x83/0x85/0x86/0x87 "OtaUpdate 升级中").

---

## 6. Group 0x80 — watch-initiated reports (`DeviceReportEventParser.a(B[B)V`)

| Key | Event | Decoding (byte offsets) | Status |
|---|---|---|---|
| **0x80** | Real-time activity | 13 bytes `80 80 0D 00 <st> S0 S1 S2 S3 D0 D1 C0 C1`: steps u32@5, distance m u16@9, kcal u16@11 (PC 0x0435) | ✅ (`80 80 0D 00 01 00…` = 0 steps; `…41 12 00 00 E0 0C BD 00` = 4673 steps / 3296 m / 189 kcal = app dashboard. Sent at connect and every ~3 s while walking.) |
| **0x82** | Real-time heart rate | 7 bytes `80 82 07 00 01 <bpm> 00`: bpm = `byte[5]` (PC 0x0411) | ✅ (`…5D 00` = 93 bpm, streamed every ~3 s) |
| **0x84** | Single-measurement status/result | §7 | ✅ |
| 0x86 | Exercise ended on watch | `ExerciseStateEnum(byte[5])` | 🟦 |
| 0x88 / 0x89 / 0x8A | Find phone / stop finding / take photo | (packed-switch @0x0478) | 🟦 |
| 0x8C | Music control | `byte[5]`: `F0` enter, 01 play/pause, 04 next, 08 prev, 10 vol−, 20 vol+ | 🟦 |
| 0x8E | Incoming-call control | `byte[5]`: 0 reject, 1 answer | 🟦 |
| 0x94 | Generic flag (callback 109) | `byte[4]` key, `byte[5]==1` | 🟦 |
| 0x9A | Classic-BT status | `byte[5]==1` connected | 🟦 |
| 0x9C | Sport interaction | 14 bytes: u32@5, u32@9, u8@13 | 🟦 |

The real-time HR stream and real-time step stream are pushed by the watch. There is **no** "enable pedometer stream" command `01 29 05 0F 00`. `0x29` sets the weather unit. The official app only sends the real-time report flag `01 2B 05 00 01` at connect.

---

## 7. Single measurement (HR / SpO2 / BP / …)

### 7.1 Command — `DeviceSetCmdWrapper.M(int type, boolean on)` ✅
```
01 1D 06 00 <type> <on>        on: 01 = start, 00 = stop
```
| Action | Bytes | Live |
|---|---|---|
| Start heart rate | `01 1D 06 00 00 01` | ✅ 16:46:29, 16:51:01 |
| Stop heart rate | `01 1D 06 00 00 00` | 🟦 (the app never sends it: Back or tapping "Measuring..." sends nothing, and the watch finishes on its own) |
| Start SpO2 | `01 1D 06 00 02 01` | ✅ 16:52:23, 16:56:10 |
| Stop SpO2 | `01 1D 06 00 02 00` | 🟦 (same: no stop path in the app) |
| Start blood pressure | `01 1D 06 00 01 01` | 🟦 |

Ack: `01 9D 05 00 01`. There is no duration parameter, because the watch decides the duration (HR ≈ 13–21 s, SpO2 ≈ 25–28 s in the captures).

### 7.2 Report — `80 84 08 00 <status> <type> <v1> <v2>` (PC 0x01af, packed-switch @0x01c2 on `byte[5]`)

| Byte | Meaning |
|---|---|
| 4 | status: **`01` measuring**, **`02` complete**, **any other value (`00` seen live) = error / aborted** |
| 5 | type: `00` HR · `01` BP · `02` SpO2 · `03` ECG · `04` stress · `05` blood sugar · `06` body temperature |
| 6 | `v1` = `byte[6]` |
| 7 | `v2` = `byte[7]` |

Per type (SDK passes `(type, statusIdx, v1, v2)` to `MeasurePoster.t`):

| Type | Value | Live proof |
|---|---|---|
| HR | **bpm = byte 7** (byte 6 = 0) | `80 84 08 00 02 00 00 7F` → 127 bpm; `…00 56` → **86 bpm** (17:33:24); `…00 42` → 66 bpm, `…00 4E` → 78 bpm (21:39:49, 21:41:05) |
| SpO2 | **% = byte 7** (byte 6 = 0) | `80 84 08 00 02 02 00 63` → 99 %; `…00 58` → 88 %; `…00 62` → **98 %** (17:35:09); `…00 61` → 97 %, `…00 63` → 99 % (21:42:11, 21:43:26) |
| BP | SBP = byte 6, DBP = byte 7 | 🟦 (Not supported on watch hardware) |
| Stress | byte 6 / byte 7 | 🟦 (Not supported on watch hardware) |
| Blood sugar | `byte6/10`, `byte7/10` mmol/L | 🟦 (Not supported on watch hardware) |
| Temperature | `((byte6<<8)|byte7)/100` °C (**big-endian**: the SDK builds `[b7,b6]` and reads it LE) | 🟦 (Not supported on watch hardware) |

A full HR session looks like this ✅: `01 1D 06 00 00 01` → `80 84 08 00 01 00 00 00` (measuring) → `01 9D 05 00 01` (ack) → `80 84 08 00 02 00 00 56` (done, 86 bpm). A failed session ends with `80 84 08 00 00 00 00 00`.

---

## 8. History sync

The official app syncs history over the **0xAA "new multipack" channel** (`MultiPackageQueryCmdWrapper`, `NewMultiPackCmd`, `NewBaseMultiPackParser`). It does **not** use `00 33`.

### 8.1 0xAA frame ✅
```
[AA] [key] [len16 LE] [body …] [crcLo] [crcHi]
```
* `len16` = number of body bytes after the 4-byte header, excluding the CRC (e.g. a 118-byte frame `AA 05 70 00 …` → 0x70 = 112).
* **CRC-16/CCITT-FALSE** (poly 0x1021, init 0xFFFF, no reflection, no final XOR) over every byte from `AA` up to the CRC, stored **little-endian** (`CrcUtil.b/c`). It was checked on all 47 AA frames in the first capture and all 65 in the v2.2.0 capture, e.g. `AA 85 03 00 01 01 00` → `7D BA`. The receiver drops frames whose CRC doesn't match.
* **Fragmented responses:** if `byte[3] & 0x80`, the header is `AA key lenLo (0x80|lenHi) total16 index16(1-based)`. The payload starts at byte 8. Payloads are concatenated until `index == total`, then the length is checked against `lenLo | (lenHi<<8)`. Live: the HR sync arrives as `AA 05 25 81 02 00 01 00 …` + `AA 05 25 81 02 00 02 00 …` (234 + 59 = 293 = 0x125 bytes).
* **Ack frame:** `AA 01 02 00 <acked key> <status>`, e.g. `AA 01 02 00 85 01`. The meaning of the status byte is not verified; the SDK only logs it. Seen live: `00` after a set (`83 00`) and `01` after queries (`84 01`, `85 01`).
* **Set result (key 0x03):** `AA 03 04 00 <count> <id16> <result>`, where result `00` = OK (e.g. after the `AA 83 …` 82-byte settings write).

| Request key | Purpose | Body |
|---|---|---|
| `0x83` | Multi-param set (alarms/smart clock etc.) | `ParamMultiPackage` |
| `0x84` | Query by enum | `[n] [id16 LE × n]`. Live `AA 84 03 00 01 05 00 19 33` queries id 5 = `SMART_CLOCK`. |
| **`0x85`** | **Health history** | `[HealthEnum type] [dayCount] [dayOffset × dayCount]` (0 = today) |

### 8.2 Health-history request & response ✅
`HealthEnum`: **1 = steps**, **2 = heart rate**, **3 = sleep**, 4 = exercise, 5 = GPS, 6 = scuba, 7 = sleep-expand. (SpO2/BP/temperature history would come via key-6 measurement data, `TYPE_MEASURE_BO` etc. The app did not request it.)

Live sync sequence (16:45:33): `AA 85 03 00 01 01 00 7D BA` (steps, today) → `AA 85 03 00 03 01 00 1D D4` (sleep) → `AA 85 03 00 02 01 00 2D E3` (HR) → `AA 85 0C 00 04 0A 00 01 … 09 80 2E` (exercise, last 10 days).

Response payload (key `0x05`, after reassembly): `[type] [count]`, then `count ×` `[day u8] [length] [data]`. The length is u16 LE for types 2/3 and u8 for types 1/4 (`FF` → a u32 follows).

| Type | Record | Layout | Parser |
|---|---|---|---|
| 1 Steps | 108 bytes | 48 × u16 LE half-hour step counts @0–95, **total steps u32 @96**, **kcal u32 @100**, **distance m u32 @104** | `v2/StepDataParser.b` |
| 2 Heart rate | 288 bytes | one bpm byte per slot; valid if `0 < v < 255` (288 × 5-min slots; slot i = clock i×5 min, ✅ v2.2.0: last valid slot 258 = 21:30 in a 21:38 sync) | `v2/HRDataParser.b` |
| 3 Sleep | ≤ 360 bytes | 2 bits per minute, MSB-first: 0 awake, 1 light, 2 deep, 3 no data. Minute index i → clock `(i+720) % 1440`, i.e. the record starts at 12:00 (🟦, live record was empty) | `v2/SleepDataParser.b` |
| 4 Exercise | variable (u8 len) | Partly decoded (v2.2.0, one 32-byte record): **start** `u16 year, month, day, 00, hh, mm, ss` @0, then 8 unknown bytes @8, **end** datetime (same layout) @16, u32 @24 (unknown), **distance m u32 @28**. Live: 2026-11-16 19:39:11 → 20:22:04, 2596 m = app "19:39:11, 2.59 km" ✅. Unknown bytes `01 47 E6 09 5E 0E 00 00` and `A7 00 00 00` might be type 1, ~2534 s active, 3678 steps, 167 kcal; **guesses only**, check against `SportDataParser`. Empty days are `[day] 00`. | `v2/SportDataParser` |

Live: the steps record was `01 01 00 6C` + 108 zero bytes (0 steps today). The HR record had samples 75 and 80 bpm at slots 191 and 195.

Live v2.2.0 (21:37:54) with real data ✅: steps total 4673, kcal 189, distance 3296 m, matching the app dashboard and the `80 80` real-time frame. The non-zero half-hour bins (17:00 28, 17:30 16, 19:00 79, 19:30 2590, 20:00 1909, 21:30 51) add up exactly to the total. HR record: 58 valid slots, 60–109 bpm, avg 87.5, matching the app's day view. Sleep record was empty again (`03 01 00 00 00`), which confirms the u16 length for type 3. Exercise response: `04 0A` + day 0 (32-byte record above) + days 1–9 with length 0.

The **legacy** group-0x03 channel (`SyncDataV1`: key 0x80 health, 0x82 exercise, 0x84 function list) uses the same 108-byte step layout in `v1/StepDataParser`. This watch uses it only for the function list (§9).

---

## 9. Function list

Request `03 04 05 00 06` (type 6). The response is a group-0x03 multi-chunk stream ✅:
* First 20-byte chunk: `03 84 <total16 LE> … <type@7> … <crc16@10-11> <lastChunkLen@12> <7 payload bytes>`. Total = 0x5F = 95.
* Following chunks: `03 84 <index16 LE, 1-based> <16 payload bytes>`. Here 6 chunks.
* Bytes 10–11 of the first chunk equal CRC-16/CCITT-FALSE of the 95-byte payload (the SDK doesn't check it).

Payload (`FunctionListParser.c`): `[N=8 bitmap bytes] [TLV id,len,data …]`. **Decoded for this watch (fw 1.10):**

| Supported ✅ | NOT supported ❌ |
|---|---|
| Steps, Sleep, **Heart rate**, **All-day HR**, **SpO2 ("Bo")**, Exercise, Messages, Metric units, Alarms, Sedentary, Goals, DND, Weather, Multi-language, Backlight, Contacts (100), Online/custom/local dials (5 local), Menstrual cycle, Drink water, Raise-to-wake, Camera, Music, Find watch, Shutdown/Restart/Factory reset, Call answer/hang-up, Time format, Classic BT, Sport interaction, Bind/unbind, Weather update time, NewProtocol (0xAA), SOS contact, BLE name set | **Blood pressure**, **ECG**, **Body temperature**, **Blood sugar**, **Stress/pressure**, Vibration, Anti-loss, HR warning, Low-battery reminder, Local music, Location, Custom sport, Set time zone, HrNewProtocol |

Selected TLVs: platform (0x2C) = **1 = JIELI** (0 RK, 2 Nordic), maxSendLength (0x2B) = **244**, alarm slots = 10, brightness 100 / screen-on 5–30 s, watchStyle = 1. The list contains no screen-size field and no HR/SpO2 measure-mode TLVs.

> Consequence: BP/ECG/temperature/sugar/stress codepaths in `80 84` (types 1, 3–6) exist in the SDK but **this watch does not advertise them**. Do not offer them in the UI.

---

## 10. Errata — v1.1.0 vs verified reality

| # | v1.1.0 claim | Reality | Evidence |
|---|---|---|---|
| 1 | Battery query `00 08 04 08` | `00 08 04 00`. Byte 3 is always 0. | `ReadCmd` fill-array `04 00`; live ✅ |
| 2 | Response battery at byte 5 of `00 88` | Correct (byte 4 = status 01) | live ✅ |
| 3 | `0x00 0x8E` = MAC | `0x8E` = version block. MAC is `0x86`. | DeviceInfo switch @0x0010; live ✅ |
| 4 | Real-time steps enable `01 29 05 0F 00` | `0x29` = **set weather unit**. No stream-enable command exists. The real-time report flag is `01 2B 05 00 01`. | DeviceSet switch; `J(I)` key 0x2B ✅ |
| 5 | Real-time steps frame `80 80 0D 08 00 …` | `80 80 0D 00 <status> …` (byte 3 = 0, byte 4 = status); offsets 5/9/11 correct | live ✅ |
| 6 | History sync `00 33 04 08` | Not an official command (group 0 has no key 0x33). It came from our own app. The official app syncs over **0xAA multi-pack** (§8). | DeviceInfo switch; capture ✅ |
| 7 | 108-byte StepDataParser packet on `00 33` | StepDataParser is a SyncDataV1 (group 0x03) / multipack payload parser, not group 0x00 | §8 |
| 8 | Start HR `01 1D 06 3C 00 3C` ("60 s") | `01 1D 06 00 00 01`. There is no duration; byte 4 = type, byte 5 = on/off. | `M(IZ)` ✅ |
| 9 | Start SpO2 `01 1D 06 08 00 08` | That frame has type 0 → **starts HR, not SpO2**. Correct: `01 1D 06 00 02 01`. | live ✅ (our app 15:46:05) |
| 10 | Stop `01 1D 06 00 00 00` for both | Stop must carry the type: `…00 00 00` (HR), `…00 02 00` (SpO2) | `M(IZ)` |
| 11 | 0x84 HR "value at byte 6 (fallback byte 7)" | HR and SpO2 value is **byte 7**; byte 6 is 0 | live ✅ |
| 12 | 0x84 status `03` = error | Error = anything other than 01/02; the watch sends `00` | bytecode + live ✅ |
| 13 | Router diagram: `0x00/0x33 → StepDataParser` | Routes are `00,01,02,03,04,05,80,AA` (§2) | `EventParseHandler.<clinit>` |
| 14 | Single GATT service | Three SDK profiles. This watch uses 01FF/FF02/FF03. | `UUIDConfig` |
| 15 | `FunctionList: isSupportBp=true …, platform=JIELI` | Decoded live: **BP = false** (also no ECG/temperature/sugar/stress). HR, SpO2, sleep and steps are true; platform = JIELI is correct. | §9 ✅ |
| 16 | "AC7013/JL7013A", "4-LED+4-PD", "BLE 5.3" stated as fact | Unverified marketing (§1) | — |
| 17 | Evidence files `all_att_packets.txt`, `btsnoop_hr.txt` | Corrupted (unreassembled, truncated dumpsys summary) and mixed with our app's traffic | §0 |

---

## 11. Implementation rules (revised)

1. **Decode by `(group, key)`, then by fixed offsets** from §4–§7. Never scan for "plausible" byte ranges.
2. **Type isolation:** a `80 84` frame is SpO2 only if `byte[5] == 0x02`, HR only if `byte[5] == 0x00`. Real-time HR comes only from `80 82`. Battery comes only from `00 88`.
3. **Only send official commands.** Remove the `FE EA 10 …`, `00 33`, `00 35`, `00 07` frames from `src/bleConstants.ts`, because the watch ignores them.
4. **Serialize writes:** one command in flight, wait for the `key|0x80` response (or ~2 s timeout), like `BytesDataConnect`.
5. **Tests use real frames:** fixtures must come from [`captures/`](captures/) (reassembled), never from the old `scratch/*.txt` dumps.
6. Source-code changes still need explicit owner approval.

## 12. Reproducing a capture
```bash
adb shell getprop persist.bluetooth.btsnooplogmode   # expect "full"
# drive the official app (or adb shell input …), then:
adb bugreport br.zip
unzip -o br.zip FS/data/misc/bluetooth/logs/btsnoop_hci.log
node tools/btsnoop-att.js FS/data/misc/bluetooth/logs/btsnoop_hci.log > capture.txt   # run from this folder
```
