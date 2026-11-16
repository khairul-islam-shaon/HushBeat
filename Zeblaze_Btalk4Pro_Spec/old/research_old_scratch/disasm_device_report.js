const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

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

function getField(idx) {
  if (idx < 0 || idx >= fieldIdsSize) return '';
  const classIdx = buf.readUInt16LE(fieldIdsOff + idx * 8);
  const typeIdx = buf.readUInt16LE(fieldIdsOff + idx * 8 + 2);
  const nameIdx = buf.readUInt32LE(fieldIdsOff + idx * 8 + 4);
  return `${getType(classIdx)}->${getString(nameIdx)}:${getType(typeIdx)}`;
}

const codeOff = 4224732;
const registersSize = buf.readUInt16LE(codeOff);
const insSize = buf.readUInt16LE(codeOff + 2);
const outsSize = buf.readUInt16LE(codeOff + 4);
const insnsSize = buf.readUInt32LE(codeOff + 12);
const codeStart = codeOff + 16;
const codeEnd = codeStart + insnsSize * 2;
const insns = buf.slice(codeStart, codeEnd);

console.log(`Registers: ${registersSize}, Ins: ${insSize}, Outs: ${outsSize}, InsnsSize: ${insnsSize}`);

let ip = 0;
while (ip < insns.length) {
  const pc = ip / 2;
  const op = insns[ip];
  let desc = `[${pc.toString(16).padStart(4, '0')}] op=${op.toString(16).padStart(2, '0')}`;

  if (op === 0x1a) { // const-string
    const reg = insns[ip + 1];
    const strIdx = insns.readUInt16LE(ip + 2);
    desc += ` const-string v${reg}, "${getString(strIdx).replace(/\n/g, '\\n')}"`;
    ip += 4;
  } else if (op === 0x1b) { // const-string/jumbo
    const reg = insns[ip + 1];
    const strIdx = insns.readUInt32LE(ip + 2);
    desc += ` const-string/jumbo v${reg}, "${getString(strIdx).replace(/\n/g, '\\n')}"`;
    ip += 6;
  } else if (op === 0x12) { // const/4
    const reg = insns[ip + 1] & 0x0f;
    const val = (insns[ip + 1] >> 4);
    desc += ` const/4 v${reg}, ${val}`;
    ip += 2;
  } else if (op === 0x13) { // const/16
    const reg = insns[ip + 1];
    const val = insns.readInt16LE(ip + 2);
    desc += ` const/16 v${reg}, ${val} (0x${(val & 0xffff).toString(16)})`;
    ip += 4;
  } else if (op === 0x14) { // const
    const reg = insns[ip + 1];
    const val = insns.readInt32LE(ip + 2);
    desc += ` const v${reg}, ${val} (0x${(val >>> 0).toString(16)})`;
    ip += 6;
  } else if (op >= 0x6e && op <= 0x72) { // invoke-kind
    const mId = insns.readUInt16LE(ip + 2);
    desc += ` invoke op=${op.toString(16)} ${getMethod(mId)}`;
    ip += 6;
  } else if (op === 0x54) { // iget-object
    const fId = insns.readUInt16LE(ip + 2);
    desc += ` iget-object ${getField(fId)}`;
    ip += 4;
  } else if (op === 0x52) { // iget
    const fId = insns.readUInt16LE(ip + 2);
    desc += ` iget ${getField(fId)}`;
    ip += 4;
  } else if (op === 0x44) { // aget-byte
    desc += ` aget-byte v${insns[ip+1]} from v${insns[ip+2]}[v${insns[ip+3]}]`;
    ip += 4;
  } else if (op === 0x4d) { // aput-byte
    desc += ` aput-byte v${insns[ip+1]} into v${insns[ip+2]}[v${insns[ip+3]}]`;
    ip += 4;
  } else if (op === 0x22) { // new-instance
    const typeIdx = insns.readUInt16LE(ip + 2);
    desc += ` new-instance v${insns[ip+1]}, ${getType(typeIdx)}`;
    ip += 4;
  } else if (op === 0x23) { // new-array
    const typeIdx = insns.readUInt16LE(ip + 2);
    desc += ` new-array v${insns[ip+1]}, ${getType(typeIdx)}`;
    ip += 4;
  } else if (op === 0x38 || op === 0x39) { // if-eqz / if-nez
    const reg = insns[ip + 1];
    const offset = insns.readInt16LE(ip + 2);
    desc += ` if-${op === 0x38 ? 'eqz' : 'nez'} v${reg} -> pc=${(pc + offset).toString(16)}`;
    ip += 4;
  } else if (op === 0x32 || op === 0x33) { // if-eq / if-ne
    const reg1 = insns[ip + 1] & 0x0f;
    const reg2 = (insns[ip + 1] >> 4) & 0x0f;
    const offset = insns.readInt16LE(ip + 2);
    desc += ` if-${op === 0x32 ? 'eq' : 'ne'} v${reg1}, v${reg2} -> pc=${(pc + offset).toString(16)}`;
    ip += 4;
  } else if (op === 0x28) { // goto
    const offset = insns[ip + 1];
    desc += ` goto -> pc=${(pc + offset).toString(16)}`;
    ip += 2;
  } else if (op === 0x29) { // goto/16
    const offset = insns.readInt16LE(ip + 2);
    desc += ` goto/16 -> pc=${(pc + offset).toString(16)}`;
    ip += 4;
  } else if (op === 0x2b) { // packed-switch
    const reg = insns[ip + 1];
    const offset = insns.readInt32LE(ip + 2);
    const tablePos = ip + offset * 2;
    const size = insns.readUInt16LE(tablePos + 2);
    const firstKey = insns.readInt32LE(tablePos + 4);
    desc += ` packed-switch v${reg} (size=${size}, firstKey=${firstKey}) tablePos=${(tablePos/2).toString(16)}`;
    ip += 6;
  } else if (op === 0x2c) { // sparse-switch
    const reg = insns[ip + 1];
    const offset = insns.readInt32LE(ip + 2);
    const tablePos = ip + offset * 2;
    const size = insns.readUInt16LE(tablePos + 2);
    desc += ` sparse-switch v${reg} (size=${size}) tablePos=${(tablePos/2).toString(16)}`;
    ip += 6;
  } else {
    ip += 2;
  }
  console.log(desc);
}
