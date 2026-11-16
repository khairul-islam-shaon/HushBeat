const fs = require('fs');
const buf = fs.readFileSync('scratch/zc_dex/classes.dex');

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
  const descriptorIdx = buf.readUInt32LE(typeIdsOff + idx * 4);
  return getString(descriptorIdx);
}

for (let i = 0; i < classDefsSize; i++) {
  const cOff = classDefsOff + i * 32;
  const classIdx = buf.readUInt32LE(cOff);
  const className = getType(classIdx);
  if (className.includes('EventParseHandler')) {
    console.log(`Found EventParseHandler at classDef ${i}: ${className}`);
    const classDataOff = buf.readUInt32LE(cOff + 24);
    let p = classDataOff;
    function readUleb() {
      let result = 0, shift = 0;
      while (true) {
        const b = buf[p++];
        result |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      return result;
    }
    const sFields = readUleb();
    const iFields = readUleb();
    const dMethods = readUleb();
    const vMethods = readUleb();
    for (let f = 0; f < sFields + iFields; f++) { readUleb(); readUleb(); }
    
    let mIdx = 0;
    for (let m = 0; m < dMethods + vMethods; m++) {
      if (m === dMethods) mIdx = 0;
      mIdx += readUleb();
      const access = readUleb();
      const codeOff = readUleb();
      const mName = getString(buf.readUInt32LE(methodIdsOff + mIdx * 8 + 4));
      console.log(`Method ${mName} codeOff: ${codeOff}`);
    }
  }
}
