const fs = require('fs');
const buf = fs.readFileSync('scratch/zc_dex/classes.dex');

const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsSize = buf.readUInt32LE(0x40);
const typeIdsOff = buf.readUInt32LE(0x44);
const methodIdsSize = buf.readUInt32LE(0x58);
const methodIdsOff = buf.readUInt32LE(0x5c);

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

function dumpCode(codeOff) {
  const regs = buf.readUInt16LE(codeOff);
  const ins = buf.readUInt16LE(codeOff + 2);
  const outs = buf.readUInt16LE(codeOff + 4);
  const insnsSize = buf.readUInt32LE(codeOff + 12);
  console.log(`Regs: ${regs}, Ins: ${ins}, Outs: ${outs}, Size: ${insnsSize}`);
  const insns = buf.subarray(codeOff + 16, codeOff + 16 + insnsSize * 2);
  for (let i = 0; i < insnsSize; i++) {
    const op = insns[i * 2];
    const b1 = insns[i * 2 + 1];
    let extra = '';
    if (op === 0x1a) { // const-string
      const strIdx = insns.readUInt16LE((i + 1) * 2);
      extra = `str="${getString(strIdx)}"`;
    } else if (op === 0x6e || op === 0x6f || op === 0x70 || op === 0x71 || op === 0x72) {
      const mId = insns.readUInt16LE((i + 1) * 2);
      extra = `meth=${getType(buf.readUInt16LE(methodIdsOff + mId * 8))}->${getString(buf.readUInt32LE(methodIdsOff + mId * 8 + 4))}`;
    }
    console.log(`[${i.toString(16).padStart(4, '0')}] op=${op.toString(16)} b1=${b1.toString(16)} ${extra}`);
  }
}

console.log('--- EventParseHandler.a ---');
dumpCode(4219748);
console.log('--- EventParseHandler.b ---');
dumpCode(4219872);
