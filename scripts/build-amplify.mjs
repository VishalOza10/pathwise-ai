import {mkdirSync,cpSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {cloudConfig} from '../server/cloud-config.js';
const config=cloudConfig(process.env);
const root=resolve('.'),out=resolve('.amplify-hosting');
if(out!==join(root,'.amplify-hosting'))throw new Error('Unexpected output directory');
rmSync(out,{recursive:true,force:true});
const compute=join(out,'compute','default'),assets=join(out,'static');
mkdirSync(compute,{recursive:true});mkdirSync(assets,{recursive:true});
for(const name of ['server','shared','public','node_modules','package.json'])cpSync(join(root,name),join(compute,name),{recursive:true});
cpSync(join(root,'public'),assets,{recursive:true});
cpSync(join(root,'shared'),join(assets,'shared'),{recursive:true});
cpSync(join(root,'node_modules','zod'),join(assets,'vendor','zod'),{recursive:true});
// Only these non-secret configuration values enter the server bundle.
writeFileSync(join(compute,'cloud-config.json'),JSON.stringify(config));
writeFileSync(join(compute,'server.js'),"import './server/cloud.js';\n");
writeFileSync(join(out,'deploy-manifest.json'),JSON.stringify({version:1,framework:{name:'express',version:'5.1.0'},routes:[{path:'/api/*',target:{kind:'Compute',src:'default'}},{path:'/*.*',target:{kind:'Static',cacheControl:'public,max-age=60'},fallback:{kind:'Compute',src:'default'}},{path:'/*',target:{kind:'Compute',src:'default'}}],computeResources:[{name:'default',runtime:'nodejs24.x',entrypoint:'server.js'}]},null,2));
console.info('Amplify bundle created. No local databases, .env files, or submission documents included.');
