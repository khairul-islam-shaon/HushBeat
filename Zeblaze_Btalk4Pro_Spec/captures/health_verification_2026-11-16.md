# Health verification run: 2026-11-16 21:36–21:52

Phone POCO X3 Pro (Android 12) over wireless ADB · watch FD:99:E2:BB:76:D0 fw 1.10 · Zeblaze Connect v1.1.0
Evidence: `btsnoop_hci_health_2026-11-16_2136.log` (full snoop), decoded to `att_health_2026-11-16_2136.txt` with `tools/btsnoop-att.js`.

## Result vs spec v2.1.0

| Spec item | Captured bytes | Matches app UI | Verdict |
|---|---|---|---|
| §6 real-time HR `80 82 07 00 01 <bpm> 00` | every ~3 s, e.g. `…01 42 00` = 66 | yes | ✅ confirmed |
| §6 real-time activity `80 80 0D 00 …` | `80 80 0D 00 01 41 12 00 00 E0 0C BD 00` → 4673 steps, 3296 m, 189 kcal | 4673 / 3.2 km / 189 kcal | ✅ confirmed |
| §7 start HR `01 1D 06 00 00 01` | 21:39:28 → `80 84 08 00 01 00 00 00` → `01 9D 05 00 01` → 21:39:49 `80 84 08 00 02 00 00 42` | 66 bpm | ✅ confirmed (21 s) |
| §7 HR (2nd) | 21:40:45 → 21:41:05 `…02 00 00 4E` | 78 bpm | ✅ |
| §7 start SpO2 `01 1D 06 00 02 01` | 21:41:43 → `80 84 08 00 01 02 00 00` → ack → 21:42:11 `…02 02 00 61` | 97 % | ✅ confirmed (28 s) |
| §7 SpO2 (2nd) | 21:42:58 → 21:43:26 `…02 02 00 63` | 99 % | ✅ |
| §7 stop HR / stop SpO2 (`…00 00`, `…02 00`) | **not sent.** Pressing Back or tapping "Measuring..." sends nothing, and the watch finishes the measurement anyway | — | 🟦 still unverified: the app has no stop path |
| §8 health sync `AA 85 03 00 01/03/02 01 00` + exercise `AA 85 0C 00 04 0A…` | sent twice (21:37:54 and 21:38:36), same order as spec. All 38 AA frames pass CRC-16/CCITT-FALSE | — | ✅ confirmed |
| §8.2 steps record (108 B) | total u32@96 = 4673, kcal@100 = 189, dist@104 = 3296. The half-hour bins add up to 4673 (17:00 28, 17:30 16, 19:00 79, 19:30 2590, 20:00 1909, 21:30 51) | yes | ✅ confirmed with non-zero data (was only 0 / 44 before) |
| §8.2 HR record (288 B) | 58 valid slots, min 60 max 109 avg 87.5. Last slot 258 ≈ 21:30 | app day view "60-109 bpm, avg 87" | ✅ confirmed. **5-min slots now confirmed** (slot × 5 min = clock time), no longer just inferred |
| §8.2 sleep record | `03 01 00 00 00` (empty) | — | 🟦 layout still unverified (no sleep data) |
| §5.2 24h HR get `01 34 04 00` | `01 34 04 00` → `01 B4 06 00 01 01` (status OK, value 1 = on) | switch shows on | ✅ new: get response carries the value at byte 5 (length 6) |
| §5.2 24h HR set `01 35 05 00 <0/1>` | Not sent in this run. The switch was toggled at 21:46:04 and 21:46:11, but the page's ✓ save was never pressed, so the app had nothing to write | — | ✅ unchanged from the 17:38–17:39 capture, which already confirms it. This is expected, not a contradiction |
