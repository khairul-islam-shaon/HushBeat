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

function dumpClassByName(targetName) {
  for (let i = 0; i < classDefsSize; i++) {
    const cOff = classDefsOff + i * 32;
    const classIdx = buf.readUInt32LE(cOff);
    const className = getType(classIdx);
    if (className === targetName || className.endsWith('/' + targetName + ';')) {
      dumpClassDef(i, className, cOff);
    }
  }
}

function dumpClassDef(classIdxNum, className, cOff) {
  const classDataOff = buf.readUInt32LE(cOff + 24);
  console.log(`\n================== CLASS: ${className} ==================`);
  if (classDataOff === 0) return;

  let p = classDataOff;
  const sfs = readUleb128(p); p += sfs.len;
  const ifs = readUleb128(p); p += ifs.len;
  const dms = readUleb128(p); p += dms.len;
  const vms = readUleb128(p); p += vms.len;

  let fIdx = 0;
  for (let i = 0; i < sfs.val; i++) {
    const dIdx = readUleb128(p); p += dIdx.len; fIdx += dIdx.val;
    const access = readUleb128(p); p += access.len;
    console.log(`  Static Field: ${getField(fIdx)}`);
  }
  fIdx = 0;
  for (let i = 0; i < ifs.val; i++) {
    const dIdx = readUleb128(p); p += dIdx.len; fIdx += dIdx.val;
    const access = readUleb128(p); p += access.len;
    console.log(`  Instance Field: ${getField(fIdx)}`);
  }

  let mIdx = 0;
  const allMethods = [];
  for (let i = 0; i < dms.val; i++) {
    const dIdx = readUleb128(p); p += dIdx.len; mIdx += dIdx.val;
    const access = readUleb128(p); p += access.len;
    const codeOff = readUleb128(p); p += codeOff.len;
    allMethods.push({ idx: mIdx, codeOff: codeOff.val, isVirtual: false });
  }
  mIdx = 0;
  for (let i = 0; i < vms.val; i++) {
    const dIdx = readUleb128(p); p += dIdx.len; mIdx += dIdx.val;
    const access = readUleb128(p); p += access.len;
    const codeOff = readUleb128(p); p += codeOff.len;
    allMethods.push({ idx: mIdx, codeOff: codeOff.val, isVirtual: true });
  }

  for (const m of allMethods) {
    const mName = getMethod(m.idx);
    console.log(`\n  Method: ${mName}`);
    if (m.codeOff === 0) continue;

    const insnsSize = buf.readUInt32LE(m.codeOff + 12);
    const codeStart = m.codeOff + 16;
    const codeEnd = codeStart + insnsSize * 2;
    const insns = buf.slice(codeStart, codeEnd);

    const foundStrings = [];
    const calledMethods = [];
    const constInts = [];
    const byteArrays = [];

    let ip = 0;
    while (ip < insns.length) {
      const op = insns[ip];
      if (op === 0x1a) {
        const strIdx = insns.readUInt16LE(ip + 2);
        foundStrings.push(getString(strIdx));
        ip += 4;
      } else if (op === 0x1b) {
        const strIdx = insns.readUInt32LE(ip + 2);
        foundStrings.push(getString(strIdx));
        ip += 6;
      } else if (op >= 0x6e && op <= 0x72) {
        const mId = insns.readUInt16LE(ip + 2);
        calledMethods.push(getMethod(mId));
        ip += 6;
      } else if (op === 0x13) {
        constInts.push(insns.readInt16LE(ip + 2));
        ip += 4;
      } else if (op === 0x14) {
        constInts.push(insns.readInt32LE(ip + 2));
        ip += 6;
      } else if (op === 0x12) {
        constInts.push(insns[ip + 1] >> 4);
        ip += 2;
      } else if (op === 0x26) {
        const offset = insns.readInt32LE(ip + 2);
        const tablePos = ip + offset * 2;
        if (tablePos >= 0 && tablePos + 8 < insns.length) {
          const elementWidth = insns.readUInt16LE(tablePos + 2);
          const size = insns.readUInt32LE(tablePos + 4);
          const data = insns.slice(tablePos + 8, tablePos + 8 + size * elementWidth);
          byteArrays.push(data.toString('hex'));
        }
        ip += 6;
      } else {
        ip += 2;
      }
    }

    if (foundStrings.length > 0) console.log(`    Strings: ${JSON.stringify(foundStrings)}`);
    if (constInts.length > 0) {
      const interesting = constInts.filter(x => (x >= 0x80 && x <= 0xff) || (x >= 0 && x <= 0x50) || (x >= 1000 && x <= 1100));
      if (interesting.length > 0) console.log(`    Const Ints: ${JSON.stringify(interesting)}`);
    }
    if (byteArrays.length > 0) console.log(`    Byte Arrays: ${JSON.stringify(byteArrays)}`);
    if (calledMethods.length > 0) {
      const filtered = calledMethods.filter(c => !c.startsWith('Ljava/lang/StringBuilder') && !c.startsWith('Ljava/lang/String;->valueOf'));
      if (filtered.length > 0) console.log(`    Calls: ${JSON.stringify(filtered.slice(0, 10))}`);
    }
  }
}

const targets = [
  'CmdConstant',
  'SyncCmdWrapper',
  'SyncDataV1EventParser',
  'DeviceReportEventParser',
  'DeviceInfoEventParser',
];

targets.forEach(dumpClassByName);
