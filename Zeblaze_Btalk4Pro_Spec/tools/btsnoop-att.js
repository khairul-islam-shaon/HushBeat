// Usage: node tools/btsnoop-att.js <btsnoop_hci.log>
// Full btsnoop parser: reassembles fragmented L2CAP over HCI ACL (unlike parse-btsnoop.js, which
// drops continuation fragments), decodes ATT writes/notifications, and maps handles when GATT
// discovery is present in the log. Get the log with: adb bugreport br.zip, then unzip
// FS/data/misc/bluetooth/logs/btsnoop_hci.log (needs Developer options > HCI snoop log = Enabled).
const fs=require('fs');const buf=fs.readFileSync(process.argv[2]);
if(buf.toString('latin1',0,8)!=='btsnoop\0')throw 'bad magic';
const dl=buf.readUInt32BE(12);const EP=0x00dcddb30f2f8000n;
const hex=b=>Buffer.from(b).toString('hex');
let off=16;const re={};const conns={};const out=[];const handles={};
const uuidS=b=>b.length==2?b.readUInt16LE(0).toString(16).padStart(4,'0'):hex(Buffer.from(b).reverse()).replace(/^(.{8})(.{4})(.{4})(.{4})/,'$1-$2-$3-$4-');
let lastReq={};
while(off+24<=buf.length){const il=buf.readUInt32BE(off+4),fl=buf.readUInt32BE(off+8),ts=buf.readBigUInt64BE(off+16);
let p=buf.subarray(off+24,off+24+il);off+=24+il;const rx=(fl&1)==1;
if(dl==1002){if(p[0]==0x04&&p[1]==0x3e){/*LE meta*/ const sub=p[3]; if(sub==1||sub==0x0a){const h=p.readUInt16LE(5);const a=hex(Buffer.from(p.subarray(8,14)).reverse());conns[h]=a;}} if(p[0]!==2)continue;p=p.subarray(1);}
const hdr=p.readUInt16LE(0),h=hdr&0xfff,pb=(hdr>>12)&3;const d=p.subarray(4);const key=h+(rx?'r':'t');
if(pb==1){if(!re[key])continue;re[key].b=Buffer.concat([re[key].b,d]);}else{re[key]={b:Buffer.from(d),ts};}
const r=re[key];if(r.b.length<4)continue;const l=r.b.readUInt16LE(0);if(r.b.length<l+4)continue;
const cid=r.b.readUInt16LE(2);const att=r.b.subarray(4,4+l);delete re[key];if(cid!==4)continue;
const op=att[0];const t=new Date(Number((r.ts-EP)/1000n));const tt=t.toISOString().slice(11,23);
const dir=rx?'W->P':'P->W';
if(op==0x11){const el=att[1];for(let i=2;i+el<=att.length;i+=el){const s=att.readUInt16LE(i),e=att.readUInt16LE(i+2);handles[s]='SVC '+uuidS(att.subarray(i+4,i+el))+' ..'+e.toString(16);}}
if(op==0x09){const el=att[1];for(let i=2;i+el<=att.length;i+=el){const vh=att.readUInt16LE(i+3);handles[vh]='CHR '+uuidS(att.subarray(i+5,i+el))+' props=0x'+att[i+2].toString(16);}}
if(op==0x05){const f=att[1];const el=f==1?4:18;for(let i=2;i+el<=att.length;i+=el){const hh=att.readUInt16LE(i);handles[hh]=handles[hh]||('DSC '+uuidS(att.subarray(i+2,i+el)));}}
const names={0x52:'WRITE_CMD',0x12:'WRITE_REQ',0x1b:'NOTIFY',0x1d:'INDICATE',0x0a:'READ_REQ',0x0b:'READ_RSP',0x02:'MTU_REQ',0x03:'MTU_RSP'};
if(!names[op])continue;let hd='',v;
if(op==0x0b){hd=lastReq[h];v=att.subarray(1);}else if(op==2||op==3){v=att.subarray(1);}else{hd=att.readUInt16LE(1);v=att.subarray(3);if(op==0x0a)lastReq[h]=hd;}
out.push(`${tt} c${h} ${dir} ${names[op].padEnd(9)} h=0x${(hd||0).toString(16).padStart(4,'0')} [${v.length}] ${hex(v)}`);}
console.log('# connections',JSON.stringify(conns));console.log('# handles');for(const k of Object.keys(handles).sort((a,b)=>a-b))console.log('0x'+(+k).toString(16).padStart(4,'0'),handles[k]);
console.log(out.join('\n'));
