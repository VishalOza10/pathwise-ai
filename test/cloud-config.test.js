import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudConfig} from '../server/cloud-config.js';
import {spawnSync} from 'node:child_process';

test('cloud packaging and startup reject missing durable configuration and unsafe origins',()=>{
  assert.throws(()=>cloudConfig({}),/configuration incomplete/);
  assert.throws(()=>cloudConfig({AWS_APP_ID:'example',AWS_BRANCH:'main'}),/configuration incomplete/);
  for(const origin of ['http://example.com','https://example.com/','https://user:password@example.com','https://example.com/path'])
    assert.throws(()=>cloudConfig({APP_ORIGIN:origin,PATHWISE_TABLE:'DemoTable'}),/HTTPS origin/);
  assert.throws(()=>cloudConfig({APP_ORIGIN:'https://example.com',PATHWISE_TABLE:'invalid/table'}),/table name/);
});

test('cloud configuration derives Amplify origin and excludes unrelated environment secrets',()=>{
  assert.deepEqual(cloudConfig({AWS_APP_ID:'example',AWS_BRANCH:'main',PATHWISE_TABLE:'PathWiseData',SECRET:'not-to-be-published'}),
    {origin:'https://main.example.amplifyapp.com',table:'PathWiseData',region:'us-east-1'});
  const saved={origin:'https://main.example.amplifyapp.com',table:'PathWiseData',region:'us-east-1'};
  assert.deepEqual(cloudConfig({},saved),saved);
});

test('the actual Amplify build fails before packaging when storage is absent',()=>{
  const env={...process.env,APP_ORIGIN:'',PATHWISE_TABLE:'',AWS_APP_ID:'example',AWS_BRANCH:'main'};
  const run=spawnSync(process.execPath,['scripts/build-amplify.mjs'],{env,encoding:'utf8'});
  assert.equal(run.status,1);
  assert.match(run.stderr,/Deployment configuration incomplete/);
  assert.doesNotMatch(run.stdout,/bundle created/);
});
