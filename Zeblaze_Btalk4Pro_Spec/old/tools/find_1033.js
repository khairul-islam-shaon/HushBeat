const fs = require('fs');
const buf = fs.readFileSync('official_app/classes.dex');

const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsSize = buf.readUInt32LE(0x40);
const typeIdsOff = buf.readUInt32LE(0x44);
const methodIdsSize = buf.readUInt32LE(0x58);
const methodIdsOff = buf.readUInt32LE(0x5c);
const classDefsSize = buf.readUInt32LE(0x60);
const classDefsOff = buf.readUInt32LE(0x64);

function getString(idx) {
  if (idx < 0 || idx >= stringIdsSize) return '';
  const off = buf.readUInt32LE(stringIdsOff + idx * 4);
  let p = off;
  while (buf[p] & 0x80) p++;
  p++;
  let end = p;
  while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}
function getType(idx) {
  if (idx < 0 || idx >= typeIdsSize) return '';
  return getString(buf.readUInt32LE(typeIdsOff + idx * 4));
}

let idx = 0;
const str = buf.toString('latin1');
while ((idx = str.indexOf('\x09\x04', idx + 1)) !== -1) { // 1033 is 0x0409
  // check if inside a class
}

// search for string "1033"
for (let i = 0; i < stringIdsSize; i++) {
  const s = getString(i);
  if (s === '1033' || s.includes('1033')) {
    console.log('String match:', i, s);
  }
}
