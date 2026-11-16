# Zeblaze Btalk 4 Pro & Zeblaze Connect: Verified BLE Protocol Specification

> **Document Version:** 2.0.0 (2026-11-16): rewritten from a clean capture. v1.1.0 is kept as `ZEBLAZE_BTALK_4_PRO_OFFICIAL_SPECIFICATION.v1.1.0.bak.md`.
> **Device:** Zeblaze Btalk 4 Pro, MAC `FD:99:E2:BB:76:D0`, firmware `1.10` (shown in the app and read over BLE)
> **Companion app:** `com.watch.zeblaze` v1.1.0 (versionCode 12), SDK namespace `com.antjy.sdk.*`
> **Test phone:** POCO X3 Pro (Android 12), Bluetooth HCI snoop log set to "full"

## 0. Evidence levels

Every claim in this document carries one of these tags:

| Tag | Meaning |
|---|---|
| **[BC]** | Read directly from the official APK's Dalvik bytecode (`dexdump -d` of `classes.dex` / `classes2.dex`) |
| **[CAP]** | Seen in the clean HCI capture of 2026-11-16 (`D:\Zeblaze\scratch\capture_2026-11-16\btsnoop_hci.log`, full btsnoop from `adb bugreport`) |
| **[UI]** | Matches what the official app displayed on screen at the same moment |
| **[UNVERIFIED]** | Not proven by the APK or by BLE traffic; treat it as an assumption |

> ⚠️ **The old capture is corrupt.** `scratch/all_att_packets.txt`, `btsnoop_hr.txt` and `btsnoop_spo2.txt` were decoded from the truncated `BTSNOOP_LOG_SUMMARY` in `dumpsys`. Their "packets" contain spliced HCI/L2CAP headers (e.g. `06 20 0c 00 08 00 04 00 1b 18 00`). Every byte value in v1.1.0 that came from those files (such as the trailing `08` / `0F` / `3C` bytes) is an artifact. Do not use those files.

---

## 1. Hardware

None of the hardware details can be confirmed from the APK or from BLE traffic. The only thing BLE exposes is the feature list the watch reports (§4.8).

| Item | Status |
|---|---|
| Jieli SoC (AC7013 / JL7013A) | **[UNVERIFIED]** The SDK has a Jieli platform code path, but the chip part number is not proven |
| 4-LED + 4-PD "OHR Fusion" optical array, Tianyi Hexin | **[UNVERIFIED]**, marketing material |
| Green 525 nm / Red 660 nm / IR 940 nm LEDs | **[UNVERIFIED]**. These are typical PPG/SpO2 wavelengths, not measured |
| 3-axis accelerometer | Very likely (it has a pedometer), but the part number is **[UNVERIFIED]** |
| 3-axis gyroscope | **[UNVERIFIED]**. Nothing in the BLE protocol or SDK requires one |
| BLE + BR/EDR (calls / audio) | The phone showed both a classic connection (HFP audio) and a GATT client **[CAP]** |

The PPG and SpO2 theory in v1.1.0 (Beer-Lambert ratio, the R formula) is general textbook physics. It is not specific to this watch. The watch's DSP runs on the device itself, and the app only ever receives finished integer results.

---

## 2. Companion app architecture **[BC]**

### 2.1 Send path
`BaseCmdWrapper.createCmd(group, key, payload)` → `[group][key][payload…]`
- `ReadCmd(group, key)` uses the fixed payload `{0x04, 0x00}`, so every read command is the 4 bytes **`<group> <key> 04 00`**.
- `WriteCmd` payloads are built with `createDataCmd(n)`, which sets `payload[0] = n + 2`. **Byte 2 is therefore always the total frame length.**
- Frames are capped at 20 bytes (`createCmd` loop bound). Larger data goes through `MultiPackCmd` (`0xAA`).
- `BytesDataConnect.O()` → `BluetoothGattCharacteristic.setValue()` + `writeCharacteristic()`. It does **not** add a CRC, sequence number or extra header.

### 2.2 Receive path
`BytesDataConnect.L(bytes)` → `EventParseHandler.a(bytes)`. The minimum frame length is 4 bytes; shorter frames throw `"最小长度为4个字节"`.
`byte[0]` selects the parser and `byte[1]` (the key) is passed to that parser:

| byte[0] | Parser |
|---|---|
| `0x00` | `DeviceInfoEventParser` |
| `0x01` | `DeviceSetEventParser` |
| `0x02` | `DeviceRemindEventParser` |
| `0x03` | `SyncDataV1EventParser` |
| `0x04` | `DeviceTestEventParser` |
| `0x05` | `DeviceOtaEventParser` |
| `0x80` | `DeviceReportEventParser` (watch-initiated events) |
| `0xAA` | `MultiPackEventParser` (multi-packet data) |

The v1.1.0 diagram (`0x00/0x33 → StepDataParser`) was wrong.

### 2.3 Response convention **[CAP]**
A response repeats the command with bit 7 set on the key (`0x08 → 0x88`, `0x1D → 0x9D`):

```
[group][key | 0x80][total_len][0x00][status=0x01][data…]
```

Every response seen in the capture has `byte[3] = 0x00` and `byte[4] = 0x01`.

### 2.4 Multi-byte numbers **[BC]**
`ByteDataConvertUtil.f(bytes, offset, n)` decodes **unsigned little-endian** values for n = 1, 2, 3 and 4.

### 2.5 Class locations (corrected)
- `com.antjy.sdk.protocol.parser.EventParseHandler`
- `com.antjy.sdk.protocol.parser.common.{DeviceInfo,DeviceSet,DeviceReport,SyncDataV1,MultiPack,…}EventParser`
- `com.antjy.sdk.util.parser.version.v1.StepDataParser`, and `…v2.StepDataParser` (not `protocol.parser.data`)
- `com.antjy.sdk.util.parser.version.v2.FunctionListParser`
- Posters: `com.antjy.sdk.callback.impl.poster.{RealHeartRatePoster, RealDataPoster, MeasurePoster}`

---

## 3. GATT

| Role | Handle | Notes |
|---|---|---|
| Write (phone → watch) | `0x0016` | ATT Write Command (no response) **[CAP]** |
| Notify (watch → phone) | `0x0018` | ATT Handle Value Notification **[CAP]** |
| CCCD | `0x0019` | Written with `01 00` **[CAP]** |

Characteristic UUIDs `FF02` (write) and `FF03` (notify), and service `000001ff-3c17-d293-8e48-14fe2e4da212`, come from v1.1.0 notes. They have **not** been re-checked against `com.antjy.sdk.bluetooth.connect.UUIDConfig` **[UNVERIFIED]**.

---

## 4. Commands and packets

All examples below are real frames from the 2026-11-16 capture **[CAP]**.

### 4.1 Battery level — `00 08`
| | Frame |
|---|---|
| Query | `00 08 04 00` |
| Response | `00 88 06 00 01 3a` |

- **Battery % = `byte[5]`** (`0x3a` = 58). The app showed 58% at the same time **[UI]**, and the parser reads offset 5, 1 byte **[BC]**.
- v1.1.0 listed the query as `00 08 04 08`. That was wrong: the last byte is `00`.

### 4.2 Firmware version — `00 02`
| | Frame |
|---|---|
| Query | `00 02 04 00` |
| Response | `00 82 09 00 01 31 2e 31 30` |

- `bytes[5..]` are ASCII: `"1.10"` **[CAP][UI]**.

### 4.3 MAC address — `00 06` → `00 86`
- The parser for key `0x86` copies 6 bytes from offset 5 and logs `"获取 mac = "` **[BC]**.
- This query was not seen in the capture.
- **Correction:** v1.1.0 said `0x8E` is the MAC. It is not (see §4.4).

### 4.4 Product / firmware / resource version — `00 0E` → `00 8E`
| | Frame |
|---|---|
| Query | `00 0e 04 00` |
| Response | `00 8e 11 00 01 03 00 5e 01 01 00 01 0a 01 07 01 02` |

- The parser logs `"获取产品、固件、资源等版本信息"` **[BC]**.
- It reads 2-byte values at offsets 5 and 7, plus 2-char strings at offsets 9, 11, 13 and 15.

### 4.5 Other DeviceInfo keys **[BC]**
`DeviceInfoEventParser` handles these response keys:
- `0x80`, `0x84` (serial number), `0x89` (set time ack), `0x8A` (function list), `0x8C` (get all settings), `0x8D` (set all settings)
- plus `0x82`, `0x86`, `0x88` and `0x8E` described above

### 4.6 Real-time heart rate stream — `80 82`
```
80 82 07 00 01 <BPM> 00
```
- **BPM = `byte[5]`** **[BC]** (offset 5, 1 byte) **[CAP]**
- The watch sends it about every 3 seconds once streaming is active **[CAP]**.
- Captured values: `5d` (93), `86` (134), `7f` (127), `41` (65), and others.

### 4.7 Real-time activity stream — `80 80`
```
80 80 0d 00 01 [S0 S1 S2 S3] [D0 D1] [C0 C1]
```

| Field | Offset | Size (bytes) |
|---|---|---|
| Steps | 5 | 4 |
| Distance | 9 | 2 |
| Calories | 11 | 2 |

- All three fields are little-endian **[BC]**.
- Captured frame: `80 80 0d 00 01 00 00 00 00 00 00 00 00`. All zeros: the watch itself reported 0 steps, and the app also showed 0 **[UI]**.
- Enable command sent by the official app: `01 29 05 00 00` → ack `01 a9 05 00 01` **[CAP]**. The v1.1.0 value `01 29 05 0F 00` came from the corrupt capture.
- **[UNVERIFIED]:** what byte 4 of the `01 29` payload means (enable flag or interval).

### 4.8 Function list — `03 04` → `03 84`
| | Frame |
|---|---|
| Query | `03 04 05 00 06` |
| Response | A stream of `03 84 <idx> …` frames |

- `SyncDataV1EventParser` key `0x84` logs `"获取设备支持的功能列表"` (supported-features list) **[BC]**.
- Its other keys are `0x80` (sync health data) and `0x82` (sync exercise data) **[BC]**.
- **Correction:** this is not step history. The bit layout is in `FunctionListParser` (v2) and has not been decoded yet. The v1.1.0 claims `isSupportHr / Bo / Bp / Step / Sleep = true`, `platform = JIELI` are **[UNVERIFIED]**.

### 4.9 Step history — 108-byte record
- `com.antjy.sdk.util.parser.version.v1.StepDataParser.b(bytes)` **[BC]**:
  - `bytes[0..95]`: 48 × 2-byte values (half-hour buckets)
  - `bytes[96..99]`: daily total steps (4-byte LE)
  - `bytes[100..103]`: daily total calories (4-byte LE)
  - `bytes[104..107]`: daily total distance (4-byte LE)
- The parser logs `"BaseMultiPackParser: 解析步数数据"`, so this record is delivered through the **multi-pack (`0xAA`) channel** **[BC]**.
- `00 33 04 00` was written several times but **no `00 B3` response was ever received** **[CAP]**. The v1.1.0 claim that `00 33 04 08` triggers this sync is unproven.
- **[UNVERIFIED]:** the exact `AA` request that fetches step history. It needs a dedicated capture.

### 4.10 Single measurement — command `01 1D`
```
Start:  01 1d 06 00 <type> 01
Stop:   01 1d 06 00 <type> 00
Ack:    01 9d 05 00 01
```

`<type>` uses the same TypeKey values as §4.11 (0 = HR, 2 = SpO2, …).

| Test | Sent **[CAP]** |
|---|---|
| Heart rate | `01 1d 06 00 00 01` |
| SpO2 | `01 1d 06 00 02 01` |

**Correction:** v1.1.0's `01 1D 06 3C 00 3C` (HR "60 s") and `01 1D 06 08 00 08` (SpO2 "8 s") were wrong. The command has no duration field. Both measurements finished in about 20–30 seconds **[CAP]**.

### 4.11 Single measurement report — `80 84`
```
[80][84][08][00][Status][TypeKey][Val1][Val2]
  0   1   2   3     4       5       6     7
```

- **Status** (`byte[4]`) **[BC]**: `0x01` = measuring, `0x02` = complete, anything else = error
- **TypeKey** (`byte[5]`, `packed-switch` keys 0–6) **[BC]**:

| TypeKey | Measurement |
|---|---|
| 0 | Heart rate |
| 1 | Blood pressure |
| 2 | SpO2 |
| 3 | ECG |
| 4 | Stress |
| 5 | Blood sugar |
| 6 | Body temperature |

- Val1 = `byte[6]` and Val2 = `byte[7]`. Both are passed to `MeasurePoster.t(type, status, val1, val2)` **[BC]**.
- Temperature combines `byte[7]` and `byte[6]` into a 2-byte value and divides it by 100 **[BC]**.

**Real captures:**

| Frame | Meaning | App showed |
|---|---|---|
| `80 84 08 00 01 00 00 00` | HR measuring | — |
| `80 84 08 00 02 00 00 7f` | HR complete, **byte[7] = 127** | 127 bpm **[UI]** |
| `80 84 08 00 01 02 00 00` | SpO2 measuring | — |
| `80 84 08 00 02 02 00 63` | SpO2 complete, **byte[7] = 99** | 99 % **[UI]** |

> ✅ **For HR and SpO2 the result is in `byte[7]`; `byte[6]` is `0x00`.** v1.1.0's "Byte 6 (fallback Byte 7)" works only because byte 6 happens to be zero. Read `byte[7]` directly.

> ℹ️ The 127 bpm reading came right after the watch was put on. The live stream went 134 → 132 → 129 and then stayed at 127 (`0x7F`) for about a minute. A minute later, during the SpO2 test, it showed 65–66. This is how the watch measures, not a parsing bug. Repeat the test at rest to confirm.

### 4.12 Other frames seen **[CAP]**, not yet decoded
| Frame | Notes |
|---|---|
| `00 07 04 00` | DeviceInfo key 0x07; no 0x87 response seen |
| `00 09 0b 00 <yy> <mm> <dd> <hh> <mi> <ss>` → `00 89 05 00 01` | Set time (the parser labels key 0x89 "设置设备时间") |
| `aa 85 …`, `aa 83 …`, `aa 05 …`, `aa 03 …`, `aa 01 02 00 <key> …` | Multi-pack requests, data and acks, with a 2-byte trailer (probably a CRC) |
| `fe ea 10 06 xx 00` | Another protocol family; its source in the APK has not been traced |

---

## 5. Implementation rules

1. **Read commands are always `<group> <key> 04 00`.** Never put `0x08` or `0x0F` in byte 3.
2. **Use a fixed offset for every field** and switch on `TypeKey`. No range heuristics such as "a byte between 80 and 100 must be SpO2".
3. **TypeKey decides the meaning.** Never treat `80 84` as SpO2 unless `byte[5] == 0x02`, or as HR unless `byte[5] == 0x00`.
4. **`80 82` is live HR and `00 88` is battery.** Never mix the two up.
5. **Use only clean captures as test fixtures.** Take them from the full `btsnoop_hci.log` (`adb bugreport` → `FS/data/misc/bluetooth/logs/`) and parse with `tools/parse-btsnoop.js`. Never use the `dumpsys` summary.

## 6. Open items
- Decode the `FunctionListParser` bit layout (§4.8).
- Capture the request that fetches step history (§4.9) and the HR-day / SpO2 history requests.
- Verify the service and characteristic UUIDs in `UUIDConfig`.
- Find the meaning of the `01 29` payload byte and of the `fe ea` family.
- Repeat the HR measurement at rest to confirm the 127 bpm reading.
