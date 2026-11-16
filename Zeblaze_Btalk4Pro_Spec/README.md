# Zeblaze Btalk 4 Pro — Spec Folder

The verified BLE spec for the Zeblaze Btalk 4 Pro and the official Zeblaze Connect app, plus the evidence behind it. Use it as the reference for app development.

| Path | What it is |
|---|---|
| `ZEBLAZE_BTALK_4_PRO_OFFICIAL_SPECIFICATION.md` | **Main spec (v2.2.0).** Frame format, commands, HR/SpO2/steps, 24h HR, history sync, function list, errata vs v1.1.0 |
| `captures/health_verification_2026-11-16.md` | **Latest test notes** (21:36 run): HR 66/78 bpm, SpO2 97/99 %, 4673 steps, HR history; each checked against the spec |
| `captures/btsnoop_hci_health_2026-11-16_2136.log`, `att_health_2026-11-16_2136.txt` | Raw snoop log + decoded ATT packets for that run |
| `captures/*_fresh.*`, `captures/br_fresh.zip`, `captures/ui_dumps_fresh/` | Earlier run (17:26): HR 86 bpm, SpO2 98 %, 24h HR toggle, sync. Includes the full bugreport and time marks |
| `screenshots/` | Official app screens. `08`/`11`/`14` = 17:26 run, `29`/`30`/`31` = 21:36 run (HR 66, SpO2 97 %, synced home) |
| `official_app/` | Official APK `com.watch.zeblaze` v1.1.0 (vc 12) and its extracted DEX files |
| `tools/btsnoop-att.js` | `btsnoop_hci.log` → readable ATT packets |
| `tools/verify-analyze.js` | ATT log → 0xAA CRC check + decoded step / HR / sleep / exercise history |
| `old/` | History only, **don't use as evidence**: spec v1.1.0, earlier captures and screenshots, old research scratch (some files there are corrupt), old roadmap, old one-off scripts, UI dumps |

## Device tested
- Zeblaze Btalk 4 Pro, MAC `FD:99:E2:BB:76:D0`, firmware 1.10
- Phone: POCO X3 Pro, Android 12, HCI snoop log = full (USB debugging, then wireless debugging)
- Date: 2026-11-16

## Reproducing a capture
See spec §12. Decode with:
```bash
node tools/btsnoop-att.js btsnoop_hci.log > att.txt
node tools/verify-analyze.js att.txt
```

## Re-checking the bytecode
```bash
"%LOCALAPPDATA%\Android\Sdk\build-tools\35.0.0\dexdump.exe" -d official_app/classes.dex > classes.dump.txt
```
Then search for a class such as `Lcom/antjy/sdk/protocol/parser/common/DeviceReportEventParser;`.

## Open items
Marked 🟦 (bytecode only) or ⚠️ (unverified) in the spec. Health items still open: stop HR/SpO2 (the app never sends it), sleep record layout (no sleep data yet), and the unknown exercise-record fields.
