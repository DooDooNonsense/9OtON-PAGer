'use strict';
/* Guest screen: vote, answer trivia, read the info, look back at My History. */
S.jc = (location.hash || '').replace('#', '').toUpperCase();
S.cid = getCid();
S.tpick = {};
S.histView = 'mine';
S.keys = {};
S.plus = null;
function jurl(p) {
  return '/api/join/' + S.jc + p;
}
function same(k, v) {
  var s = JSON.stringify(v);
  if (S.keys[k] === s) return true;
  S.keys[k] = s;
  return false;
}
function connect() {
  var es = new EventSource(jurl('/events?cid=' + S.cid));
  es.onmessage = function (e) {
    var d;
    try {
      d = JSON.parse(e.data);
    } catch (x) {
      return;
    }
    var prev = S.data;
    S.data = d;
    syncClock(d);
    if (prev && prev.me && d.me && d.me.score > prev.me.score) S.plus = { n: d.me.score - prev.me.score, at: Date.now() };
    else if (prev && prev.me && d.me && (d.me.bonus || 0) > (prev.me.bonus || 0))
      S.plus = { n: d.me.bonus - (prev.me.bonus || 0), at: Date.now(), yel: true };
    if (d.tr && (!prev || !prev.tr || prev.tr.qid !== d.tr.qid || prev.tr.itemId !== d.tr.itemId) && lphase(d.tr) === 'countdown')
      delete S.tpick[d.tr.itemId + ':' + d.tr.qid];
    renderAll();
  };
  es.onerror = function () {
    if (!S.data) $('main').replaceChildren(h('div', { class: 'pcard center' }, h('div', { class: 'muted', text: 'Connecting…' })));
  };
}
function named() {
  return S.data && S.data.me && S.data.me.name;
}
function liveItem() {
  var d = S.data;
  return d.live.itemId
    ? d.items.filter(function (b) {
        return b.id === d.live.itemId;
      })[0]
    : null;
}
function roomTitle() {
  return S.data && plain(S.data.name) ? rich(S.data.name) : 'Impollster';
}
function tile(b, small) {
  var el = h('div', { class: 'tile' + (small ? ' sm' : '') });
  if (b.img) el.append(h('img', { src: imgUrl(b), alt: '' }));
  if (plain(b.name)) {
    var tt = h('div', { class: 'tt' }, rich(b.name));
    el.append(tt);
    fitInCircle(el, tt, 'auto');
  }
  return el;
}
function tierChip(id) {
  var t = tierById(id);
  return h('span', { class: 'result-tier', tc: id }, t ? rich(t.label) : '?');
}
function vote(b, tier, lock) {
  api('POST', jurl('/vote'), { cid: S.cid, itemId: b.id, tier: tier, lock: lock ? true : undefined }).catch(function (e) {
    setMsg(e.message, true);
  });
}
function pickAnswer(t, k) {
  var key = t.itemId + ':' + t.qid;
  S.tpick[key] = k;
  renderAll(true);
  api('POST', jurl('/answer'), { cid: S.cid, itemId: t.itemId, qid: t.qid, pick: k }).catch(function (e) {
    delete S.tpick[key];
    setMsg(e.message, true);
    renderAll(true);
  });
}
window.chooseTier = function (t, tier) {
  api('POST', jurl('/choose'), { cid: S.cid, itemId: t.itemId, tier: tier }).catch(function (e) {
    setMsg(e.message, true);
    renderAll(true);
  });
};
function lockAnswer(t, pick) {
  api('POST', jurl('/answer'), { cid: S.cid, itemId: t.itemId, qid: t.qid, pick: pick, lock: true }).catch(function (e) {
    setMsg(e.message, true);
  });
}
function nameGate() {
  var inp = h('input', { type: 'text', maxlength: '10', autocomplete: 'off', 'aria-label': 'Your name', placeholder: 'Your name' });
  var pw = h('input', {
    type: 'password',
    maxlength: '64',
    autocomplete: 'off',
    'aria-label': 'Password',
    placeholder: 'Password (4 or more characters)'
  });
  var eye = h('button', {
    class: 'btn small pwtoggle',
    type: 'button',
    'aria-pressed': 'false',
    text: 'Show',
    onclick: function () {
      var on = pw.type === 'password';
      pw.type = on ? 'text' : 'password';
      eye.textContent = on ? 'Hide' : 'Show';
      eye.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });
  var err = h('div', { class: 'notice err', hidden: true, role: 'alert' });
  var hint = h('div', {
    class: 'muted pwhint',
    hidden: true,
    text: 'If it’s you, enter your old password and tap That’s me. Otherwise pick another name.'
  });
  var go = h('button', { class: 'btn primary big-btn', type: 'submit', text: 'Join' });
  var me = h('button', { class: 'btn big-btn', type: 'button', hidden: true, text: 'That’s me' });
  function fail(x) {
    go.disabled = false;
    me.disabled = false;
    err.textContent = x.message;
    err.hidden = false;
  }
  var f = h(
    'form',
    {
      class: 'gate',
      onsubmit: function (e) {
        e.preventDefault();
        go.disabled = true;
        err.hidden = true;
        if (pw.value.length < 4) {
          fail(new Error('Pick a password of at least 4 characters.'));
          pw.focus();
          return;
        }
        api('POST', jurl('/name'), { cid: S.cid, name: inp.value, pw: pw.value }).then(
          function () {
            go.disabled = false;
          },
          function (x) {
            fail(x);
            if (/already taken/i.test(x.message)) {
              hint.hidden = false;
              me.hidden = false;
              pw.focus();
            }
          }
        );
      }
    },
    h('h2', { text: 'Pick a name' }),
    h('div', { class: 'muted', text: 'Up to 10 characters. It shows on the leaderboard.' }),
    inp,
    h('div', { class: 'pwrow' }, pw, eye),
    h('div', {
      class: 'muted pwnote',
      text: 'This is just so you can get back in using the same name if you need to. Don’t use a real password.'
    }),
    hint,
    err,
    go,
    me
  );
  me.onclick = function () {
    me.disabled = true;
    err.hidden = true;
    api('POST', jurl('/name'), { cid: S.cid, name: inp.value, pw: pw.value, claim: true }).then(function () {
      me.disabled = false;
    }, fail);
  };
  inp.addEventListener('input', function () {
    hint.hidden = true;
    me.hidden = true;
  });
  return h('div', { class: 'pcard center' }, f);
}
function renderHead() {
  var d = S.data;
  var plusOn = S.plus && Date.now() - S.plus.at < 2200;
  if (same('head', [d.me, d.name, plusOn ? S.plus.at : 0])) return;
  var acts = h('div', { class: 'acts' });
  if (named())
    acts.append(
      h('button', { class: 'btn small', type: 'button', text: 'Leaderboard', onclick: openLeaderboard }),
      h('button', { class: 'btn small', type: 'button', text: 'Menu', onclick: openMenu })
    );
  var sub = named()
    ? h(
        'div',
        { class: 'psub' },
        named(),
        h(
          'span',
          { class: 'pts' },
          ' · ',
          scoreEl(d.me.score, d.me.bonus),
          plusOn ? h('span', { class: 'plus' + (S.plus.yel ? ' yel' : ''), text: '+' + S.plus.n }) : null
        )
      )
    : null;
  $('phead').replaceChildren(h('div', { class: 'pname' }, h('div', { class: 'ptitle' }, nameEl(roomTitle(), false)), sub), acts);
  if (plusOn)
    setTimeout(function () {
      delete S.keys.head;
      if (S.data) renderHead();
    }, 2300);
}
function openMenu() {
  var inp = h('input', { type: 'text', maxlength: '10', value: named(), 'aria-label': 'Your name' });
  var err = h('div', { class: 'notice err', hidden: true, role: 'alert' });
  var save = h('button', {
    class: 'btn primary',
    type: 'button',
    text: 'Save Name',
    onclick: function () {
      err.hidden = true;
      api('POST', jurl('/name'), { cid: S.cid, name: inp.value }).then(closeModal, function (x) {
        err.textContent = x.message;
        err.hidden = false;
      });
    }
  });
  openModal(
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      h('div', { id: 'dlg-title', class: 'dlg-title big', text: 'Menu' }),
      h('div', { class: 'field' }, h('label', { class: 'label', text: 'Your name' }), inp, err),
      h(
        'div',
        { class: 'actions' },
        h('a', { class: 'btn', href: '/', text: 'Leave Room' }),
        h('button', { class: 'btn', type: 'button', text: 'Close', onclick: closeModal }),
        save
      )
    ),
    function () {
      inp.focus();
    }
  );
}
function tierTile(id, over) {
  return h(
    'span',
    { class: 'lr-tier' + (over ? ' over' : ''), tc: id },
    (function () {
      var t = tierById(id);
      return t ? rich(t.label) : '?';
    })()
  );
}
// Item pill: name plus a trivia capsule or an "i". The whole pill is tappable when there is something behind it.
function itemPill(r) {
  var trivia = r.kind === 'trivia' && r.segs && r.segs.length,
    text = r.kind === 'text',
    tap = trivia || text;
  var kids = [r.img ? h('img', { class: 'ipimg', src: imgUrl(r), alt: '' }) : null, h('span', { class: 'ipn' }, nm(r))];
  if (trivia) {
    var cap = h('span', { class: 'tcap' });
    r.segs.forEach(function (x) {
      cap.append(h('i', { class: x || '' }));
    });
    kids.push(cap);
  } else if (text) kids.push(h('span', { class: 'ibtn', 'aria-hidden': 'true', text: 'i' }));
  var p = h(
    tap ? 'button' : 'div',
    {
      class: 'ipill' + (tap ? ' tap' : ''),
      type: tap ? 'button' : null,
      'aria-label': tap ? (trivia ? 'Trivia results for ' : 'Information about ') + (plain(r.name) || 'this item') : null
    },
    kids
  );
  if (tap)
    p.addEventListener('click', function () {
      if (trivia) showReview(r);
      else showInfo(r);
    });
  return p;
}
// One of the last three placed items: item pill, tier, total votes.
// Votes are announced per tile, never as the whole room's total: the winning tile's own count.
function voteWord(n) {
  return n + (n === 1 ? ' vote' : ' votes');
}
function tileVotes(b, id) {
  return (id && b.counts && b.counts[id]) || 0;
}
// "With N votes, the room <verb>" for a clear win; with a tie or an empty tile the count is left out ("The room <verb>").
function roomSays(b, id, verb) {
  var n = tileVotes(b, id);
  return n && !b.tie ? 'With ' + voteWord(n) + ', the room ' + verb : 'The room ' + verb;
}
function lrRow(r) {
  return h(
    'div',
    { class: 'lr-row' },
    itemPill(r),
    tierTile(r.final, r.over),
    h('span', { class: 'lr-v' }, voteWord(tileVotes(r, r.final)), r.tie ? h('small', { text: '(Tie)' }) : null)
  );
}
function lobbyCard(d) {
  var c = h('div', { class: 'pcard center' });
  var ds = descEl(d.desc);
  if (ds) c.append(ds);
  if (d.peek) c.append(h('h2', { class: 'soon', text: 'Polls open soon for…' }), h('div', { class: 'tile-wrap' }, tile(d.peek)));
  else
    c.append(
      h(
        'div',
        { class: 'status' },
        'Waiting for the host to start',
        h('span', { class: 'dots' }, h('span', { text: '.' }), h('span', { text: '.' }), h('span', { text: '.' }))
      )
    );
  if (d.lr && d.lr.length)
    c.append(
      h('div', { class: 'sep' }),
      h('div', { class: 'label', text: 'Latest results' }),
      h('div', { class: 'lr-box' }, d.lr.map(lrRow))
    );
  return c;
}
// A question is running and this guest arrived mid-way: ask first (or wait it out).
function holdCard(d) {
  var hd = d.hold,
    c = h('div', { class: 'pcard center' });
  if (hd.state === 'wait') {
    c.append(h('h2', { text: 'Waiting to join room...' }));
    var ds = descEl(d.desc);
    if (ds) c.append(ds);
    return c;
  }
  var left = function () {
    return Math.max(0, Math.ceil((hd.endAt - Math.max(nowS(), hd.startAt)) / 1000));
  };
  var hb = h('b', { 'data-hold': '1', text: String(left()) });
  function go(kind) {
    api('POST', jurl('/' + kind), { cid: S.cid }).catch(function (e) {
      setMsg(e.message, true);
    });
  }
  c.append(
    h(
      'div',
      { class: 'hold-msg' },
      'There is a timed question currently happening. If you proceed, you\u2019ll be marked as getting the answer wrong if you can\u2019t answer in time. There are ',
      hb,
      ' seconds left to answer.'
    ),
    h(
      'div',
      { class: 'actions center yn' },
      h('button', {
        class: 'btn primary big-btn',
        type: 'button',
        onclick: function () {
          go('proceed');
        },
        text: 'Proceed?'
      }),
      h('button', {
        class: 'btn big-btn',
        type: 'button',
        onclick: function () {
          go('wait');
        },
        text: 'I\u2019ll Wait'
      })
    )
  );
  return c;
}
setInterval(function () {
  var hd = S.data && S.data.hold;
  if (!hd || hd.state !== 'ask') return;
  var v = Math.max(0, Math.ceil((hd.endAt - Math.max(nowS(), hd.startAt)) / 1000));
  Array.prototype.forEach.call(document.querySelectorAll('[data-hold]'), function (el) {
    el.textContent = String(v);
  });
}, 250);
var TIE_LINES = {
  showdown: ['The tie will be decided by Showdown.', 'The first to answer correctly chooses the winner.'],
  slots: ['The tie will be decided at random.', 'A slot machine picks the winner.'],
  average: ['The tie will be decided by Average.', 'The average of the tied tiers wins.'],
  high: ['The tie will be decided by High Card.', 'The highest tied tier wins.'],
  under: ['The tie will be decided by Underdog.', 'The lowest tied tier wins.']
};
function gstatus(head, sub) {
  return h(
    'div',
    { class: 'gstatus', role: 'status', 'aria-live': 'polite' },
    h(
      'div',
      { class: 'gs-head' },
      head,
      h('span', { class: 'dots' }, h('span', { text: '.' }), h('span', { text: '.' }), h('span', { text: '.' }))
    ),
    (Array.isArray(sub) ? sub : sub ? [sub] : []).map(function (x) {
      return h('div', { class: 'gs-sub', text: x });
    })
  );
}
function mainCard() {
  var c = mainCard0(),
    d = S.data;
  if (d && !d.tr && !d.hold && named() && d.consider) {
    var g = gstatus('Considering trivia');
    c.append(g);
    if (!sleepless()) rise(g, {});
  }
  return c;
}
function mainCard0() {
  var d = S.data;
  if (!named()) return nameGate();
  if (d.hold) return holdCard(d);
  var t = d.tr;
  if (t) {
    var key = t.itemId + ':' + t.qid,
      pick = S.tpick[key];
    if (pick === undefined) pick = t.mine;
    return h(
      'div',
      { class: 'pcard tv' },
      triviaBody(
        t,
        false,
        function (k) {
          pickAnswer(t, k);
        },
        pick,
        function () {
          lockAnswer(t, pick);
        }
      )
    );
  }
  var b = liveItem();
  if (!b || (d.liveShown && !d.live.open && d.peek)) return lobbyCard(d);
  var mine = d.mine[b.id],
    c = h('div', { class: 'pcard' + (d.live.open ? '' : ' center') });
  if (d.live.open) {
    var ds = descEl(d.desc);
    if (ds) c.append(ds);
  }
  c.append(h('div', { class: 'tile-wrap' }, tile(b)));
  var info =
    d.live.open || !d.liveShown
      ? null
      : d.info[b.id] && d.info[b.id].kind === 'text'
        ? infoBox(d.info[b.id].pages, d.info[b.id].title)
        : null;
  if (d.live.open) {
    var grid = h('div', { class: 'tier-stack' + (mine ? ' has-pick' : '') });
    d.tiers.forEach(function (tr) {
      grid.append(
        h(
          'button',
          {
            type: 'button',
            class: 'tier-btn',
            tc: tr.id,
            disabled: d.locked || null,
            'aria-pressed': mine === tr.id ? 'true' : 'false',
            'aria-label': 'Tier ' + plain(tr.label),
            onclick: function () {
              vote(b, tr.id);
            }
          },
          rich(tr.label)
        )
      );
    });
    c.append(promptRow(d.locked ? 'Your vote is locked in.' : 'Where does it belong?'));
    c.append(grid);
    var lk = pollLockBtn(!!mine, d.locked, function () {
      vote(b, mine, true);
    });
    if (lk) c.append(lk);
  } else if (!d.liveShown) {
    c.append(
      h('div', { class: 'status' }, 'Polling closed'),
      h('div', { class: 'hint', text: 'Waiting for the host to reveal the results…' })
    );
  } else {
    var tie = b.tie,
      R = b.revealAt || 0,
      base = R || nowS() - 1e7,
      D = base + barsDone(d.tiers.length);
    var unresolved = !!tie && !b.final;
    S.popDone = S.popDone || {};
    S.sawTie = S.sawTie || {};
    var live = function (imm) {
      return imm || c.isConnected;
    };
    var votedEl = h('div', { class: 'hint', text: mine ? 'You voted ' + tname(mine) + '.' : 'You did not vote on this one.' });
    if (b.over && b.auto) {
      // the host moved it afterwards: no suspense
      c.append(
        h('div', { class: 'status' }, roomSays(b, b.auto, 'chose ')),
        tierChip(b.auto),
        h('div', { class: 'status' }, 'The host moved it to:'),
        h('div', { class: 'tile-wrap over big' }, tierChip(b.final)),
        votedEl
      );
    } else {
      var status = h('div', { class: 'status', text: roomSays(b, b.final, 'placed it in:') });
      var slot = h(
        'div',
        { class: 'ell-slot' },
        h('span', { class: 'dots' }, h('span', { text: '.' }), h('span', { text: '.' }), h('span', { text: '.' }))
      );
      c.append(status, slot, votedEl);
      var noteEl = tie && tie.how ? tieNoteEl(Object.assign({}, tie, { phase: 'done' })) : null,
        tmsg = null;
      if (noteEl) {
        noteEl.hidden = true;
        c.append(noteEl);
      }
      votedEl.hidden = true;
      if (info) info.hidden = true;
      var afterTile = function (T0) {
        atServer(T0 + 450, function (imm) {
          if (!live(imm)) return;
          if (noteEl) rise(noteEl, { imm: imm });
        });
        atServer(T0 + 900, function (imm) {
          if (!live(imm)) return;
          rise(votedEl, { imm: imm });
        });
        atServer(T0 + 1500, function (imm) {
          if (!live(imm)) return;
          if (info) rise(info, { imm: imm });
        });
      };
      var placeTile = function (id, fresh) {
        status.textContent = roomSays(b, id, 'placed it in:');
        var el = id ? tierChip(id) : h('div', { class: 'hint', text: 'nowhere, since there were no votes.' });
        slot.replaceChildren(el);
        if (fresh && id) el.classList.add('popin');
      };
      if (!unresolved) {
        var T = D;
        if (tie && tie.resultAt) T = Math.max(D, tie.resultAt + (tie.how === 'slots' ? SLOTS_SETTLE : 0));
        else if (tie && tie.how === 'showdown') T = S.sawTie[b.id] ? nowS() : -1e9;
        var pk = b.id + ':' + R + ':' + (b.final || '-');
        if (S.popDone[pk] || nowS() - T > 2500) {
          placeTile(b.final, false);
          votedEl.hidden = false;
          if (noteEl) noteEl.hidden = false;
          if (info) info.hidden = false;
        } else
          atServer(T, function (imm) {
            if (!live(imm)) return;
            S.popDone[pk] = true;
            placeTile(b.final, !imm);
            afterTile(T);
          });
      } else {
        atServer(D, function (imm) {
          if (!live(imm)) return;
          S.sawTie[b.id] = true;
          status.textContent = 'The room is tied:';
          var tt = h('span', { class: 'result-tier tietile', text: 'Tie' });
          slot.replaceChildren(tt);
          if (!imm) tt.classList.add('popin');
        });
        if (tie.phase === 'wait') {
          var gs = gstatus('Waiting for the tie-breaker', TIE_LINES[tie.method] || null);
          gs.hidden = true;
          c.append(gs);
          atServer(D + 900, function (imm) {
            if (!live(imm)) return;
            rise(gs, { imm: imm });
          });
        }
        var tR = tie.resultAt + (tie.how === 'slots' ? SLOTS_SETTLE : 0);
        if (tie.phase === 'run')
          atServer(tR, function (imm) {
            if (!live(imm) || (imm && nowS() - tR > 2500)) return;
            var pk2 = b.id + ':' + R + ':' + tie.winner;
            if (S.popDone[pk2]) return;
            S.popDone[pk2] = true;
            if (tmsg) sink(tmsg);
            placeTile(tie.winner, true);
            afterTile(tR);
          });
      }
    }
  }
  if (info) c.append(info);
  return c;
}
function renderMain(force) {
  var d = S.data,
    t = d.tr,
    b = liveItem();
  var key = [
    named(),
    d.locked,
    d.consider,
    d.name,
    d.desc,
    d.live,
    d.liveShown,
    d.peek,
    d.lr,
    d.hold && [d.hold.state, d.hold.endAt],
    b && d.mine[b.id],
    b && [
      b.final || (b.tie && b.tie.phase === 'run' ? b.tie.winner : null),
      b.votes,
      b.over,
      b.auto,
      b.name,
      b.img,
      b.revealAt,
      b.tie && [b.tie.tiers, b.tie.phase, b.tie.method, b.tie.how, b.tie.startAt, b.tie.by, b.tie.ms, b.tie.fb, b.tie.sfb, b.tie.beat]
    ],
    b && d.info[b.id],
    d.tiers,
    t && [
      t.itemId,
      t.qid,
      t.phase,
      t.q,
      t.mine,
      t.locked,
      t.dist,
      t.correct,
      t.result,
      t.expl,
      t.win,
      t.choosing,
      t.tiers,
      S.tpick[t.itemId + ':' + t.qid]
    ],
    t && lphase(t),
    !b &&
      !t &&
      d.placed.map(function (p) {
        return [p.id, p.final, p.over, p.seq];
      })
  ];
  if (!force && same('main', key)) return;
  if (
    !named() &&
    document.activeElement &&
    document.activeElement.tagName === 'INPUT' &&
    $('main').contains(document.activeElement) &&
    S.gateBuilt
  )
    return;
  S.gateBuilt = !named();
  $('main').replaceChildren(mainCard());
}
function showInfo(b) {
  api('GET', jurl('/info/' + b.id + '?cid=' + S.cid)).then(
    function (gi) {
      infoPopup(b, gi);
    },
    function (e) {
      setMsg(e.message, true);
    }
  );
}
function iBtn(b) {
  return h('button', {
    class: 'ibtn',
    type: 'button',
    title: 'Information',
    'aria-label': 'Information about ' + (plain(b.name) || 'this item'),
    onclick: function (e) {
      e.stopPropagation();
      showInfo(b);
    },
    text: 'i'
  });
}

// Trivia pill: one scrolling popup with how this guest did on each revealed question
function showReview(r) {
  api('GET', jurl('/review/' + r.id + '?cid=' + S.cid)).then(
    function (rv) {
      var body = h('div', { class: 'tc-body' });
      if (!rv.qs.length) body.append(h('div', { class: 'muted', text: 'No questions have been revealed yet.' }));
      rv.qs.forEach(function (q) {
        if (q.state === 'miss') {
          body.append(h('div', { class: 'rv-miss', text: 'Question ' + q.n + ' – Missed' }));
          return;
        }
        var c = h(
          'div',
          { class: 'rv-q' },
          h('div', { class: 'rv-n', text: 'Question ' + q.n }),
          h('div', { class: 'rv-text' }, rich(q.q))
        );
        var ans = function (cls, label, k) {
          return h('div', { class: 'rv-ans ' + cls }, h('b', { text: label }), ' ', optLetter(k) + ': ', rich(q.opts[k]));
        };
        if (q.state === 'right') c.append(ans('right', 'Your answer:', q.pick));
        else if (q.state === 'wrong') c.append(ans('wrong', 'Your answer:', q.pick), ans('right', 'Correct answer:', q.correct));
        else c.append(h('div', { class: 'rv-ans wrong' }, h('b', { text: 'No answer' })), ans('right', 'Correct answer:', q.correct));
        var ib = plain(q.expl) ? infoBox([q.expl]) : null;
        if (ib) c.append(ib);
        body.append(c);
      });
      openModal(
        h(
          'div',
          { class: 'tcard hmenu info-pop rv-pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
          menuBar(nm(r), { close: true }),
          body
        )
      );
    },
    function (e) {
      setMsg(e.message, true);
    }
  );
}
// Final board chip: where the room's votes went, and whether the item was moved or placed by a tie-breaker
function showPlacement(p) {
  var body = h('div', { class: 'tc-body' });
  body.append(placedLine(p));
  var tot = p.votes || 0,
    counts = p.counts || {};
  if (tot) {
    var bars = h('div', { class: 'pb' });
    d0().tiers.forEach(function (t) {
      var n = counts[t.id] || 0,
        fill = h('div', { class: 'pb-f' });
      fill.style.width = (n / tot) * 100 + '%';
      fill.style.background = t.color;
      bars.append(
        h(
          'div',
          { class: 'pb-row' },
          h('div', { class: 'pb-l', tc: t.id }, rich(t.label)),
          h('div', { class: 'pb-t' }, fill),
          h('div', { class: 'pb-n mono', text: n + ' · ' + Math.round((n / tot) * 100) + '%' })
        )
      );
    });
    body.append(bars);
  } else body.append(h('div', { class: 'muted', text: 'No poll data for this item.' }));
  openModal(
    h(
      'div',
      { class: 'tcard hmenu info-pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      menuBar(nm(p), { close: true }),
      body
    )
  );
}
function d0() {
  return S.data;
}
// A chip on My Board: name (or picture), trivia capsule, "i" for a text bubble. Trivia chips open your personal review.
function boardChip(it) {
  var trivia = it.kind === 'trivia' && it.segs && it.segs.length;
  var kids = [it.img ? h('img', { src: imgUrl(it), alt: '' }) : null, h('span', {}, nm(it))];
  if (trivia) {
    var cap = h('span', { class: 'tcap' });
    it.segs.forEach(function (x) {
      cap.append(h('i', { class: x || '' }));
    });
    kids.push(cap);
  } else if (it.kind === 'text') kids.push(iBtn(it));
  var c = h(
    'span',
    {
      class: 'chip' + (it.img ? '' : ' noimg') + (trivia ? ' tapchip' : ''),
      role: trivia ? 'button' : null,
      tabindex: trivia ? '0' : null,
      'aria-label': trivia ? 'Trivia results for ' + (plain(it.name) || 'this item') : null
    },
    kids
  );
  if (trivia) {
    c.addEventListener('click', function () {
      showReview(it);
    });
    c.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showReview(it);
      }
    });
  }
  return c;
}
function renderHist() {
  var d = S.data;
  if (!named()) {
    $('hist').replaceChildren();
    return;
  }
  var key = [
    S.histView,
    d.items.map(function (b) {
      return [b.id, b.name, b.img];
    }),
    d.mine,
    d.tres,
    d.placed,
    d.tiers
  ];
  if (same('hist', key)) return;
  var box = h('div', { class: 'stack' });
  var seg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'History view' },
    h('button', {
      type: 'button',
      text: 'My Board',
      'aria-pressed': S.histView === 'mine' ? 'true' : 'false',
      onclick: function () {
        S.histView = 'mine';
        renderHist();
      }
    }),
    h('button', {
      type: 'button',
      text: 'Final Board',
      'aria-pressed': S.histView === 'final' ? 'true' : 'false',
      onclick: function () {
        S.histView = 'final';
        renderHist();
      }
    })
  );
  var head = h('div', { class: 'hist-head' }, h('h2', { text: 'My History' }), seg);
  if (S.histView === 'mine') {
    var any = false;
    var kindOf = function (id) {
      var tr = d.tres[id];
      return { kind: Array.isArray(tr) && tr.length ? 'trivia' : tr === 'text' ? 'text' : 'none', segs: Array.isArray(tr) ? tr : null };
    };
    d.tiers.forEach(function (tr) {
      var here = d.items.filter(function (b) {
        return d.mine[b.id] === tr.id;
      });
      if (!here.length) return;
      any = true;
      box.append(
        h(
          'div',
          { class: 'frow' },
          h('div', { class: 'fl', tc: tr.id }, rich(tr.label)),
          h(
            'div',
            { class: 'fi' },
            here.map(function (b) {
              return boardChip(Object.assign({ id: b.id, name: b.name, img: b.img }, kindOf(b.id)));
            })
          )
        )
      );
    });
    var missed = d.placed.filter(function (p) {
      return !d.mine[p.id];
    });
    if (missed.length) {
      any = true;
      box.append(
        h(
          'div',
          { class: 'frow nv' },
          h('div', { class: 'fl nv', text: 'Didn’t Vote' }),
          h(
            'div',
            { class: 'fi' },
            missed.map(function (p) {
              return boardChip(Object.assign({ id: p.id, name: p.name, img: p.img }, kindOf(p.id)));
            })
          )
        )
      );
    }
    if (!any) box.append(h('div', { class: 'notice', text: 'Your votes will show up here.' }));
  } else {
    if (!d.placed.length) box.append(h('div', { class: 'notice', text: 'Nothing has been placed yet.' }));
    else
      d.tiers.forEach(function (tr) {
        var here = d.placed.filter(function (p) {
          return p.final === tr.id;
        });
        if (!here.length) return;
        box.append(
          h(
            'div',
            { class: 'frow' },
            h('div', { class: 'fl', tc: tr.id }, rich(tr.label)),
            h(
              'div',
              { class: 'fi' },
              here.map(function (p) {
                var chip = h(
                  'span',
                  {
                    class: 'chip tapchip' + (p.img ? '' : ' noimg') + (p.over ? ' over' : '') + (p.tie ? ' tb' : ''),
                    role: 'button',
                    tabindex: '0',
                    'aria-label': 'Poll results for ' + (plain(p.name) || 'this item')
                  },
                  p.img ? h('img', { src: imgUrl(p), alt: '' }) : null,
                  h('span', {}, nm(p)),
                  d.tres[p.id] === 'text' ? iBtn(p) : null
                );
                chip.addEventListener('click', function () {
                  showPlacement(p);
                });
                chip.addEventListener('keydown', function (e) {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showPlacement(p);
                  }
                });
                return chip;
              })
            )
          )
        );
      });
  }
  $('hist').replaceChildren(head, box);
}
function renderAll(force) {
  if (!S.data) return;
  renderHead();
  renderMain(force);
  renderHist();
  renderLb();
  watchTies(S.data.items);
}
window.rerenderTrivia = function () {
  if (S.data) renderMain(true);
};
(async function () {
  if (!/^[A-Z0-9]{4}$/.test(S.jc)) {
    location.replace('/');
    return;
  }
  try {
    await api('GET', jurl('/check'));
  } catch (e) {
    $('main').replaceChildren(
      h(
        'div',
        { class: 'pcard center' },
        h('h2', { text: 'Room not found' }),
        h('div', { class: 'muted', text: e.message }),
        h('a', { class: 'btn primary', href: '/', text: 'Back' })
      )
    );
    return;
  }
  connect();
})();
