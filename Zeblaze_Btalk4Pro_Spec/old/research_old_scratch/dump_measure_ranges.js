const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsSize = buf.readUInt32LE(0x40);
const typeIdsOff = buf.readUInt32LE(0x44);
const methodIdsSize = buf.readUInt32LE(0x58);
const methodIdsOff = buf.readUInt32LE(0x5c);
const fieldIdsSize = buf.readUInt32LE(0x50);
const fieldIdsOff = buf.readUInt32LE(0x54);

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
  const nameIdx = buf.readUInt32LE(methodIdsOff + idx * 8 + 4);
  return `${getType(classIdx)}->${getString(nameIdx)}`;
}
function getField(idx) {
  const classIdx = buf.readUInt16LE(fieldIdsOff + idx * 8);
  const typeIdx = buf.readUInt16LE(fieldIdsOff + idx * 8 + 2);
  const nameIdx = buf.readUInt32LE(fieldIdsOff + idx * 8 + 4);
  return `${getType(classIdx)}->${getString(nameIdx)}:${getType(typeIdx)}`;
}

const codeOff = 4224732;
const codeStart = codeOff + 16;
const insns = buf.slice(codeStart, codeStart + 1172 * 2);

function dumpRange(startPc, endPc) {
  let ip = startPc * 2;
  while (ip < endPc * 2) {
    const pc = ip / 2;
    const op = insns[ip];
    let s = `[${pc.toString(16).padStart(4, '0')}] op=${op.toString(16).padStart(2, '0')}`;
    if (op === 0x44) { // aget-byte
      const vA = insns[ip + 1];
      const vB = insns[ip + 2];
      const vC = insns[ip + 3];
      s += ` aget-byte v${vA}, v${vB}[v${vC}]`;
      ip += 4;
    } else if (op === 0x48) { // aget-byte vA, vB[vC] with 4-bit regs
      const vA = insns[ip + 1] & 0x0f;
      const vB = (insns[ip + 1] >> 4) & 0x0f;
      s += ` aget-byte v${vA}, array=v${vB}`;
      ip += 2;
    } else if (op === 0x12) { // const/4
      const vA = insns[ip + 1] & 0x0f;
      const val = insns[ip + 1] >> 4;
      s += ` const/4 v${vA}, ${val}`;
      ip += 2;
    } else if (op === 0x13) { // const/16
      const vA = insns[ip + 1];
      const val = insns.readInt16LE(ip + 2);
      s += ` const/16 v${vA}, ${val}`;
      ip += 4;
    } else if (op >= 0x6e && op <= 0x72) {
      const mId = insns.readUInt16LE(ip + 2);
      const argCount = (insns[ip + 1] >> 4);
      s += ` invoke-${op.toString(16)} (args=${argCount}) ${getMethod(mId)}`;
      ip += 6;
    } else if (op === 0x1a) {
      const vA = insns[ip + 1];
      const sId = insns.readUInt16LE(ip + 2);
      s += ` const-string v${vA}, "${getString(sId).replace(/\n/g, '\\n')}"`;
      ip += 4;
    } else if (op === 0x0a || op === 0x0b || op === 0x0c || op === 0x0d || op === 0x0e || op === 0x0f) {
      s += ` move-result`;
      ip += 2;
    } else {
      s += ` (raw: ${insns.slice(ip, ip + 4).toString('hex')})`;
      ip += 2;
    }
    console.log(s);
  }
}

console.log('=== Header unpacking [0x1b4 - 0x1c5] ===');
dumpRange(0x1b4, 0x1c5);

console.log('=== HR unpacking [0x3c8 - 0x410] ===');
dumpRange(0x3c8, 0x410);

console.log('=== SpO2 unpacking [0x336 - 0x379] ===');
dumpRange(0x336, 0x379);

console.log('=== Real-time steps unpacking [0x435 - 0x460] ===');
dumpRange(0x435, 0x460);
