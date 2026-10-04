// Disposable, local-only copies for video rehearsal; the saved demo database is untouched.
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/database.js';
const normalDb=createDatabase();
const failureDb=createDatabase();
const servers=[
  createApp({db:normalDb,origin:'http://localhost:3002'}).listen(3002,'127.0.0.1',()=>console.info('Rehearsal: http://localhost:3002')),
  createApp({db:failureDb,origin:'http://127.0.0.1:3003',aiMode:'unavailable'}).listen(3003,'127.0.0.1',()=>console.info('AI outage rehearsal: http://127.0.0.1:3003')),
];
function stop(){for(const server of servers)server.close();normalDb.close();failureDb.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
