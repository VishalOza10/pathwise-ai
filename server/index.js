import { createApp } from './app.js';
import { createDatabase } from './database.js';
import { mkdirSync } from 'node:fs';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PORT');
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const db = createDatabase(new URL('../data/pathwise.sqlite', import.meta.url));
const app = createApp({ db, origin: process.env.APP_ORIGIN || `http://localhost:${port}` });
const server = app.listen(port, '127.0.0.1', () => console.info(`PathWise academic prototype: http://localhost:${port}`));
function stop() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
