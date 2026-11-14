'use strict';
S.isHost = true;
S.hc = (location.hash || '').replace('#', '').trim().toUpperCase();
S.sel = null;
S.resultSeen = null;
S.viewRes = null;
S.unlocked = null;
S.tab = 'customize';
S.skip = [];
S.ask = null;
S.stageKey = null;
S.landId = null;
S.tapId = null;
S.tapAt = 0;

/* ---------- connection and actions ---------- */
function connect() {
  var es = new EventSource('/api/host/' + S.hc + '/events');
  S.es = es;
  es.onmessage = function (ev) {
    try {
      S.data = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    syncClock(S.data);
    // a page opened mid-session should not replay results that were already shown
    var first = S.firstData === undefined;
    if (first) {
      S.firstData = true;
      var L = liveItem();
      if (L && L.shown) S.resultSeen = L.id;
    }
    if (S.data.items.length) S.autoGearOff = true;
    renderAll();
    // a brand-new (still empty) room opens the menu so you can start adding items
    if (first && !S.data.items.length && !S.autoGearOff && !modalStack.length && window.openGearMenu) window.openGearMenu('customize');
  };
  es.onerror = function () {
    setMsg('Connection lost. Trying to reconnect…', true);
  };
  es.onopen = function () {
    if (S.msgErr) setMsg('');
  };
}
async function act(p) {
  if (S.busy) return false;
  S.busy = true;
  renderAll();
  try {
    await api('POST', '/api/host/' + S.hc + '/action', p);
    S.busy = false;
    renderAll();
    return true;
  } catch (e) {
    S.busy = false;
    setMsg(e.message, true);
    renderAll();
    return false;
  }
}
function liveItem() {
  var d = S.data;
  return d && d.live.itemId
    ? d.items.find(function (b) {
        return b.id === d.live.itemId;
      }) || null
    : null;
}
function queueItems() {
  var d = S.data;
  return d.items.filter(function (b) {
    return !b.final && !(d.live.open && d.live.itemId === b.id);
  });
}

/* ---------- top bar ---------- */
function renderTop() {
  var d = S.data;
  $('room-title').replaceChildren(d && plain(d.name) ? rich(d.name) : 'Impollster');
  var ft = $('foot');
  ft.replaceChildren();
  if (d) ft.append(h('span', {}, 'Room Code: ' + d.joinCode), h('span', { class: 'sub', text: 'Join at ' + location.host + '/play' }));
}

/* ---------- stage ---------- */
function bigItem(b) {
  return h(
    'div',
    { class: 'hero' },
    b.img ? h('img', { class: 'hero-img', src: imgUrl(b), alt: '' }) : null,
    plain(b.name) ? h('div', { class: 'hero-name' }, rich(b.name)) : null
  );
}
function pollCard(b, d) {
  var dots = h(
    'span',
    { class: 'polling' },
    'Polling',
    h('span', { class: 'dd', text: '.' }),
    h('span', { class: 'dd', text: '.' }),
    h('span', { class: 'dd', text: '.' })
  );
  var card = h('div', { class: 'card' }, h('div', { class: 'label', text: 'Now polling' }));
  card.append(bigItem(b), dots);
  if (d.cfg.hostVotes) {
    var grid = h('div', { class: 'tier-grid' + (d.hvote ? ' has-pick' : '') });
    d.tiers.forEach(function (t) {
      grid.append(
        h(
          'button',
          {
            type: 'button',
            class: 'tier-btn',
            tc: t.id,
            'aria-pressed': d.hvote === t.id ? 'true' : 'false',
            'aria-label': 'Tier ' + plain(t.label),
            disabled: S.busy || d.hlock || null,
            onclick: function () {
              act({ type: 'hvote', id: b.id, tier: t.id });
            }
          },
          rich(t.label)
        )
      );
    });
    card.append(promptRow(d.hlock ? 'Your vote is locked in.' : 'Cast your vote', 'label'), grid);
    var hl = pollLockBtn(
      !!d.hvote,
      d.hlock,
      function () {
        act({ type: 'hvote', id: b.id, tier: d.hvote, lock: true });
      },
      true
    );
    if (hl) card.append(hl);
  } else {
    var clk = pollClock();
    if (clk) card.append(clk);
  }
  card.append(
    h('div', { class: 'muted', id: 'voted-line', text: lockText(d.lockN) }),
    h(
      'div',
      { class: 'actions center' },
      h('button', {
        class: 'btn primary big-btn',
        type: 'button',
        disabled: S.busy || null,
        onclick: function () {
          act({ type: 'close' });
        },
        text: 'Close Poll'
      })
    )
  );
  return card;
}
function closedCard(b) {
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'label', text: 'Poll closed' }),
    bigItem(b),
    h(
      'div',
      { class: 'actions center' },
      h('button', {
        class: 'btn primary big-btn',
        type: 'button',
        disabled: S.busy || null,
        onclick: function () {
          act({ type: 'reveal', id: b.id });
        },
        text: 'Reveal Results?'
      })
    )
  );
}
// Nobody answered the Showdown question correctly: a buffer prompt (no way to close it) before the backup method runs.
function missPrompt(b, tie) {
  if (document.querySelector('.missprompt') || (S.missBusy && S.missBusy[b.id])) return;
  var how = tie.method === 'slots' ? 'randomly' : 'by ' + tieMethodName(tie.method);
  var go = h('button', {
    class: 'btn primary pillbtn',
    type: 'button',
    onclick: function () {
      (S.missBusy || (S.missBusy = {}))[b.id] = true;
      closeModal();
      act({ type: 'tiebreak', id: b.id }).then(function (ok) {
        S.missBusy[b.id] = false;
        if (!ok) missPrompt(b, tie);
      });
    },
    text: 'Continue'
  });
  openModal(
    h(
      'div',
      { class: 'tcard hmenu missprompt', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      menuBar(nm(b), {}),
      h(
        'div',
        { class: 'tc-body' },
        h(
          'div',
          { class: 'showmsg' },
          h('div', { text: 'No one got it!' }),
          h('div', { text: 'That means we’ll decide this ' + how + '.' })
        ),
        go
      )
    ),
    function () {
      go.focus();
    },
    { sticky: true }
  );
}
function showdownMenu(b) {
  var tie = b.tie;
  if (!tie || !tie.left) {
    act({ type: 'tshowdown', id: b.id });
    return;
  }
  var go = h('button', {
    class: 'btn primary pillbtn',
    type: 'button',
    onclick: function () {
      closeModal();
      act({ type: 'tshowdown', id: b.id });
    },
    text: 'Commence Showdown?'
  });
  openModal(
    h(
      'div',
      { class: 'tcard hmenu', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      menuBar(nm(b), { close: true }),
      h(
        'div',
        { class: 'tc-body' },
        h(
          'div',
          { class: 'showmsg' },
          h('div', { text: 'The tie will be decided by Showdown.' }),
          h('div', { text: 'The first to answer correctly chooses the winner.' })
        ),
        go
      )
    ),
    function () {
      go.focus();
    }
  );
}
// A soft glow hops between the tied rows and settles on the winner; the bars and their numbers never change.
// Slots (its own reel) and Showdown (its own question) play alone, with no glow until the winner is placed.
function runTieAnim(rows, tie, barsEl) {
  var how = tie.how || tie.method;
  if (how === 'slots' || how === 'showdown') return;
  var tied = rows.filter(function (r) {
      return tie.tiers.indexOf(r.t.id) >= 0;
    }),
    win = rows.filter(function (r) {
      return r.t.id === tie.winner;
    })[0];
  if (!win || sleepless() || !barsEl) return;
  var dur = Math.max(900, tie.resultAt - tie.startAt - 150);
  var seq = [],
    laps = Math.max(2, Math.ceil(6 / Math.max(1, tied.length)));
  for (var k = 0; k < laps; k++)
    tied.forEach(function (r) {
      seq.push(r);
    });
  if (seq[seq.length - 1] !== win) seq.push(win);
  var step = dur / seq.length,
    prev = null;
  seq.forEach(function (r, i) {
    setTimeout(function () {
      if (!barsEl.isConnected) return;
      if (prev && prev !== r) prev.el.classList.remove('lit');
      r.el.classList.add('lit');
      prev = r;
    }, i * step);
  });
  S.litRows = tied;
}
S.popDone = {};
S.tieSeen = {};
/* Text beside a result bar: "2 · 67%". `k` (0..1) is how far the bar has travelled, so count and percent track it. */
function resNum(n, total, k) {
  var c = k >= 1 ? n : Math.round(n * k);
  return c + (total ? ' · ' + (k >= 1 ? Math.round((n / total) * 100) : Math.round((n / total) * 100 * k)) + '%' : '');
}
/* the bar's own easing, cubic-bezier(.2,.8,.2,1), solved so the numbers follow the bar exactly */
function barEase(t) {
  var x1 = 0.2,
    y1 = 0.8,
    x2 = 0.2,
    y2 = 1;
  function bz(a, b, s) {
    return 3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s;
  }
  var lo = 0,
    hi = 1,
    s = t;
  for (var i = 0; i < 24; i++) {
    s = (lo + hi) / 2;
    if (bz(x1, x2, s) < t) lo = s;
    else hi = s;
  }
  return bz(y1, y2, s);
}
// Runs from the moment the bar's `go` class is added (that is when its CSS width transition starts).
function countUp(el, n, total, owner) {
  var DUR = 1000, // matches the .res-fill width transition
    startAt = null;
  (function frame() {
    if (!owner.isConnected) return;
    // the bar's CSS transition begins on the first frame after `go` is added, so the count starts there too
    if (startAt === null) {
      startAt = nowS();
      el.textContent = resNum(n, total, 0);
      return requestAnimationFrame(frame);
    }
    var p = Math.max(0, Math.min(1, (nowS() - startAt) / DUR));
    el.textContent = resNum(n, total, p >= 1 ? 1 : barEase(p));
    if (p < 1) requestAnimationFrame(frame);
  })();
}
function resultsCard(b, replay) {
  var ts = tiersOf(),
    counts = b.counts || {},
    total = b.votes || 0,
    tie = b.tie;
  var win = b.final ? tierById(b.final) : null;
  var unresolved = !!tie && !b.final;
  var R = b.revealAt || 0,
    base = R || nowS() - 1e7;
  var D = base + barsDone(ts.length),
    inst = nowS() - D > 1500;
  var rows = ts.map(function (t) {
    var n = counts[t.id] || 0,
      fill = h('div', { class: 'res-fill' }),
      numEl = h('div', { class: 'res-n mono', text: resNum(n, total, 1) });
    // a revealed tally stays hidden until its own bar starts to fill, then counts up in step with the bar
    if (!(inst || sleepless())) numEl.style.opacity = '0';
    fill.style.setProperty('--w', (total ? (n / total) * 100 : 0) + '%');
    fill.style.background = tierById(t.id).color;
    return {
      t: t,
      n: n,
      num: numEl,
      fill: fill,
      el: h(
        'div',
        { class: 'res-row', 'data-t': t.id, style: '--glow:' + tierById(t.id).color },
        h('div', { class: 'res-label', tc: t.id }, tlab(t)),
        h('div', { class: 'res-track' }, fill),
        numEl
      )
    };
  });
  var banner = h('div', { class: 'res-banner', hidden: true }),
    note = h('div', { class: 'res-note', hidden: true }),
    tiebox = h('div', { class: 'breaktie', hidden: true }),
    msg = h('div', { class: 'res-msg', hidden: true }),
    barsEl = h(
      'div',
      { class: 'res-bars' },
      rows.map(function (r) {
        return r.el;
      })
    );
  var cont = h('button', {
    class: 'btn primary big-btn',
    type: 'button',
    hidden: unresolved,
    onclick: function () {
      var wasLive = !S.viewRes;
      card.classList.add('leaving');
      setTimeout(
        function () {
          var cur =
              (S.data &&
                S.data.items.filter(function (x) {
                  return x.id === b.id;
                })[0]) ||
              b,
            placed = !!cur.final;
          S.resultSeen = b.id;
          S.viewRes = null;
          S.landId = placed ? b.id : null;
          renderAll();
          if (placed && wasLive)
            setTimeout(
              function () {
                askTrivia(b.id);
              },
              sleepless() ? 250 : 750
            );
        },
        sleepless() ? 0 : 300
      );
    },
    text: 'Continue'
  });
  // the text bubble waits beneath the placement announcement until the item is placed
  var bub = h('div', { class: 'res-info', hidden: true });
  if (b.info && b.info.kind === 'text' && b.info.ready) {
    api('GET', '/api/host/' + S.hc + '/item/' + b.id)
      .then(function (r) {
        var rc = r.rc || {},
          ib = infoBox(
            [rc.text || ''].concat(rc.pages || []),
            plain(rc.title || '') ? rc.title : plain(b.name) ? 'More on ' + b.name : 'More info'
          );
        if (ib) bub.append(ib);
      })
      .catch(function () {});
  }
  var card = h(
    'div',
    { class: 'card res' },
    h('div', { class: 'res-grid' }, h('div', {}, bigItem(b), banner, msg, tiebox, note, bub), barsEl),
    h('div', { class: 'actions right' }, cont)
  );
  // bars fill one tier at a time
  rows.forEach(function (r, i) {
    if (inst) r.fill.classList.add('instant', 'go');
    else if (sleepless()) {
      // reduced motion: the bar is plain and the numbers fade in at their final value when the bar's turn comes
      r.fill.classList.add('instant', 'go');
      r.num.style.opacity = '0';
      atServer(base + 120 + i * BAR_STEP, function () {
        r.num.style.transition = 'opacity .4s ease';
        r.num.style.opacity = '1';
      });
    } else
      atServer(base + 120 + i * BAR_STEP, function () {
        r.fill.classList.add('go');
        r.num.style.opacity = '1';
        if (card.isConnected) countUp(r.num, r.n, total, card);
      });
  });
  // Random: the Tie tile shrinks away first, then the result arrives, with each step spaced out
  var slow = !!(tie && tie.how === 'slots');
  function showPlaced(w, fresh) {
    if (fresh && slow && !banner.hidden) {
      sink(banner, function () {
        placeResult(w, fresh);
      });
      return;
    }
    placeResult(w, fresh);
  }
  function placeResult(w, fresh) {
    banner.replaceChildren(h('span', { text: 'Placed in ' }), h('span', { class: 'res-win', tc: w.id }, tlab(w)));
    banner.hidden = false;
    tiebox.hidden = true;
    rows.forEach(function (r) {
      r.el.classList.remove('lit');
    });
    var nt = tieNoteEl(b.tie && b.tie.how ? Object.assign({}, b.tie, { phase: 'done' }) : null);
    if (nt) {
      note.replaceChildren(nt);
    }
    var wr = rows.filter(function (r) {
      return r.t.id === w.id;
    })[0];
    if (msg && !msg.hidden) sink(msg);
    if (fresh) {
      banner.classList.remove('pop');
      void banner.offsetWidth;
      banner.classList.add('pop');
      if (wr) wr.el.classList.add('win');
      if (nt) rise(note, { delay: slow ? 900 : 350 });
      rise(bub, { delay: slow ? 1500 : 650 });
      confetti();
      rise(cont, { delay: slow ? 1900 : 900 });
    } else {
      if (wr) wr.el.classList.add('win');
      if (nt) note.hidden = false;
      bub.hidden = false;
      cont.hidden = false;
    }
  }
  function showTie(fresh) {
    S.tieSeen[b.id] = true;
    banner.replaceChildren(h('span', { class: 'res-win tietile', text: 'Tie' }));
    rise(banner, { imm: !fresh });
  }
  var key = b.id + ':' + R + ':' + (b.final || '-');
  function live(imm) {
    return imm || card.isConnected;
  }
  if (!unresolved && win) {
    var tp = D;
    if (tie && tie.resultAt) tp = Math.max(D, tie.resultAt + (slow ? SLOTS_SETTLE : 0));
    else if (tie && tie.how === 'showdown') tp = S.tieSeen[b.id] ? nowS() : -1e9;
    if (S.popDone[key] || nowS() - tp > 1500) showPlaced(win, false);
    else
      atServer(tp, function (imm) {
        if (!live(imm)) return;
        var first = !S.popDone[key];
        S.popDone[key] = true;
        showPlaced(win, first);
      });
  } else if (!unresolved) {
    // nobody voted
    atServer(D, function (imm) {
      if (!live(imm)) return;
      banner.replaceChildren(h('span', { text: 'No votes came in, so this item was not placed.' }));
      banner.hidden = false;
      bub.hidden = false;
      if (!imm) banner.classList.add('pop');
    });
  } else {
    var btn = h('button', {
      class: 'btn primary big-btn',
      type: 'button',
      onclick: function () {
        if (tie.method === 'showdown') showdownMenu(b);
        else act({ type: 'tiebreak', id: b.id });
      },
      text: tieMethodName(tie.method)
    });
    var head = h('div', { class: 'bt-h', text: 'Break the tie!' });
    tiebox.append(head, btn);
    if (tie.miss && tie.phase === 'wait')
      atServer(D + 300, function (imm) {
        if (card.isConnected || imm) missPrompt(b, tie);
      });
    if (tie.phase === 'run') {
      atServer(D, function (imm) {
        if (!live(imm)) return;
        showTie(!imm);
      });
      atServer(tie.startAt, function (imm) {
        if (!live(imm) || (imm && nowS() - tie.startAt > 200)) return;
        runTieAnim(rows, tie, barsEl);
      });
      atServer(tie.resultAt + (slow ? SLOTS_SETTLE : 0), function (imm) {
        if (!live(imm) || (imm && nowS() - tie.resultAt - (slow ? SLOTS_SETTLE : 0) > 1500)) return;
        var pk = b.id + ':' + R + ':' + tie.winner;
        if (S.popDone[pk]) return;
        S.popDone[pk] = true;
        showPlaced(tierById(tie.winner), true);
      });
    } else {
      atServer(D, function (imm) {
        if (!live(imm)) return;
        showTie(!imm);
      });
      atServer(D + 1100, function (imm) {
        if (!live(imm)) return;
        rise(tiebox, { imm: imm });
      });
    }
  }
  return card;
}
function triviaCard(t) {
  var ph = lphase(t),
    box = h('div', { class: 'card tv' });
  if (ph === 'hold') {
    box.append(
      h(
        'div',
        { class: 'tstage tcard host' },
        h(
          'div',
          { class: 'tc-head' },
          nm({ name: t.name }),
          t.tie ? ' - Tie-Breaking Question' : ' Trivia - Question ' + (t.qi + 1) + ' of ' + t.n
        ),
        h(
          'div',
          { class: 'tc-body holdbody' },
          h('div', { class: 'q-text big', text: 'Holding for Joining Players' }),
          h('div', { class: 'muted', text: t.joining + (t.joining === 1 ? ' player is' : ' players are') + ' still entering a name.' }),
          h('button', {
            class: 'qlink',
            type: 'button',
            disabled: S.busy || null,
            onclick: function () {
              act({ type: 'tgo' });
            },
            text: 'Proceed'
          })
        )
      )
    );
    return box;
  }
  var pick = t.hostPick;
  var tb = triviaBody(
    t,
    true,
    function (k) {
      act({ type: 'hanswer', pick: k });
    },
    pick,
    function () {
      act({ type: 'hanswer', pick: pick, lock: true });
    }
  );
  box.append(tb);
  var body = tb._body || box,
    row = h('div', { class: 'actions center col' }),
    due = 0,
    now = nowS();
  if (ph === 'question') {
    var msg = t.ready ? (t.lockedN >= t.ready ? 'Everyone’s locked in' : t.lockedN + ' of ' + t.ready + ' locked in') : '';
    row.append(
      h('button', {
        class: 'btn big-btn',
        type: 'button',
        disabled: S.busy || null,
        onclick: function () {
          act({ type: 'tend' });
        },
        text: 'End Timer Early'
      }),
      msg ? h('div', { class: 'lockmsg' + (t.lockedN >= t.ready ? ' all' : ''), text: msg }) : null
    );
  } else if (ph === 'results') {
    row.append(
      h('button', {
        class: 'btn primary big-btn',
        type: 'button',
        disabled: S.busy || null,
        onclick: function () {
          act({ type: 'treveal' });
        },
        text: 'Reveal Answer?'
      })
    );
  } else if (ph === 'revealed') {
    // the follow-up waits behind a More… pill; Next Question / Done fades in about a second after the results (or after the follow-up opens)
    var key = t.itemId + ':' + t.qid + (t.tie ? ':tie' : '');
    S.revSeen = S.revSeen || {};
    S.moreAt = S.moreAt || {};
    if (!S.revSeen[key]) S.revSeen[key] = now;
    var hasX = !!plain(t.expl);
    if (hasX) {
      var wrap = h('div', { class: 'morewrap' });
      if (!t.more) {
        wrap.append(
          h('button', {
            class: 'morepill',
            type: 'button',
            disabled: S.busy || null,
            onclick: function () {
              act({ type: 'tmore' });
            },
            text: 'More…'
          })
        );
        due = Infinity;
      } else {
        if (S.moreAt[key] === undefined) S.moreAt[key] = now;
        var ma = S.moreAt[key],
          ib = infoBox([t.expl], null);
        ib.classList.add('morecard');
        if (!sleepless() && now - ma < 700) {
          ib.classList.add('start');
          raf2(function () {
            ib.classList.remove('start');
          });
        }
        wrap.append(ib);
        due = ma + 900;
      }
      body.append(wrap);
    } else due = S.revSeen[key] + 1000;
    if (t.tie) {
      if (t.win)
        row.append(
          h('button', {
            class: 'btn primary big-btn',
            type: 'button',
            disabled: S.busy || t.choosing || null,
            onclick: function () {
              act({ type: 'tshowdone' });
            },
            text: 'Done'
          })
        );
      else
        row.append(
          h('button', {
            class: 'btn primary big-btn',
            type: 'button',
            disabled: S.busy || null,
            onclick: function () {
              act({ type: 'tdismiss' });
            },
            text: 'Continue'
          })
        ); // one question per tie: the backup comes next
    } else if (t.hasNext)
      row.append(
        h('button', {
          class: 'btn primary big-btn',
          type: 'button',
          disabled: S.busy || null,
          onclick: function () {
            act({ type: 'tstart', id: t.itemId });
          },
          text: 'Next Question'
        }),
        h('button', {
          class: 'qlink',
          type: 'button',
          onclick: function () {
            act({ type: 'tdismiss' });
          },
          text: 'Back to Board'
        })
      );
    else
      row.append(
        h('button', {
          class: 'btn primary big-btn',
          type: 'button',
          onclick: function () {
            act({ type: 'tdismiss' });
          },
          text: 'Done'
        })
      );
    if (due === Infinity) row.hidden = true;
    else if (due > now && !sleepless()) {
      row.classList.add('latein');
      row.style.animationDelay = due - now + 'ms';
      row.style.pointerEvents = 'none';
      setTimeout(function () {
        row.style.pointerEvents = '';
      }, due - now);
    }
  }
  body.append(row);
  return box;
}

/* ---------- tier board ---------- */
function chipDots(b) {
  var k = b.info && b.info.kind,
    ds = [];
  if (k === 'trivia' && b.info.ready)
    ds = (b.tstats || []).map(function (q) {
      return q.host || '';
    });
  else if (k === 'text' && b.info.ready) ds = ['text'];
  if (!ds.length) return null;
  var box = h('div', { class: 'dots-arc' });
  ds.forEach(function (c, i) {
    var a = ((30 + i * 26) * Math.PI) / 180,
      d = h('i', { class: 'pip' + (c ? ' ' + c : '') });
    d.style.left = 50 + 41 * Math.sin(a) + '%';
    d.style.top = 50 - 41 * Math.cos(a) + '%';
    box.append(d);
  });
  return box;
}
function rankChip(b) {
  var el = h('div', {
    class:
      'rchip' +
      (b.over ? ' over' : '') +
      (b.tie && b.tie.phase === 'done' && !b.over ? ' tb' : '') +
      (S.unlocked === b.id ? ' unlocked' : '') +
      (S.landId === b.id ? ' land' : ''),
    'data-id': b.id,
    title:
      (plain(b.name) || 'Picture') +
      (b.over
        ? ' (moved by host)'
        : b.tie && b.tie.phase === 'done'
          ? ' (' + tieHowText(b.tie.how || b.tie.method).toLowerCase() + ')'
          : '') +
      (S.unlocked === b.id ? ' – unlocked: drag to move' : ' – right-click for options, double-click to move')
  });
  if (b.img) el.append(h('img', { src: imgUrl(b), alt: '', draggable: 'false' }));
  else {
    var tx = h('div', { class: 'rtx' }),
      sp = h('span');
    sp.append(rich(b.name));
    tx.append(sp);
    el.append(tx);
  }
  var dd = chipDots(b);
  if (dd) el.append(dd);
  return el;
}
// Item names scale with their circle: one shared size cap (a fraction of the diameter) so short names never balloon,
// shrunk further so the widest word fits; words wrap before they shrink, and only break mid-word as a last resort.
function fitRankText(root) {
  var chips = Array.prototype.slice.call(root.querySelectorAll('.rtx'));
  if (!chips.length) return;
  var fits = [];
  chips.forEach(function (tx) {
    var sp = tx.firstChild;
    if (!sp || sp.nodeType !== 1) return;
    var dia = tx.parentNode.getBoundingClientRect().width || 48;
    fits.push({ sp: sp, f: fitName(sp, dia, Math.max(8, dia * 0.27)) });
  });
  // keep the set looking alike: nobody more than ~18% bigger than the tightest name on the board
  if (fits.length > 1) {
    var low = Math.min.apply(
        null,
        fits.map(function (x) {
          return x.f;
        })
      ),
      top = Math.max.apply(
        null,
        fits.map(function (x) {
          return x.f;
        })
      ),
      ref = Math.max(low, top * 0.62);
    fits.forEach(function (x) {
      if (x.f > ref * 1.18) x.sp.style.fontSize = ref * 1.18 + 'px';
    });
  } // one very long name only shrinks itself
}
if (document.fonts && document.fonts.ready)
  document.fonts.ready.then(function () {
    var st = document.getElementById('stage');
    if (st) fitRankText(st);
  });
// the big item name never breaks mid-word: it shrinks until its longest word fits
function fitHeroes(root) {
  Array.prototype.forEach.call(root.querySelectorAll('.hero-name'), function (el) {
    el.style.fontSize = '';
    el.style.overflowWrap = 'normal';
    var f = parseFloat(getComputedStyle(el).fontSize),
      n = 0;
    while (el.scrollWidth > el.clientWidth + 1 && f > 18 && n < 40) {
      f *= 0.94;
      el.style.fontSize = f + 'px';
      n++;
    }
    if (el.scrollWidth > el.clientWidth + 1) el.style.overflowWrap = 'anywhere';
  });
}
(function () {
  var stg = document.getElementById('stage');
  if (!stg) return;
  var t = null,
    run = function () {
      cancelAnimationFrame(t);
      t = requestAnimationFrame(function () {
        fitHeroes(stg);
      });
    };
  if (window.MutationObserver) new MutationObserver(run).observe(stg, { childList: true });
  if (window.ResizeObserver) new ResizeObserver(run).observe(stg);
  window.addEventListener('resize', run);
})();
var fitWatch = null;
function watchFit(st) {
  if (!window.ResizeObserver) {
    return;
  }
  if (fitWatch) fitWatch.disconnect();
  var t = null;
  fitWatch = new ResizeObserver(function () {
    clearTimeout(t);
    t = setTimeout(function () {
      fitRankText(st);
    }, 60);
  });
  fitWatch.observe(st);
}
function tiersEl(d) {
  var wrap = h('div', { class: 'rb' });
  tiersOf().forEach(function (t) {
    var placed = d.items
      .filter(function (b) {
        return b.final === t.id && b.shown;
      })
      .sort(function (a, b) {
        return (a.rank || 0) - (b.rank || 0);
      });
    var track = h('div', { class: 'rrow', 'data-tier': t.id }, placed.map(rankChip));
    var eL = h('div', { class: 'redge l', 'aria-hidden': 'true' }, h('span', { text: '◀' })),
      eR = h('div', { class: 'redge r', 'aria-hidden': 'true' }, h('span', { text: '▶' }));
    wrap.append(
      h(
        'div',
        { class: 'rb-row' },
        h('div', { class: 'rb-label' + (plain(t.label).length > 3 ? ' long' : ''), tc: t.id }, tlab(t)),
        h('div', { class: 'rwrap' }, track, eL, eR)
      )
    );
  });
  return wrap;
}
function wireScroll(root) {
  Array.prototype.forEach.call(root.querySelectorAll('.rwrap'), function (w) {
    var tr = w.querySelector('.rrow'),
      eL = w.querySelector('.redge.l'),
      eR = w.querySelector('.redge.r'),
      raf = 0,
      dir = 0;
    function upd() {
      var max = tr.scrollWidth - tr.clientWidth;
      eL.style.display = tr.scrollLeft > 2 ? 'flex' : 'none';
      eR.style.display = tr.scrollLeft < max - 2 ? 'flex' : 'none';
    }
    function loop() {
      if (!dir) return;
      tr.scrollLeft += dir * 9;
      raf = requestAnimationFrame(loop);
    }
    function go(d) {
      dir = d;
      cancelAnimationFrame(raf);
      if (d) raf = requestAnimationFrame(loop);
    }
    [
      [eL, -1],
      [eR, 1]
    ].forEach(function (p) {
      p[0].addEventListener('mouseenter', function () {
        go(p[1]);
      });
      p[0].addEventListener('mouseleave', function () {
        go(0);
      });
      p[0].addEventListener('click', function () {
        tr.scrollBy({ left: p[1] * 280, behavior: 'smooth' });
      });
    });
    tr.addEventListener('scroll', upd);
    var sv = S.rowScroll && S.rowScroll[tr.getAttribute('data-tier')];
    if (sv) tr.scrollLeft = sv;
    upd();
  });
}
function queueOrdered(d) {
  var q = queueItems();
  if (d.cfg.shuffle)
    q = q.slice().sort(function (a, b) {
      return (a.ord || 0) - (b.ord || 0);
    });
  var fresh = q.filter(function (b) {
    return S.skip.indexOf(b.id) < 0;
  });
  var later = S.skip
    .map(function (id) {
      return q.filter(function (b) {
        return b.id === id;
      })[0];
    })
    .filter(Boolean);
  return fresh.concat(later);
}
function fitOneLine(el) {
  // shrink the label until it sits on one line with a comfortable margin either side
  el.style.removeProperty('font-size');
  var fs = parseFloat(getComputedStyle(el).fontSize),
    guard = 0;
  var rg = document.createRange();
  rg.selectNodeContents(el);
  var room = function () {
    return el.clientWidth - Math.max(28, el.clientWidth * 0.2);
  };
  while (rg.getBoundingClientRect().width > room() && fs > 10 && guard++ < 40) {
    fs -= 1;
    el.style.setProperty('font-size', fs + 'px', 'important');
  }
}
function qCard(d) {
  var q = queueOrdered(d),
    nx = q[0],
    hide = !!d.cfg.hideNext;
  var ranked = d.items.filter(function (b) {
    return b.final && b.shown;
  }).length;
  var count = h('div', { class: 'qcount', text: ranked + '/' + d.items.length + ' Items Ranked' });
  if (!nx)
    return h(
      'div',
      { class: 'qcard' },
      h('div', { class: 'qempty', text: d.items.length ? 'Every item has been polled.' : 'No items yet.' }),
      count
    );
  var shown = !hide || d.peek === nx.id;
  var circ = h('div', { class: 'qcircle' });
  if (!shown) circ.append(h('div', { class: 'qt', text: '?' }));
  else {
    if (nx.img) circ.append(h('img', { src: imgUrl(nx), alt: '' }));
    if (plain(nx.name)) {
      var qt = h('div', { class: 'qt' }, rich(nx.name));
      circ.append(qt);
      fitInCircle(circ, qt, 'auto');
    }
    var dd = chipDots(nx);
    if (dd) circ.append(dd);
  }
  var skip =
    shown && q.length > 1
      ? h('button', {
          class: 'qskip',
          type: 'button',
          onclick: function () {
            S.skip = S.skip.filter(function (x) {
              return x !== nx.id;
            });
            S.skip.push(nx.id);
            if (hide) act({ type: 'peek', id: null });
            renderStage(true);
          },
          text: 'Skip'
        })
      : null;
  var go = shown
    ? h('button', {
        class: 'btn primary qgo',
        type: 'button',
        disabled: S.busy || null,
        onclick: function () {
          S.skip = S.skip.filter(function (x) {
            return x !== nx.id;
          });
          act({ type: 'open', id: nx.id });
        },
        text: 'Start Poll'
      })
    : h('button', {
        class: 'btn primary qgo',
        type: 'button',
        disabled: S.busy || null,
        onclick: function () {
          act({ type: 'peek', id: nx.id });
        },
        text: 'Reveal Item'
      });
  var cardEl = h('div', { class: 'qcard' }, skip, circ, go, count);
  raf2(function () {
    fitOneLine(go);
  });
  return cardEl;
}
function boardEl(d) {
  var side = h('div', { class: 'qside' }, qCard(d));
  return h('div', { class: 'stagegrid' }, side, tiersEl(d));
}
/* "Everyone Locked In!" curtain: slides up over the poll, holds, then slides off the top to reveal the Reveal Results page.
   The stage is frozen while the curtain rises so the swap happens out of sight. */
function playAllIn() {
  var bg = getComputedStyle(document.body).backgroundColor;
  var msg = h('div', { class: 'allin-msg', role: 'status', text: 'Everyone Locked In!' });
  var cur = h('div', { class: 'allin-curtain', 'aria-live': 'polite' }, msg);
  cur.style.background = bg;
  document.body.append(cur);
  S.freeze = true;
  var done = function () {
    S.freeze = false;
    cur.remove();
  };
  var out = function () {
    S.freeze = false;
    renderStage(true); /* the page behind is ready before the curtain leaves */
    var a = sleepless()
      ? cur.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' })
      : cur.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], {
          duration: 620,
          easing: 'cubic-bezier(.5,0,.75,.3)',
          fill: 'forwards'
        });
    a.onfinish = done;
    a.oncancel = done;
  };
  var inA = sleepless()
    ? cur.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' })
    : cur.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], {
        duration: 560,
        easing: 'cubic-bezier(.22,.8,.3,1)',
        fill: 'forwards'
      });
  inA.onfinish = function () {
    setTimeout(out, 1300);
  };
}
function renderStage(force) {
  var d = S.data,
    st = $('stage');
  if (d && d.live && d.live.allIn && !d.live.open && S.allInSeen !== d.live.allIn) {
    S.allInSeen = d.live.allIn;
    if (nowS() - d.live.allIn < 4000) playAllIn();
  }
  if (S.freeze) return;
  if (!d) {
    st.replaceChildren(h('div', { class: 'muted', text: 'Connecting…' }));
    return;
  }
  var L = liveItem(),
    t = d.tr,
    key,
    card = null;
  if (L && !L.shown && S.resultSeen === L.id) S.resultSeen = null; /* a re-polled item must show its results again */
  if (d.cfg.hideNext && d.peek && !S.peekFix) {
    var q0 = queueOrdered(d)[0];
    if (q0 && q0.id !== d.peek) {
      S.peekFix = true;
      act({ type: 'peek', id: null }).then(
        function () {
          S.peekFix = false;
        },
        function () {
          S.peekFix = false;
        }
      );
    }
  }
  if (t) {
    key = 'tr';
    card = triviaCard(t);
  } else if (
    S.viewRes &&
    d.items.some(function (b) {
      return b.id === S.viewRes;
    })
  ) {
    key = 'res:' + S.viewRes + ':v';
  } else if (L && d.live.open) {
    key =
      'poll:' +
      L.id +
      (S.busy ? ':b' : '') +
      ':' +
      (d.hvote || '') +
      ':' +
      (d.hlock ? 'L' : '') +
      ':' +
      d.cfg.hostVotes +
      ':' +
      (d.live.endAt || 0);
  } else if (L && !d.live.open && !L.shown) {
    key = 'closed:' + L.id + ':' + (S.ask || '') + (S.busy ? ':b' : '');
  } else if (L && L.shown && S.resultSeen !== L.id) {
    key =
      'res:' +
      L.id +
      ':' +
      (L.final || (L.tie && L.tie.phase === 'run' ? L.tie.winner : '-')) +
      ':' +
      (L.tie ? [L.tie.startAt, L.tie.how, L.tie.by, L.tie.fb, L.tie.sfb].join(':') : '');
  } else key = 'board';
  if (key === 'board') {
    if (rdrag && rdrag.on) return;
    var bk = JSON.stringify([
      d.items.map(function (b) {
        return [b.id, b.name, b.img, b.final, b.shown, b.rank, b.over, b.info, b.tstats, b.ord, b.tie && b.tie.phase];
      }),
      d.tiers,
      d.cfg,
      d.peek,
      S.unlocked,
      S.busy,
      S.skip,
      S.landId
    ]);
    if (!force && S.stageKey === 'board' && S.boardKey === bk) return;
    var prevKey = S.stageKey;
    S.boardKey = bk;
    S.stageKey = key;
    S.rowScroll = {};
    Array.prototype.forEach.call(st.querySelectorAll('.rrow'), function (r) {
      S.rowScroll[r.getAttribute('data-tier')] = r.scrollLeft;
    });
    var be = boardEl(d);
    if (prevKey && prevKey !== 'board' && !sleepless()) be.classList.add('stage-in');
    st.replaceChildren(be);
    fitRankText(st);
    watchFit(st);
    wireScroll(st);
    finishGlide(st);
    if (S.landId) {
      S.landId = null;
    }
    return;
  }
  if (key === 'tr') {
    var tcopy = Object.assign({}, t);
    delete tcopy.now;
    var tk = JSON.stringify([tcopy, S.busy, lphase(t)]);
    if (!force && S.stageKey === 'tr' && S.trKey === tk) return;
    var prevT = S.stageKey;
    S.trKey = tk;
    S.stageKey = key;
    if (prevT !== 'tr' && !sleepless()) card.classList.add('stage-in');
    st.replaceChildren(card);
    return;
  }
  if (key === S.stageKey && !force) {
    var vl = document.getElementById('voted-line');
    if (vl && d.lockN) vl.textContent = lockText(d.lockN);
    return;
  }
  var prevS = S.stageKey;
  S.stageKey = key;
  var item = S.viewRes
    ? d.items.filter(function (b) {
        return b.id === S.viewRes;
      })[0]
    : L;
  if (key.indexOf('poll:') === 0) card = pollCard(L, d);
  else if (key.indexOf('closed:') === 0) card = closedCard(L);
  else card = resultsCard(item, !!S.viewRes);
  if (prevS && prevS.split(':')[0] !== key.split(':')[0] && !sleepless()) card.classList.add('stage-in');
  st.replaceChildren(card);
}

/* ---------- board interaction: right-click menu, double-click unlock, drag ---------- */
var rdrag = null;
function rowAt(x, y) {
  var el = document.elementFromPoint(x, y);
  return el && el.closest ? el.closest('.rrow') : null;
}
document.addEventListener('pointerdown', function (e) {
  if (e.button !== undefined && e.button !== 0) return;
  var src = e.target.closest && e.target.closest('.rchip[data-id]');
  if (!src || src.classList.contains('ghost') || !S.data) return;
  e.preventDefault();
  var id = src.getAttribute('data-id');
  rdrag = { id: id, src: src, x: e.clientX, y: e.clientY, on: false, ghost: null };
  clearTimeout(S.lp);
  S.lp = setTimeout(function () {
    if (rdrag && !rdrag.on) {
      rdrag = null;
      var it = S.data.items.find(function (b) {
        return b.id === id;
      });
      if (it) openTileMenu(it);
    }
  }, 650);
});
window.addEventListener('pointermove', function (e) {
  if (!rdrag) return;
  if (!rdrag.on) {
    if (Math.hypot(e.clientX - rdrag.x, e.clientY - rdrag.y) < 5) return;
    clearTimeout(S.lp);
    if (S.unlocked !== rdrag.id) return;
    rdrag.on = true;
    var g = rdrag.src.cloneNode(true);
    g.className = 'rchip ghost';
    g.removeAttribute('title');
    (function () {
      var sp = g.querySelector('.rtx>span'),
        d0 = rdrag.src.getBoundingClientRect().width;
      if (sp && sp.style.fontSize && d0) sp.style.fontSize = (parseFloat(sp.style.fontSize) * 76) / d0 + 'px';
    })();
    g.style.transform = 'translate(' + (e.clientX - 38) + 'px,' + (e.clientY - 38) + 'px)';
    document.body.appendChild(g);
    rdrag.ghost = g;
    rdrag.src.classList.add('dragging');
    if (!sleepless() && g.animate)
      g.animate(
        [
          { opacity: 0.5, boxShadow: '0 0 0 rgba(0,0,0,0)' },
          { opacity: 1, boxShadow: '0 10px 24px rgba(0,0,0,.4)' }
        ],
        { duration: 220, easing: EASE }
      );
  }
  rdrag.ghost.style.transform = 'translate(' + (e.clientX - 38) + 'px,' + (e.clientY - 38) + 'px)';
  Array.prototype.forEach.call(document.querySelectorAll('.rrow.over'), function (n) {
    n.classList.remove('over');
  });
  var r = rowAt(e.clientX, e.clientY);
  if (r) r.classList.add('over');
});
function endDrag(e, cancel) {
  clearTimeout(S.lp);
  if (!rdrag) return;
  var d = rdrag;
  rdrag = null;
  Array.prototype.forEach.call(document.querySelectorAll('.rrow.over'), function (n) {
    n.classList.remove('over');
  });
  if (!d.on) {
    if (cancel) return;
    var tn = Date.now();
    if (S.tapId === d.id && tn - S.tapAt < 400) {
      S.tapId = null;
      S.unlocked = S.unlocked === d.id ? null : d.id;
      renderStage(true);
    } else {
      S.tapId = d.id;
      S.tapAt = tn;
    }
    return;
  }
  var back = function () {
    glideTo(d.ghost, d.src, function () {
      d.src.classList.remove('dragging');
    });
  };
  if (cancel) {
    back();
    return;
  }
  var row = rowAt(e.clientX, e.clientY);
  if (!row) {
    back();
    return;
  }
  var tier = row.getAttribute('data-tier');
  var kids = Array.prototype.filter.call(row.querySelectorAll('.rchip'), function (c) {
    return c !== d.src && !c.classList.contains('ghost');
  });
  var idx = kids.length;
  for (var i = 0; i < kids.length; i++) {
    var r = kids[i].getBoundingClientRect();
    if (e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2)) {
      idx = i;
      break;
    }
  }
  var srcRow = d.src.closest('.rrow'),
    srcIdx = Array.prototype.filter
      .call(srcRow ? srcRow.querySelectorAll('.rchip') : [], function (c) {
        return !c.classList.contains('ghost');
      })
      .indexOf(d.src);
  if (srcRow && srcRow === row && srcIdx === idx) {
    back();
    return;
  } // dropped where it already was
  S.unlocked = null;
  // the copy stays afloat until the board redraws, then glides into the item's new spot
  S.glide = { id: d.id, tier: tier, idx: idx, same: !!(srcRow && srcRow === row), ghost: d.ghost };
  var gl = S.glide;
  act({ type: 'place', id: d.id, tier: tier, index: idx }).then(function (ok) {
    if (S.glide !== gl) return;
    if (!ok) {
      S.glide = null;
      glideTo(gl.ghost, d.src, function () {
        d.src.classList.remove('dragging');
      });
      return;
    } // refused: back home
    finishGlide(document.getElementById('stage') || document); // the board may already hold the new spot
    // the move is saved; if the board never shows the tile in that tier, let the copy settle rather than hang
    setTimeout(function () {
      if (S.glide === gl) {
        S.glide = null;
        gl.ghost.remove();
        d.src.classList.remove('dragging');
      }
    }, 8000);
  });
}
// glide a floating tile onto a target element (its exact box), then remove it
function glideTo(ghost, target, done) {
  var fin = function () {
    ghost.remove();
    if (done) done();
  };
  if (!ghost || !target || !target.isConnected || sleepless() || !ghost.animate) {
    fin();
    return;
  }
  var r = target.getBoundingClientRect(),
    m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(ghost.style.transform) || [0, 0, 0];
  var s = r.width / 76,
    a = ghost.animate(
      [
        { transform: 'translate(' + m[1] + 'px,' + m[2] + 'px) scale(1)' },
        { transform: 'translate(' + r.left + 'px,' + r.top + 'px) scale(' + s + ')' }
      ],
      { duration: 340, easing: EASE, fill: 'forwards' }
    );
  a.onfinish = fin;
  a.oncancel = fin;
}
function finishGlide(st) {
  var gl = S.glide;
  if (!gl) return;
  var chip = st.querySelector('.rchip[data-id="' + gl.id + '"]');
  var row = chip && chip.closest('.rrow');
  if (!chip || !row || row.getAttribute('data-tier') !== gl.tier) return;
  var at = Array.prototype.filter
    .call(row.querySelectorAll('.rchip'), function (c) {
      return !c.classList.contains('ghost');
    })
    .indexOf(chip);
  if (gl.same && at !== gl.idx) return; // keep floating until the board shows it in the tier it was dropped on
  S.glide = null;
  chip.style.visibility = 'hidden';
  glideTo(gl.ghost, chip, function () {
    chip.style.visibility = '';
  });
}
window.addEventListener('pointerup', function (e) {
  endDrag(e, false);
});
window.addEventListener('pointercancel', function (e) {
  endDrag(e, true);
});
document.addEventListener('contextmenu', function (e) {
  var src = e.target.closest && e.target.closest('.rchip[data-id]');
  if (!src || !S.data) return;
  e.preventDefault();
  var it = S.data.items.find(function (b) {
    return b.id === src.getAttribute('data-id');
  });
  if (it) openTileMenu(it);
});

function resultsMini(b) {
  var ts = tiersOf(),
    counts = b.counts || {},
    total = b.votes || 0,
    box = h('div', { class: 'stack tight' });
  var win = b.final ? tierById(b.final) : null;
  if (win || b.tie) box.append(placedLine({ final: b.final, over: b.over, auto: b.auto, tie: b.tie }));
  else box.append(h('div', { class: 'muted', text: 'No votes came in, so this item was not placed.' }));
  var rows = h('div', { class: 'res-bars' });
  ts.forEach(function (t) {
    var n = counts[t.id] || 0,
      fill = h('div', { class: 'res-fill go' });
    fill.style.setProperty('--w', (total ? (n / total) * 100 : 0) + '%');
    fill.style.background = t.color;
    rows.append(
      h(
        'div',
        { class: 'res-row' + (b.auto === t.id || (!b.auto && b.final === t.id) ? ' win' : '') },
        h('div', { class: 'res-label', tc: t.id }, tlab(t)),
        h('div', { class: 'res-track' }, fill),
        h('div', { class: 'res-n mono', text: n + (total ? ' · ' + Math.round((n / total) * 100) + '%' : '') })
      )
    );
  });
  box.append(rows);
  return box;
}
function statsHas(it) {
  return !!(
    (it.shown && it.counts && (it.votes || 0) > 0) ||
    (it.tstats || []).some(function (s2) {
      return s2.n > 0 || s2.revealed;
    })
  );
}
// Stats: Poll and Trivia panes; "More" slides a names card in from the right.
function openStats(it) {
  var tab = 'poll',
    data = null;
  var main = h('div', { class: 'stats-sl main' }),
    names = h('div', { class: 'stats-sl names' });
  var back = h('button', {
    class: 'stats-back',
    type: 'button',
    'aria-label': 'Back to the summary',
    title: 'Back',
    onclick: function () {
      pane.classList.remove('on-names');
    },
    text: '◀'
  });
  var pane = h('div', { class: 'stats-pane' }, main, names, back);
  var hasTrivia = !!(it.info && it.info.kind === 'trivia' && it.info.ready);
  var tabs = h(
    'div',
    { class: 'stats-tabs', role: 'tablist' },
    (hasTrivia
      ? [
          ['poll', 'Poll'],
          ['trivia', 'Trivia']
        ]
      : []
    ).map(function (k) {
      return h('button', {
        type: 'button',
        role: 'tab',
        'data-tab': k[0],
        class: k[0] === tab ? 'on' : '',
        onclick: function () {
          tab = k[0];
          pane.classList.remove('on-names');
          paint();
        },
        text: k[1]
      });
    })
  );
  function moreLink() {
    return h('button', {
      class: 'morelink',
      type: 'button',
      onclick: function () {
        pane.classList.add('on-names');
      },
      text: 'More'
    });
  }
  function paint() {
    Array.prototype.forEach.call(tabs.children, function (b2) {
      b2.classList.toggle('on', b2.getAttribute('data-tab') === tab);
      b2.setAttribute('aria-selected', b2.getAttribute('data-tab') === tab ? 'true' : 'false');
    });
    main.replaceChildren();
    names.replaceChildren();
    main.scrollTop = 0;
    if (!data) {
      main.append(h('div', { class: 'muted', text: 'Loading…' }));
      return;
    }
    var cur =
      (S.data &&
        S.data.items.filter(function (x) {
          return x.id === it.id;
        })[0]) ||
      it;
    if (tab === 'poll') {
      var p = data.poll;
      if (!p.votes && !p.tie) {
        main.append(h('div', { class: 'muted', text: 'No poll data yet.' }));
        return;
      }
      main.append(resultsMini(cur));
      main.append(moreLink());
      p.voters.forEach(function (v) {
        names.append(
          h(
            'div',
            { class: 'nm-row' },
            h('span', { class: 'nn' }, nameEl(v.name, v.host)),
            h('span', { class: 'nm-tier', tc: v.tier }, tlab(tierById(v.tier) || { label: '?' }))
          )
        );
      });
      if (!p.voters.length) names.append(h('div', { class: 'muted', text: 'No votes were recorded.' }));
    } else {
      if (!data.trivia.length) {
        main.append(h('div', { class: 'muted', text: 'This item has no trivia.' }));
        return;
      }
      var any = false,
        gaps = 0,
        played = data.trivia.some(function (q) {
          return q.has;
        });
      data.trivia.forEach(function (q) {
        if (!q.has) {
          gaps++;
          if (!played) main.append(h('div', { class: 'sq-card nodata', text: 'No Data Yet' }));
          return;
        }
        any = true;
        var c = h('div', { class: 'sq-card' }, h('div', { class: 'q-text' }, 'Question ' + q.n + ': ', rich(q.q)));
        var tot = q.dist.reduce(function (a, b2) {
          return a + b2;
        }, 0);
        q.opts.forEach(function (o, k) {
          var pct = tot ? Math.round((q.dist[k] / tot) * 100) : 0,
            bar = h(
              'div',
              { class: 'sq-bar' + (q.revealed && q.correct === k ? ' ok' : '') },
              h('div', { class: 'bf', style: 'width:' + pct + '%' }),
              h('span', { class: 'ot' }, rich(o)),
              q.hostPick === k ? h('span', { class: 'hostchip sm', text: 'HOST' }) : null,
              h('span', { class: 'pct mono', text: pct + '% ' + q.dist[k] })
            );
          c.append(bar);
        });
        main.append(c);
        names.append(h('div', { class: 'nm-q' }, 'Question ' + q.n + ': ', rich(q.q)));
        q.answers.forEach(function (a) {
          var st = q.revealed ? (a.pick === q.correct ? 'right' : 'wrong') : '';
          names.append(
            h(
              'div',
              { class: 'nm-row' },
              h('span', { class: 'nn' }, nameEl(a.name, a.host)),
              h('span', { class: 'nm-ans ' + st }, optLetter(a.pick) + ': ', rich(q.opts[a.pick]))
            )
          );
        });
      });
      if (gaps && played) main.append(h('div', { class: 'sq-card nodata', text: 'No Data on Remaining Trivia Yet' }));
      if (any) main.append(moreLink());
      if (gaps && cur.final && cur.shown && !(S.data && S.data.tr))
        main.append(
          h(
            'div',
            { class: 'stats-play' },
            h('button', {
              class: 'btn primary pillbtn',
              type: 'button',
              text: 'Play Trivia Now',
              onclick: function () {
                closeAll();
                setTimeout(
                  function () {
                    askTrivia(it.id);
                  },
                  sleepless() ? 0 : 320
                );
              }
            })
          )
        );
    }
  }
  var m = h(
    'div',
    { class: 'tcard hmenu wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
    menuBar(nm(it), { back: true, close: closeAll }),
    hasTrivia ? tabs : null,
    pane
  );
  openModal(m, function () {});
  paint();
  api('GET', '/api/host/' + S.hc + '/stats/' + it.id).then(
    function (r) {
      data = r;
      paint();
    },
    function (e) {
      main.replaceChildren(h('div', { class: 'err-line', text: e.message }));
    }
  );
}
/* compact trivia prompt: item name bar with Stats, the question, Yes / Not Now */
function triviaPrompt(it) {
  var d = S.data;
  if (!d) return;
  var st = it.tstats || [],
    doneN = st.filter(function (s2) {
      return s2.revealed;
    }).length,
    total = it.info.qs;
  var running = !!d.tr && d.tr.phase !== 'revealed',
    blocked = d.live.open,
    again = doneN >= total;
  var sub = again
    ? 'All ' + total + ' questions are done. Running again clears the old answers.'
    : (doneN ? doneN + ' of ' + total + ' done. ' : '') +
      total +
      ' question' +
      (total === 1 ? '' : 's') +
      ', ' +
      d.cfg.timer +
      ' seconds each.';
  var yes = h('button', {
    class: 'btn primary big-btn',
    type: 'button',
    disabled: blocked || running || S.busy || null,
    onclick: function () {
      closeModal();
      if (!again) act({ type: 'tstart', id: it.id });
      else
        act({ type: 'treset', id: it.id }).then(function () {
          return act({ type: 'tstart', id: it.id });
        });
    },
    text: 'Yes'
  });
  var row = h('div', { class: 'tp-row' }, yes, h('button', { class: 'btn big-btn', type: 'button', onclick: closeModal, text: 'Not Now' }));
  var note = blocked ? 'Close the open poll first.' : running ? 'A trivia question is already running.' : '';
  var pm = h(
    'div',
    { class: 'tcard tprompt hmenu', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
    menuBar(nm(it), {
      stats: statsBtn(statsHas(it), function () {
        openStats(it);
      })
    }),
    h(
      'div',
      { class: 'tc-body' },
      h('div', { class: 'tp-q', text: again ? 'Run the trivia again?' : 'Answer trivia question?' }),
      h('div', { class: 'tp-sub', text: note || sub }),
      row
    )
  );
  openModal(pm, function () {
    yes.focus();
  });
  // tell guests the host is weighing trivia until this prompt goes away
  if (!running && !blocked) {
    var cl = function (on) {
      api('POST', '/api/host/' + S.hc + '/action', { type: 'tconsider', id: on ? it.id : null }).catch(function () {});
    };
    cl(true);
    var iv = setInterval(function () {
      if (!pm.isConnected) {
        clearInterval(iv);
        cl(false);
      }
    }, 300);
  }
}
// right after an item with trivia has been ranked, offer to run its questions
function askTrivia(id) {
  var d = S.data;
  if (!d || d.tr || modalStack.length) return;
  var it = d.items.find(function (x) {
    return x.id === id;
  });
  if (!it || !it.final || !it.shown || !it.info || it.info.kind !== 'trivia' || !it.info.ready) return;
  var st = it.tstats || [];
  if (
    st.length &&
    st.every(function (q) {
      return q.revealed;
    })
  )
    return;
  triviaPrompt(it);
}
function openTileMenu(b) {
  var d = S.data;
  if (!d) return;
  var it =
      d.items.find(function (x) {
        return x.id === b.id;
      }) || b,
    k = it.info && it.info.kind;
  if (k === 'trivia' && it.info.ready) {
    triviaPrompt(it);
    return;
  }
  var body = null;
  if (k === 'text' && it.info.ready) {
    var slot = h('div', { class: 'muted', text: 'Loading…' });
    body = h('div', { class: 'tc-body' }, slot);
    api('GET', '/api/host/' + S.hc + '/item/' + it.id)
      .then(function (r) {
        var rc = r.rc || {},
          pages = [rc.text || ''].concat(rc.pages || []);
        var ib = infoBox(pages, plain(rc.title || '') ? rc.title : plain(it.name) ? 'More on ' + it.name : 'More info');
        slot.replaceWith(ib || h('div', { class: 'muted', text: 'No text yet.' }));
      })
      .catch(function () {
        slot.textContent = 'The text could not be loaded.';
      });
  }
  openModal(
    h(
      'div',
      { class: 'tcard hmenu' + (body ? '' : ' mini'), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      menuBar(nm(it), {
        stats: statsBtn(statsHas(it), function () {
          openStats(it);
        }),
        close: true
      }),
      body
    ),
    function () {}
  );
}
window.rerenderTrivia = function () {
  renderStage(true);
};

function renderAll() {
  renderTop();
  renderStage();
  renderLb();
  watchTies(S.data && S.data.items);
  if (S.gearOpen && window.renderGear) window.renderGear();
}

/* ---------- menu (gear) ---------- */
S.gearOpen = false;
S.paneBuilt = null;
var TABS = [
  ['customize', 'Customize'],
  ['items', 'Items'],
  ['room', 'Room'],
  ['advanced', 'Advanced'],
  ['file', 'Save/Open']
];
function fromGear() {}
window.modalClosed = function () {
  S.gearOpen = false;
  S.paneBuilt = null;
};
function section(title, desc) {
  var s = h('section', { class: 'gs' }, h('h3', { text: title }));
  if (desc) s.append(h('p', { class: 'gs-desc', text: desc }));
  for (var i = 2; i < arguments.length; i++) if (arguments[i]) s.append(arguments[i]);
  return s;
}
function row(label, hint, control) {
  return h(
    'div',
    { class: 'grow-row' },
    h('div', { class: 'gr-text' }, h('b', { text: label }), hint ? h('span', { text: hint }) : null),
    h('div', { class: 'gr-ctl' }, control)
  );
}
function switchRow(label, hint, checked, onchange, key, disabled) {
  var cb = h('input', { type: 'checkbox', role: 'switch', 'data-k': key, disabled: disabled || null });
  cb.checked = !!checked;
  cb.addEventListener('change', function (e) {
    onchange(e.target.checked);
  });
  return h(
    'div',
    { class: 'grow-row' + (disabled ? ' off' : '') },
    h('div', { class: 'gr-text' }, h('b', { text: label }), hint ? h('span', { text: hint }) : null),
    h('label', { class: 'switch bare' }, cb, h('span', { class: 'sw-track' }))
  );
}
function copyBtn(text, label) {
  var b = h('button', { class: 'btn small', type: 'button', text: label || 'Copy' });
  b.addEventListener('click', function () {
    function done() {
      b.textContent = 'Copied';
      setTimeout(function () {
        b.textContent = label || 'Copy';
      }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
  });
  return b;
}
function gcard(title) {
  var s = h('section', { class: 'gcard' }, h('h3', { text: title }));
  for (var i = 1; i < arguments.length; i++) if (arguments[i]) s.append(arguments[i]);
  return s;
}
function radioRow(label, hint, value, cur, onpick) {
  var r = h('input', { type: 'radio', name: 'tiemethod', 'data-k': 'tie-' + value, 'aria-label': label });
  r.checked = cur === value;
  r.addEventListener('change', function () {
    if (r.checked) onpick(value);
  });
  return h(
    'label',
    { class: 'grow-row tieopt' },
    h('div', { class: 'gr-text' }, h('b', { text: label }), h('span', { text: hint })),
    h('div', { class: 'gr-ctl' }, r)
  );
}
function advancedPane() {
  var d = S.data,
    box = h('div', { class: 'stack tight' });
  var tin = h('input', {
    type: 'number',
    min: '5',
    max: '600',
    value: String(d.cfg.timer),
    'data-k': 'timer',
    'aria-label': 'Seconds per trivia question',
    style: 'width:100px'
  });
  tin.addEventListener('change', function () {
    act({ type: 'cfg', timer: Number(tin.value) });
  });
  var pt = d.cfg.pollTimer || 0;
  var pin = h('input', {
    type: 'number',
    min: '5',
    max: '3600',
    value: String(pt || 30),
    'data-k': 'ptimer',
    'aria-label': 'Seconds to vote',
    style: 'width:100px',
    disabled: !pt || null
  });
  pin.addEventListener('change', function () {
    act({ type: 'cfg', pollTimer: Number(pin.value) });
  });
  var pcb = h('input', { type: 'checkbox', role: 'switch', 'data-k': 'ptoggle' });
  pcb.checked = !!pt;
  pcb.addEventListener('change', function (e) {
    act({ type: 'cfg', pollTimer: e.target.checked ? Number(pin.value) || 30 : 0 });
  });
  var pctl = h('div', { class: 'inline' }, pin, h('label', { class: 'switch bare' }, pcb, h('span', { class: 'sw-track' })));
  var tie = d.cfg.tie || 'average';
  var setTie = function (v) {
    act({ type: 'cfg', tie: v });
  };
  var sub = switchRow(
    'Host Score/Stats?',
    'Your answers earn points and show on the leaderboard.',
    d.cfg.hostScore,
    function (v) {
      act({ type: 'cfg', hostScore: v });
    },
    'hostscore',
    !d.cfg.hostPlay
  );
  sub.classList.add('sub');
  box.append(
    gcard(
      'Polling',
      switchRow(
        'Host votes in polls',
        'Your vote counts toward the result.',
        d.cfg.hostVotes,
        function (v) {
          act({ type: 'cfg', hostVotes: v });
        },
        'hostvotes'
      ),
      row('Poll timer', 'Closes voting by itself (seconds).', pctl),
      switchRow(
        'Hide the next item',
        'Shows a ? until you press Reveal Item.',
        d.cfg.hideNext,
        function (v) {
          act({ type: 'cfg', hideNext: v });
        },
        'hidenext'
      ),
      switchRow(
        'Randomize items',
        'Shuffles the queue. Off keeps your order.',
        d.cfg.shuffle,
        function (v) {
          act({ type: 'cfg', shuffle: v });
        },
        'shuffle'
      ),
      h('div', { class: 'tiehead' }, h('b', { text: 'Tie Breaking' }), h('span', { text: 'How would you like to break ties?' })),
      radioRow('Average', 'The item is placed in the average of the selected tiers.', 'average', tie, setTie),
      radioRow('High Card', 'The highest placement wins.', 'high', tie, setTie),
      radioRow('Underdog', 'The lowest placement wins.', 'under', tie, setTie),
      radioRow('Showdown', 'The quickest to answer a question correctly gets their choice.', 'showdown', tie, setTie),
      tie === 'showdown' || tie === 'grab'
        ? row(
            'Tie-Breaking Questions',
            'Questions used to settle a showdown.',
            h('button', {
              class: 'btn small',
              type: 'button',
              'data-k': 'tiepool',
              onclick: openTiePool,
              text:
                'Tie-Breaking Questions (' +
                (d.cfg.tieQs || 0) +
                ')' +
                ((d.tpool || []).length - (d.cfg.tieQs || 0) > 0
                  ? ' · ' + ((d.tpool || []).length - (d.cfg.tieQs || 0)) + ' Incomplete'
                  : '')
            })
          )
        : null,
      radioRow('Random', 'A tied tier is picked at random on a slot machine.', 'slots', tie, setTie),
      radioRow('Grab Bag', 'One of the other methods is picked at random for each tie.', 'grab', tie, setTie)
    ),
    gcard(
      'Trivia',
      row('Seconds per question', 'How long guests get (5 to 600).', tin),
      switchRow(
        'Play Along Trivia',
        'You answer trivia questions too.',
        d.cfg.hostPlay,
        function (v) {
          act({ type: 'cfg', hostPlay: v });
        },
        'hostplay'
      ),
      sub
    )
  );
  return box;
}
function roomPane() {
  var d = S.data,
    box = h('div', { class: 'stack tight' });
  var link = location.origin + '/play#' + d.joinCode;
  var hostCodeShown = false,
    hc = h('b', { class: 'mono', text: '••••••' }),
    hbtn = h('button', { class: 'btn small', type: 'button', text: 'Show' });
  hbtn.addEventListener('click', function () {
    hostCodeShown = !hostCodeShown;
    hc.textContent = hostCodeShown ? S.hc : '••••••';
    hbtn.textContent = hostCodeShown ? 'Hide' : 'Show';
  });
  var hn = h('input', {
      type: 'text',
      maxlength: '10',
      value: d.hostName,
      'data-k': 'hostname',
      'aria-label': 'Your host name',
      style: 'width:150px'
    }),
    hne = h('div', { class: 'err-line', hidden: true });
  function saveHn() {
    api('POST', '/api/host/' + S.hc + '/action', { type: 'hostname', name: hn.value })
      .then(function () {
        hne.hidden = true;
        setMsg('Name saved.');
      })
      .catch(function (e) {
        hne.textContent = e.message;
        hne.hidden = false;
      });
  }
  hn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveHn();
    }
  });
  box.append(
    section(
      'Share with Guests',
      '',
      row(
        'Guest code',
        'Guests join with this code.',
        h('div', { class: 'inline' }, h('b', { style: 'font-size:1.6rem;letter-spacing:.2em', text: d.joinCode }), copyBtn(d.joinCode))
      ),
      row('Guest link', 'A link that opens the room.', copyBtn(link, 'Copy Link'))
    ),
    section(
      'Host',
      '',
      row(
        'Your name',
        'Shown with a HOST chip.',
        h('div', { class: 'inline' }, hn, h('button', { class: 'btn small', type: 'button', onclick: saveHn, text: 'Save' }))
      ),
      hne,
      row('Your host code', 'Keep this private. You need it to return.', h('div', { class: 'inline' }, hc, hbtn, copyBtn(S.hc)))
    ),
    playersPane()
  );
  return box;
}
// Tie-breaking question pool for Showdown: written like trivia questions
// What is missing from trivia questions / a text bubble, as sentences for the "Continue?" popup.
function issueLines(st) {
  var out = [];
  if (st.kind === 'text') {
    if (
      !st.pages.some(function (p) {
        return plain(p);
      })
    )
      out.push('You have not entered any text for the bubble.');
    return out;
  }
  if (st.kind !== 'trivia') return out;
  st.qs.forEach(function (q, i) {
    var n = i + 1;
    if (!plain(q.q)) out.push('You have not entered the question text for Question ' + n + '.');
    var filled = q.opts.filter(function (o) {
      return plain(o);
    }).length;
    if (filled < 2) {
      var need = 2 - filled;
      q.opts.forEach(function (o, k) {
        if (need > 0 && !plain(o)) {
          out.push('You have not entered Answer ' + (k + 1) + ' for Question ' + n + '.');
          need--;
        }
      });
    } else if (!plain(q.opts[q.correct])) out.push('The correct answer for Question ' + n + ' is blank.');
  });
  return out;
}
function confirmDialog(title, lines, yes, no, onYes, onNo) {
  var done = false;
  var a = h('button', {
    class: 'btn primary pillbtn',
    type: 'button',
    text: yes,
    onclick: function () {
      done = true;
      closeModal();
      onYes();
    }
  });
  var b = h('button', {
    class: 'btn pillbtn',
    type: 'button',
    text: no,
    onclick: function () {
      done = true;
      closeModal();
      if (onNo) onNo();
    }
  });
  openModal(
    h(
      'div',
      { class: 'tcard hmenu mini', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      menuBar(title, {}),
      h(
        'div',
        { class: 'tc-body' },
        lines.map(function (l) {
          return h('div', { class: 'showmsg', text: l });
        }),
        h('div', { class: 'tp-row' }, a, b)
      )
    ),
    function () {
      b.focus();
    }
  );
}
function confirmIncomplete(lines, go) {
  confirmDialog('Incomplete', lines.concat(['Continue?']), 'Continue', 'Go Back', go);
}
function openTiePool() {
  fromGear();
  var d = S.data,
    st = {
      qs: (d.tpool || []).map(function (q) {
        return { id: q.id, q: q.q, opts: q.opts.slice(), correct: q.correct, expl: q.expl || '' };
      })
    },
    eds = null;
  if (!st.qs.length) st.qs = [{ id: null, q: '', opts: ['', ''], correct: 0, expl: '' }];
  var box = h('div', { class: 'info-ed' });
  function harvest() {
    if (!eds) return;
    st.qs = eds.map(function (x) {
      return {
        id: x.id,
        q: x.q.html(),
        opts: x.opts.map(function (e) {
          return e.html();
        }),
        correct: x.correct(),
        expl: x.expl.html()
      };
    });
  }
  function draw() {
    box.replaceChildren();
    eds = [];
    st.qs.forEach(function (q, qi) {
      var x = { id: q.id, opts: [] };
      x.q = makeRich({ html: q.q, label: 'Tie-breaking question ' + (qi + 1), placeholder: 'Question', max: 500 });
      var corr = q.correct,
        gname = 'tcor' + qi + '-' + Math.random().toString(36).slice(2, 6);
      x.correct = function () {
        return corr;
      };
      var optBox = h('div', { class: 'opt-ed' });
      q.opts.forEach(function (o, k) {
        var e = makeRich({ html: o, label: 'Answer ' + (k + 1) + ' for question ' + (qi + 1), placeholder: 'Answer ' + (k + 1), max: 200 });
        x.opts.push(e);
        var r = h('input', { type: 'radio', name: gname, 'aria-label': 'Answer ' + (k + 1) + ' is correct' });
        r.checked = k === corr;
        r.addEventListener('change', function () {
          corr = k;
        });
        optBox.append(
          h(
            'div',
            { class: 'opt-row' },
            r,
            h('div', { class: 'grow' }, e.el),
            q.opts.length > 2
              ? iconBtn(
                  ICON_X,
                  'Remove answer ' + (k + 1),
                  function () {
                    harvest();
                    var Q = st.qs[qi];
                    Q.opts.splice(k, 1);
                    if (Q.correct === k) Q.correct = 0;
                    else if (Q.correct > k) Q.correct--;
                    draw();
                  },
                  false,
                  'danger'
                )
              : null
          )
        );
      });
      x.expl = makeRich({
        html: q.expl,
        label: 'Follow-up text for question ' + (qi + 1),
        placeholder: 'Follow-up text (optional)',
        max: 2000,
        multi: true
      });
      eds.push(x);
      box.append(
        h(
          'div',
          { class: 'q-ed' },
          h('div', { class: 'label', text: 'Question ' + (qi + 1) }),
          x.q.el,
          h('div', { class: 'label', text: 'Answers (select the correct one)' }),
          optBox,
          q.opts.length < 6
            ? h('button', {
                class: 'btn small',
                type: 'button',
                onclick: function () {
                  harvest();
                  st.qs[qi].opts.push('');
                  draw();
                },
                text: 'Add Answer'
              })
            : null,
          h('div', { class: 'label', text: 'Follow-up text, shown after answering' }),
          x.expl.el,
          h('button', {
            class: 'btn small danger',
            type: 'button',
            onclick: function () {
              harvest();
              st.qs.splice(qi, 1);
              draw();
            },
            text: 'Remove Question'
          })
        )
      );
    });
    if (st.qs.length < 15)
      box.append(
        h('button', {
          class: 'btn small',
          type: 'button',
          onclick: function () {
            harvest();
            st.qs.push({ id: null, q: '', opts: ['', ''], correct: 0, expl: '' });
            draw();
          },
          text: 'Add Question'
        })
      );
  }
  draw();
  var fb = h('select', { 'aria-label': 'If nobody answers the question correctly, default to' });
  [
    ['average', 'Average'],
    ['high', 'High Card'],
    ['under', 'Underdog'],
    ['slots', 'Random'],
    ['grab', 'Grab Bag']
  ].forEach(function (o) {
    var op = h('option', { value: o[0], text: o[1] });
    if (d.cfg.tieFallback === o[0]) op.selected = true;
    fb.append(op);
  });
  function save() {
    harvest();
    var qs = st.qs.filter(function (q) {
      return (
        plain(q.q) ||
        q.opts.some(function (o) {
          return plain(o);
        })
      );
    });
    function commit(again) {
      closeModal();
      act({ type: 'tpool', qs: qs, fallback: fb.value, reinclude: again || [] });
    }
    function spentStep() {
      var spent = d.tspent || [],
        old = {};
      (d.tpool || []).forEach(function (q) {
        old[q.id] = JSON.stringify([q.q, q.opts, q.correct, q.expl || '']);
      });
      var edited = qs.filter(function (q) {
        return q.id && spent.indexOf(q.id) >= 0 && old[q.id] !== JSON.stringify([q.q, q.opts, q.correct, q.expl || '']);
      });
      var again = [];
      (function next(i) {
        if (i >= edited.length) {
          commit(again);
          return;
        }
        var q = edited[i];
        confirmDialog(
          'Edited Question',
          [plain(q.q) || 'This question', 'You edited a question that was already used. Include it in the pool again?'],
          'Yes',
          'No',
          function () {
            again.push(q.id);
            next(i + 1);
          },
          function () {
            next(i + 1);
          }
        );
      })(0);
    }
    var lines = issueLines({ kind: 'trivia', qs: qs });
    if (lines.length) confirmIncomplete(lines, spentStep);
    else spentStep();
  }
  openModal(
    h(
      'div',
      { class: 'modal wide scroll', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      h('div', { id: 'dlg-title', class: 'dlg-title big', text: 'Tie-Breaking Questions' }),
      h('div', {
        class: 'small-note',
        text: 'A showdown asks these in order. The quickest guest from a tied tier to answer correctly wins.'
      }),
      box,
      h('div', { class: 'field' }, h('div', { class: 'label', text: 'If no questions are left, default to…' }), fb),
      h(
        'div',
        { class: 'actions right' },
        h('button', { class: 'btn primary', type: 'button', onclick: save, text: 'Save' }),
        h('button', { class: 'btn', type: 'button', onclick: closeModal, text: 'Cancel' })
      )
    ),
    function () {}
  );
}
var addEd = null;
function stripBullet(l) {
  return l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
}
function addMany(lines) {
  var items = lines.map(stripBullet).filter(Boolean).slice(0, 300).map(escHtml);
  if (!items.length) {
    setMsg('Type or paste at least one item.');
    return Promise.resolve();
  }
  var before = S.data.items.length;
  return act({ type: 'add', items: items }).then(function (ok) {
    if (ok && S.data) {
      var n = S.data.items.length - before;
      setMsg(n + ' item' + (n === 1 ? '' : 's') + ' added.');
    }
  });
}
function addOne() {
  var t = addEd.plain();
  if (!t) {
    setMsg('Type an item first.');
    addEd.focus();
    return;
  }
  var before = S.data.items.length;
  var parts =
    t.indexOf(',') >= 0
      ? t
          .split(',')
          .map(function (x) {
            return x.trim();
          })
          .filter(Boolean)
          .map(escHtml)
      : [addEd.html()];
  act({ type: 'add', items: parts }).then(function (ok) {
    if (!ok) return;
    var n = S.data.items.length - before;
    if (!n) {
      setMsg('Already in the list.');
      addEd.focus();
      return;
    }
    addEd.clear();
    addEd.focus();
  });
}
function itemStatus(b) {
  var d = S.data;
  if (d.live.itemId === b.id && d.live.open) return 'Polling';
  if (b.final && b.shown) return 'Placed in ' + tname(b.final);
  if (d.live.itemId === b.id && !d.live.open && !b.shown) return 'Awaiting reveal';
  return 'Queued';
}
function rmBtn(b) {
  var el = h('button', { type: 'button' });
  function paint() {
    var a = S.rmArm && S.rmArm.id === b.id ? S.rmArm.step : 0,
      nmx = plain(b.name) || 'picture';
    el.className = a ? 'btn small primary warn rm armed' : 'btn small icon danger rm';
    el.setAttribute(
      'aria-label',
      a === 0 ? 'Remove ' + nmx : a === 1 ? 'Remove ' + nmx + '? Press again to continue' : 'Confirm removing ' + nmx
    );
    el.title = a === 0 ? 'Remove ' + nmx : '';
    if (a === 0) el.innerHTML = ICON_X;
    else el.textContent = a === 1 ? 'Remove' : 'Confirm';
    el.disabled = !!S.busy;
  }
  el._paint = paint;
  el.addEventListener('click', function (e) {
    e.stopPropagation();
    var a = S.rmArm && S.rmArm.id === b.id ? S.rmArm.step : 0;
    if (a === 2) {
      S.rmArm = null;
      act({ type: 'remove', id: b.id });
      return;
    }
    S.rmArm = { id: b.id, step: a + 1 };
    paint();
  });
  paint();
  return el;
}
document.addEventListener('mousedown', function (e) {
  if (!S.rmArm) return;
  if (e.target.closest && e.target.closest('.rm.armed')) return;
  S.rmArm = null;
  Array.prototype.forEach.call(document.querySelectorAll('.rm'), function (x) {
    if (x._paint) x._paint();
  });
});
function buildItemsList() {
  var d = S.data,
    list = h('div', { class: 'items-list' });
  d.items.forEach(function (b) {
    var live = d.live.itemId === b.id && d.live.open,
      st = itemStatus(b);
    var k = b.info && b.info.kind,
      pill = null;
    if (k === 'trivia')
      pill = h('button', {
        type: 'button',
        class: 'kind' + (b.info.ready ? '' : ' inc'),
        title: 'Edit the trivia questions',
        onclick: function () {
          openEditItem(b, true);
        },
        text: b.info.ready
          ? 'Trivia · ' +
            b.info.qs +
            (b.info.qs === 1 ? ' Question' : ' Questions') +
            (b.info.inc ? ' (' + b.info.inc + ' Incomplete)' : '')
          : 'Trivia · Incomplete'
      });
    else if (k === 'text')
      pill = h('button', {
        type: 'button',
        class: 'kind text',
        title: 'Edit the text bubble',
        onclick: function () {
          openEditItem(b, true);
        },
        text: b.info.ready ? 'Text Bubble' : 'Text Bubble · Incomplete'
      });
    list.append(
      h(
        'div',
        { class: 'item-row' },
        b.img
          ? h('img', { class: 'item-thumb', src: imgUrl(b), alt: '' })
          : h('div', { class: 'item-thumb txt', 'aria-hidden': 'true' }, nm(b)),
        h(
          'div',
          { class: 'item-main' },
          h('div', { class: 'item-name' }, nm(b)),
          iconBtn(
            ICON_PENCIL,
            'Edit ' + (plain(b.name) || 'picture'),
            function () {
              openEditItem(b);
            },
            false
          )
        ),
        h(
          'div',
          { class: 'item-acts' },
          st !== 'Queued' ? h('span', { class: 'stat', text: st }) : null,
          pill,
          (b.final || d.live.itemId === b.id) && !live
            ? iconBtn(
                ICON_RESET,
                'Reset ' + (plain(b.name) || 'picture') + ' so it can be polled again',
                function () {
                  askConfirm('reset', b);
                },
                S.busy
              )
            : null,
          rmBtn(b)
        )
      )
    );
  });
  return h('div', {}, h('h3', { text: 'Items:' }), d.items.length ? list : h('div', { class: 'muted', text: 'Nothing here yet.' }));
}
function itemsPane() {
  var d = S.data,
    box = h('div', { class: 'stack tight' });
  addEd = makeRich({
    label: 'Enter items',
    placeholder: 'Press Enter to add',
    max: 600,
    onEnter: addOne,
    onLines: function (ls) {
      addMany(ls);
    }
  });
  var file = h('input', { type: 'file', accept: '.txt,.csv,text/plain,text/csv', hidden: true });
  file.addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      var csv = /\.csv$/i.test(f.name);
      addMany(
        String(r.result)
          .split(/\r?\n/)
          .map(function (l) {
            return csv ? l.split(',')[0].replace(/^"|"$/g, '') : l;
          })
      );
    };
    r.readAsText(f);
    e.target.value = '';
  });
  box.append(
    h(
      'div',
      { class: 'lblrow' },
      h('div', { class: 'lbl' }, 'Enter Items:', h('small', { text: 'Separate items with commas.' })),
      addEd.el
    ),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: addOne, text: 'Add' }),
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: function () {
          file.click();
        },
        text: 'Load a List'
      }),
      file
    )
  );
  box.append(h('div', { class: 'gs', id: 'items-wrap' }, buildItemsList()));
  return box;
}
function playersPane() {
  var d = S.data;
  return section(
    'Players (' + d.players.length + ')',
    'Removing a player makes them choose a new name.',
    d.players.length
      ? h(
          'div',
          { class: 'items-list' },
          d.players.map(function (p) {
            return h(
              'div',
              { class: 'item-row' },
              h(
                'div',
                { class: 'item-main' },
                h('div', { class: 'item-name' }, nameEl(p.name, false)),
                h('div', { class: 'item-meta muted' }, scoreEl(p.score, p.bonus))
              ),
              h('button', {
                class: 'btn small danger',
                type: 'button',
                onclick: function () {
                  act({ type: 'kick', pid: p.pid });
                },
                text: 'Remove'
              })
            );
          })
        )
      : h('div', { class: 'muted', text: 'Nobody has joined with a name yet.' })
  );
}
function customizePane() {
  var d = S.data,
    draft = tiersOf().map(function (t) {
      return { id: t.id, label: t.label, color: t.color };
    });
  var eds = [],
    list = h('div', { class: 'tier-ed' }),
    err = h('div', { class: 'err-line', hidden: true });
  function harvest() {
    eds.forEach(function (e, i) {
      if (draft[i]) draft[i].label = e.html();
    });
  }
  function draw() {
    list.replaceChildren();
    eds = [];
    draft.forEach(function (t, i) {
      var e = makeRich({ html: t.label, label: 'Tier ' + (i + 1) + ' name', placeholder: 'Tier name', max: 24 });
      eds.push(e);
      var col = h('input', { type: 'color', value: t.color, 'aria-label': 'Tier ' + (i + 1) + ' color', class: 'colorpick' });
      col.addEventListener('input', function () {
        t.color = col.value;
      });
      list.append(
        h(
          'div',
          { class: 'tier-ed-row' },
          col,
          h('div', { class: 'grow' }, e.el),
          iconBtn(
            ICON_PENCIL,
            'Edit tier name',
            function () {
              e.focus();
            },
            false
          ),
          h('button', {
            class: 'btn small icon',
            type: 'button',
            'aria-label': 'Move tier up',
            disabled: i === 0 || null,
            onclick: function () {
              harvest();
              var x = draft.splice(i, 1)[0];
              draft.splice(i - 1, 0, x);
              draw();
            },
            text: '↑'
          }),
          h('button', {
            class: 'btn small icon',
            type: 'button',
            'aria-label': 'Move tier down',
            disabled: i === draft.length - 1 || null,
            onclick: function () {
              harvest();
              var x = draft.splice(i, 1)[0];
              draft.splice(i + 1, 0, x);
              draw();
            },
            text: '↓'
          }),
          iconBtn(
            ICON_X,
            'Remove tier',
            function () {
              harvest();
              draft.splice(i, 1);
              draw();
            },
            draft.length <= 1,
            'danger'
          )
        )
      );
    });
  }
  draw();
  var pal = [
    '#ff4d5a',
    '#ff8000',
    '#ffe05a',
    '#00cc70',
    '#00c0ff',
    '#8080ff',
    '#e060ff',
    '#ff7ab8',
    '#2fb7a6',
    '#c49a6c',
    '#5870e0',
    '#c4c9d4'
  ];
  function apply() {
    harvest();
    for (var i = 0; i < draft.length; i++)
      if (!plain(draft[i].label)) {
        err.textContent = 'Every tier needs a name.';
        err.hidden = false;
        return;
      }
    err.hidden = true;
    act({ type: 'tiers', tiers: draft }).then(function (ok) {
      if (ok) {
        S.paneBuilt = null;
        setMsg('Tiers saved.');
      }
    });
  }
  var nameEd = makeRich({ html: d.name, label: 'Room name', placeholder: 'Room name (optional)', max: 60, onEnter: saveName });
  function saveName() {
    var v = nameEd.html();
    if (v !== (S.data.name || ''))
      act({ type: 'rename', name: v }).then(function (ok) {
        if (ok) setMsg('Room name saved.');
      });
  }
  nameEd.el.addEventListener('focusout', function () {
    setTimeout(function () {
      if (!nameEd.el.contains(document.activeElement)) saveName();
    }, 0);
  });
  var cnt = h('div', { class: 'gs-desc', style: 'text-align:right' });
  var descEd = makeRich({
    html: d.cfg.desc || '',
    label: 'Description',
    placeholder: 'What are you ranking? Add things to consider, one per line starting with -',
    max: 500,
    multi: true,
    bullets: true,
    onInput: function () {
      cnt.textContent = descLen() + ' / 500';
    }
  });
  function descLen() {
    var bd = descEd.el.querySelector('.rt-body');
    return bd ? (bd.textContent || '').length : 0;
  }
  function saveDesc() {
    var v = descEd.html();
    if (v !== (S.data.cfg.desc || ''))
      act({ type: 'cfg', desc: v }).then(function (ok) {
        if (ok) setMsg('Description saved.');
      });
  }
  descEd.el.addEventListener('focusout', function () {
    setTimeout(function () {
      if (!descEd.el.contains(document.activeElement)) saveDesc();
    }, 0);
  });
  setTimeout(function () {
    cnt.textContent = descLen() + ' / 500';
  }, 0);
  return h(
    'div',
    { class: 'stack tight' },
    h('div', { class: 'lblrow' }, h('div', { class: 'lbl', text: 'Room Name:' }), nameEd.el),
    h(
      'div',
      { class: 'lblrow' },
      h('div', { class: 'lbl' }, 'Description:', h('small', { text: 'Let voters know what you’re ranking and what to consider.' })),
      h('div', {}, descEd.el, cnt)
    ),
    h(
      'div',
      { class: 'gs' },
      h('h3', { text: 'Tiers:' }),
      list,
      err,
      h(
        'div',
        { class: 'actions' },
        h('button', {
          class: 'btn',
          type: 'button',
          disabled: draft.length >= 12 || null,
          onclick: function () {
            harvest();
            draft.push({ id: null, label: escHtml('Tier ' + (draft.length + 1)), color: pal[draft.length % pal.length] });
            draw();
          },
          text: 'Add Tier'
        }),
        h('button', {
          class: 'btn',
          type: 'button',
          onclick: function () {
            harvest();
            draft = DEF_TIERS.map(function (t) {
              return { id: t.id, label: t.label, color: t.color };
            });
            draw();
          },
          text: 'Reset to S\u2013F'
        }),
        h('button', { class: 'btn primary', type: 'button', disabled: S.busy || null, onclick: apply, text: 'Save Tiers' })
      ),
      h('p', { class: 'gs-desc', text: 'Removing a tier sends its items back to the queue.' })
    )
  );
}
function filePane() {
  var box = h('div', { class: 'stack tight' }),
    status = h('div', { class: 'small-note', role: 'status' }),
    pending = h('div', { class: 'stack tight' });
  var base = '/api/host/' + S.hc;
  var inp = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  inp.addEventListener('change', function () {
    var f = inp.files && inp.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      var obj = null;
      try {
        obj = JSON.parse(String(r.result));
      } catch (e) {}
      if (!obj) {
        status.textContent = 'That file could not be read.';
        return;
      }
      pending.replaceChildren(
        h('div', { class: 'notice', text: 'Opening “' + f.name + '” replaces this room’s items, tiers and votes. Continue?' }),
        h(
          'div',
          { class: 'actions' },
          h('button', {
            class: 'btn small',
            type: 'button',
            onclick: function () {
              pending.replaceChildren();
            },
            text: 'Cancel'
          }),
          h('button', {
            class: 'btn small primary',
            type: 'button',
            onclick: function () {
              pending.replaceChildren();
              act({ type: 'import', file: obj }).then(function (ok) {
                if (ok) {
                  S.paneBuilt = null;
                  status.textContent = 'File opened.';
                }
              });
            },
            text: 'Replace and Open'
          })
        )
      );
    };
    r.readAsText(f);
    inp.value = '';
  });
  async function pdf() {
    status.textContent = 'Making the PDF…';
    try {
      var date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      var r = await fetch(base + '/results.pdf?date=' + encodeURIComponent(date));
      if (!r.ok) throw new Error('The PDF could not be created.');
      var url = URL.createObjectURL(await r.blob()),
        a = h('a', { href: url, download: 'impollster-results.pdf' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 8000);
      status.textContent = '';
    } catch (e) {
      status.textContent = e.message;
    }
  }
  box.append(
    section(
      'Save and open',
      'Save list keeps items, pictures, bonus content and tiers. Save progress also keeps votes, placements and trivia answers. Tier Ranker files open too.',
      h(
        'div',
        { class: 'actions' },
        h('a', {
          class: 'btn',
          'data-k': 'save-list',
          href: base + '/export?kind=template',
          download: 'impollster-list.json',
          text: 'Save List'
        }),
        h('a', {
          class: 'btn',
          'data-k': 'save-progress',
          href: base + '/export?kind=progress',
          download: 'impollster-progress.json',
          text: 'Save Progress'
        }),
        h('button', {
          class: 'btn',
          'data-k': 'open-file',
          type: 'button',
          onclick: function () {
            inp.click();
          },
          text: 'Open a File…'
        }),
        inp
      ),
      pending
    ),
    section(
      'Results',
      '',
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: pdf, text: 'Download Results (PDF)' }),
        h('a', {
          class: 'btn',
          'data-k': 'answers',
          href: base + '/answers.csv',
          download: 'impollster-trivia-answers.csv',
          text: 'Download Trivia Answers (CSV)'
        })
      )
    ),
    status
  );
  return box;
}
window.renderGear = function (force) {
  if (!S.gearOpen) return;
  var pane = document.getElementById('gm-pane');
  if (!pane) return;
  var live = S.tab === 'items' || S.tab === 'advanced' || S.tab === 'room';
  if (!force && S.paneBuilt === S.tab && !live) return;
  var fa = document.activeElement;
  if (
    !force &&
    S.paneBuilt === S.tab &&
    fa &&
    pane.contains(fa) &&
    (fa.matches('input:not([type=checkbox]):not([type=radio]),textarea') || fa.isContentEditable)
  ) {
    if (S.tab === 'items') {
      var w = document.getElementById('items-wrap');
      if (w) w.replaceChildren(buildItemsList());
    }
    return;
  }
  var keep = fa && fa.getAttribute && fa.getAttribute('data-k'),
    st = pane.scrollTop;
  var fn = { customize: customizePane, items: itemsPane, room: roomPane, advanced: advancedPane, file: filePane }[S.tab] || customizePane;
  pane.replaceChildren(fn());
  pane.scrollTop = force ? 0 : st;
  S.paneBuilt = S.tab;
  Array.prototype.forEach.call(document.querySelectorAll('.gm-nav button'), function (b) {
    var on = b.getAttribute('data-tab') === S.tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (keep) {
    var n = pane.querySelector('[data-k="' + keep + '"]');
    if (n)
      try {
        n.focus();
      } catch (e) {}
  }
};
window.openGearMenu = function (tab) {
  openGear(tab);
};
// Leaving the menu with Showdown picked but no questions written: say what will happen instead.
function gearGuard(done) {
  var d = S.data;
  if (!d || !d.cfg || d.cfg.tie !== 'showdown' || (d.cfg.tieQs || 0) > 0) {
    done();
    return;
  }
  var add = h('button', {
    class: 'btn primary',
    type: 'button',
    onclick: function () {
      closeModal();
      openTiePool();
    },
    text: 'Add questions'
  });
  var go = h('button', {
    class: 'btn',
    type: 'button',
    onclick: function () {
      closeModal();
      done();
    },
    text: 'Continue anyway'
  });
  openModal(
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      h('div', { id: 'dlg-title', class: 'dlg-title', text: 'Showdown has no questions yet' }),
      h('div', { class: 'muted' }, 'Showdown needs tie-breaking questions. Until you add some, ties will be decided by Average.'),
      h('div', { class: 'actions' }, go, add)
    ),
    function () {
      add.focus();
    }
  );
}
function openGear(tab) {
  if (tab) S.tab = tab;
  S.gearOpen = true;
  S.paneBuilt = null;
  var nav = h(
    'div',
    { class: 'gm-nav', role: 'tablist', 'aria-label': 'Menu sections' },
    TABS.map(function (t) {
      return h('button', {
        type: 'button',
        role: 'tab',
        'data-tab': t[0],
        class: 'gm-tab',
        onclick: function () {
          S.tab = t[0];
          S.paneBuilt = null;
          window.renderGear(true);
        },
        text: t[1]
      });
    })
  );
  var modal = h(
    'div',
    { class: 'modal gm', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu and settings' },
    h(
      'div',
      { class: 'gm-bar' },
      nav,
      h('button', {
        class: 'btn icon gm-x',
        type: 'button',
        'aria-label': 'Close menu',
        title: 'Close',
        onclick: function () {
          modal._tryClose();
        },
        html: ''
      })
    ),
    h('div', { class: 'gm-pane', id: 'gm-pane' })
  );
  modal.querySelector('.gm-x').innerHTML = ICON_X;
  openModal(modal, function () {}, { guard: gearGuard });
  S.gearOpen = true;
  window.renderGear(true);
  var t = nav.querySelector('.gm-tab.on');
  if (t) t.focus();
}

/* ---------- item editor, viewer, confirm (from the editor) ---------- */
function askConfirm(kind, item) {
  fromGear();
  var verb = kind === 'remove' ? 'remove' : 'reset';
  var detail =
    kind === 'remove'
      ? 'The item and its votes will be deleted.'
      : 'Its votes and tier result will be cleared, and the item goes back to the queue.';
  var cancel = h('button', { class: 'btn', type: 'button', onclick: closeModal, text: 'Cancel' });
  var ok = h('button', {
    class: 'btn primary' + (kind === 'remove' ? ' warn' : ''),
    type: 'button',
    text: kind === 'remove' ? 'Remove' : 'Reset',
    onclick: function () {
      closeModal();
      act({ type: verb, id: item.id });
    }
  });
  openModal(
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      h('div', { id: 'dlg-title', class: 'dlg-title' }, 'Are you sure you would like to ', h('b', { text: verb }), ' ', nm(item), '?'),
      h('div', { class: 'muted', text: detail }),
      h('div', { class: 'actions' }, cancel, ok)
    ),
    function () {
      cancel.focus();
    }
  );
}
function openEditItem(b, focusRc) {
  fromGear();
  var staged; // undefined = keep photo, null = remove, string = new photo
  var err = h('div', { class: 'err-line', hidden: true });
  var ed = makeRich({ html: b.name, label: 'Item title', placeholder: 'Item title', max: 120 });
  var prevBox = h('div', { class: 'ph-row' });
  function hasPhoto() {
    return staged === undefined ? !!b.img : staged !== null;
  }
  function drawPhoto() {
    prevBox.replaceChildren();
    var src = staged === undefined ? (b.img ? imgUrl(b) : null) : staged;
    if (src) prevBox.append(h('img', { class: 'ph-prev', src: src, alt: '' }));
    prevBox.append(h('button', { class: 'btn small', type: 'button', onclick: choose, text: hasPhoto() ? 'Change Photo' : 'Add Photo' }));
    if (hasPhoto())
      prevBox.append(
        h('button', {
          class: 'btn small danger',
          type: 'button',
          onclick: function () {
            staged = null;
            drawPhoto();
          },
          text: 'Remove Photo'
        })
      );
  }
  function choose() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      resizeImage(f)
        .then(function (url) {
          staged = url;
          err.hidden = true;
          drawPhoto();
        })
        .catch(function () {
          err.textContent = 'That image could not be read.';
          err.hidden = false;
        });
    });
    inp.click();
  }

  /* bonus: text bubble pages or trivia questions */
  var loaded = false,
    st = { kind: 'none', title: '', pages: [''], qs: [] },
    eds = null;
  var infoBox = h('div', { class: 'info-ed' }, h('div', { class: 'muted', text: 'Loading…' }));
  function newQ() {
    return { id: null, q: '', opts: ['', ''], correct: 0, expl: '' };
  }
  function harvest() {
    if (!eds) return;
    if (st.kind === 'text') {
      st.pages = eds.pages.map(function (e) {
        return e.html();
      });
      if (eds.title) st.title = eds.title.html();
    }
    if (st.kind === 'trivia')
      st.qs = eds.qs.map(function (x) {
        return {
          id: x.id,
          q: x.q.html(),
          opts: x.opts.map(function (e) {
            return e.html();
          }),
          correct: x.correct(),
          expl: x.expl.html()
        };
      });
  }
  function drawInfo() {
    infoBox.replaceChildren();
    eds = { pages: [], qs: [] };
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Bonus type' });
    [
      ['none', 'None'],
      ['text', 'Text Bubble'],
      ['trivia', 'Trivia']
    ].forEach(function (k) {
      seg.append(
        h('button', {
          type: 'button',
          class: 'btn small' + (st.kind === k[0] ? ' primary' : ''),
          'aria-pressed': st.kind === k[0] ? 'true' : 'false',
          onclick: function () {
            harvest();
            st.kind = k[0];
            if (k[0] === 'text' && !st.pages.length) st.pages = [''];
            if (k[0] === 'trivia' && !st.qs.length) st.qs = [newQ()];
            drawInfo();
          },
          text: k[1]
        })
      );
    });
    infoBox.append(seg);
    if (st.kind === 'text') {
      infoBox.append(
        h('div', { class: 'small-note', text: 'Guests see this after they submit their tier vote. Add pages for a longer bubble.' })
      );
      eds.title = makeRich({
        html: st.title || '',
        label: 'Bubble title',
        placeholder: 'More on ' + (ed.plain() || '[Item Name]'),
        max: 80
      });
      infoBox.append(h('div', { class: 'field' }, h('div', { class: 'label', text: 'Title' }), eds.title.el));
      st.pages.forEach(function (p, i) {
        var e = makeRich({ html: p, label: 'Bubble page ' + (i + 1), placeholder: 'Bubble text', max: 2000, multi: true });
        eds.pages.push(e);
        infoBox.append(
          h(
            'div',
            { class: 'field' },
            h('div', { class: 'label', text: 'Page ' + (i + 1) }),
            e.el,
            st.pages.length > 1
              ? h('button', {
                  class: 'btn small danger',
                  type: 'button',
                  onclick: function () {
                    harvest();
                    st.pages.splice(i, 1);
                    drawInfo();
                  },
                  text: 'Remove Page'
                })
              : null
          )
        );
      });
      if (st.pages.length < 10)
        infoBox.append(
          h('button', {
            class: 'btn small',
            type: 'button',
            onclick: function () {
              harvest();
              st.pages.push('');
              drawInfo();
            },
            text: 'Add Page'
          })
        );
    } else if (st.kind === 'trivia') {
      infoBox.append(
        h('div', {
          class: 'small-note',
          text: 'Guests answer after they vote. Mark the correct answer. Answers are graded on the server and recorded per guest.'
        })
      );
      st.qs.forEach(function (q, qi) {
        var x = { id: q.id, opts: [] };
        x.q = makeRich({ html: q.q, label: 'Question ' + (qi + 1), placeholder: 'Question', max: 500 });
        var corr = q.correct,
          gname = 'cor' + qi + '-' + Math.random().toString(36).slice(2, 6);
        x.correct = function () {
          return corr;
        };
        var optBox = h('div', { class: 'opt-ed' });
        q.opts.forEach(function (o, k) {
          var e = makeRich({
            html: o,
            label: 'Answer ' + (k + 1) + ' for question ' + (qi + 1),
            placeholder: 'Answer ' + (k + 1),
            max: 200
          });
          x.opts.push(e);
          var r = h('input', { type: 'radio', name: gname, 'aria-label': 'Answer ' + (k + 1) + ' is correct' });
          r.checked = k === corr;
          r.addEventListener('change', function () {
            corr = k;
          });
          optBox.append(
            h(
              'div',
              { class: 'opt-row' },
              r,
              h('div', { class: 'grow' }, e.el),
              q.opts.length > 2
                ? iconBtn(
                    ICON_X,
                    'Remove answer ' + (k + 1),
                    function () {
                      harvest();
                      var Q = st.qs[qi];
                      Q.opts.splice(k, 1);
                      if (Q.correct === k) Q.correct = 0;
                      else if (Q.correct > k) Q.correct--;
                      drawInfo();
                    },
                    false,
                    'danger'
                  )
                : null
            )
          );
        });
        x.expl = makeRich({
          html: q.expl,
          label: 'Follow-up text for question ' + (qi + 1),
          placeholder: 'Follow-up text (optional)',
          max: 2000,
          multi: true
        });
        eds.qs.push(x);
        infoBox.append(
          h(
            'div',
            { class: 'q-ed' },
            h('div', { class: 'label', text: 'Question ' + (qi + 1) }),
            x.q.el,
            h('div', { class: 'label', text: 'Answers (select the correct one)' }),
            optBox,
            q.opts.length < 6
              ? h('button', {
                  class: 'btn small',
                  type: 'button',
                  onclick: function () {
                    harvest();
                    st.qs[qi].opts.push('');
                    drawInfo();
                  },
                  text: 'Add Answer'
                })
              : null,
            h('div', { class: 'label', text: 'Follow-up text, shown after answering' }),
            x.expl.el,
            h('button', {
              class: 'btn small danger',
              type: 'button',
              onclick: function () {
                harvest();
                st.qs.splice(qi, 1);
                if (!st.qs.length) st.kind = 'none';
                drawInfo();
              },
              text: 'Remove Question'
            })
          )
        );
      });
      if (st.qs.length < 15)
        infoBox.append(
          h('button', {
            class: 'btn small',
            type: 'button',
            onclick: function () {
              harvest();
              st.qs.push(newQ());
              drawInfo();
            },
            text: 'Add Question'
          })
        );
    }
  }
  api('GET', '/api/host/' + S.hc + '/item/' + b.id)
    .then(function (r) {
      var rc = r.rc || {};
      st.kind = rc.kind || 'none';
      st.title = rc.title || '';
      st.pages = [rc.text || ''].concat(rc.pages || []);
      st.qs = (rc.qs || []).map(function (q) {
        return { id: q.id, q: q.q, opts: q.opts.slice(), correct: q.correct, expl: q.expl || '' };
      });
      if (
        st.kind === 'text' &&
        !st.pages.some(function (p) {
          return plain(p);
        })
      )
        st.pages = [''];
      loaded = true;
      drawInfo();
      if (focusRc)
        setTimeout(function () {
          infoBox.scrollIntoView({ block: 'start' });
        }, 40);
    })
    .catch(function () {
      infoBox.replaceChildren(h('div', { class: 'err-line', text: 'The bonus content could not be loaded.' }));
    });

  function save() {
    if (!ed.plain() && !hasPhoto()) {
      err.textContent = 'Give the item a name or a photo.';
      err.hidden = false;
      ed.focus();
      return;
    }
    if (loaded) {
      harvest();
      var lines = issueLines(st);
      if (lines.length) {
        confirmIncomplete(lines, commit);
        return;
      }
    }
    commit();
  }
  function commit() {
    var p = { type: 'edit', id: b.id, name: ed.html() };
    if (typeof staged === 'string') p.image = staged;
    else if (staged === null) p.removeImage = true;
    if (loaded) {
      harvest();
      var rc = { kind: st.kind, title: '', text: '', pages: [], qs: [] };
      if (st.kind === 'text') {
        rc.title = st.title || '';
        rc.text = st.pages[0] || '';
        rc.pages = st.pages.slice(1);
      }
      if (st.kind === 'trivia') rc.qs = st.qs;
      p.rc = rc;
    }
    closeModal();
    act(p);
  }
  drawPhoto();
  openModal(
    h(
      'div',
      { class: 'modal wide scroll', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      h('div', { id: 'dlg-title', class: 'dlg-title big', text: 'Edit item' }),
      h('div', { class: 'field' }, h('div', { class: 'label', text: 'Title' }), ed.el),
      h('div', { class: 'field' }, h('div', { class: 'label', text: 'Photo (optional)' }), prevBox),
      h('div', { class: 'field' }, h('div', { class: 'label', text: 'Bonus with the results (optional)' }), infoBox),
      err,
      h(
        'div',
        { class: 'actions right' },
        h('button', { class: 'btn primary', type: 'button', onclick: save, text: 'Save' }),
        h('button', { class: 'btn', type: 'button', onclick: closeModal, text: 'Cancel' })
      )
    ),
    function () {
      if (!focusRc) ed.focus();
    }
  );
}

/* ---------- start ---------- */
(async function init() {
  $('gear-btn').addEventListener('click', function () {
    openGear();
  });
  $('lb-btn').addEventListener('click', openLeaderboard);
  if (!/^[A-Z0-9]{6}$/.test(S.hc)) {
    location.replace('/');
    return;
  }
  try {
    await api('GET', '/api/host/' + S.hc + '/check');
  } catch (e) {
    $('stage').replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('h2', { text: 'Room not found' }),
        h('div', { class: 'muted', text: e.message }),
        h('div', { class: 'actions center' }, h('a', { class: 'btn primary', href: '/', text: 'Back to Start' }))
      )
    );
    return;
  }
  try {
    localStorage.setItem('btp_host', S.hc);
  } catch (e) {}
  connect();
})();
