import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dev=process.argv.includes('--dev');
const children=[];
let stopping=false;
function stop(code=0){
 if(stopping)return;stopping=true;
 children.forEach(child=>child.kill('SIGTERM'));
 const timer=setTimeout(()=>{children.forEach(child=>child.kill('SIGKILL'));process.exit(code)},5000);
 Promise.all(children.map(child=>new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve)))).then(()=>{clearTimeout(timer);process.exit(code)});
}
function launch(directory,port,hostname,extra={}){
 const cwd=path.join(root,directory);
 const child=spawn(process.execPath,[path.join(cwd,'node_modules/next/dist/bin/next'),dev?'dev':'start',...(dev?['--webpack']:[]),'--hostname',hostname,'--port',String(port)],{cwd,env:{...process.env,...extra},stdio:'inherit'});
 children.push(child);
 child.once('error',error=>{console.error(error.message);stop(1)});
 child.once('exit',code=>{if(!stopping)stop(code||1)});
}
launch('projects/polymarket/web',3107,'127.0.0.1',{POLYMARKET_PROJECT_ROOT:path.join(root,'projects/polymarket')});
launch('web',process.env.PORT||3000,dev?'127.0.0.1':'0.0.0.0',{POLYMARKET_WEB_ORIGIN:'http://127.0.0.1:3107'});
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
