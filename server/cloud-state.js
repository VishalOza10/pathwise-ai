import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createDatabase } from './database.js';
// Bounded fictional cohort only. DynamoDB is durable; SQLite is a per-request rule engine.
// Whole-cohort CAS trades concurrency for simplicity. It is not a multi-tenant production store.
const tables=['users','students','courses','assignments','grades','alerts','notes','resources','sessions','audit','plans','plan_activity','demo_migrations'];
export function encodeState(db){
  const data=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));
  const raw=JSON.stringify(data);
  const body=gzipSync(raw);
  if(body.length>300000 || Buffer.byteLength(raw)>4000000)throw new Error('Demo storage limit reached');
  return {body,digest:createHash('sha256').update(raw).digest('hex')};
}
export function decodeState(body,password){
  const data=JSON.parse(gunzipSync(body,{maxOutputLength:4000000}).toString('utf8'));
  const db=createDatabase(':memory:',password,false);
  try{
    db.exec('BEGIN');
    for(const table of tables){
      const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
      const statement=db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
      for(const row of data[table]||[])statement.run(...columns.map(c=>row[c]??null));
    }
    db.exec('COMMIT');return db;
  }catch(error){db.close();throw error;}
}
