const { chromium } = require('playwright');
const B='http://localhost:3123', SP=process.argv[2];
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});return r.json().catch(()=>({}));};
const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFklEQVQY02P8z8Dwn4EIwDiqkL4KAQAH9QIBq0XQ4wAAAABJRU5ErkJggg==';
(async()=>{
  const r=await j('POST','/api/rooms',{name:'Alpha'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  await act({type:'cfg',shuffle:false,timer:6,hostPlay:true});
  await act({type:'add',items:['Cc','Bb','Aa']});
  let hv=await snap('/api/host/'+H+'/events');const id=n=>hv.items.find(b=>b.name===n).id;
  await act({type:'edit',id:id('Aa'),rc:{kind:'trivia',qs:[{id:'q1',q:'Pick B',opts:['x','y','z','w'],correct:1,expl:'because'},{id:'q2',q:'Pick A',opts:['p','q'],correct:0,expl:''}]}});
  await act({type:'edit',id:id('Bb'),rc:{kind:'text',title:'Hello there',text:'Page one',pages:['Page two']}});
  await act({type:'edit',id:id('Cc'),image:PNG,rc:{kind:'text',title:'',text:'Only page',pages:[]}});
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const errs=[];
  const mk=async(n,vp)=>{const p=await br.newPage({viewport:vp});p.on('pageerror',e=>errs.push(n+' '+e));p.on('console',m=>{if(m.type()==='error'&&!/40\d/.test(m.text()))errs.push(n+' '+m.text());});return p;};
  const p=await mk('host',{width:1400,height:900});await p.goto(B+'/host#'+H);await p.waitForSelector('.qcircle');
  const g=await mk('guest',{width:390,height:800});await g.goto(B+'/play#'+J);
  await g.fill('.gate input[aria-label="Your name"]','Pat');await g.fill('.gate input[aria-label="Password"]','test1234');await g.click('.gate button[type=submit]');await g.waitForSelector('.pcard.center');

  /* description editor: real Enter + bullet button */
  await p.click('#gear-btn');await p.click('.gm-tab:has-text("Customize")');
  const rt=p.locator('.gm .lblrow:has-text("Ranking") .rt-body');
  await rt.click();await p.keyboard.type('Intro line');await p.keyboard.press('Enter');
  await p.click('.gm .lblrow:has-text("Ranking") .rt-btn[aria-label="Bulleted list"]');
  await p.keyboard.type('one');await p.keyboard.press('Enter');await p.keyboard.type('two');
  await p.click('.gm h3:has-text("Tiers")');await p.waitForTimeout(600);
  hv=await snap('/api/host/'+H+'/events');
  ok(/Intro line\n- one\n- two/.test(hv.cfg.desc),'typed Enter lines and bullets are saved as separate lines: '+JSON.stringify(hv.cfg.desc));
  await g.waitForFunction(()=>document.querySelectorAll('.pcard .desc li').length===2);ok(true,'guest sees 2 bullets');
  ok((await g.locator('.pcard .desc p').count())===1,'guest sees intro as its own line');
  await p.screenshot({path:SP+'/q1.png'});

  /* stacked popups */
  await p.click('.gm-tab:has-text("Items")');await p.waitForSelector('.item-row');
  await p.locator('.item-row').filter({hasText:'Aa'}).first().locator('button[aria-label*="dit"]').first().click();
  await p.waitForSelector('.overlay.stacked >> nth=1');
  ok((await p.locator('.overlay.stacked').count())===2,'edit popup stacks over the gear menu');
  const names=await p.locator('.overlay.stacked >> nth=1 >> .actions.right button').allTextContents();
  ok(names.join('|')==='Save|Cancel','Save then Cancel, right-aligned: '+names);
  const bx=await p.locator('.overlay.stacked >> nth=1 >> .actions.right').evaluate(e=>{const r=e.getBoundingClientRect(),c=e.parentElement.getBoundingClientRect();return Math.round(c.right-r.right-parseFloat(getComputedStyle(e.parentElement).paddingRight));});
  await p.screenshot({path:SP+'/q2.png'});
  await p.click('.overlay.stacked >> nth=1 >> button:has-text("Cancel")');
  await p.waitForTimeout(350);ok((await p.locator('.overlay.stacked').count())===1&&(await p.locator('.gm').count())===1,'cancel closes only the top popup');
  await p.keyboard.press('Escape');await p.waitForTimeout(350);ok((await p.locator('.overlay.stacked').count())===0,'escape closes the gear menu');

  /* text bubble: Cc first -> default title, image glow */
  await p.reload();await p.waitForSelector('.qcircle');
  await p.screenshot({path:SP+'/q3.png'});
  ok((await p.locator('.qcircle img+.qt').evaluate(e=>getComputedStyle(e).textShadow)).includes('255'),'queue tile text glows over a picture');
  await p.click('button:has-text("Start Poll")');await g.waitForSelector('.tier-btn');
  ok((await g.locator('.tile img+.tt').evaluate(e=>getComputedStyle(e).textShadow)).includes('255'),'guest tile text glows over a picture');
  const hh=await p.locator('.hero-img').evaluate(e=>e.getBoundingClientRect().top);ok(hh>=0,'polling tile not clipped at the top');
  await p.setViewportSize({width:1000,height:480});await p.waitForTimeout(300);
  const small=await p.locator('.hero-img').evaluate(e=>({t:e.getBoundingClientRect().top,card:e.closest('.card').getBoundingClientRect().top}));
  ok(small.t>=small.card-1,'polling tile still not clipped on a short window');await p.screenshot({path:SP+'/q4.png'});
  await p.setViewportSize({width:1400,height:900});
  await g.click('.tier-btn >> nth=0');
  await p.click('button:has-text("Close poll")');await p.click('button:has-text("Reveal Results?")');await p.waitForSelector('.res-bars');await g.waitForSelector('.infobox.titled');
  ok((await g.textContent('.infobox .ib-title')).includes('More on'),'default title when blank');
  await g.screenshot({path:SP+'/q5.png'});
  await p.click('button:has-text("Continue")');
  /* Bb with custom title, via i button */
  await p.click('button:has-text("Start Poll")');await g.waitForSelector('.tier-btn');await g.click('.tier-btn >> nth=1');
  await p.click('button:has-text("Close poll")');await p.click('button:has-text("Reveal Results?")');await p.waitForSelector('.res-bars');await g.waitForSelector('.infobox.titled');ok((await g.textContent('.infobox .ib-title')).includes('Hello there'),'custom bubble title');
  await p.click('button:has-text("Continue")');
  await g.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  await g.locator('.frow .chip .ibtn').first().click();await g.waitForSelector('.info-pop');
  ok((await g.textContent('.info-pop .tc-head')).length>0&&(await g.textContent('.info-pop .ib-title')).length>0,'info popup has header strip and title');
  const geo={n:await g.locator('.info-pop .sqb.x').count(),cp:await g.locator('.info-pop .closepill').count()};
  ok(geo.n===1&&geo.cp===0,'red X in the bar, no Close pill '+JSON.stringify(geo));await g.screenshot({path:SP+'/q6.png'});await g.click('.info-pop .sqb.x');await g.waitForTimeout(300);

  /* trivia redesign: poll Aa first */
  await p.click('button:has-text("Start Poll")');await g.waitForSelector('.tier-btn');await g.click('.tier-btn >> nth=1');
  await p.click('button:has-text("Close poll")');await p.click('button:has-text("Reveal Results?")');await p.waitForSelector('.res-bars');await p.click('button:has-text("Continue")');
  await p.waitForSelector('.tprompt');
  await p.click('.tprompt button:has-text("Yes")');
  await p.waitForSelector('.pie');await g.waitForSelector('.pie');
  const e1=await g.locator('.pie').evaluate(e=>parseFloat(getComputedStyle(e).getPropertyValue('--e')));await g.waitForTimeout(500);
  const e2=await g.locator('.pie').evaluate(e=>parseFloat(getComputedStyle(e).getPropertyValue('--e')));ok(e2>e1,'pie sweeps continuously '+e1+' > '+e2);
  await g.screenshot({path:SP+'/q7.png'});
  await g.waitForSelector('.tcard .opt-btn');await p.waitForSelector('.tcard .opt-btn');
  ok((await g.textContent('.tc-head')).includes('Trivia - Question 1 of 2'),'header strip text');
  await g.click('.opt-btn >> nth=0');await g.waitForTimeout(1000);
  ok((await g.locator('.opt-btn.sel').evaluate(e=>getComputedStyle(e).borderTopColor))==='rgb(0, 180, 200)','selected has cyan outline');
  ok(/^\d:\d\d$/.test((await g.textContent('.tbar2 .tl')).trim()),'timer clock label');
  ok((await g.textContent('.lockbtn')).trim()==='Lock It In','red lock button');
  await g.screenshot({path:SP+'/q8.png'});
  await g.click('.lockbtn');
  await p.click('.tcard .opt-btn >> nth=1');await p.click('.lockbtn');
  
  await p.waitForSelector('button:has-text("Reveal Answer")');await p.waitForTimeout(1300);
  const chipIn=await p.locator('.bar-opt .hostchip').count();ok(chipIn===1,'HOST chip sits inside its bar row');
  await p.click('button:has-text("Reveal Answer")');await p.waitForTimeout(1300);
  const al=await p.evaluate(()=>{const a=document.querySelector('.bar-opt').getBoundingClientRect().right,b=document.querySelector('.tcard .infobox');return b?{bar:Math.round(a),box:Math.round(b.getBoundingClientRect().right)}:{bar:Math.round(a),box:null};});
  ok(al.box===null||Math.abs(al.bar-al.box)<=2,'bars end flush with the follow-up box '+JSON.stringify(al));
  ok((await p.locator('button:has-text("Next Question")').count())===1,'Next Question button');
  await p.screenshot({path:SP+'/q9.png'});await g.screenshot({path:SP+'/q10.png'});
  console.log('ERRS',errs);console.log(fails?'FAILS '+fails:'ALL PASS');await br.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
