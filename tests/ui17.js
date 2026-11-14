const { chromium } = require('playwright');
const B='http://localhost:3141', SP=process.argv[2];
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const x=await r.json().catch(()=>({}));x._s=r.status;return x;};
const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  const r=await j('POST','/api/rooms',{name:'Vis'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  await act({type:'cfg',tie:'slots',timer:8});
  await act({type:'add',items:['Tie1','Tie2']});
  const nm=(c,n)=>j('POST','/api/join/'+J+'/name',{cid:c,pw:'test1234',name:n});
  for(let i=1;i<=12;i++)await nm('cidui17-'+String(i).padStart(2,'0'),'P'+i);
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const errs=[];const mk=async(n,vp)=>{const p=await br.newPage({viewport:vp});p.on('pageerror',e=>errs.push(n+' '+e));p.on('console',m=>{if(m.type()==='error'&&!/40\d/.test(m.text()))errs.push(n+' '+m.text());});return p;};
  // ---- gate + claim, in the UI
  const g=await mk('g',{width:390,height:800});await g.goto(B+'/play#'+J);await g.waitForSelector('.gate');
  const gt=await g.locator('.gate').innerText();
  ok(gt.includes('This is just so you can get back in using the same name if you need to. Don’t use a real password.'),'exact password text');
  await g.fill('.gate input[aria-label="Your name"]','P3');await g.fill('.gate input[aria-label="Password"]','abc');await g.click('.gate button[type=submit]');
  await g.waitForSelector('.gate .notice.err:not([hidden])');ok(/at least 4/.test(await g.locator('.gate .notice.err').innerText()),'short password refused in the form');
  await g.fill('.gate input[aria-label="Password"]','nope-nope');await g.click('.gate button[type=submit]');
  await g.waitForFunction(()=>/already taken/.test(document.querySelector('.gate .notice.err').textContent));
  ok(await g.locator('.gate button:has-text("That’s me")').isVisible(),'"That\'s me" appears for a taken name');
  await g.screenshot({path:SP+'/v_gate.png'});
  await g.click('.gate button:has-text("That’s me")');
  await g.waitForFunction(()=>/doesn.t match/.test(document.querySelector('.gate .notice.err').textContent));ok(true,'wrong password message');
  await g.fill('.gate input[aria-label="Password"]','test1234');
  await g.click('.pwtoggle');ok((await g.locator('.gate input[aria-label="Password"]').getAttribute('type'))==='text','show/hide toggle');
  await g.click('.gate button:has-text("That’s me")');
  await g.waitForSelector('.psub');ok((await g.locator('.psub').innerText()).startsWith('P3'),'claimed P3 in the UI');
  // ---- slots reel: sample frames and make sure it ends on the winner and moves smoothly
  const hp=await mk('h',{width:1280,height:800});await hp.goto(B+'/host#'+H);await hp.waitForSelector('.qcircle');
  let hv=await snap('/api/host/'+H+'/events');const T=hv.items;
  for(const it of T){await act({type:'open',id:it.id});await j('POST','/api/join/'+J+'/vote',{cid:'cidui17-01',itemId:it.id,tier:hv.tiers[0].id});await j('POST','/api/join/'+J+'/vote',{cid:'cidui17-02',itemId:it.id,tier:hv.tiers[1].id});await act({type:'close'});await act({type:'reveal',id:it.id});await sleep(5500);await hp.evaluate(()=>{try{closeAll()}catch(e){}});
    hv=await snap('/api/host/'+H+'/events');const b=hv.items.find(i=>i.id===it.id);if(b.tie&&b.tie.phase==='wait'){
      // guest should show the waiting status
      ok(true,'tie waiting for '+b.name);
      await sleep(1500);
      const gs=await g.evaluate(()=>{const e=document.querySelector('.gstatus');return e?e.innerText:null;});
      ok(gs&&/Waiting for the tie-breaker/.test(gs)&&/decided at random/.test(gs),'guest status: '+JSON.stringify(gs));
      await g.screenshot({path:SP+'/v_status.png'});
      await act({type:'tiebreak',id:it.id});
      const ys=[];const t0=Date.now();
      while(Date.now()-t0<5900){const v=await g.evaluate(()=>{const o=document.querySelector('.slot-ov');if(!o)return null;const t=[...o.querySelectorAll('.slot-tile')].map(x=>({y:x.style.transform,o:+x.style.opacity,t:x.textContent})).filter(x=>x.o>0.9);return t.length?t[0].t:'-';});ys.push(v);await sleep(40);}
      const seen=ys.filter(Boolean);ok(seen.length>40,'reel visible on the guest for most of the run ('+seen.length+' samples)');
      const finalTile=[...seen].reverse().find(x=>x&&x!=='-');
      hv=await snap('/api/host/'+H+'/events');const bb=hv.items.find(i=>i.id===it.id);
      const wl=hv.tiers.find(t=>t.id===bb.tie.winner).label.replace(/<[^>]+>/g,'');
      ok(finalTile===wl,'reel lands on the winner: '+finalTile+' vs '+wl);
      break;}
  }
  await sleep(800);
  // ---- host leaderboard shows everyone
  await hp.click('#lb-btn');await hp.waitForSelector('.lb .lb-row');
  const n=await hp.locator('.lb .lb-row').count();ok(n===12,'host leaderboard lists all 12 players (incl. 0 pts): '+n);
  ok(!(await hp.locator('.lb').innerText()).includes('Top 10'),'no "Top 10 of N" footer');
  await hp.screenshot({path:SP+'/v_lb.png'});
  const g2=await mk('g2',{width:390,height:800});await g2.goto(B+'/play#'+J);
  console.log(errs.length?'ERRS '+errs.join('; '):'ERRS none');
  console.log(fails?'FAILED '+fails:'ALL PASS');await br.close();process.exit(0);
})().catch(e=>{console.log('Error '+e.stack);process.exit(1)});
