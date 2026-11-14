const { chromium } = require('playwright');
const B='http://localhost:3131', SP=process.argv[2];
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});return r.json().catch(()=>({}));};
const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  const r=await j('POST','/api/rooms',{name:'Drag'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  await act({type:'cfg',timer:6,hostVotes:true});
  await act({type:'add',items:['Mushy','Soft','Mashed']});
  let hv=await snap('/api/host/'+H+'/events');
  // place all three via the host: open, host vote, close, reveal
  for(const it of hv.items){
    await act({type:'open',id:it.id});await act({type:'hvote',id:it.id,tier:hv.tiers[0].id});
    await act({type:'close'});await act({type:'reveal',id:it.id});await sleep(300);
  }
  hv=await snap('/api/host/'+H+'/events');
  console.log('placed',hv.items.map(i=>i.name+':'+i.final+':'+i.shown).join(' '));
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const errs=[];const p=await br.newPage({viewport:{width:1100,height:760}});
  p.on('pageerror',e=>errs.push(''+e));p.on('console',m=>{if(m.type()==='error'&&!/40\d/.test(m.text()))errs.push(m.text());});
  await p.goto(B+'/host#'+H);await p.waitForSelector('.rchip',{timeout:8000});
  await p.evaluate(()=>{try{closeAll();}catch(e){}});
  const chip=p.locator('.rchip[title^="Soft"]');
  await chip.dblclick({delay:60});await p.waitForTimeout(400);
  let bb=await chip.boundingBox();
  const oldRow=await p.locator('.rrow[data-tier="'+hv.tiers[0].id+'"]').boundingBox();
  const tr=await p.locator('.rrow[data-tier="'+hv.tiers[3].id+'"]').boundingBox();
  await p.mouse.move(bb.x+20,bb.y+20);await p.mouse.down();
  await p.mouse.move(bb.x+60,bb.y+60,{steps:2});
  const gp=await p.evaluate(()=>{const g=document.querySelector('.rchip.ghost');if(!g)return null;const r=g.getBoundingClientRect();return {cx:r.left+r.width/2,cy:r.top+r.height/2};});
  ok(gp&&Math.abs(gp.cx-(bb.x+60))<14&&Math.abs(gp.cy-(bb.y+60))<14,'ghost sits under the cursor right away: '+JSON.stringify(gp)+' vs '+(bb.x+60)+','+(bb.y+60));
  await sleep(1200); // past the unlock pulse delay
  const gp1=await p.evaluate(()=>{const g=document.querySelector('.rchip.ghost');const r=g.getBoundingClientRect();return {cx:r.left+r.width/2,cy:r.top+r.height/2,an:getComputedStyle(g).animationName};});
  ok(gp1.an==='none'&&Math.abs(gp1.cx-(bb.x+60))<6,'ghost still under the cursor after 1.2s, no animation: '+JSON.stringify(gp1));
  await p.mouse.move(tr.x+200,tr.y+30,{steps:10});
  const gp2=await p.evaluate(()=>{const g=document.querySelector('.rchip.ghost');const r=g.getBoundingClientRect();return {cx:r.left+r.width/2,cy:r.top+r.height/2};});
  ok(Math.abs(gp2.cx-(tr.x+200))<6&&Math.abs(gp2.cy-(tr.y+30))<6,'ghost tracks the cursor with no lag: '+JSON.stringify(gp2));
  await p.mouse.up();
  let minY=1e9;for(let i=0;i<40;i++){const y=await p.evaluate(()=>{const g=document.querySelector('.rchip.ghost');if(!g)return null;const r=g.getBoundingClientRect();return r.top+r.height/2;});if(y!==null)minY=Math.min(minY,y);await sleep(30);}
  ok(minY>oldRow.y+oldRow.height,'the floating tile never heads for the old tier (min y '+Math.round(minY)+' vs old row bottom '+Math.round(oldRow.y+oldRow.height)+')');
  await sleep(120);
  ok(minY<1e9,'ghost stayed afloat while the move landed (no vanish)');
  await sleep(900);
  ok(await p.locator('.rchip.ghost').count()===0,'ghost gone after gliding in');
  hv=await snap('/api/host/'+H+'/events');ok(hv.items.find(i=>i.name==='Soft').final===hv.tiers[3].id,'Soft landed in D');
  ok(await p.locator('.rrow[data-tier="'+hv.tiers[3].id+'"] .rchip[title^="Soft"]').isVisible(),'Soft visible in its new tier');
  ok(await p.locator('.rchip[style*="hidden"]').count()===0,'no tile left hidden');
  // drop on empty space (outside any row) -> glides back
  const c2=p.locator('.rchip[title^="Mushy"]');await c2.dblclick({delay:60});await p.waitForTimeout(400);
  bb=await c2.boundingBox();
  await p.mouse.move(bb.x+20,bb.y+20);await p.mouse.down();await p.mouse.move(bb.x+40,bb.y+40,{steps:3});await p.mouse.move(60,740,{steps:6});await p.mouse.up();
  await sleep(900);
  ok(await p.locator('.rchip.ghost').count()===0&&await p.locator('.rchip.dragging').count()===0,'dropped on nothing: ghost glides home, tile restored');
  hv=await snap('/api/host/'+H+'/events');ok(hv.items.find(i=>i.name==='Mushy').final===hv.tiers[0].id,'Mushy unchanged');
  console.log(errs.length?'ERRS '+errs.join('; '):'ERRS none');
  console.log(fails?'FAILED '+fails:'ALL PASS');await br.close();process.exit(0);
})().catch(e=>{console.log('Error '+e.stack);process.exit(1)});
