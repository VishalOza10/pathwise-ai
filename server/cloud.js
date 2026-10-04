import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createApp } from './app.js';
import { createDatabase } from './database.js';
import { encodeState, decodeState } from './cloud-state.js';

const config=existsSync(new URL('../cloud-config.json',import.meta.url))?JSON.parse(readFileSync(new URL('../cloud-config.json',import.meta.url),'utf8')):{};
const origin=process.env.APP_ORIGIN||config.origin;
const table=process.env.PATHWISE_TABLE||config.table;
const region=process.env.AWS_REGION||config.region||'us-east-1';
if(!origin?.startsWith('https://')||!table)throw new Error('Cloud origin and durable table configuration are required');
const parsed=new URL(origin);
if(parsed.origin!==origin)throw new Error('Invalid cloud origin');
const store=DynamoDBDocumentClient.from(new DynamoDBClient({region,maxAttempts:2}));
const demoPassword='Pathwise-Demo-Only-2026!'; // Explicit fictional classroom accounts, not real-user authentication.
const shellDb=createDatabase();
const shell=createApp({db:shellDb,origin,secureCookie:true});
function fail(res,status,message){res.removeHeader('Set-Cookie');res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:message}));}
async function cloudRequest(req,res){
  const started=Date.now(),requestId=randomBytes(5).toString('hex');
  if(req.headers.host!==parsed.host)return fail(res,403,'This host is not permitted.');
  if(!req.url.startsWith('/api/'))return shell(req,res);
  if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)return fail(res,403,'This request is not permitted.');
  if(Number(req.headers['content-length']||0)>16384)return fail(res,413,'This request is too large.');
  let db;
  try {
    // Cohort-wide limit is deliberately conservative and durable across compute instances.
    // It bounds demo abuse without trusting a client-supplied forwarding header.
    const login=req.url==='/api/auth/login';
    const bucket=`RATE#${login?'LOGIN':'API'}#${Math.floor(Date.now()/(login?900000:60000))}`;
    try{await store.send(new UpdateCommand({TableName:table,Key:{pk:bucket},UpdateExpression:'SET expiresAt=:expiry ADD requests :one',ConditionExpression:'attribute_not_exists(requests) OR requests < :limit',ExpressionAttributeValues:{':expiry':Math.floor(Date.now()/1000)+1800,':one':1,':limit':login?30:120}}));}
    catch(error){if(error.name==='ConditionalCheckFailedException')return fail(res,429,'The demo is busy. Please wait a little and try again.');throw error;}
    const item=(await store.send(new GetCommand({TableName:table,Key:{pk:'COHORT'},ConsistentRead:true}))).Item;
    db=item?decodeState(item.body,demoPassword):createDatabase(':memory:',demoPassword);
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    // Prevent an unbounded public demo session table.
    db.exec('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions ORDER BY expires_at DESC LIMIT -1 OFFSET 150)');
    const initial=encodeState(db);
    const app=createApp({db,origin,secureCookie:true});
    const originalEnd=res.end.bind(res);
    let ending=false;
    res.end=function(chunk,encoding,callback){
      if(ending)return res;ending=true;
      (async()=>{
        try{
          const next=encodeState(db);
          if(!item||initial.digest!==next.digest){
            await store.send(new PutCommand({TableName:table,Item:{pk:'COHORT',version:(item?.version||0)+1,body:next.body},ConditionExpression:item?'version=:version':'attribute_not_exists(pk)',...(item?{ExpressionAttributeValues:{':version':item.version}}:{})}));
          }
          originalEnd(chunk,encoding,callback);
        }catch(error){
          res.removeHeader('Set-Cookie');res.removeHeader('Content-Length');res.statusCode=error.name==='ConditionalCheckFailedException'?409:503;
          originalEnd(JSON.stringify({error:res.statusCode===409?'Another demo action was saved first. Refresh and retry.':'We could not save your changes. Please retry.'}));
          console.error(JSON.stringify({event:'cloud_save_failed',requestId,status:res.statusCode}));
        }finally{db.close();console.info(JSON.stringify({event:'request_finished',requestId,status:res.statusCode,durationMs:Date.now()-started}));}
      })();return res;
    };
    app(req,res);
  }catch(error){db?.close();console.error(JSON.stringify({event:'cloud_request_failed',requestId}));fail(res,503,'PathWise could not load saved data. Please try again.');}
}
http.createServer(cloudRequest).listen(3000,'0.0.0.0',()=>console.info('PathWise Amplify server ready'));
