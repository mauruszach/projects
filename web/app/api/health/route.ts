export const dynamic='force-dynamic';
export async function GET(){
 try{
  const response=await fetch(`${process.env.POLYMARKET_WEB_ORIGIN||'http://127.0.0.1:3107'}/polymarket/api/health`,{cache:'no-store',signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw Error('unavailable');
  return Response.json({status:'ok',services:{site:'ok',polymarket:'ok'}},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({status:'unavailable',services:{site:'ok',polymarket:'unavailable'}},{status:503,headers:{'Cache-Control':'no-store'}})}
}
