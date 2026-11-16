const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes2.dex');

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

function dumpClass(classIdxNum) {
  const cOff = classDefsOff + classIdxNum * 32;
  const classIdx = buf.readUInt32LE(cOff);
  const className = getType(classIdx);
  const classDataOff = buf.readUInt32LE(cOff + 24);
  console.log(`\n================== CLASS: ${className} (dataOff: ${classDataOff}) ==================`);
  if (classDataOff === 0) return;

  let p = classDataOff;
  const staticFieldsSize = readUleb128(p); p += staticFieldsSize.len;
  const instanceFieldsSize = readUleb128(p); p += instanceFieldsSize.len;
  const directMethodsSize = readUleb128(p); p += directMethodsSize.len;
  const virtualMethodsSize = readUleb128(p); p += virtualMethodsSize.len;

  // skip fields
  let fIdx = 0;
  for (let i = 0; i < staticFieldsSize.val; i++) {
    const dIdx = readUleb128(p); p += dIdx.len;
    fIdx += dIdx.val;
    const access = readUleb128(p); p += access.len;
  }
  fIdx = 0;
  for (let i = 0; i < instanceFieldsSize.val; i++) {
    const dIdx = readUleb128(p); p += dIdx.len;
    fIdx += dIdx.val;
    const access = readUleb128(p); p += access.len;
  }

  // methods
  let mIdx = 0;
  const allMethods = [];
  for (let i = 0; i < directMethodsSize.val; i++) {
    const dIdx = readUleb128(p); p += dIdx.len;
    mIdx += dIdx.val;
    const access = readUleb128(p); p += access.len;
    const codeOff = readUleb128(p); p += codeOff.len;
    allMethods.push({ idx: mIdx, codeOff: codeOff.val, isVirtual: false });
  }
  mIdx = 0;
  for (let i = 0; i < virtualMethodsSize.val; i++) {
    const dIdx = readUleb128(p); p += dIdx.len;
    mIdx += dIdx.val;
    const access = readUleb128(p); p += access.len;
    const codeOff = readUleb128(p); p += codeOff.len;
    allMethods.push({ idx: mIdx, codeOff: codeOff.val, isVirtual: true });
  }

  for (const m of allMethods) {
    const mName = getMethod(m.idx);
    console.log(`\n  Method: ${mName} (codeOff: ${m.codeOff})`);
    if (m.codeOff === 0) continue;

    // Code Item
    const registersSize = buf.readUInt16LE(m.codeOff);
    const insSize = buf.readUInt16LE(m.codeOff + 2);
    const outsSize = buf.readUInt16LE(m.codeOff + 4);
    const triesSize = buf.readUInt16LE(m.codeOff + 6);
    const debugInfoOff = buf.readUInt32LE(m.codeOff + 8);
    const insnsSize = buf.readUInt32LE(m.codeOff + 12);

    const codeStart = m.codeOff + 16;
    const codeEnd = codeStart + insnsSize * 2;
    const insns = buf.slice(codeStart, codeEnd);

    // scan for const-string, const-string/jumbo, sget, invoke-static/virtual, const-int
    const foundStrings = [];
    const calledMethods = [];
    const constInts = [];

    let ip = 0;
    while (ip < insns.length) {
      const op = insns[ip];
      if (op === 0x1a) { // const-string
        const strIdx = insns.readUInt16LE(ip + 2);
        foundStrings.push(getString(strIdx));
        ip += 4;
      } else if (op === 0x1b) { // const-string/jumbo
        const strIdx = insns.readUInt32LE(ip + 2);
        foundStrings.push(getString(strIdx));
        ip += 6;
      } else if (op === 0x6e || op === 0x6f || op === 0x70 || op === 0x71 || op === 0x72) { // invoke-kind
        const mId = insns.readUInt16LE(ip + 2);
        calledMethods.push(getMethod(mId));
        ip += 6;
      } else if (op === 0x13) { // const/16
        const val = insns.readInt16LE(ip + 2);
        constInts.push(val);
        ip += 4;
      } else if (op === 0x15) { // const-high16
        ip += 4;
      } else if (op === 0x14) { // const
        const val = insns.readInt32LE(ip + 2);
        constInts.push(val);
        ip += 6;
      } else if (op === 0x12) { // const/4
        const val = (insns[ip + 1] >> 4);
        constInts.push(val);
        ip += 2;
      } else {
        // default step 2 bytes
        ip += 2;
      }
    }

    if (foundStrings.length > 0) {
      console.log(`    Strings: ${JSON.stringify(foundStrings)}`);
    }
    if (constInts.length > 0) {
      // filter interesting ints
      const interesting = constInts.filter(x => (x >= 1000 && x <= 1100) || (x >= 0x80 && x <= 0xff) || (x >= 1 && x <= 50));
      if (interesting.length > 0) {
        console.log(`    Interesting Ints: ${JSON.stringify(interesting)}`);
      }
    }
    const calls = calledMethods.filter(c => c.includes('Pull') || c.includes('send') || c.includes('Write') || c.includes('write') || c.includes('Sync') || c.includes('Step') || c.includes('Byte'));
    if (calls.length > 0) {
      console.log(`    Key Calls: ${JSON.stringify(calls.slice(0, 10))}`);
    }
  }
}

// Dump StepSync, HRSync, PullSync, PullRead, PullWrite
[4170, 4172, 4173, 4184, 4188, 4189, 4190, 4151].forEach(dumpClass);
