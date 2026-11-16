/* おのだサンパーク館内ナビ 見本：道順の計算・案内文の組み立て・画面
 * 上半分（Nav）は画面に依存せず、Node でも動く。下半分が画面。
 * 座標は階ごと（その階の画像のピクセル）。階をまたぐ距離は計算しない。
 */
(function () {
  'use strict';
  var B = (typeof module !== 'undefined' && module.exports) ? require('./building.js') : window.BUILDING;

  // ---------- 道順の計算 ----------
  // 昇降機の線の重さは距離ではなく固定値（歩く距離のpx相当。エレベーターは待ち時間ぶん重い）
  var COST = { escalator: 120, stairs: 160, elevator: 260 };
  var nodeById = {};
  B.nodes.forEach(function (n) { nodeById[n.id] = n; });

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function buildGraph(stepFree) {
    var adj = {};
    B.nodes.forEach(function (n) { adj[n.id] = []; });
    B.edges.forEach(function (e) {
      if (stepFree && !e.stepFree) return; // 車いす・ベビーカー：エスカレーター・階段は使わない
      var a = nodeById[e.from], b = nodeById[e.to];
      var w = e.type === 'walk' ? dist(a, b) : COST[e.type];
      adj[e.from].push({ to: e.to, w: w, edge: e });
      adj[e.to].push({ to: e.from, w: w, edge: e });
    });
    return adj;
  }

  // ダイクストラ法。戻り値：{ nodes:[id...], edges:[edge...], cost } か null
  function shortestPath(fromId, toId, stepFree) {
    var adj = buildGraph(stepFree);
    var d = {}, prev = {}, done = {};
    B.nodes.forEach(function (n) { d[n.id] = Infinity; });
    d[fromId] = 0;
    for (;;) {
      var u = null, best = Infinity;
      for (var id in d) { if (!done[id] && d[id] < best) { best = d[id]; u = id; } }
      if (u === null || u === toId) break;
      done[u] = true;
      adj[u].forEach(function (x) {
        if (d[u] + x.w < d[x.to]) { d[x.to] = d[u] + x.w; prev[x.to] = { id: u, edge: x.edge }; }
      });
    }
    if (d[toId] === Infinity) return null;
    var nodes = [toId], edges = [], cur = toId;
    while (cur !== fromId) { var p = prev[cur]; edges.unshift(p.edge); cur = p.id; nodes.unshift(cur); }
    return { nodes: nodes, edges: edges, cost: d[toId] };
  }

  // ---------- 形の計算 ----------
  function centroid(poly) {
    var x = 0, y = 0;
    poly.forEach(function (p) { x += p[0]; y += p[1]; });
    return { x: x / poly.length, y: y / poly.length };
  }
  function ptSegDist(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
    var t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)) : 0;
    return { d: Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)), t: t };
  }
  // 道の線分 a-b と多角形の縁との最短距離、そのときの線分上の位置 t
  function segPolyDist(a, b, poly) {
    var best = { d: Infinity, t: 0 };
    for (var i = 0; i < poly.length; i++) {
      var p = { x: poly[i][0], y: poly[i][1] }, q = { x: poly[(i + 1) % poly.length][0], y: poly[(i + 1) % poly.length][1] };
      var r = ptSegDist(p, a, b);
      if (r.d < best.d) best = { d: r.d, t: r.t };
      // 道の両端から縁へ
      var r2 = ptSegDist(a, p, q); if (r2.d < best.d) best = { d: r2.d, t: 0 };
      var r3 = ptSegDist(b, p, q); if (r3.d < best.d) best = { d: r3.d, t: 1 };
    }
    return best;
  }

  // ---------- 案内文 ----------
  function heading(a, b) { return [b.x - a.x, b.y - a.y]; }
  // 画面は y が下向き。cross>0 なら右回り（右へ曲がる）
  function turnDeg(h1, h2) {
    var cross = h1[0] * h2[1] - h1[1] * h2[0], dot = h1[0] * h2[0] + h1[1] * h2[1];
    return Math.atan2(cross, dot) * 180 / Math.PI;
  }
  function turnWord(deg) {
    if (Math.abs(deg) < 35) return 'まっすぐ';
    if (Math.abs(deg) > 135) return '引き返すように';
    return deg > 0 ? '右へ' : '左へ';
  }
  // 点が進行方向のどちら側か：右手／左手／正面
  function sideOf(h, from, p) {
    var cross = h[0] * (p.y - from.y) - h[1] * (p.x - from.x);
    var dot = h[0] * (p.x - from.x) + h[1] * (p.y - from.y);
    if (Math.abs(Math.atan2(cross, dot)) * 180 / Math.PI < 25) return '正面';
    return cross > 0 ? '右手' : '左手';
  }

  var NEAR = 45; // 道から店の縁までこの距離（px）以内なら「道沿い」
  function landmarksAlong(nodeIds, floor, skipNames) {
    var byName = {};
    B.landmarks.forEach(function (lm) {
      if (lm.floor !== floor || skipNames[lm.name]) return;
      var c = centroid(lm.poly);
      for (var i = 0; i + 1 < nodeIds.length; i++) {
        var a = nodeById[nodeIds[i]], b = nodeById[nodeIds[i + 1]];
        if (dist(a, b) < 15) continue;
        var r = segPolyDist(a, b, lm.poly);
        if (r.d > NEAR) continue;
        var side = sideOf(heading(a, b), a, c);
        if (side === '正面') continue;
        var cand = { name: lm.name, pos: i + r.t, side: side, d: r.d };
        if (!byName[lm.name] || cand.d < byName[lm.name].d) byName[lm.name] = cand;
      }
    });
    var found = Object.keys(byName).map(function (k) { return byName[k]; });
    // 近い順に2つまで選び、通る順に並べる
    found.sort(function (x, y) { return x.d - y.d; });
    found = found.slice(0, 2);
    found.sort(function (x, y) { return x.pos - y.pos; });
    return found;
  }
  function landmarkPhrase(list) {
    if (!list.length) return '';
    var by = {}, order = [];
    list.forEach(function (l) { if (!by[l.side]) { by[l.side] = []; order.push(l.side); } by[l.side].push(l.name); });
    return order.map(function (sd) { return by[sd].join('・') + 'を' + sd + 'に'; }).join('、') + '見て';
  }

  // 歩きの区間の折れ線を、Douglas-Peucker で「脚」にまとめる（短いジグザグを曲がり角と数えない）
  function keyIndices(ids, eps) {
    var pts = ids.map(function (id) { return nodeById[id]; });
    function rec(i0, i1, out) {
      var a = pts[i0], b = pts[i1], md = 0, mi = -1;
      for (var i = i0 + 1; i < i1; i++) { var r = ptSegDist(pts[i], a, b); if (r.d > md) { md = r.d; mi = i; } }
      if (md > eps) { rec(i0, mi, out); out.push(mi); rec(mi, i1, out); }
    }
    var out = [0]; rec(0, pts.length - 1, out); out.push(pts.length - 1);
    return out;
  }

  var TURN_EPS = 14;       // これより小さいずれは折れと見なさない（px）
  var MIN_LEG = 30;        // これより短い脚では「曲がる」と判定しない（px）

  function liftName(n) { return n.name.replace(/^[12]F /, ''); }
  function toolWord(kind) { return { escalator: 'エスカレーター', stairs: '階段', elevator: 'エレベーター' }[kind]; }

  // 道順 → カード（3〜7枚）。各カード：{ floor, text, nodes:[id...], kind }
  function buildCards(path) {
    var dest = B.destination;
    // 1) 歩きの「続き」と昇降機に分ける
    var runs = [], cur = null;
    path.edges.forEach(function (e, i) {
      var a = path.nodes[i], b = path.nodes[i + 1];
      if (e.type !== 'walk') { cur = null; runs.push({ kind: e.type, nodes: [a, b] }); return; }
      if (!cur) { cur = { kind: 'walk', nodes: [a] }; runs.push(cur); }
      cur.nodes.push(b);
    });
    // 2) 歩きの続きを、曲がり角でカードの単位に分ける
    var groups = [], lastHeading = nodeById[path.nodes[0]].facing || null, afterLift = false;
    runs.forEach(function (r) {
      if (r.kind !== 'walk') {
        groups.push({ kind: r.kind, nodes: r.nodes, floor: nodeById[r.nodes[0]].floor, floorTo: nodeById[r.nodes[1]].floor });
        lastHeading = null; afterLift = true;
        return;
      }
      var keys = keyIndices(r.nodes, TURN_EPS), g = null;
      for (var k = 0; k + 1 < keys.length; k++) {
        var a = nodeById[r.nodes[keys[k]]], b = nodeById[r.nodes[keys[k + 1]]];
        var h = heading(a, b), len = Math.hypot(h[0], h[1]);
        var turn = lastHeading ? turnDeg(lastHeading, h) : null;
        var isTurn = turn !== null && Math.abs(turn) >= 35 && len >= MIN_LEG;
        if (!g || isTurn) {
          g = { kind: 'walk', floor: a.floor, nodes: [r.nodes[keys[k]]], turn: g ? turn : (afterLift ? null : turn), afterLift: !groups.length ? false : afterLift, first: !groups.length };
          groups.push(g); afterLift = false;
        }
        for (var m = keys[k] + 1; m <= keys[k + 1]; m++) g.nodes.push(r.nodes[m]);
        if (len >= 8) lastHeading = h;
      }
    });

    // 3) カードの文
    var said = {}; // 一度出した目印は繰り返さない
    var lastWalkIdx = -1;
    groups.forEach(function (g, i) { if (g.kind === 'walk') lastWalkIdx = i; });
    var cards = groups.map(function (g, gi) {
      if (g.kind !== 'walk') {
        var ln = nodeById[g.nodes[0]];
        return { kind: g.kind, floor: g.floor, floorTo: g.floorTo, nodes: g.nodes,
          text: toolWord(g.kind) + 'で' + g.floorTo + '階へ' + (g.floor < g.floorTo ? '上がります。' : '下ります。'),
          sub: liftName(ln) };
      }
      var lmList = landmarksAlong(g.nodes, g.floor, said);
      lmList.forEach(function (l) { said[l.name] = true; });
      var lm = landmarkPhrase(lmList);
      var end = nodeById[g.nodes[g.nodes.length - 1]];
      var target;
      if (gi === lastWalkIdx && end.id === dest.node) target = dest.name + 'の' + (dest.entranceNote || '入口') + 'まで進みます。';
      else if (end.kind === 'escalator' || end.kind === 'stairs' || end.kind === 'elevator') target = liftName(end) + 'まで進みます。';
      else target = end.name + 'まで進みます。';
      var head;
      if (g.turn === null) head = g.afterLift ? '降りたら、' : '';
      else {
        var tw = turnWord(g.turn);
        head = (g.first && nodeById[g.nodes[0]].kind === 'entrance' ? '入口から、' : '') + (tw === 'まっすぐ' ? 'まっすぐ、' : tw + '曲がって、');
      }
      return { kind: 'walk', floor: g.floor, nodes: g.nodes, text: head + (lm ? lm + '、' : '') + target };
    });

    // 4) 到着カード：最後の歩きの向きから、行き先の店が右手・左手・正面のどちらかを計算
    var arrive = dest.name + 'の店舗前の目安です。入口の位置は現地でご確認ください。';
    if (lastWalkIdx >= 0) {
      var ln2 = groups[lastWalkIdx].nodes, n2 = nodeById[ln2[ln2.length - 1]], n1 = nodeById[ln2[ln2.length - 2]];
      var sd = sideOf(heading(n1, n2), n2, centroid(dest.poly));
      arrive = dest.name + 'は' + sd + 'です。ここは店舗前の目安です。入口の位置は現地でご確認ください。';
    }
    cards.push({ kind: 'arrive', floor: nodeById[path.nodes[path.nodes.length - 1]].floor,
      nodes: [path.nodes[path.nodes.length - 1]], text: arrive });

    // 曲がる案内を失わないよう、カードの枚数で経路を圧縮しない。
    return cards;
  }

  function route(fromId, stepFree) {
    var p = shortestPath(fromId, B.destination.node, stepFree);
    if (!p) return null;
    return { path: p, cards: buildCards(p) };
  }

  var Nav = { shortestPath: shortestPath, buildCards: buildCards, route: route, nodeById: nodeById, B: B };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Nav; return; }

  // ---------- 画面 ----------
  var $ = function (id) { return document.getElementById(id); };
  var state = { from: null, stepFree: false, idx: 0, mapFloor: 1, r: null };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function readUrl() {
    var q = new URLSearchParams(location.search);
    var f = q.get('from');
    if (f && B.starts.some(function (s) { return s.id === f; })) state.from = f;
    if (q.get('stepfree') === '1') state.stepFree = true;
  }
  function writeUrl() {
    var q = new URLSearchParams();
    if (state.from) q.set('from', state.from);
    if (state.stepFree) q.set('stepfree', '1');
    var s = q.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '')); } catch (e) { /* file:// など */ }
  }

  function compute() {
    state.r = state.from ? route(state.from, state.stepFree) : null;
    state.idx = 0;
    if (state.r) state.mapFloor = state.r.cards[0].floor;
  }

  function renderStart() {
    var html = '<h2 class="q">いまどこにいますか？</h2><div class="starts">';
    B.starts.forEach(function (s) {
      html += '<button class="start-btn" data-from="' + esc(s.id) + '">' + esc(s.label) + '</button>';
    });
    html += '</div><p class="hint">店内のQRシールを読み取ると、この質問は省かれます。</p>';
    $('main').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('.start-btn'), function (b) {
      b.addEventListener('click', function () { state.from = b.getAttribute('data-from'); writeUrl(); compute(); render(); });
    });
  }

  // その階で、ルートと行き先が入る範囲（画像のピクセル）
  function floorBBox(floor, cards) {
    var xs = [], ys = [];
    cards.forEach(function (c) { c.nodes.forEach(function (id) { var n = nodeById[id]; if (n.floor === floor) { xs.push(n.x); ys.push(n.y); } }); });
    if (floor === B.destination.floor) B.destination.poly.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
    if (!xs.length) { B.outline[floor].forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); }
    var pad = 110;
    var x0 = Math.min.apply(null, xs) - pad, x1 = Math.max.apply(null, xs) + pad;
    var y0 = Math.min.apply(null, ys) - pad, y1 = Math.max.apply(null, ys) + pad;
    var w = Math.max(x1 - x0, 520), h = Math.max(y1 - y0, 360);
    // 縦横比を 4:3 前後にそろえる
    if (w / h > 1.45) h = w / 1.45; else if (w / h < 1.15) w = h * 1.15;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }

  function pts(ids) { return ids.map(function (id) { return nodeById[id].x + ',' + nodeById[id].y; }).join(' '); }
  function polyPts(poly) { return poly.map(function (p) { return p[0] + ',' + p[1]; }).join(' '); }

  var LIFT_LABEL = { escalator: 'エス', stairs: '階段', elevator: 'EV' };

  function renderMap() {
    var floor = state.mapFloor, cards = state.r.cards, vb = floorBBox(floor, cards);
    var u = vb.w / 380; // 画面1px ≒ この値
    var s = '<svg viewBox="' + [vb.x, vb.y, vb.w, vb.h].map(Math.round).join(' ') + '" role="img" aria-label="' + floor + '階の地図">';
    s += '<polygon points="' + polyPts(B.outline[floor]) + '" fill="#f6f8fb" stroke="#1f2f4f" stroke-width="' + 1.6 * u + '" stroke-linejoin="round"/>';
    // 名前なしの店
    (B.grey[floor] || []).forEach(function (g) { s += '<polygon points="' + polyPts(g) + '" fill="#e2e5eb" stroke="#cfd4de" stroke-width="' + 0.6 * u + '"/>'; });
    // 広場・昇降機の島・吹抜
    B.areas.forEach(function (a) {
      if (a.floor !== floor) return;
      if (a.kind === 'plaza') s += '<polygon points="' + polyPts(a.poly) + '" fill="#fbf6e6" stroke="#d9c88f" stroke-width="' + 0.8 * u + '" stroke-dasharray="' + 3 * u + ' ' + 2 * u + '"/>';
      else s += '<polygon points="' + polyPts(a.poly) + '" fill="#cfd9e8" stroke="#8a9ab5" stroke-width="' + 0.8 * u + '"/>' +
        '<text x="' + centroid(a.poly).x + '" y="' + centroid(a.poly).y + '" font-size="' + 7.5 * u + '" text-anchor="middle" dominant-baseline="middle" fill="#51607d">' + (a.kind === 'void' ? '吹抜' : '') + '</text>';
    });
    // 目印の店（名前あり）
    var named = {};
    B.landmarks.forEach(function (l) {
      if (l.floor !== floor) return;
      s += '<polygon points="' + polyPts(l.poly) + '" fill="#fff" stroke="#9aa5bb" stroke-width="' + 0.9 * u + '"/>';
      if (named[l.name]) return; named[l.name] = 1;
      var c = centroid(l.poly), xs = l.poly.map(function (p) { return p[0]; });
      var wid = Math.max.apply(null, xs) - Math.min.apply(null, xs);
      var fs = Math.max(6 * u, Math.min(9.5 * u, wid / (l.name.length * 0.62)));
      s += '<text x="' + c.x + '" y="' + c.y + '" font-size="' + fs + '" text-anchor="middle" dominant-baseline="middle" fill="#1f2f4f">' + esc(l.name) + '</text>';
    });
    // 行き先
    var dest = B.destination;
    if (dest.floor === floor) {
      var dc = centroid(dest.poly), dn = nodeById[dest.node];
      s += '<polygon points="' + polyPts(dest.poly) + '" fill="#e9d9a6" stroke="#b08d2e" stroke-width="' + 2 * u + '"/>';
      s += '<text x="' + dc.x + '" y="' + (dc.y + 4 * u) + '" font-size="' + 11 * u + '" font-weight="700" text-anchor="middle" fill="#1f2f4f">DAISO</text>';
      s += '<circle cx="' + dn.x + '" cy="' + dn.y + '" r="' + 4.5 * u + '" fill="#b08d2e" stroke="#fff" stroke-width="' + 1.5 * u + '"/>';
      s += '<text x="' + (dn.x + 8 * u) + '" y="' + (dn.y + 13 * u) + '" font-size="' + 8 * u + '" font-weight="700" fill="#8a6a1a">' + esc(dest.entranceNote || '入口') + '</text>';
    }
    // ルート全体（太い線）
    cards.forEach(function (c) {
      if (c.floor === floor && c.kind === 'walk') s += '<polyline points="' + pts(c.nodes) + '" fill="none" stroke="#1f2f4f" stroke-opacity=".55" stroke-width="' + 6 * u + '" stroke-linecap="round" stroke-linejoin="round"/>';
    });
    // いまのカードの区間（強調）
    var cur = cards[state.idx];
    if (cur && cur.floor === floor && cur.kind === 'walk') {
      s += '<polyline points="' + pts(cur.nodes) + '" fill="none" stroke="#fff" stroke-width="' + 12 * u + '" stroke-linecap="round" stroke-linejoin="round"/>';
      s += '<polyline points="' + pts(cur.nodes) + '" fill="none" stroke="#c79a2b" stroke-width="' + 8 * u + '" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    // 昇降機の記号：ルートで使うものは濃く、ほかは薄く
    var onRoute = {};
    cards.forEach(function (c) { if (c.kind !== 'walk' && c.kind !== 'arrive') c.nodes.forEach(function (id) { onRoute[id] = c; }); });
    B.symbols.forEach(function (m) {
      if (m.floor !== floor) return;
      var c = m.node && onRoute[m.node], act = c && c === cur;
      var r = (c ? 10 : 7) * u;
      var fill = act ? '#c79a2b' : (c ? '#1f2f4f' : '#9aa5bb');
      s += '<rect x="' + (m.x - r) + '" y="' + (m.y - r) + '" width="' + 2 * r + '" height="' + 2 * r + '" rx="' + 2.5 * u + '" fill="' + fill + '"/>';
      s += '<text x="' + m.x + '" y="' + (m.y + 0.8 * u) + '" font-size="' + (c ? 9 : 6.5) * u + '" text-anchor="middle" dominant-baseline="middle" fill="#fff">' + LIFT_LABEL[m.kind] + '</text>';
    });
    var sn = nodeById[state.r.path.nodes[0]];
    if (sn.floor === floor) {
      s += '<circle cx="' + sn.x + '" cy="' + sn.y + '" r="' + 9 * u + '" fill="#fff" stroke="#1f2f4f" stroke-width="' + 3.5 * u + '"/>';
      s += '<text x="' + sn.x + '" y="' + (sn.y + 22 * u) + '" font-size="' + 10 * u + '" font-weight="700" text-anchor="middle" fill="#1f2f4f">出発</text>';
    }
    s += '</svg>';
    return s;
  }

  function renderRoute() {
    var r = state.r, cards = r.cards, c = cards[state.idx];
    var html = '';
    html += '<div class="opts"><span class="opts-label">道の選び方</span>' +
      '<button class="seg' + (state.stepFree ? '' : ' on') + '" data-sf="0">ふつう</button>' +
      '<button class="seg' + (state.stepFree ? ' on' : '') + '" data-sf="1">車いす・ベビーカー</button></div>';
    html += '<p class="from">出発：' + esc(B.starts.filter(function (x) { return x.id === state.from; })[0].label) +
      '　<button class="link" id="change-from">変える</button></p>';
    var lift = c.kind === 'escalator' || c.kind === 'elevator' || c.kind === 'stairs';
    html += '<section class="card" aria-live="polite"><div class="step">' + (state.idx + 1) + ' / ' + cards.length + '　' + c.floor + '階' + (lift ? ' → ' + c.floorTo + '階' : '') + '</div>' +
      '<p class="card-text">' + esc(c.text) + '</p>' + (lift && c.sub ? '<p class="card-sub">' + esc(c.sub) + '</p>' : '') +
      '<div class="nav"><button id="prev" class="btn"' + (state.idx === 0 ? ' disabled' : '') + '>前へ</button>' +
      '<button id="next" class="btn primary"' + (state.idx === cards.length - 1 ? ' disabled' : '') + '>次へ</button></div></section>';
    html += '<div class="floors"><button class="fl' + (state.mapFloor === 1 ? ' on' : '') + '" data-fl="1">1F</button><button class="fl' + (state.mapFloor === 2 ? ' on' : '') + '" data-fl="2">2F</button></div>';
    html += '<div class="map">' + renderMap() + '</div>';
    html += '<p class="legend"><span class="lg lg-shop"></span>目印の店　<span class="lg lg-grey"></span>ほかの店　<span class="lg lg-void"></span>吹抜・昇降機の島（通らない想定）</p>';
    if (state.stepFree) html += '<p class="hint">エレベーターを使う道順の目安です。段差・通路幅・扉は現地未確認です。</p>';
    $('main').innerHTML = html;
    $('prev').addEventListener('click', function () { go(-1); });
    $('next').addEventListener('click', function () { go(1); });
    $('change-from').addEventListener('click', function () { state.from = null; state.r = null; writeUrl(); render(); });
    Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (b) {
      b.addEventListener('click', function () { state.stepFree = b.getAttribute('data-sf') === '1'; writeUrl(); compute(); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.fl'), function (b) {
      b.addEventListener('click', function () { state.mapFloor = +b.getAttribute('data-fl'); render(); });
    });
  }

  function go(d) {
    var n = state.idx + d;
    if (n < 0 || n >= state.r.cards.length) return;
    state.idx = n;
    var c = state.r.cards[n];
    // 昇降機のカードでは、降りる階の地図を見せる
    state.mapFloor = (c.kind === 'escalator' || c.kind === 'elevator' || c.kind === 'stairs') ? c.floorTo : c.floor;
    render();
  }

  function render() {
    if (!state.from) renderStart(); else if (state.r) renderRoute();
    else $('main').innerHTML = '<p class="card-text">道順が見つかりませんでした。</p><p><button class="link" id="change-from">出発点を選び直す</button></p>';
    var cf = $('change-from');
    if (cf && !state.r) cf.addEventListener('click', function () { state.from = null; writeUrl(); render(); });
  }

  function initSearch() {
    var input = $('q'), msg = $('q-msg');
    input.addEventListener('input', function () {
      var v = input.value.trim();
      if (!v) { msg.textContent = ''; return; }
      var lv = v.toLowerCase();
      var hit = B.destination.aliases.some(function (a) { return lv.indexOf(a.toLowerCase()) !== -1; });
      msg.textContent = hit ? B.destination.name + 'への道順を表示しています。' : '「' + v + '」は、ご契約後に表示します。';
    });
  }

  readUrl();
  compute();
  document.addEventListener('DOMContentLoaded', function () { $('note').textContent = B.note; initSearch(); render(); });
})();
