const polymarketOrigin=process.env.POLYMARKET_WEB_ORIGIN||'http://127.0.0.1:3107';
export default {
 async rewrites(){return [{source:'/polymarket',destination:`${polymarketOrigin}/polymarket`},{source:'/polymarket/:path*',destination:`${polymarketOrigin}/polymarket/:path*`}];}
};
