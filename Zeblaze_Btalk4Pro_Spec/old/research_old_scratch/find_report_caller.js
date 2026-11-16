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

let targetTypeId = -1;
for (let i = 0; i < typeIdsSize; i++) {
  if (getType(i) === 'Lcom/antjy/sdk/protocol/parser/common/DeviceReportEventParser;') {
    targetTypeId = i;
    break;
  }
}
console.log('targetTypeId:', targetTypeId);

const targetMethodIds = [];
for (let i = 0; i < methodIdsSize; i++) {
  const classIdx = buf.readUInt16LE(methodIdsOff + i * 8);
  if (classIdx === targetTypeId) {
    const nameIdx = buf.readUInt32LE(methodIdsOff + i * 8 + 4);
    const mName = getString(nameIdx);
    console.log(`Method ${i}: ${mName}`);
    targetMethodIds.push(i);
  }
}

for (let i = 0; i < classDefsSize; i++) {
  const classDataOff = buf.readUInt32LE(classDefsOff + i * 32 + 24);
  if (classDataOff === 0) continue;
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
    if (codeOff === 0) continue;
    const insnsSize = buf.readUInt32LE(codeOff + 12);
    const insns = buf.subarray(codeOff + 16, codeOff + 16 + insnsSize * 2);
    for (let c = 0; c < insnsSize - 1; c++) {
      const op = insns[c * 2];
      if (op === 0x6e || op === 0x6f || op === 0x70 || op === 0x71 || op === 0x72) {
        const mId = insns.readUInt16LE(c * 2 + 2);
        if (targetMethodIds.includes(mId)) {
          const callerClass = getType(buf.readUInt16LE(methodIdsOff + mIdx * 8));
          const callerMethod = getString(buf.readUInt32LE(methodIdsOff + mIdx * 8 + 4));
          console.log(`Called by: ${callerClass}->${callerMethod} at insn ${c}`);
        }
      }
    }
  }
}
