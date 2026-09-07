const origin=process.argv[2]||'http://127.0.0.1:3008';
let failed=false;
for(const route of ['/','/predictor','/polymarket','/polymarket/how-it-works','/polymarket/graph-prices.json','/api/health']){
 try{const response=await fetch(new URL(route,origin),{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`HTTP ${response.status}`);console.log(`PASS ${route}`)}catch(error){console.error(`FAIL ${route}: ${error.message}`);failed=true}
}
try{
 const response=await fetch(new URL('/api/agent-step',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
 if(response.status!==401)throw Error(`Expected 401, got ${response.status}`);
 console.log('PASS simulation requires a visitor key');
}catch(error){console.error(error.message);failed=true}
process.exitCode=failed?1:0;
