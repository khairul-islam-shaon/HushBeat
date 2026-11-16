#!/usr/bin/env node
// Parse an Android btsnoop_hci.log and print every BLE ATT write / notification / read.
// Usage: node tools/parse-btsnoop.js <btsnoop_hci.log> [--filter=<hex prefix>]
//
// Writes from the phone (TX) are the app's commands (FF02); notifications (RX) are
// the watch's answers (FF03). Use this to find commands the official app sends.

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/parse-btsnoop.js <btsnoop_hci.log> [--filter=hexprefix]');
  process.exit(1);
}
const filterArg = process.argv.find(a => a.startsWith('--filter='));
const filter = filterArg ? filterArg.slice(9).toLowerCase().replace(/\s/g, '') : null;

const buf = fs.readFileSync(file);
if (buf.toString('latin1', 0, 8) !== 'btsnoop\0') {
  console.error('Not a btsnoop file (bad magic).');
  process.exit(1);
}
const datalink = buf.readUInt32BE(12); // 1002 = H4 (has a packet-type byte), 1001 = no type byte

const OPCODES = {
  0x0a: 'READ_REQ',
  0x0b: 'READ_RSP',
  0x12: 'WRITE_REQ',
  0x52: 'WRITE_CMD',
  0x1b: 'NOTIFY',
  0x1d: 'INDICATE',
};
// BTSnoop timestamps: microseconds since 0000-01-01; this offset converts to the Unix epoch.
const EPOCH_DELTA = 0x00dcddb30f2f8000n;
const hex = b => Buffer.from(b).toString('hex').replace(/(..)/g, '$1 ').trim();
const lastReadHandle = new Map(); // ACL connection -> handle of the last READ_REQ

let off = 16;
let count = 0;
while (off + 24 <= buf.length) {
  const inclLen = buf.readUInt32BE(off + 4);
  const flags = buf.readUInt32BE(off + 8);
  const ts = buf.readBigUInt64BE(off + 16);
  let p = buf.subarray(off + 24, off + 24 + inclLen);
  off += 24 + inclLen;

  const received = (flags & 1) === 1;
  if (datalink === 1002) {
    if (p[0] !== 0x02) continue; // only ACL data
    p = p.subarray(1);
  } else if (datalink !== 1001) {
    continue;
  }
  if (p.length < 9) continue;
  const hdr = p.readUInt16LE(0);
  const conn = hdr & 0x0fff;
  const pb = (hdr >> 12) & 0x3;
  if (pb === 0x1) continue; // continuation fragment; ATT commands here are small
  const cid = p.readUInt16LE(6);
  if (cid !== 0x0004) continue; // ATT only
  const att = p.subarray(8);
  const op = att[0];
  const name = OPCODES[op];
  if (!name) continue;

  let handle = null;
  let value;
  if (op === 0x0b) {
    handle = lastReadHandle.get(conn) ?? null;
    value = att.subarray(1);
  } else {
    handle = att.readUInt16LE(1);
    value = att.subarray(3);
    if (op === 0x0a) lastReadHandle.set(conn, handle);
  }

  const valueHex = hex(value);
  if (filter && !valueHex.replace(/\s/g, '').startsWith(filter)) continue;

  const time = new Date(Number((ts - EPOCH_DELTA) / 1000n)).toISOString().slice(11, 23);
  const dir = received ? 'RX watch->phone' : 'TX phone->watch';
  const h = handle === null ? '  ?   ' : '0x' + handle.toString(16).padStart(4, '0');
  console.log(`${time}  ${dir}  ${name.padEnd(9)} h=${h}  ${valueHex}`);
  count++;
}
console.error(`\n${count} ATT packets.`);
