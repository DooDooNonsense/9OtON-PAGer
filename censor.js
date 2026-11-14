'use strict';
// Name screening for player and host nicknames. The word lists are stored ROT13-encoded so the
// source does not read as a wall of slurs. Matching ignores case, accents, spacing, repeated letters
// and common look-alike characters (@ for a, 0 for o, $ for s, and so on).
const rot = s => s.replace(/[a-z]/gi, c => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
const STRONG = rot(
  'shpx fuvg ovgpu phag avtt sntt ergneq xvxr puvax genaal juber fyhg nffubyr onfgneq anmv uvgyre jrgonpx gjng jnax pbpxfhpx wvmm oybjwbo cbea encvfg zbyrfg crqbcuvy fvrturvy juvgrcbjre ungrnyy xvyynyy ohxxnxr qvyqb nahf'
).split(' ');
const EXACT = rot(
  'nff phz gvg gvgf qvpx pbpx snt cnxv fcvp pbba tbbx qlxr encr xlf xxx crqb avt ubzb gneq nany frk cvff phagf arteb avtf sntf 1488 8814 uu 88'
).split(' ');
const LEET = { '@': 'a', 4: 'a', 3: 'e', 1: 'i', '!': 'i', '|': 'i', 0: 'o', $: 's', 5: 's', 7: 't', '+': 't', 8: 'b' };
const collapse = s => s.replace(/(.)\1+/g, '$1');
function clean(name) {
  const n = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return n
    .split('')
    .map(c => LEET[c] || c)
    .join('');
}
function nameAllowed(name) {
  const raw = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const letters = clean(name).replace(/[^a-z]/g, '');
  const squashed = collapse(letters);
  if (STRONG.some(w => letters.includes(w) || squashed.includes(collapse(w)))) return false;
  const tokens = [raw, clean(name)]
    .join(' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.some(t => EXACT.includes(t) || EXACT.includes(collapse(t)))) return false;
  if (EXACT.includes(letters) || EXACT.includes(squashed) || EXACT.includes(raw.replace(/[^a-z0-9]/g, ''))) return false;
  return true;
}
module.exports = { nameAllowed };
