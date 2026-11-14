const { chromium } = require('playwright');
const B='http://localhost:3136',SP=process.argv[2];
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
const NAMES=['The Strangeness','ITEM 1','Soft','Mashed','Strawberry Cheesecake Supreme','Supercalifragilistic','A B C D E F G','Pork','W','<b>Bold Name Here</b>'];
(async()=>{
  const r=await (await fetch(B+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'T'})})).json();
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
  for(const [w,hh] of [[1600,1300],[1280,800],[820,1100],[700,600],[420,800],[320,600]]){
    const p=await br.newPage({viewport:{width:w,height:hh}});await p.goto(B+'/host#'+r.hostCode);await p.waitForSelector('.stage');
    await p.evaluate((names)=>{document.querySelectorAll('.overlay').forEach(o=>o.remove());
      const ts=tiersOf(),items=names.map((n,i)=>({id:'x'+i,name:n,final:ts[i%3].id,shown:true,rank:i,counts:{},votes:0}));
      const d=Object.assign({},S.data,{items});const st=document.querySelector('.stage');st.replaceChildren(boardEl(d));fitRankText(st);watchFit(st);},NAMES);
    await p.waitForTimeout(400);
    const res=await p.evaluate(()=>[...document.querySelectorAll('.stage .rchip')].filter(c=>c.querySelector('.rtx')).map(c=>{const sp=c.querySelector('.rtx>span'),cr=c.getBoundingClientRect(),sr=sp.getBoundingClientRect();const fs=parseFloat(getComputedStyle(sp).fontSize);return {t:sp.textContent,fit:sp.scrollWidth<=sp.clientWidth+1,fs,lines:Math.round(sr.height/(fs*1.05)),inside:sr.left>=cr.left+cr.width*.08&&sr.right<=cr.right-cr.width*.08,dia:cr.width};}));
    const bad=res.filter(x=>(x.lines>1&&!/\s/.test(x.t))||!x.inside||!x.fit);
    ok(res.length===NAMES.length&&bad.length===0,w+'px: '+res.length+' tiles, one line, inside circle '+(bad.length?JSON.stringify(bad):'(min font '+Math.min(...res.map(x=>x.fs)).toFixed(1)+'px)'));
    if(w===320||w===1600)await p.screenshot({path:SP+'/fit'+w+'.png'});
    await p.close();
  }
  // guest tile + host question circle
  const g=await br.newPage({viewport:{width:390,height:800}});await g.goto(B+'/play#'+r.joinCode);await g.waitForSelector('.gate');
  await g.evaluate((names)=>{const w=document.createElement('div');w.style.cssText='display:flex;flex-wrap:wrap;gap:8px;padding:8px;position:fixed;inset:0;background:#063;z-index:99';names.forEach(n=>w.append(h('div',{class:'tile-wrap'},tile({name:n},true))));document.body.append(w);},NAMES);
  await g.waitForTimeout(500);
  const gr=await g.evaluate(()=>[...document.querySelectorAll('.tile .tt')].map(t=>{const b=t.closest('.tile').getBoundingClientRect(),r=t.getBoundingClientRect(),fs=parseFloat(getComputedStyle(t).fontSize);return {t:t.textContent,one:r.height<fs*1.6,inside:r.left>=b.left&&r.right<=b.right};}));
  ok(gr.every(x=>x.inside),'guest tiles: one line, inside circle '+JSON.stringify(gr.filter(x=>!(x.one&&x.inside))));
  await g.screenshot({path:SP+'/fitg.png'});
  // the guest tile and the host's big circle share one look
  const gt=await g.evaluate(()=>{const t=document.querySelector('.tile');const cs=getComputedStyle(t);const tt=t.querySelector('.tt');return {sh:cs.boxShadow,fw:cs.fontWeight,bg:cs.backgroundColor,pad:cs.padding,dia:t.getBoundingClientRect().width};});
  const hp=await br.newPage({viewport:{width:1280,height:800}});await hp.goto(B+'/host#'+r.hostCode);await hp.waitForSelector('.stage');
  const ht=await hp.evaluate(async(names)=>{document.querySelectorAll('.overlay').forEach(o=>o.remove());const w=document.createElement('div');w.style.cssText='position:fixed;left:20px;top:20px;width:300px;z-index:99';const c=h('div',{class:'qcircle'});const q=h('div',{class:'qt'},rich(names));c.append(q);w.append(c);document.body.append(w);fitInCircle(c,q,'auto');await new Promise(r=>setTimeout(r,300));const cs=getComputedStyle(c),qs=getComputedStyle(q);return {sh:cs.boxShadow,fw:cs.fontWeight,bg:cs.backgroundColor,dia:c.getBoundingClientRect().width,fs:parseFloat(qs.fontSize),pad:cs.padding};},'Mashed');
  const gfs=await g.evaluate(()=>{const w=document.createElement('div');w.style.cssText='position:fixed;inset:0;z-index:99';const t=tile({name:'Mashed'});w.append(h('div',{class:'tile-wrap'},t));document.body.append(w);return new Promise(r=>setTimeout(()=>{r({fs:parseFloat(getComputedStyle(t.querySelector('.tt')).fontSize),dia:t.getBoundingClientRect().width});},300));});
  ok(gt.sh===ht.sh&&gt.sh!=='none','same drop shadow: '+gt.sh+' | '+ht.sh);
  ok(gt.fw===ht.fw&&gt.bg===ht.bg,'same weight and colour');
  ok(Math.abs(gfs.fs/gfs.dia-ht.fs/ht.dia)<0.02,'same text-to-circle ratio: '+(gfs.fs/gfs.dia).toFixed(3)+' vs '+(ht.fs/ht.dia).toFixed(3));
  console.log(fails?'FAILED '+fails:'ALL PASS');await br.close();process.exit(0);
})().catch(e=>{console.log('Error '+e.stack);process.exit(1)});
