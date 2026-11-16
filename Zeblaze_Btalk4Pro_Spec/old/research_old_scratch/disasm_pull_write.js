const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes2.dex');

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

const codeOff = 2405844;
const insnsSize = buf.readUInt32LE(codeOff + 12);
const insns = buf.slice(codeOff + 16, codeOff + 16 + insnsSize * 2);

console.log('InsnsSize:', insnsSize);

for (let ip = 0; ip < insns.length; ip += 2) {
  const pc = ip / 2;
  const op = insns[ip];
  let s = `[${pc.toString(16).padStart(3, '0')}] op=${op.toString(16).padStart(2, '0')}`;
  if (op === 0x1a) {
    const sId = insns.readUInt16LE(ip + 2);
    if (sId < stringIdsSize) s += ` const-string "${getString(sId)}"`;
    ip += 2;
  } else if (op >= 0x6e && op <= 0x72) {
    const mId = insns.readUInt16LE(ip + 2);
    if (mId < methodIdsSize) s += ` invoke ${getMethod(mId)}`;
    ip += 4;
  } else if (op === 0x13) {
    s += ` const/16 ${insns.readInt16LE(ip + 2)}`;
    ip += 2;
  } else if (op === 0x12) {
    s += ` const/4 ${insns[ip+1] >> 4}`;
  } else if (op === 0x2b) {
    s += ` packed-switch table=${(pc + insns.readInt32LE(ip + 2)).toString(16)}`;
    ip += 4;
  } else if (op === 0x2c) {
    s += ` sparse-switch table=${(pc + insns.readInt32LE(ip + 2)).toString(16)}`;
    ip += 4;
  }
  console.log(s);
}
