const fs = require('fs');

// Simple DEX parser to inspect class definitions and strings
const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes2.dex');

// DEX Header
const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsSize = buf.readUInt32LE(0x40);
const typeIdsOff = buf.readUInt32LE(0x44);
const protoIdsSize = buf.readUInt32LE(0x48);
const protoIdsOff = buf.readUInt32LE(0x4c);
const fieldIdsSize = buf.readUInt32LE(0x50);
const fieldIdsOff = buf.readUInt32LE(0x54);
const methodIdsSize = buf.readUInt32LE(0x58);
const methodIdsOff = buf.readUInt32LE(0x5c);
const classDefsSize = buf.readUInt32LE(0x60);
const classDefsOff = buf.readUInt32LE(0x64);

console.log('Class defs count:', classDefsSize);

// Read string by index
function getString(idx) {
  if (idx < 0 || idx >= stringIdsSize) return '';
  const off = buf.readUInt32LE(stringIdsOff + idx * 4);
  // Mutf-8: length is uleb128, then null-terminated string
  let p = off;
  // skip uleb128
  while (buf[p] & 0x80) p++;
  p++;
  let end = p;
  while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}

// Read type by index
function getType(idx) {
  if (idx < 0 || idx >= typeIdsSize) return '';
  const descriptorIdx = buf.readUInt32LE(typeIdsOff + idx * 4);
  return getString(descriptorIdx);
}

// Find interesting classes
const targetClasses = [
  'PullSync',
  'PullRead',
  'PullSetting',
  'PullWrite',
  'SyncDelegate',
  'MeasureDelegate',
  'StepSync',
  'HRSync',
  'SleepSync',
  'SportSync',
  'BasePull',
  'PullFactory',
];

for (let i = 0; i < classDefsSize; i++) {
  const cOff = classDefsOff + i * 32;
  const classIdx = buf.readUInt32LE(cOff);
  const className = getType(classIdx);
  for (const tc of targetClasses) {
    if (className.includes(tc)) {
      console.log(`Found class [${i}]: ${className}`);
    }
  }
}
