import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePackaging } from '../../scripts/validate-packaging.mjs';
const source = new URL('../../', import.meta.url);
async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'qling-packaging-fixture-'));
  await cp(new URL('packaging/',source),join(dir,'packaging'),{recursive:true});
  await cp(new URL('package.json',source),join(dir,'package.json'));
  return dir;
}
async function jsonEdit(dir,path,edit) {
  const file=join(dir,path), value=JSON.parse(await readFile(file,'utf8'));edit(value);await writeFile(file,JSON.stringify(value));
}
test('source validation preserves published 1.4.1 while release gate rejects unpublished 1.5.0',async()=>{
  const dir=await fixture();const result=await validatePackaging(dir);
  assert.equal(result.sourceVersion,'1.5.0');assert.equal(result.publishedVersion,'1.4.1');assert.deepEqual(result.errors,[]);
  assert.match((await validatePackaging(dir,{release:true})).errors.join(' '),/release pending/);
  await jsonEdit(dir,'package.json',p=>p.version='1.4.1');assert.deepEqual((await validatePackaging(dir,{release:true})).errors,[]);
});
test('source version cannot trail published installer state',async()=>{
  const dir=await fixture();await jsonEdit(dir,'package.json',p=>p.version='1.4.0');assert.match((await validatePackaging(dir)).errors.join(' '),/older than published/);
});
for(const field of ['version','url','hash']) test(`source validation still rejects mismatched bucket ${field}`,async()=>{
  const dir=await fixture();await jsonEdit(dir,'packaging/scoop-bucket/qling.json',p=>{
    if(field==='version')p.version='1.4.0';else p.architecture['64bit'][field]=field==='hash'?'a'.repeat(64):'https://example.invalid/v1.4.1.zip';
  });assert.ok((await validatePackaging(dir)).errors.length);
});
test('source validation rejects WinGet artifact/hash mismatch and invalid Scoop URL pin',async()=>{
  const dir=await fixture();const path=join(dir,'packaging/winget/Zzy-min.qling.yaml');
  await writeFile(path,(await readFile(path,'utf8')).replace(/InstallerSha256: [a-f0-9]+/,'InstallerSha256: '+'a'.repeat(64)));
  assert.match((await validatePackaging(dir)).errors.join(' '),/hash differs/);
  await jsonEdit(dir,'packaging/scoop/qling.json',p=>p.architecture['64bit'].url='https://example.invalid/1.4.1');
  assert.match((await validatePackaging(dir)).errors.join(' '),/url does not pin/);
});
