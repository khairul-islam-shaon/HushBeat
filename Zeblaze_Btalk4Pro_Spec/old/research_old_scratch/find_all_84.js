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
  let p = off; while (buf[p] & 0x80) p++; p++;
  let end = p; while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}
function getType(idx) { return getString(buf.readUInt32LE(typeIdsOff + idx * 4)); }
function getMethod(idx) {
  if (idx < 0 || idx >= methodIdsSize) return '';
  const classIdx = buf.readUInt16LE(methodIdsOff + idx * 8);
  const nameIdx = buf.readUInt32LE(methodIdsOff + idx * 8 + 4);
  return `${getType(classIdx)}->${getString(nameIdx)}`;
}
function readUleb128(p) {
  let result = 0, shift = 0, byte, count = 0;
  do { byte = buf[p++]; count++; result |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
  return { val: result, len: count };
}

for (let i = 0; i < classDefsSize; i++) {
  const cOff = classDefsOff + i * 32;
  const cName = getType(buf.readUInt32LE(cOff));
  if (cName.includes('parser') && !cName.includes('base')) {
    const classDataOff = buf.readUInt32LE(cOff + 24);
    if (!classDataOff) continue;
    let p = classDataOff;
    const sfs = readUleb128(p); p += sfs.len;
    const ifs = readUleb128(p); p += ifs.len;
    const dms = readUleb128(p); p += dms.len;
    const vms = readUleb128(p); p += vms.len;
    for (let j = 0; j < sfs.val + ifs.val; j++) { readUleb128(p); readUleb128(p); }
    
    let mIdx = 0;
    for (let j = 0; j < dms.val + vms.val; j++) {
      if (j === dms.val) mIdx = 0;
      const d = readUleb128(p); p += d.len; mIdx += d.val;
      const access = readUleb128(p);
      const codeOff = readUleb128(p).val;
      if (codeOff === 0) continue;
      
      const insnsSize = buf.readUInt32LE(codeOff + 12);
      const insns = buf.slice(codeOff + 16, codeOff + 16 + insnsSize * 2);
      for (let ip = 0; ip < insns.length - 2; ip += 2) {
        if (insns[ip] === 0x13 && insns.readInt16LE(ip + 2) === -124) { // -124 is 0xff84 (132 / 0x84)
          console.log(`Found 0x84 in ${getMethod(mIdx)}`);
        }
      }
    }
  }
}
