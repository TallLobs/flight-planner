/* Navlog math: pure functions, no DOM. Loaded by index.html, test.html and node (tests.js). */
(function (root) {
  'use strict';

  var RAD = Math.PI / 180;
  var EARTH_NM = 3440.065;

  function blankText(v) {
    return v === null || v === undefined || String(v).trim() === '';
  }

  function num(v) {
    if (blankText(v)) return null;
    var n = Number(String(v).trim().replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  // Signed value with optional letter suffix: variation "7W" = +7 / "7E" = -7 (the sheet's -E +W),
  // WCA "7R" = +7 / "7L" = -7. A plain "-7" or "+7" also works.
  function signed(v, negLetter, posLetter) {
    if (blankText(v)) return null;
    var m = String(v).trim().match(/^([+-]?\d+(?:\.\d+)?)\s*([A-Za-z])?$/);
    if (!m) return null;
    var n = Number(m[1]);
    if (m[2]) {
      var letter = m[2].toUpperCase();
      if (letter === negLetter) n = -Math.abs(n);
      else if (letter === posLetter) n = Math.abs(n);
      else return null;
    }
    return n;
  }

  function variation(v) { return signed(v, 'E', 'W'); }
  function wcaValue(v) { return signed(v, 'L', 'R'); }

  // Headings are whole degrees, 001-360.
  function wrap360(d) {
    var x = Math.round(d) % 360;
    if (x <= 0) x += 360;
    return x;
  }

  // Wind direction is the direction the wind blows FROM, in degrees true.
  // Returns {wca, gs}, {error}, or null when there is not enough to compute.
  function windTriangle(tc, tas, wd, wv) {
    if (tc == null || tas == null || tas <= 0) return null;
    if (wv == null || wv === 0) return { wca: 0, gs: tas };
    if (wd == null) return null;
    var angle = (wd - tc) * RAD;
    var x = wv * Math.sin(angle) / tas;
    if (Math.abs(x) >= 1) return { error: 'Crosswind component is larger than TAS' };
    var wca = Math.asin(x) / RAD;
    var gs = tas * Math.cos(wca * RAD) - wv * Math.cos(angle);
    if (gs <= 0) return { error: 'Headwind is larger than TAS' };
    return { wca: wca, gs: gs };
  }

  // Durations in minutes: "12" = 12 min, "12:30" = 12 min 30 s, "12.5" = 12.5 min.
  function duration(v) {
    if (blankText(v)) return null;
    var s = String(v).trim();
    var m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return Number(m[1]) + Number(m[2]) / 60;
    return num(s);
  }

  // Clock times in minutes after midnight: "14:30", "1430", "9:05", "905", optional Z/L suffix.
  function clock(v) {
    if (blankText(v)) return null;
    var s = String(v).trim().replace(/[ZzLl]$/, '');
    var h, mm, m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m) { h = Number(m[1]); mm = Number(m[2]); }
    else if (/^\d{3,4}$/.test(s)) { h = Math.floor(Number(s) / 100); mm = Number(s) % 100; }
    else return null;
    if (h > 23 || mm > 59) return null;
    return h * 60 + mm;
  }

  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function formatDuration(min) {
    if (min == null) return '';
    var s = Math.round(min * 60);
    return Math.floor(s / 60) + ':' + pad(s % 60, 2);
  }

  function formatClock(min) {
    if (min == null) return '';
    var m = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60), 2) + ':' + pad(m % 60, 2);
  }

  function formatHeading(d) { return d == null ? '' : pad(d, 3); }
  function formatWca(n) { return n == null ? '' : (n > 0 ? '+' + n : String(n)); }
  function formatTenths(n) { return n == null ? '' : String(round1(n)); }
  function formatWhole(n) { return n == null ? '' : String(Math.round(n)); }

  var FORMAT = {
    wca: formatWca, th: formatHeading, mh: formatHeading, ch: formatHeading,
    rem: formatTenths, gse: formatWhole, gsa: formatWhole,
    ete: formatDuration, ate: formatDuration, eta: formatClock,
    fuel: formatTenths, frem: formatTenths
  };

  // How a typed override of a computed cell is read back.
  var PARSE = {
    wca: wcaValue, th: num, mh: num, ch: num, rem: num, gse: num, gsa: num,
    ete: duration, ate: duration, eta: clock, fuel: num, frem: num
  };

  // state: { legs: [...], totalFuel, gph, timeOff }. Each leg holds typed text; leg.pin holds
  // typed overrides of computed cells, which also carry forward (a pinned Fuel Rem re-bases the rest).
  function computeSheet(state) {
    var legs = state.legs || [];
    var gph = num(state.gph);
    var totalFuel = num(state.totalFuel);
    var timeOff = clock(state.timeOff);

    var totalDist = null;
    legs.forEach(function (l) {
      var d = num(l.dist);
      if (d != null) totalDist = (totalDist || 0) + d;
    });

    var distLeft = totalDist, fuelLeft = totalFuel;
    var clockNow = timeOff;      // ETA base: time off, then each leg's ATA when known, else its ETA
    var lastActual = timeOff;    // ATE base: time off, then each leg's ATA
    var out = [];

    legs.forEach(function (l) {
      var pin = l.pin || {};
      function pinned(k) { return blankText(pin[k]) ? undefined : PARSE[k](pin[k]); }
      function pick(k, computed) { var p = pinned(k); return p !== undefined ? p : computed; }

      var r = { error: null };
      var tc = num(l.tc), tas = num(l.tas), wd = num(l.wdir), wv = num(l.wvel), dist = num(l.dist);
      var tri = windTriangle(tc, tas, wd, wv);
      if (tri && tri.error) { r.error = tri.error; tri = null; }

      r.wca = pick('wca', tri ? Math.round(tri.wca) : null);
      r.th = pick('th', tc != null && r.wca != null ? wrap360(tc + r.wca) : null);
      var v = variation(l.var);
      r.mh = pick('mh', r.th != null && v != null ? wrap360(r.th + v) : null);
      var dev = blankText(l.dev) ? 0 : signed(l.dev);
      r.ch = pick('ch', r.mh != null && dev != null ? wrap360(r.mh + dev) : null);

      r.gse = pick('gse', tri ? Math.round(tri.gs) : null);
      r.ete = pick('ete', dist != null && r.gse > 0 ? dist / r.gse * 60 : null);

      var ata = clock(l.ata);
      r.ate = pick('ate', ata != null && lastActual != null ? (((ata - lastActual) % 1440) + 1440) % 1440 : null);
      lastActual = ata;
      r.gsa = pick('gsa', dist != null && r.ate > 0 ? dist / r.ate * 60 : null);

      r.eta = pick('eta', clockNow != null && r.ete != null ? clockNow + r.ete : null);
      clockNow = ata != null ? ata : r.eta;

      var burn = r.ate != null ? r.ate : r.ete;
      r.fuel = pick('fuel', burn != null && gph != null ? burn / 60 * gph : null);
      if (r.fuel != null) fuelLeft = fuelLeft != null ? fuelLeft - r.fuel : null;
      else if (dist != null) fuelLeft = null;   // a flown leg with unknown burn breaks the chain
      r.frem = r.fuel != null ? fuelLeft : null;
      var pf = pinned('frem');
      if (pf !== undefined) { r.frem = pf; fuelLeft = pf; }

      if (dist != null && distLeft != null) { distLeft -= dist; r.rem = distLeft; } else r.rem = null;
      var pr = pinned('rem');
      if (pr !== undefined) { r.rem = pr; distLeft = pr; }

      out.push(r);
    });

    return { legs: out, totalDist: totalDist, totalFuel: totalFuel, timeOff: timeOff };
  }

  function sum(values) {
    var t = null;
    values.forEach(function (v) { if (v != null) t = (t || 0) + v; });
    return t;
  }

  // CG from weight and moment. Moments written as lb-in/1000 are detected and scaled.
  function cg(weight, moment) {
    var w = num(weight), m = num(moment);
    if (!w || m == null) return null;
    var c = m / w;
    if (Math.abs(c) < 1) c *= 1000;
    return round1(c);
  }

  function logTime(hobbsOut, hobbsIn) {
    var o = num(hobbsOut), i = num(hobbsIn);
    return o == null || i == null ? null : round1(i - o);
  }

  // Great-circle initial bearing (degrees true) and distance (nm) between two lat/lon points.
  function bearing(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  function distanceNm(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * RAD, p2 = lat2 * RAD;
    var dp = p2 - p1, dl = (lon2 - lon1) * RAD;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // points: [{name, lat, lon}] -> legs [{to, tc, dist}]
  function routeLegs(points) {
    var legs = [];
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      legs.push({
        to: b.name,
        tc: wrap360(bearing(a.lat, a.lon, b.lat, b.lon)),
        dist: round1(distanceNm(a.lat, a.lon, b.lat, b.lon))
      });
    }
    return legs;
  }

  var api = {
    num: num, signed: signed, variation: variation, wcaValue: wcaValue, wrap360: wrap360,
    windTriangle: windTriangle, duration: duration, clock: clock,
    formatDuration: formatDuration, formatClock: formatClock, formatHeading: formatHeading,
    formatWca: formatWca, formatTenths: formatTenths, FORMAT: FORMAT,
    computeSheet: computeSheet, sum: sum, cg: cg, logTime: logTime,
    bearing: bearing, distanceNm: distanceNm, routeLegs: routeLegs
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Navlog = api;
})(this);
