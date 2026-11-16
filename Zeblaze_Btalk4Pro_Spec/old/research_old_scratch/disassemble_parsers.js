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

function getMethod(idx) {
  if (idx < 0 || idx >= methodIdsSize) return '';
  const classIdx = buf.readUInt16LE(methodIdsOff + idx * 8);
  const protoIdx = buf.readUInt16LE(methodIdsOff + idx * 8 + 2);
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

function readUleb128(p) {
  let result = 0;
  let shift = 0;
  let byte;
  let count = 0;
  do {
    byte = buf[p++];
    count++;
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return { val: result, len: count };
}

function dumpMethodDetailed(className, methodName) {
  for (let i = 0; i < classDefsSize; i++) {
    const cOff = classDefsOff + i * 32;
    const classIdx = buf.readUInt32LE(cOff);
    const cName = getType(classIdx);
    if (!cName.includes(className)) continue;

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

      const mFull = getMethod(mIdx);
      if (mFull.includes(methodName)) {
        console.log(`\n================== METHOD: ${mFull} (codeOff: ${codeOff.val}) ==================`);
        disassemble(codeOff.val);
      }
    }
  }
}

function disassemble(codeOff) {
  const registersSize = buf.readUInt16LE(codeOff);
  const insSize = buf.readUInt16LE(codeOff + 2);
  const outsSize = buf.readUInt16LE(codeOff + 4);
  const triesSize = buf.readUInt16LE(codeOff + 6);
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
      const val = insns[ip + 1] >> 4;
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
    } else if (op === 0x22) { // new-instance
      const typeIdx = insns.readUInt16LE(ip + 2);
      desc += ` new-instance v${insns[ip+1]}, ${getType(typeIdx)}`;
      ip += 4;
    } else if (op === 0x23) { // new-array
      const typeIdx = insns.readUInt16LE(ip + 2);
      desc += ` new-array v${insns[ip+1]}, ${getType(typeIdx)}`;
      ip += 4;
    } else if (op === 0x26) { // fill-array-data
      const offset = insns.readInt32LE(ip + 2);
      const tablePos = ip + offset * 2;
      const size = insns.readUInt32LE(tablePos + 4);
      desc += ` fill-array-data size=${size}`;
      ip += 6;
    } else if (op === 0x38 || op === 0x39) { // if-eqz / if-nez
      const offset = insns.readInt16LE(ip + 2);
      desc += ` if-${op === 0x38 ? 'eqz' : 'nez'} -> pc=${(pc + offset).toString(16)}`;
      ip += 4;
    } else if (op === 0x32 || op === 0x33) { // if-eq / if-ne
      const offset = insns.readInt16LE(ip + 2);
      desc += ` if-${op === 0x32 ? 'eq' : 'ne'} -> pc=${(pc + offset).toString(16)}`;
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
      const offset = insns.readInt32LE(ip + 2);
      desc += ` packed-switch offset=${offset}`;
      ip += 6;
    } else if (op === 0x2c) { // sparse-switch
      const offset = insns.readInt32LE(ip + 2);
      desc += ` sparse-switch offset=${offset}`;
      ip += 6;
    } else {
      ip += 2;
    }
    console.log(desc);
  }
}

console.log('--- SyncCmdWrapper ---');
dumpMethodDetailed('SyncCmdWrapper', '->a');
dumpMethodDetailed('SyncCmdWrapper', '->b');
dumpMethodDetailed('SyncCmdWrapper', '->c');

console.log('--- DeviceReportEventParser ---');
dumpMethodDetailed('DeviceReportEventParser', '->a');
