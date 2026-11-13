'use strict';
var S={data:null,msg:'',msgErr:false,busy:false};
var $=function(id){return document.getElementById(id);};
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch(e){}return null;}
var memCid=null;
function getCid(){
  var c=store('btp_cid')||memCid;
  if(c&&/^[A-Za-z0-9-]{8,64}$/.test(c))return c;
  var a=new Uint8Array(12);
  try{crypto.getRandomValues(a);}catch(e){for(var i=0;i<12;i++)a[i]=Math.floor(Math.random()*256);}
  c=Array.prototype.map.call(a,function(x){return ('0'+x.toString(16)).slice(-2);}).join('');
  store('btp_cid',c);memCid=c;return c;
}

function put(parent){
  for(var i=1;i<arguments.length;i++){var c=arguments[i];if(c==null||c===false)continue;parent.append(c);}
}
function h(tag,attrs){
  var e=document.createElement(tag);
  attrs=attrs||{};
  Object.keys(attrs).forEach(function(k){
    var v=attrs[k];
    if(v===false||v==null)return;
    if(k==='class')e.className=v;
    else if(k==='text')e.textContent=v;
    else if(k==='tc'){var tt=tierById(v),col=tt?tt.color:(/^#/.test(v)?v:'#888888');e.style.setProperty('--tc',col);e.style.setProperty('--on-tier',inkFor(col));}
    else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),v);
    else e.setAttribute(k,v===true?'':v);
  });
  for(var i=2;i<arguments.length;i++){
    var kids=[].concat(arguments[i]);
    for(var j=0;j<kids.length;j++){var c=kids[j];if(c==null||c===false)continue;e.append(c.nodeType?c:document.createTextNode(String(c)));}
  }
  return e;
}
async function api(method,url,body){
  var r=await fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  var j={};try{j=await r.json();}catch(e){}
  if(!r.ok)throw new Error(j.error||'Something went wrong. Try again.');
  return j;
}

/* ---------- styled text ---------- */
var ALLOW={B:'b',STRONG:'b',I:'i',EM:'i',U:'u',S:'s',STRIKE:'s',DEL:'s',SUP:'sup',SUB:'sub'};
function safeHref(u){return typeof u==='string'&&u.length<=500&&/^(https?:\/\/|mailto:)/i.test(u);}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function serialize(root,nl){
  var out='';
  root.childNodes.forEach(function(n){
    if(n.nodeType===3){out+=escHtml(nl?n.nodeValue.replace(/[ \t\r]+/g,' '):n.nodeValue.replace(/[ \r\n\t]+/g,' '));}
    else if(n.nodeType===1){
      if(nl&&n.nodeName==='BR'){out+='\n';return;}
      if(nl&&n.nodeName==='UL'){
        Array.prototype.forEach.call(n.children,function(li){
          if(out&&out.charAt(out.length-1)!=='\n')out+='\n';
          out+='- '+serialize(li,nl).replace(/\n+$/,'')+'\n';
        });
        return;
      }
      if(nl&&n.nodeName==='DIV'){
        if(out&&out.charAt(out.length-1)!=='\n')out+='\n';
        var di=serialize(n,nl);out+=di;if(di&&di.charAt(di.length-1)!=='\n')out+='\n';
        return;
      }
      var inner=serialize(n,nl);
      if(n.nodeName==='A'){
        var href=n.getAttribute('href')||'';
        out+=safeHref(href)?'<a href="'+escHtml(href).replace(/"/g,'&quot;')+'">'+inner+'</a>':inner;
      }else if(ALLOW[n.nodeName]){out+='<'+ALLOW[n.nodeName]+'>'+inner+'</'+ALLOW[n.nodeName]+'>';}
      else out+=inner;
    }
  });
  return out;
}
function parseHtml(html){return new DOMParser().parseFromString('<!doctype html><body>'+(html||''),'text/html').body;}
function rich(html){
  var f=document.createDocumentFragment();
  (function walk(src,dst){
    src.childNodes.forEach(function(n){
      if(n.nodeType===3){dst.appendChild(document.createTextNode(n.nodeValue));}
      else if(n.nodeType===1){
        if(n.nodeName==='A'){
          var href=n.getAttribute('href');
          if(safeHref(href)){var a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';dst.appendChild(a);walk(n,a);return;}
        }
        if(ALLOW[n.nodeName]){var e=document.createElement(ALLOW[n.nodeName]);dst.appendChild(e);walk(n,e);}
        else walk(n,dst);
      }
    });
  })(parseHtml(html),f);
  return f;
}
function plain(html){return (parseHtml(html).textContent||'').replace(/\s+/g,' ').trim();}
/* ---------- tiers ---------- */
var DEF_TIERS=[['S','#ff4d5a'],['A','#ff8000'],['B','#ffe05a'],['C','#00cc70'],['D','#00c0ff'],['E','#8080ff'],['F','#e060ff']].map(function(x){return {id:x[0],label:x[0],color:x[1]};});
function tiersOf(){return (S.data&&S.data.tiers&&S.data.tiers.length)?S.data.tiers:DEF_TIERS;}
function tierById(id){var a=tiersOf();for(var i=0;i<a.length;i++)if(a[i].id===id)return a[i];return null;}
function tname(id){var t=tierById(id);return t?plain(t.label):'';}
function tlab(t){return rich(t.label);}
function inkFor(hex){return '#000';}
function nm(b){return plain(b.name)?rich(b.name):'(picture)';}
function sleepless(){return window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;}
/* motion: nothing just appears. rise() unhides an element by growing it from nothing while it fades and slides up, so its neighbours glide
   to make room; sink() does the reverse. Reduced-motion users get a plain fade. */
var EASE='cubic-bezier(.22,.8,.3,1)';
var PADK=['paddingTop','paddingBottom','marginTop','marginBottom'];
function rise(el,o){
  o=o||{};if(!el)return null;
  if(o.imm||!el.animate){el.hidden=false;return null;}
  el.hidden=false;
  if(sleepless()){var f=el.animate([{opacity:0},{opacity:1}],{duration:260,delay:o.delay||0,fill:'backwards'});return f;}
  var cs=getComputedStyle(el),hh=el.getBoundingClientRect().height,from={opacity:0,height:'0px',transform:'translateY(14px)'},to={opacity:1,height:hh+'px',transform:'none'};
  PADK.forEach(function(k){from[k]='0px';to[k]=cs[k];});
  var bs=el.style.boxSizing,ov=el.style.overflow;el.style.boxSizing='border-box';el.style.overflow='hidden';
  var a=el.animate([from,to],{duration:o.ms||560,easing:EASE,delay:o.delay||0,fill:'backwards'});
  var done=function(){el.style.boxSizing=bs;el.style.overflow=ov;};a.onfinish=done;a.oncancel=done;
  return a;
}
function sink(el,cb){
  if(!el||el.hidden||!el.animate||sleepless()){if(el)el.hidden=true;if(cb)cb();return;}
  var cs=getComputedStyle(el),hh=el.getBoundingClientRect().height,from={opacity:1,height:hh+'px'},to={opacity:0,height:'0px',transform:'translateY(-8px)'};
  PADK.forEach(function(k){from[k]=cs[k];to[k]='0px';});
  var bs=el.style.boxSizing,ov=el.style.overflow;el.style.boxSizing='border-box';el.style.overflow='hidden';
  var a=el.animate([from,to],{duration:380,easing:EASE,fill:'forwards'});
  a.onfinish=function(){el.hidden=true;el.style.boxSizing=bs;el.style.overflow=ov;a.cancel();if(cb)cb();};
}
var seenAt={};
// true when this exact view was already on screen a moment ago: re-draws then skip their entrance (no bar reload)
function seenBefore(key){var t=seenAt[key],n=Date.now();if(t===undefined){seenAt[key]=n;return false;}return n-t>800;}
/* tie-break notes: two deliberate lines */
// a name that ellipsizes when cramped and opens in place on hover (tap on touch); its badge stays put 10px away
function nameEl(content,host,cls){
  var t=h('span',{class:'nmt'},content),w=h('span',{class:'nmx'+(cls?' '+cls:''),tabindex:'0'},t,host?h('span',{class:'hostchip sm',text:'HOST'}):null);
  w.addEventListener('click',function(){w.classList.toggle('open');});
  w.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();w.classList.toggle('open');}});
  w.addEventListener('mouseleave',function(){w.classList.remove('open');});
  return w;
}
function tieNoteLines(tie){
  if(!tie||tie.phase!=='done')return [];
  var how=tie.how||tie.method,l=['Tie broken by '+tieMethodName(how)];
  if(how==='showdown'&&tie.by)return [l[0]+':',tie.by+', '+(tie.ms/1000).toFixed(2)+' seconds'];
  return l;
}
function tieTipLines(tie){
  var ts=tie.tiers.map(function(id){return tname(id);}).join(', '),l=['Tied between '+ts+'.'];
  if(tie.phase!=='done'){l.push('The tie has not been broken yet.');return l;}
  var how=tie.how||tie.method;
  l.push(how==='showdown'&&tie.by?'Showdown: '+tie.by+', '+(tie.ms/1000).toFixed(2)+' seconds':'Tie broken by '+tieMethodName(how));
  return l;
}
function tieNoteEl(tie){var ls=tieNoteLines(tie);return ls.length?h('div',{class:'tie-note-box'},ls.map(function(x){return h('div',{text:x});})):null;}
function tieMsgEl(how){
  return h('div',{class:'tie-msg'},h('div',{text:'No one got it! And there are no tie-breakers left!'}),
    h('div',{text:how==='slots'?'We’ll decide this with the slot machine!':'We’re going to have to find the average!'}));
}
/* Tie / Override chips: hover (desktop) or tap (phone) explains them briefly */
function statChip(label,cls,text){
  var tl=Array.isArray(text)?text:[text],plainTxt=tl.join(' ');
  var tip=h('span',{class:'stat-tip',role:'tooltip'},tl.map(function(x){return h('span',{class:'tl',text:x});})),t=null;
  var c=h('span',{class:'statchip '+cls,tabindex:'0',role:'button','aria-label':label+': '+plainTxt},label,tip);
  function toggle(){if(c.classList.contains('on')){c.classList.remove('on');clearTimeout(t);return;}c.classList.add('on');clearTimeout(t);t=setTimeout(function(){c.classList.remove('on');},2800);}
  c.addEventListener('click',function(e){e.stopPropagation();toggle();});
  c.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});
  return c;
}
// "Placed in [tier] [Tie] [Override]" from { final, over, auto, tie }
function placedLine(p){
  var line=h('div',{class:'pl-line'});
  var tieTxt=p.tie?tieTipLines(p.tie):null;
  if(p.final){
    var t=tierById(p.final);
    line.append(h('span',{class:'pl-t',text:'Placed in'}),h('span',{class:'result-tier pl-tile',tc:p.final},t?rich(t.label):'?'));
  }else if(!tieTxt)line.append(h('span',{class:'pl-t',text:'Not placed'}));
  if(tieTxt)line.append(statChip('Tie','tie',tieTxt));
  if(p.over&&p.auto)line.append(statChip('Override','over','Originally Polled '+tname(p.auto)));
  return line;
}
function confetti(){
  if(sleepless())return;
  var box=h('div',{class:'confetti','aria-hidden':'true'});
  var cols=['#ec5b5f','#f2933a','#ecc81f','#68bf6b','#45a6dc','#9a82e0'];
  for(var i=0;i<28;i++){
    var s=h('span');var a=Math.random()*Math.PI*2,d=120+Math.random()*220;
    s.style.setProperty('--dx',Math.round(Math.cos(a)*d)+'px');
    s.style.setProperty('--dy',Math.round(Math.sin(a)*d-80)+'px');
    s.style.setProperty('--r',Math.round(Math.random()*720-360)+'deg');
    s.style.background=cols[i%cols.length];s.style.animationDelay=(Math.random()*60)+'ms';
    box.append(s);
  }
  document.body.append(box);setTimeout(function(){box.remove();},1400);
}


/* ---------- icons ---------- */
var SV='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">';
var ICON_RESET=SV+'<polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
var ICON_X=SV+'<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
var ICON_PENCIL=SV+'<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
var ICON_PRINT=SV+'<polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>';
var ICON_LINK=SV+'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
var ICON_GEAR=SV+'<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
function iconBtn(svg,label,onclick,disabled,extra){
  var b=h('button',{class:'btn small icon'+(extra?' '+extra:''),type:'button','aria-label':label,title:label,disabled:disabled||null,onclick:onclick});
  b.innerHTML=svg;
  return b;
}

/* ---------- style toolbar text box ---------- */
function makeRich(o){
  var max=o.max||120,multi=!!o.multi;
  var body=h('div',{class:'rt-body'+(multi?' multi':''),contenteditable:'true',role:'textbox','aria-label':o.label||null,'aria-labelledby':o.labelledby||null,'data-placeholder':o.placeholder||'',spellcheck:'true'});
  if(o.html){
    if(o.bullets){
      var bre=/^(\s*(?:<[a-z]+>)*)\s*[-•*]\s+/i,ul=null;
      String(o.html).split('\n').forEach(function(l,i,all){
        if(bre.test(l)){if(!ul){ul=document.createElement('ul');body.append(ul);}var li=document.createElement('li');li.append(rich(l.replace(bre,'$1')));ul.append(li);}
        else{ul=null;if(i>0&&body.lastChild&&body.lastChild.nodeName!=='UL')body.append(document.createElement('br'));body.append(rich(l));}
      });
    }else body.append(rich(o.html));
  }
  var saved=null,linkRow=null,hint=null;
  var btns=[];
  function inBody(n){return n&&body.contains(n);}
  function saveSel(){var s=window.getSelection();if(s&&s.rangeCount&&inBody(s.anchorNode))saved=s.getRangeAt(0).cloneRange();}
  function restoreSel(){body.focus();if(!saved)return;var s=window.getSelection();s.removeAllRanges();s.addRange(saved);}
  function inList(){var s=window.getSelection();var n=s&&s.anchorNode;while(n&&n!==body){if(n.nodeName==='LI')return true;n=n.parentNode;}return false;}
  function inLink(){var s=window.getSelection();var n=s&&s.anchorNode;while(n&&n!==body){if(n.nodeName==='A')return n;n=n.parentNode;}return null;}
  function refresh(){
    btns.forEach(function(b){
      var on=false;
      try{
        if(b.cmd==='link')on=!!inLink();
        else on=document.queryCommandState(b.cmd);
      }catch(e){}
      b.el.setAttribute('aria-pressed',on?'true':'false');
    });
  }
  function onSel(){
    if(!document.body.contains(body)){document.removeEventListener('selectionchange',onSel);return;}
    saveSel();refresh();
  }
  document.addEventListener('selectionchange',onSel);
  function exec(cmd){
    restoreSel();
    try{document.execCommand('styleWithCSS',false,false);}catch(e){}
    try{document.execCommand(cmd,false,null);}catch(e){}
    saveSel();refresh();
  }
  function setHint(t,err){if(!hint)return;hint.textContent=t||'';hint.className='rt-hint'+(err?' err':'');hint.hidden=!t;}
  function openLink(){
    saveSel();
    var s=window.getSelection(),collapsed=!saved||saved.collapsed;
    linkRow.hidden=false;
    var a=inLink();
    linkInput.value=a?(a.getAttribute('href')||''):'';
    setHint(collapsed&&!a?'Select the text you want to link first.':'',false);
    linkInput.focus();
  }
  function applyLink(){
    var u=linkInput.value.trim();
    if(u&&!/^[a-z][a-z0-9+.-]*:/i.test(u))u='https://'+u;
    if(!safeHref(u)){setHint('Enter a web address, like https://example.com',true);return;}
    restoreSel();
    if(saved&&saved.collapsed&&!inLink()){setHint('Select the text you want to link first.',true);linkInput.focus();return;}
    try{document.execCommand('createLink',false,u);}catch(e){}
    body.querySelectorAll('a').forEach(function(a){if(!safeHref(a.getAttribute('href')))a.replaceWith.apply(a,a.childNodes);});
    saveSel();refresh();closeLink();
  }
  function removeLink(){restoreSel();try{document.execCommand('unlink',false,null);}catch(e){}saveSel();refresh();closeLink();}
  function closeLink(){linkRow.hidden=true;setHint('');body.focus();restoreSel();}
  var CMDS=[['bold','Bold','<b>B</b>'],['italic','Italic','<i>I</i>'],['underline','Underline','<u>U</u>'],['strikeThrough','Strikethrough','<s>S</s>'],
    ['superscript','Superscript','<span>x<sup>2</sup></span>'],['subscript','Subscript','<span>x<sub>2</sub></span>']];
  if(o.bullets)CMDS.push(['insertUnorderedList','Bulleted list','<span class="rt-bul">•≡</span>']);
  var bar=h('div',{class:'rt-bar',role:'toolbar','aria-label':'Text style'});
  CMDS.forEach(function(c){
    var b=h('button',{class:'rt-btn',type:'button','aria-label':c[1],title:c[1],'aria-pressed':'false'});
    b.innerHTML=c[2];
    b.addEventListener('mousedown',function(e){e.preventDefault();});
    b.addEventListener('click',function(){exec(c[0]);});
    btns.push({cmd:c[0],el:b});bar.append(b);
  });
  var lb=h('button',{class:'rt-btn',type:'button','aria-label':'Link',title:'Link','aria-pressed':'false'});
  lb.innerHTML=ICON_LINK;
  lb.addEventListener('mousedown',function(e){e.preventDefault();});
  lb.addEventListener('click',openLink);
  btns.push({cmd:'link',el:lb});bar.append(lb);
  var linkInput=h('input',{class:'text-in',type:'url',placeholder:'https://',autocomplete:'off','aria-label':'Link address'});
  linkInput.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();e.stopPropagation();applyLink();}
    else if(e.key==='Escape'&&!linkRow.hidden){e.preventDefault();e.stopPropagation();closeLink();}
  });
  linkRow=h('div',{class:'rt-link',hidden:true},linkInput,
    h('button',{class:'btn small primary',type:'button',onclick:applyLink,text:'Apply'}),
    h('button',{class:'btn small',type:'button',onclick:removeLink,text:'Remove Link'}));
  hint=h('div',{class:'rt-hint',hidden:true});
  bar.append(linkRow,hint);
  var root=h('div',{class:'rt'},body,h('div',{class:'rt-wrap'},h('div',{class:'rt-clip'},bar)));

  body.addEventListener('keydown',function(e){
    if(e.key==='Enter'){if(o.bullets&&inList())return;e.preventDefault();if(multi){try{document.execCommand('insertText',false,'\n');}catch(err){}}else if(o.onEnter)o.onEnter();}
  });
  body.addEventListener('beforeinput',function(e){
    if(e.inputType&&e.inputType.indexOf('insert')===0&&e.inputType!=='insertFromPaste'&&(body.textContent||'').length>=max)e.preventDefault();
    if((e.inputType==='insertParagraph'||e.inputType==='insertLineBreak')&&!(o.bullets&&inList()))e.preventDefault();
  });
  body.addEventListener('paste',function(e){
    e.preventDefault();
    var raw=((e.clipboardData&&e.clipboardData.getData('text/plain'))||'');
    if(o.onLines){var ls=raw.split(/\r?\n/).map(function(l){return l.trim();}).filter(Boolean);if(ls.length>1){o.onLines(ls);return;}}
    var t=multi?raw.replace(/\r/g,''):raw.replace(/\s+/g,' ');
    var room=Math.max(0,max-(body.textContent||'').length);
    if(t&&room)try{document.execCommand('insertText',false,t.slice(0,room));}catch(err){}
  });
  body.addEventListener('drop',function(e){e.preventDefault();});
  body.addEventListener('input',function(){if(!body.textContent)body.innerHTML='';if(o.onInput)o.onInput();});
  return {
    el:root,
    html:function(){return serialize(body,multi).trim();},
    plain:function(){return (body.textContent||'').replace(/[ \s]+/g,' ').trim();},
    clear:function(){body.innerHTML='';},
    focus:function(){
      body.focus();
      var r=document.createRange();r.selectNodeContents(body);r.collapse(false);
      var s=window.getSelection();s.removeAllRanges();s.addRange(r);saveSel();
    }
  };
}

/* ---------- popups ---------- */
var modalStack=[];
function closeModal(){
  var top=modalStack.pop();if(!top)return;
  if(sleepless()||!top.d.isConnected){top.d.remove();}
  else{top.d.classList.add('out');top.d.onmousedown=null;setTimeout(function(){top.d.remove();},200);}
  if(!modalStack.length&&window.onModalClose)window.onModalClose();
  var r=top.ret;
  if(r&&document.body.contains(r))try{r.focus();}catch(e){}
}
function focusables(m){
  return Array.prototype.filter.call(m.querySelectorAll('button:not([disabled]),input:not([disabled]):not([type=file]),[contenteditable="true"]'),function(el){
    return !el.closest('[hidden]')&&window.getComputedStyle(el).visibility!=='hidden';
  });
}
function openModal(modal,focusFn){
  var ret=document.activeElement;
  var d=h('div',{class:'overlay stacked'});d.append(modal);
  document.body.append(d);
  modalStack.push({d:d,ret:ret});
  d.onmousedown=function(e){if(e.target===d&&modalStack.length&&modalStack[modalStack.length-1].d===d)closeModal();};
  d.onkeydown=function(e){
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeModal();return;}
    if(e.key==='Tab'){
      var f=focusables(modal);if(!f.length)return;
      var first=f[0],last=f[f.length-1],cur=document.activeElement;
      if(e.shiftKey&&(cur===first||!modal.contains(cur))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(cur===last||!modal.contains(cur))){e.preventDefault();first.focus();}
    }
  };
  if(focusFn)focusFn();
  if(!d.contains(document.activeElement)){modal.setAttribute('tabindex','-1');try{modal.focus();}catch(e){}}
}
function resizeImage(file){
  return new Promise(function(res,rej){
    var r=new FileReader();r.onerror=rej;
    r.onload=function(){
      var im=new Image();im.onerror=rej;
      im.onload=function(){
        var m=480,s=Math.min(1,m/Math.max(im.width,im.height));
        var c=document.createElement('canvas');c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);
        c.getContext('2d').drawImage(im,0,0,c.width,c.height);
        res(c.toDataURL('image/jpeg',0.72));
      };
      im.src=r.result;
    };
    r.readAsDataURL(file);
  });
}

/* ---------- copy ---------- */
function helpTip(id,text){
  var btn=h('button',{class:'help',type:'button','aria-label':'About this setting','aria-expanded':'false','aria-describedby':id,text:'?'});
  btn.addEventListener('click',function(e){e.stopPropagation();var on=btn.getAttribute('aria-expanded')==='true';closeTips();btn.setAttribute('aria-expanded',on?'false':'true');});
  btn.addEventListener('blur',function(){btn.setAttribute('aria-expanded','false');});
  return [btn,h('div',{class:'tip',id:id,role:'tooltip',text:text})];
}
function closeTips(){Array.prototype.forEach.call(document.querySelectorAll('.help[aria-expanded="true"]'),function(b){b.setAttribute('aria-expanded','false');});}


/* ---------- shared: live trivia card and leaderboard ---------- */
S.off=0;S.shownPhase=null;S.lbOpen=false;
window.onModalClose=function(){S.lbOpen=false;if(window.modalClosed)window.modalClosed();};
function nowS(){return Date.now()+(S.off||0);}
function syncClock(d){var n=d&&(d.now||(d.tr&&d.tr.now));if(n)S.off=n-Date.now();}
function lphase(t){
  if(!t)return null;
  if(t.phase==='revealed')return 'revealed';
  if(t.phase==='hold')return 'hold';
  var n=nowS();
  if(n<t.startAt)return 'countdown';
  if(n<t.endAt)return 'question';
  return 'results';
}
function secsLeft(ms){return Math.max(0,Math.ceil(ms/1000));}
function optLetter(k){return String.fromCharCode(65+k);}
function tickTrivia(){
  var t=S.data&&S.data.tr;
  if(!t||t.phase==='revealed'||t.phase==='hold')return;
  var ph=lphase(t);
  if(ph!==S.shownPhase){if(window.rerenderTrivia)window.rerenderTrivia();return;}
  var n=nowS();
  Array.prototype.forEach.call(document.querySelectorAll('[data-tcount]'),function(el){
    el.textContent=String(ph==='countdown'?secsLeft(t.startAt-n):secsLeft(t.endAt-n));
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-tclock]'),function(el){el.textContent=fmtClock(t.endAt-n);});
}
setInterval(tickTrivia,200);
function fmtClock(ms){var sc=secsLeft(ms);return Math.floor(sc/60)+':'+(sc%60<10?'0':'')+(sc%60);}
/* smooth pie countdown + timer bar, driven by animation frames */
(function frame(){
  var t=S.data&&S.data.tr;
  if(t&&t.phase!=='revealed'&&t.phase!=='hold'){
    var n=nowS();
    Array.prototype.forEach.call(document.querySelectorAll('[data-pie]'),function(el){
      var e=Math.max(0,Math.min(1,(n-(t.startAt-3000))/3000));el.style.setProperty('--e',(e*360)+'deg');
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tbar]'),function(el){
      var tot=t.endAt-t.startAt,pc=Math.max(0,Math.min(100,(t.endAt-n)/tot*100));
      el.style.width=pc+'%';if(el.parentNode)el.parentNode.style.setProperty('--w',pc+'%');
    });
  }
  requestAnimationFrame(frame);
})();
/* shrink text inside a circle until it sits well inside it, with an even margin all round */
// Fit an item name inside a circle of diameter `dia`. One line by default; only when one line would force the text
// well below `cap`, break at the spaces (balanced) if that lets it stay clearly larger. Never clipped, never mid-word.
function fitName(el,dia,cap){
  var avail=dia*.8,hmax=dia*.62,i;
  el.style.textAlign='center';
  function one(){
    el.style.whiteSpace='nowrap';el.style.overflowWrap='normal';el.style.maxWidth='none';
    var lo=2,hi=cap;el.style.fontSize=hi+'px';
    if(el.getBoundingClientRect().width<=avail)return hi;
    for(i=0;i<9;i++){var mid=(lo+hi)/2;el.style.fontSize=mid+'px';if(el.getBoundingClientRect().width<=avail)lo=mid;else hi=mid;}
    el.style.fontSize=lo+'px';return lo;
  }
  var f1=one();
  if(f1>=cap*.7||!/\s/.test((el.textContent||'').trim()))return f1;
  el.style.whiteSpace='normal';el.style.maxWidth=avail+'px';el.style.textWrap='balance';
  var fits=function(){return el.scrollWidth<=el.clientWidth+1&&el.getBoundingClientRect().height<=hmax;};
  var lo=2,hi=cap,f2;el.style.fontSize=hi+'px';
  if(fits())f2=hi;else{for(i=0;i<9;i++){var m=(lo+hi)/2;el.style.fontSize=m+'px';if(fits())lo=m;else hi=m;}f2=lo;el.style.fontSize=lo+'px';}
  if(f2>f1*1.15)return f2;
  return one();
}
function fitInCircle(box,txt,maxPx,minPx){
  var t=null;
  function run(){if(!box.isConnected)return;var d=box.clientWidth;fitName(txt,d,maxPx==='auto'?Math.min(120,Math.max(10,d*0.27)):maxPx);}
  raf2(run);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){clearTimeout(t);t=setTimeout(run,30);});
  if(window.ResizeObserver){var ro=new ResizeObserver(function(){if(!box.isConnected){ro.disconnect();return;}clearTimeout(t);t=setTimeout(run,60);});ro.observe(box);}
}
function raf2(fn){requestAnimationFrame(function(){requestAnimationFrame(fn);});}
/* ---------- info box (text bubbles, trivia follow-ups): fades up, tap to move through pages ---------- */
function infoBox(pages,title,opt){
  pages=(pages||[]).filter(function(p){return plain(p);});
  if(!pages.length)return null;
  var i=0,n=pages.length;
  var body=h('div',{class:'ib-body pre'}),count=h('span',{class:'ib-count mono'}),arrow=h('span',{class:'ib-arrow','aria-hidden':'true',text:'▶'});
  var box=h('div',{class:'infobox'+(title?' titled':'')+(n>1?' multi':'')+(opt&&opt.anim?' cardin':'')},title&&plain(title)?h('div',{class:'ib-title'},rich(title)):null,body,n>1?h('div',{class:'ib-corner'},count,arrow):null);
  function draw(){
    body.replaceChildren(rich(pages[i]));
    body.classList.remove('fadeup');void body.offsetWidth;body.classList.add('fadeup');
    if(n>1){count.textContent=(i+1)+' / '+n;arrow.style.visibility=i<n-1?'visible':'hidden';}
  }
  if(n>1){
    function next(){i=(i+1)%n;draw();}
    box.setAttribute('role','button');box.setAttribute('tabindex','0');box.setAttribute('aria-label','Tap for the next page');
    box.addEventListener('click',next);
    box.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();next();}});
  }
  draw();
  return box;
}
function descEl(text){
  if(!text||!String(text).trim())return null;
  var panel=h('div',{class:'desc'}),ul=null,key=String(text).length+':'+String(text).slice(0,60);
  String(text).split('\n').forEach(function(l){
    var re=/^(\s*(?:<[a-z]+>)*)\s*[-•*]\s+/i;
    if(re.test(l)){if(!ul){ul=h('ul');panel.append(ul);}var li=h('li');li.append(rich(l.replace(re,'$1')));ul.append(li);}
    else{ul=null;if(plain(l)){var p=h('p');p.append(rich(l.trim()));panel.append(p);}}
  });
  var sign=h('span',{class:'dsign','aria-hidden':'true'});
  var bar=h('button',{class:'desc-bar',type:'button'},sign),box=h('div',{class:'descbox'},panel,bar);
  function paint(min){box.classList.toggle('min',min);panel.hidden=min;sign.textContent=min?'+':'\u2013';bar.setAttribute('aria-expanded',min?'false':'true');bar.setAttribute('aria-label',min?'Show the description':'Hide the description');}
  paint(store('btp_dmin')===key);
  bar.addEventListener('click',function(){
    var min=!box.classList.contains('min');store('btp_dmin',min?key:null);
    if(sleepless()||!panel.animate){paint(min);return;}
    panel.style.overflow='hidden';
    if(min){
      var h0=panel.getBoundingClientRect().height;
      var a=panel.animate([{height:h0+'px',opacity:1},{height:'0px',opacity:0,paddingTop:'0px',paddingBottom:'0px'}],{duration:420,easing:EASE});
      a.onfinish=function(){paint(true);panel.style.overflow='';};
    }else{
      paint(false);
      var h1=panel.getBoundingClientRect().height;
      var b2=panel.animate([{height:'0px',opacity:0,paddingTop:'0px',paddingBottom:'0px'},{height:h1+'px',opacity:1}],{duration:460,easing:EASE});
      b2.onfinish=function(){panel.style.overflow='';};
    }
  });
  return box;
}
/* poll countdown (host and guests) */
function pollLeft(){var d=S.data;return d&&d.live&&d.live.open&&d.live.endAt?Math.max(0,Math.ceil((d.live.endAt-nowS())/1000)):null;}
function pollClock(){var v=pollLeft();return v===null?null:h('div',{class:'pclock'},h('b',{'data-pcount':'1',text:String(v)}),' s left');}
setInterval(function(){var v=pollLeft();if(v===null)return;Array.prototype.forEach.call(document.querySelectorAll('[data-pcount]'),function(el){el.textContent=String(v);});},250);

/* ---------- trivia question card ---------- */
function choiceBtn(o,k,o2){
  var b=h('button',{type:'button',class:'opt-btn'+(o2.sel?' sel':'')+(o2.still?' still':''),disabled:!o2.click||null,'aria-pressed':o2.sel?'true':'false',onclick:function(){o2.click(k);}},
    h('span',{class:'mk',text:optLetter(k)}),h('span',{class:'ot'},rich(o)));
  if(o2.state){var add=function(){o2.state.split(' ').forEach(function(c){b.classList.add(c);});};if(o2.fade&&!o2.still)raf2(add);else add();}
  return b;
}
function barRow(o,k,o2){
  var fill=h('div',{class:'bf'});
  var bar=h('div',{class:'bar-opt'+(o2.still?' still':'')},fill,h('span',{class:'ot'},rich(o)),o2.host?h('span',{class:'hostchip',text:'HOST'}):null,h('span',{class:'pct mono',text:o2.pct+'% '+o2.count}));
  if(o2.still){fill.style.width=o2.pct+'%';if(o2.state)o2.state.split(' ').forEach(function(c){bar.classList.add(c);});}
  else raf2(function(){fill.style.width=o2.pct+'%';if(o2.state)o2.state.split(' ').forEach(function(c){bar.classList.add(c);});});
  return bar;
}
function winLine(t){
  var w=t.win;if(!w)return null;
  var tr=w.tier?tierById(w.tier):null;
  return h('div',{class:'winline'},w.name+' answered in '+(w.ms/1000).toFixed(2)+' seconds and gets their way! ',nm({name:t.name}),' is placed in ',
    tr?h('span',{class:'lr-tier',tc:tr.id},tlab(tr)):'their choice','.');
}
// One trivia question card. hostSide: the host's own view. onPick(k) selects an answer, onLock() locks it in.
function triviaBody(t,hostSide,onPick,pick,onLock){
  var ph=lphase(t),n=nowS();
  var root=h('div',{class:'tstage tcard'+(hostSide?' host':'')}),box=h('div',{class:'tc-body'});
  root.append(h('div',{class:'tc-head'},nm({name:t.name}),t.tie?' - Tie-Breaking Question':' Trivia - Question '+(t.qi+1)+' of '+t.n),box);
  root._body=box;
  S.shownPhase=ph;
  if(ph==='countdown'){
    box.append(h('div',{class:'pie','data-pie':'1'},h('b',{'data-tcount':'1',text:String(secsLeft(t.startAt-n))})),h('div',{class:'get-ready',text:'Get ready to answer!'}));
    return root;
  }
  if(!t.q){box.append(h('div',{class:'muted',text:'Loading…'}));return root;}
  var wl=ph==='revealed'?winLine(t):null;if(wl)box.append(wl);
  if(t.tie&&!hostSide&&t.elig===false&&ph==='question')box.append(h('div',{class:'muted',text:'You didn’t vote in this one, but you can still try to beat the others. (It just won’t count for anything.)'}));
  box.append(h('div',{class:'q-text big'},rich(t.q)));
  var locked=hostSide?t.hostLocked:t.locked,plays=!hostSide||!!t.hostPlay;
  var still=(ph==='results'||ph==='revealed')&&seenBefore('tq:'+hostSide+':'+t.itemId+':'+t.qid+':'+ph);
  var opts=h('div',{class:'opts'});
  if(hostSide&&(ph==='results'||ph==='revealed')){
    var d=t.dist||[],tot=d.reduce(function(a,b){return a+b;},0);
    t.opts.forEach(function(o,k){
      var pct=tot?Math.round(d[k]/tot*100):0;
      opts.append(barRow(o,k,{still:still,pct:pct,count:d[k],host:t.hostPick===k,state:ph==='revealed'?(t.correct===k?(plays&&t.hostPick!==t.correct?'ok bad':'ok'):(d[k]?'miss':null)):null}));
    });
    box.append(opts);
    if(plays&&ph==='results'&&pick==null)box.append(h('div',{class:'muted',text:'You have not answered yet. You can still pick below before revealing.'}));
    if(plays&&ph==='results'&&pick==null){
      var o2=h('div',{class:'opts'});
      t.opts.forEach(function(o,k){o2.append(choiceBtn(o,k,{sel:false,click:onPick}));});
      box.append(o2);
    }
    return root; // the follow-up appears behind a More… pill that the host's card adds
  }
  var click=ph==='question'&&!locked&&plays?onPick:null;
  t.opts.forEach(function(o,k){
    var state=null;
    if(ph==='revealed'&&!hostSide){if(t.correct===k)state=pick===t.correct?'ok':'ok bad';else if(pick===k)state='miss';}
    opts.append(choiceBtn(o,k,{still:still,sel:pick===k&&ph!=='revealed',click:click,state:state,fade:true}));
  });
  box.append(opts);
  if(ph==='question'){
    box.append(h('div',{class:'tbar2'},h('div',{class:'tf','data-tbar':'1'}),h('span',{class:'tl mono','data-tclock':'1',text:fmtClock(t.endAt-n)})));
    if(pick!=null&&!locked&&onLock&&!t.tie)box.append(h('div',{class:'lockrow'},h('button',{class:'lockbtn',type:'button',onclick:onLock,text:'Lock In Answer'})));
    else if(locked)box.append(h('div',{class:'lockrow'},h('button',{class:'lockbtn locked',type:'button',disabled:true,text:'Locked In'})));
  }else if(ph==='results'){
    box.append(h('div',{class:'fb try',text:'Time’s up!'}),h('div',{class:'muted',text:'Waiting for the host to reveal the answer…'}));
  }else{
    var ib2=plain(t.expl)?infoBox([t.expl],null,{anim:true}):null;if(ib2)box.append(ib2);
  }
  return root;
}
/* a score: green base, yellow (+n) for tie-break showdown wins */
function scoreEl(sc,bonus){return h('span',{},h('span',{class:'sc-base',text:sc+(sc===1?' pt':' pts')}),bonus?h('span',{class:'sc-bonus',text:'(+'+bonus+')'}):null);}
function lbBody(){
  var lb=S.data&&S.data.lb,box=h('div',{class:'lb'});
  if(!lb||!lb.top.length){box.append(h('div',{class:'muted',text:'No players yet.'}));return box;}
  lb.top.forEach(function(e){
    box.append(h('div',{class:'lb-row'+(e.rank===1&&e.score>0?' first':'')},h('span',{class:'lb-rank mono',text:String(e.rank)}),
      h('span',{class:'lb-name'},nameEl(e.name,e.host)),h('span',{class:'lb-score mono'},scoreEl(e.score,e.bonus))));
  });
  var me=S.data.me;
  if(lb.me&&me&&me.name&&!lb.top.some(function(e){return e.name===me.name&&e.rank===lb.me.rank;}))
    box.append(h('div',{class:'lb-row me'},h('span',{class:'lb-rank mono',text:String(lb.me.rank)}),h('span',{class:'lb-name'},nameEl(me.name+' (you)',false)),h('span',{class:'lb-score mono'},scoreEl(lb.me.score,lb.me.bonus))));
  if(lb.total>lb.top.length)box.append(h('div',{class:'small-note',text:'Top '+lb.top.length+' of '+lb.total+' players.'}));
  return box;
}
function renderLb(){var el=document.getElementById('lb-holder');if(S.lbOpen&&el)el.replaceChildren(lbBody());}
function openLeaderboard(){
  S.lbOpen=true;
  if(S.isHost){
    var m=h('div',{class:'tcard hmenu wide',role:'dialog','aria-modal':'true','aria-labelledby':'dlg-title'},menuBar('Leaderboard',{close:true}),
      h('div',{class:'tc-body'},h('div',{id:'lb-holder'})));
    openModal(m,function(){});renderLb();return;
  }
  var close=h('button',{class:'btn primary',type:'button',onclick:closeModal,text:'Close'});
  openModal(h('div',{class:'modal wide scroll',role:'dialog','aria-modal':'true','aria-labelledby':'dlg-title'},
    h('div',{id:'dlg-title',class:'dlg-title big',text:'Leaderboard'}),h('div',{id:'lb-holder'}),h('div',{class:'actions'},close)),function(){close.focus();});
  renderLb();
}
function setMsg(text,err){S.msg=text||'';S.msgErr=!!err;var m=document.getElementById('msg');if(!m)return;m.hidden=!text;m.className='notice'+(err?' err':'');m.textContent=text||'';m.setAttribute('role',err?'alert':'status');clearTimeout(S.msgT);if(text&&!err)S.msgT=setTimeout(function(){setMsg('');},4000);}
function imgUrl(b){return '/api/join/'+S.data.joinCode+'/img/'+b.id+'?v='+b.img;}

/* the text-bubble card shown from "i" buttons: header strip with the item name, title, text, Close on the right */
function infoPopup(b,gi){
  openModal(h('div',{class:'tcard hmenu info-pop',role:'dialog','aria-modal':'true','aria-labelledby':'dlg-title'},
    menuBar(nm(b),{close:true}),
    h('div',{class:'tc-body'},infoBox(gi.pages,gi.title))));
}


/* ---------- round 6: square buttons, host stage menus, tie helpers ---------- */
var ICON_BACK=SV+'<polyline points="15 18 9 12 15 6"></polyline></svg>';
function sqBtn(kind,label,onclick){
  var b=h('button',{class:'sqb '+kind,type:'button','aria-label':label,title:label});
  if(onclick)b.addEventListener('click',onclick);
  if(kind==='x')b.innerHTML=ICON_X;
  else if(kind==='back')b.innerHTML=ICON_BACK;
  else b.innerHTML='<span class="chartic" aria-hidden="true"><i></i><i></i><i></i></span>';
  return b;
}
// Stats button: yellow when there is something to show; gray (with a "No Data Yet" label) when there isn't.
function statsBtn(has,onclick){
  if(has)return sqBtn('stats','Stats',onclick);
  var b=sqBtn('stats','No Data Yet');b.classList.add('nodata');b.setAttribute('aria-disabled','true');
  b.addEventListener('click',function(){
    if(b.querySelector('.sqtip'))return;
    var t=h('span',{class:'sqtip',role:'status',text:'No Data Yet'});b.append(t);
    setTimeout(function(){t.classList.add('out');},900);setTimeout(function(){t.remove();},1250);
  });
  return b;
}
function closeAll(){while(modalStack.length)closeModal();}
// Light teal bar: [Back] item name ........ [Stats] [X]
function menuBar(title,o){
  o=o||{};
  return h('div',{class:'tc-head'},
    h('div',{class:'mb-left'},o.back?sqBtn('back','Back',o.back===true?closeModal:o.back):null,h('div',{id:'dlg-title',class:'mb-title'},title)),
    h('div',{class:'mb-right'},o.stats||null,o.close?sqBtn('x','Close',o.close===true?closeModal:o.close):null));
}
var BAR_STEP=380;
function barsDone(n){return 200+n*BAR_STEP+250;} // ms after the reveal when the placement is announced; host and guests share it
function tieMethodName(m){return {average:'Average',high:'High Card',under:'Underdog',showdown:'Showdown',slots:'Slots'}[m]||m;}
function revealElapsed(b){return b&&b.revealAt?nowS()-b.revealAt:1e9;}
// Slot machine: every tied tier tile once, a fast spin, then an ease-out that lands on the winner. Everything derives from the server's start time.
function slotsOverlay(tie){
  var tiers=tie.tiers.map(tierById).filter(Boolean),k=tiers.length;if(k<2)return;
  var win=Math.max(0,tiers.map(function(t){return t.id;}).indexOf(tie.winner)),total=tie.resultAt-tie.startAt;
  var reelEnd=k*450,easeLen=1500,fastEnd=Math.max(reelEnd+300,total-easeLen-500),ticks=[],tm=fastEnd,iv=70;
  while(tm<fastEnd+easeLen){ticks.push({t:tm});tm+=iv;iv*=1.28;}
  var N=ticks.length;ticks.forEach(function(x,j){x.i=(((win-(N-1-j))%k)+k)%k;});
  var H=Math.min(window.innerWidth*0.64,270)*0.42,tiles=[],strip=h('div',{class:'slot-strip'});
  for(var m=0;m<5;m++){var tl=h('div',{class:'slot-tile'});tl.style.setProperty('--h',H+'px');tl.style.top=((m-2)*H*1.08-H/2)+'px';tiles.push(tl);strip.append(tl);}
  var box=h('div',{class:'slot-box'},h('h3',{text:'Slots'}),h('div',{class:'slot-reel'},h('div',{class:'win'},strip),h('div',{class:'shade'})));
  var ov=h('div',{class:'slot-ov','aria-hidden':'true'},box);document.body.append(ov);
  var shown=-1,lastT=nowS()*1000;
  function paint(i){
    if(i===shown)return;shown=i;
    tiles.forEach(function(tl,m){var t=tiers[(((i+2-m)%k)+k)%k];tl.replaceChildren(rich(t.label));tl.style.setProperty('--tc',t.color);tl.style.setProperty('--on-tier','#000');});
    var now=nowS()*1000,dur=Math.min(460,Math.max(50,now-lastT));lastT=now;
    if(strip.animate)strip.animate([{transform:'translateY('+(-H*1.08)+'px)'},{transform:'translateY(0)'}],{duration:dur,easing:'linear'});
  }
  paint(0);
  (function loop(){
    var e=nowS()-tie.startAt;
    if(e>=total){ov.classList.add('out');setTimeout(function(){ov.remove();},500);return;}
    var i;
    if(e<0)i=0;
    else if(e<reelEnd)i=Math.floor(e/450)%k;
    else if(e<ticks[0].t)i=Math.floor((e-reelEnd)/70)%k;
    else{var j=0;while(j+1<ticks.length&&ticks[j+1].t<=e)j++;i=ticks[j].i;}
    paint(i);
    if(e>=total-500)box.classList.add('land');
    requestAnimationFrame(loop);
  })();
}
// Called on every data push: starts the slot machine once per tie run, for hosts and guests alike.
function watchTies(items){
  (items||[]).forEach(function(b){
    var t=b.tie;if(!t||t.phase!=='run'||t.how!=='slots')return;
    var key=b.id+':'+t.startAt;S.slotSeen=S.slotSeen||{};
    if(S.slotSeen[key])return;S.slotSeen[key]=true;
    if(sleepless()||nowS()>=t.resultAt-300)return;
    slotsOverlay(t);
  });
}
// run fn at an absolute server time (immediately if that time has passed)
function atServer(tAbs,fn){var d=tAbs-nowS();if(d<=0)fn(true);else setTimeout(function(){fn(false);},d);}
