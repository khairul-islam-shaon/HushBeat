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

function getMethod(idx) {
  if (idx < 0 || idx >= methodIdsSize) return '';
  const classIdx = buf.readUInt16LE(methodIdsOff + idx * 8);
  const nameIdx = buf.readUInt32LE(methodIdsOff + idx * 8 + 4);
  return `${getType(classIdx)}->${getString(nameIdx)}`;
}

function readUleb128(p) {
  let result = 0, shift = 0, byte, count = 0;
  do {
    byte = buf[p++]; count++;
    result |= (byte & 0x7f) << shift; shift += 7;
  } while (byte & 0x80);
  return { val: result, len: count };
}

// Find string index for '上报单次测量结果'
let targetStrIdx = -1;
for (let i = 0; i < stringIdsSize; i++) {
  if (getString(i) === '上报单次测量结果') {
    targetStrIdx = i;
    break;
  }
}
console.log('Target string index:', targetStrIdx);

// Search all methods for const-string with targetStrIdx
for (let i = 0; i < classDefsSize; i++) {
  const cOff = classDefsOff + i * 32;
  const classIdx = buf.readUInt32LE(cOff);
  const className = getType(classIdx);
  const classDataOff = buf.readUInt32LE(cOff + 24);
  if (classDataOff === 0) continue;

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
    if (codeOff.val === 0) continue;

    const insnsSize = buf.readUInt32LE(codeOff.val + 12);
    const codeStart = codeOff.val + 16;
    const codeEnd = codeStart + insnsSize * 2;
    const insns = buf.slice(codeStart, codeEnd);

    for (let ip = 0; ip < insns.length - 4; ip += 2) {
      if (insns[ip] === 0x1a) {
        const sId = insns.readUInt16LE(ip + 2);
        if (sId === targetStrIdx) {
          console.log(`FOUND in ${className}::${getMethod(mIdx)} (codeOff: ${codeOff.val})`);
        }
      }
    }
  }
}
