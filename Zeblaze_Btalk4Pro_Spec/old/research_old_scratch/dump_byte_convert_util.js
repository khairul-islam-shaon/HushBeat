const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsSize = buf.readUInt32LE(0x40);
const typeIdsOff = buf.readUInt32LE(0x44);
const protoIdsSize = buf.readUInt32LE(0x48);
const protoIdsOff = buf.readUInt32LE(0x4c);
const methodIdsSize = buf.readUInt32LE(0x58);
const methodIdsOff = buf.readUInt32LE(0x5c);
const classDefsSize = buf.readUInt32LE(0x60);
const classDefsOff = buf.readUInt32LE(0x64);

function getString(idx) {
  const off = buf.readUInt32LE(stringIdsOff + idx * 4);
  let p = off;
  while (buf[p] & 0x80) p++;
  p++;
  let end = p;
  while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}
function getType(idx) {
  return getString(buf.readUInt32LE(typeIdsOff + idx * 4));
}
function getMethod(idx) {
  const classIdx = buf.readUInt16LE(methodIdsOff + idx * 8);
  const protoIdx = buf.readUInt16LE(methodIdsOff + idx * 8 + 2);
  const nameIdx = buf.readUInt32LE(methodIdsOff + idx * 8 + 4);
  return `${getType(classIdx)}->${getString(nameIdx)} (proto: ${protoIdx})`;
}

function readUleb128(p) {
  let result = 0, shift = 0, byte, count = 0;
  do { byte = buf[p++]; count++; result |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
  return { val: result, len: count };
}

for (let i = 0; i < classDefsSize; i++) {
  const cOff = classDefsOff + i * 32;
  const classIdx = buf.readUInt32LE(cOff);
  const className = getType(classIdx);
  if (className.includes('ByteDataConvertUtil')) {
    const classDataOff = buf.readUInt32LE(cOff + 24);
    let p = classDataOff;
    const sfs = readUleb128(p); p += sfs.len;
    const ifs = readUleb128(p); p += ifs.len;
    const dms = readUleb128(p); p += dms.len;
    const vms = readUleb128(p); p += vms.len;
    for (let j = 0; j < sfs.val; j++) { const d = readUleb128(p); p += d.len; const a = readUleb128(p); p += a.len; }
    for (let j = 0; j < ifs.val; j++) { const d = readUleb128(p); p += d.len; const a = readUleb128(p); p += a.len; }
    let mIdx = 0;
    for (let j = 0; j < dms.val + vms.val; j++) {
      const d = readUleb128(p); p += d.len; mIdx += d.val;
      const a = readUleb128(p); p += a.len;
      const codeOff = readUleb128(p); p += codeOff.len;
      console.log(`Method: ${getMethod(mIdx)} (codeOff: ${codeOff.val})`);
    }
  }
}
