const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsSize = buf.readUInt32LE(0x40);
const typeIdsOff = buf.readUInt32LE(0x44);
const methodIdsSize = buf.readUInt32LE(0x58);
const methodIdsOff = buf.readUInt32LE(0x5c);

function getString(idx) {
  const off = buf.readUInt32LE(stringIdsOff + idx * 4);
  let p = off; while (buf[p] & 0x80) p++; p++;
  let end = p; while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}
function getType(idx) { return getString(buf.readUInt32LE(typeIdsOff + idx * 4)); }
function getMethod(idx) {
  const classIdx = buf.readUInt16LE(methodIdsOff + idx * 8);
  const nameIdx = buf.readUInt32LE(methodIdsOff + idx * 8 + 4);
  return `${getType(classIdx)}->${getString(nameIdx)}`;
}

const codeOff = 4231832;
const insnsSize = buf.readUInt32LE(codeOff + 12);
const insns = buf.slice(codeOff + 16, codeOff + 16 + insnsSize * 2);

console.log('InsnsSize:', insnsSize);
let ip = 0;
while (ip < insns.length) {
  const pc = ip / 2;
  const op = insns[ip];
  let s = `[${pc.toString(16).padStart(4, '0')}] op=${op.toString(16).padStart(2, '0')}`;
  if (op === 0x1a) {
    s += ` const-string "${getString(insns.readUInt16LE(ip + 2)).replace(/\n/g, '\\n')}"`;
    ip += 4;
  } else if (op >= 0x6e && op <= 0x72) {
    s += ` invoke ${getMethod(insns.readUInt16LE(ip + 2))}`;
    ip += 6;
  } else if (op === 0x12) {
    s += ` const/4 v${insns[ip+1] & 0xf}, ${insns[ip+1] >> 4}`;
    ip += 2;
  } else if (op === 0x13) {
    s += ` const/16 v${insns[ip+1]}, ${insns.readInt16LE(ip + 2)}`;
    ip += 4;
  } else if (op === 0x2b) {
    const offset = insns.readInt32LE(ip + 2);
    s += ` packed-switch offset=${offset}`;
    ip += 6;
  } else if (op === 0x32 || op === 0x33) {
    s += ` if-cmp`;
    ip += 4;
  } else if (op === 0x28) {
    s += ` goto`;
    ip += 2;
  } else {
    ip += 2;
  }
  console.log(s);
}
