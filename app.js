/* The sheet: state, rendering, autosave, pages, files. Math lives in navlog.js. */
(function () {
  'use strict';

  var N = window.Navlog;
  var LEGS_PER_PAGE = 9;
  var STORE_KEY = 'flight-planner:v1';   // namespaced: every repo on talllobs.github.io shares one origin
  var CALC = ['wca', 'th', 'mh', 'ch', 'rem', 'gse', 'gsa', 'ete', 'ate', 'eta', 'fuel', 'frem'];
  var ROUTE_FIELDS = ['cp', 'course', 'tc', 'dist'];

  var sheets = document.getElementById('sheets');
  var statusEl = document.getElementById('status');
  var lastLegCell = null;

  // ---------- state ----------

  function blank() {
    return {
      version: 1, pages: 1,
      v: {}, wb: { takeoff: {}, max: {}, landing: {} },
      totalFuel: '', gph: '', timeOff: '', notes: '', depCp: '',
      legs: [], atis: { dep: {}, dest: {} }, apt: { dep: {}, dest: {} },
      hobbsIn: '', hobbsOut: '', closed: false,
      wx: {}
    };
  }

  function normalize(s) {
    var b = blank();
    Object.keys(b).forEach(function (k) { if (s[k] === undefined || s[k] === null) s[k] = b[k]; });
    ['takeoff', 'max', 'landing'].forEach(function (k) { s.wb[k] = s.wb[k] || {}; });
    ['dep', 'dest'].forEach(function (k) { s.atis[k] = s.atis[k] || {}; s.apt[k] = s.apt[k] || {}; });
    s.pages = Math.max(1, Math.floor(Number(s.pages)) || 1);
    if (!Array.isArray(s.legs)) s.legs = [];
    s.legs.length = Math.min(s.legs.length, s.pages * LEGS_PER_PAGE);
    for (var i = 0; i < s.pages * LEGS_PER_PAGE; i++) {
      s.legs[i] = s.legs[i] || {};
      s.legs[i].pin = s.legs[i].pin || {};
    }
    return s;
  }

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  function setPath(obj, path, value) {
    var keys = path.split('.'), last = keys.pop();
    var target = keys.reduce(function (o, k) { if (o[k] == null) o[k] = {}; return o[k]; }, obj);
    target[last] = value;
  }

  function filled(v) { return v !== undefined && v !== null && String(v).trim() !== ''; }

  function legHasData(l) {
    return Object.keys(l).some(function (k) {
      return k === 'pin' ? Object.keys(l.pin).some(function (p) { return filled(l.pin[p]); }) : filled(l[k]);
    });
  }

  function lastRouteLeg() {
    for (var i = state.legs.length - 1; i >= 0; i--) {
      var l = state.legs[i];
      if (filled(l.cp) || filled(l.dist) || filled(l.tc)) return i;
    }
    return -1;
  }

  function hasRoute() { return filled(state.depCp) || lastRouteLeg() >= 0; }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      status('Saved in this browser ' + N.formatClock(new Date().getHours() * 60 + new Date().getMinutes()));
    } catch (e) {
      status('Browser storage unavailable — use Save navlog to keep your work.');
    }
  }

  var state = normalize(load() || blank());

  // ---------- markup ----------

  function inp(k, attrs) { return '<input data-k="' + k + '" autocomplete="off" ' + (attrs || '') + '>'; }
  function calc(k) { return '<input data-k="' + k + '" data-calc="1" class="calc" autocomplete="off">'; }
  function out(k) { return '<output data-o="' + k + '"></output>'; }

  function topHtml() {
    var vs = [['vr', 'V<sub>R</sub>'], ['vx', 'V<sub>X</sub>'], ['vy', 'V<sub>Y</sub>'], ['va', 'V<sub>A</sub>'], ['vg', 'V<sub>MAX GLIDE</sub>']];
    var rows = [
      ['weight', 'Weight'], ['moment', 'Moment'], ['cg', 'CG (in)'],
      ['roll', 'Ground Roll'], ['clear50', 'Distance To Clear 50′'], ['rwy', 'Runway Length']
    ];
    var body = rows.map(function (r) {
      var k = r[0];
      function col(c) {
        if (k === 'cg' && c !== 'max') return '<td class="out">' + out('cg-' + c) + '</td>';
        var ph = k === 'moment' && c === 'max' ? 'placeholder="check CG envelope"' : (k === 'cg' && c === 'max' ? 'placeholder="limits"' : '');
        return '<td>' + inp('wb.' + c + '.' + k, ph) + '</td>';
      }
      return '<tr><th class="rowlabel">' + r[1] + '</th>' + col('takeoff') + col('max') + col('landing') + '</tr>';
    }).join('');
    return '<div class="sheet-top">' +
      '<div class="perf">' +
        '<div class="vspeeds">' + vs.map(function (v) {
          return '<label><span>' + v[1] + ' =</span>' + inp('v.' + v[0], 'inputmode="decimal"') + '</label>';
        }).join('') + '</div>' +
        '<table class="grid perf-table"><colgroup><col class="c-label"><col><col><col></colgroup>' +
          '<tr><th></th><th>Takeoff</th><th>Maximum</th><th>Landing</th></tr>' + body +
        '</table>' +
      '</div>' +
      '<div class="trip">' +
        '<div class="trip-fields">' +
          '<label><span>Total Fuel (gal)</span>' + inp('totalFuel', 'inputmode="decimal"') + '</label>' +
          '<label><span>GPH</span>' + inp('gph', 'inputmode="decimal"') + '</label>' +
          '<label><span>Time Off</span>' + inp('timeOff', 'placeholder="hh:mm"') + '</label>' +
        '</div>' +
        '<label class="notes"><span>Notes</span><textarea data-k="notes" rows="4"></textarea></label>' +
      '</div>' +
    '</div>';
  }

  function navHtml(p, last) {
    var cols = [112, 50, 46, 50, 34, 32, 38, 34, 34, 34, 34, 40, 36, 44, 44, 40];
    var h = '<table class="grid nav"><colgroup>' + cols.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') + '</colgroup>';
    h += '<thead><tr>' +
      '<th rowspan="2">Check Points</th><th class="small">Freq.</th><th rowspan="2">Course</th>' +
      '<th rowspan="2">Altitude<br><span class="small">(MSL)</span></th><th>Dir.</th><th>Vel.</th>' +
      '<th rowspan="2">TAS</th><th>TC</th><th>TH</th><th>MH</th><th rowspan="2">CH</th>' +
      '<th>Leg</th><th>GS Est.</th><th>ETE</th><th>ETA</th><th>Fuel</th>' +
      '</tr><tr>' +
      '<th class="small">Ident.</th><th colspan="2">Temp.</th>' +
      '<th class="small">WCA<br>−L +R</th><th class="small">Var.<br>−E +W</th><th class="small">±Dev.</th>' +
      '<th>Rem.</th><th>Act.</th><th>ATE</th><th>ATA</th><th class="small">Fuel<br>Rem.</th>' +
      '</tr></thead><tbody>';

    h += '<tr class="dep-row"><td class="cp">' + (p === 0 ? inp('depCp', 'placeholder="Departure"') : out('carry-cp-' + p)) + '</td>' +
      '<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>' +
      '<td class="out">' + out('carry-rem-' + p) + '</td><td></td><td></td>' +
      '<td class="out">' + out('carry-eta-' + p) + '</td><td class="out">' + out('carry-frem-' + p) + '</td></tr>';

    for (var j = 0; j < LEGS_PER_PAGE; j++) {
      var i = p * LEGS_PER_PAGE + j, L = 'legs.' + i + '.';
      h += '<tr class="leg-a">' +
        '<td rowspan="2" class="cp">' + inp(L + 'cp') + '</td>' +
        '<td>' + inp(L + 'freq') + '</td>' +
        '<td rowspan="2" class="course">' + inp(L + 'course') + '</td>' +
        '<td rowspan="2">' + inp(L + 'alt', 'inputmode="numeric"') + '</td>' +
        '<td>' + inp(L + 'wdir', 'inputmode="numeric"') + '</td>' +
        '<td>' + inp(L + 'wvel', 'inputmode="numeric"') + '</td>' +
        '<td rowspan="2">' + inp(L + 'tas', 'inputmode="numeric"') + '</td>' +
        '<td>' + inp(L + 'tc', 'inputmode="numeric"') + '</td>' +
        '<td>' + calc(L + 'th') + '</td><td>' + calc(L + 'mh') + '</td>' +
        '<td rowspan="2">' + calc(L + 'ch') + '</td>' +
        '<td>' + inp(L + 'dist', 'inputmode="decimal"') + '</td>' +
        '<td>' + calc(L + 'gse') + '</td><td>' + calc(L + 'ete') + '</td>' +
        '<td>' + calc(L + 'eta') + '</td><td>' + calc(L + 'fuel') + '</td>' +
        '</tr><tr class="leg-b">' +
        '<td>' + inp(L + 'ident') + '</td>' +
        '<td colspan="2">' + inp(L + 'temp') + '</td>' +
        '<td>' + calc(L + 'wca') + '</td>' +
        '<td>' + inp(L + 'var') + '</td><td>' + inp(L + 'dev') + '</td>' +
        '<td>' + calc(L + 'rem') + '</td><td>' + calc(L + 'gsa') + '</td>' +
        '<td>' + calc(L + 'ate') + '</td><td>' + inp(L + 'ata', 'placeholder=""') + '</td>' +
        '<td>' + calc(L + 'frem') + '</td></tr>';
    }

    h += '</tbody><tfoot><tr>' +
      '<td></td><td colspan="10" class="close"><div><span>' + (last ? 'Close Flight Plan' : 'Continued on page ' + (p + 2)) + '</span>' +
      '<span>' + (last ? 'Totals:' : 'Page totals:') + '</span></div></td>' +
      '<td class="out">' + out('tot-dist-' + p) + '</td><td class="shade"></td>' +
      '<td class="out">' + out('tot-ete-' + p) + '</td><td class="shade"></td>' +
      '<td class="out">' + out('tot-fuel-' + p) + '</td>' +
      '</tr></tfoot></table>';
    return h;
  }

  function sideHtml() {
    var atis = [['code', 'ATIS Code'], ['wind', 'Wind'], ['vis', 'Visibility'], ['ceil', 'Ceiling'],
      ['altim', 'Altimeter'], ['appr', 'Approach'], ['rwy', 'Runway']];
    var dep = [['atis', 'ATIS'], ['grnd', 'Grnd'], ['tower', 'Tower'], ['dep', 'Dep.'], ['ctaf', 'CTAF'], ['fss', 'FSS'], ['tpa', 'TPA'], ['elev', 'Field Elev.']];
    var dest = [['atis', 'ATIS'], ['fss', 'FSS'], ['app', 'App.'], ['tower', 'Tower'], ['ctaf', 'CTAF'], ['grnd', 'Grnd.'], ['tpa', 'TPA'], ['elev', 'Field Elev.']];
    var h = '<div class="side"><table class="grid side-table"><colgroup><col class="c-l"><col><col class="c-l"><col></colgroup>' +
      '<tr><th>Departure</th><th colspan="2" class="hatch">ATIS/Airport Advisories</th><th>Destination</th></tr>';
    atis.forEach(function (a) {
      h += '<tr><td>' + inp('atis.dep.' + a[0]) + '</td><th colspan="2">' + a[1] + '</th><td>' + inp('atis.dest.' + a[0]) + '</td></tr>';
    });
    h += '<tr><th colspan="4" class="hatch">Airport Data</th></tr>' +
      '<tr><th colspan="2">Departure</th><th colspan="2">Destination</th></tr>' +
      '<tr><td colspan="2">' + inp('apt.dep.name') + '</td><td colspan="2">' + inp('apt.dest.name') + '</td></tr>';
    for (var i = 0; i < dep.length; i++) {
      h += '<tr><th class="rowlabel">' + dep[i][1] + '</th><td>' + inp('apt.dep.' + dep[i][0]) + '</td>' +
        '<th class="rowlabel">' + dest[i][1] + '</th><td>' + inp('apt.dest.' + dest[i][0]) + '</td></tr>';
    }
    h += '<tr class="hobbs"><th class="rowlabel">HOBBS In:</th><td>' + inp('hobbsIn', 'inputmode="decimal"') + '</td><th colspan="2">Log Time</th></tr>' +
      '<tr class="hobbs"><th class="rowlabel">HOBBS Out:</th><td>' + inp('hobbsOut', 'inputmode="decimal"') + '</td><td colspan="2" class="out">' + out('logtime') + '</td></tr>' +
      '</table><label class="closed">Flight Plan Closed? <input type="checkbox" data-k="closed"></label></div>';
    return h;
  }

  function pageHtml(p) {
    var first = p === 0, last = p === state.pages - 1;
    // Continuation pages are grid only; the fit wrapper keeps the title bar as wide as the grid.
    return '<section class="sheet"><div' + (first ? '' : ' class="fit"') + '>' +
      '<header class="sheet-head"><span>Page ' + (p + 1) + ' of ' + state.pages + '</span>' +
      '<h1>VFR Navigation Log</h1><span class="route">' + out('route') + '</span></header>' +
      (first ? topHtml() : '') +
      '<div class="sheet-body">' + navHtml(p, last) + (first ? sideHtml() : '') + '</div>' +
      '</div></section>';
  }

  // ---------- weather log (back of the sheet) ----------

  function chk(k, label) { return '<label class="chk"><input type="checkbox" data-k="' + k + '"> ' + label + '</label>'; }
  function area(k, rows) { return '<textarea data-k="' + k + '" rows="' + rows + '"></textarea>'; }
  function box(title, body, cls) {
    return '<div class="wx-box ' + (cls || '') + '"><div class="wx-title">' + title + '</div>' + body + '</div>';
  }
  function condRow(label, k, withId) {
    return '<div class="wx-row"><div class="wx-label">' + label + (withId ? ': <span class="wx-id">' + inp(k + 'Id') + '</span>' : '') +
      '</div>' + area(k, 2) + '</div>';
  }
  function fpCell(span, label, body) {
    return '<td colspan="' + span + '"><span class="fl">' + label + '</span>' + body + '</td>';
  }
  function split(a, b) { return '<div class="split">' + a + b + '</div>'; }
  function sub(label, field) { return '<label><span class="fl sub">' + label + '</span>' + field + '</label>'; }

  function weatherHtml() {
    var W = 'wx.';
    var winds = '<table class="grid winds"><colgroup><col style="width:25%"><col><col><col><col><col></colgroup>' +
      '<tr><th>Station</th><th colspan="5">Altitude</th></tr><tr><th class="small">(dir/vel/temp)</th>';
    for (var a = 0; a < 5; a++) winds += '<td>' + inp(W + 'winds.alt' + a, 'placeholder="ft"') + '</td>';
    winds += '</tr>';
    for (var r = 0; r < 4; r++) {
      winds += '<tr><td>' + inp(W + 'winds.st' + r) + '</td>';
      for (a = 0; a < 5; a++) winds += '<td>' + inp(W + 'winds.r' + r + 'c' + a) + '</td>';
      winds += '</tr>';
    }
    winds += '</table>';

    var F = W + 'fp.';
    var fp = '<table class="grid fp"><colgroup>' +
      [66, 70, 82, 52, 70, 50, 50, 60].map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') + '</colgroup>' +
      '<tr>' +
        fpCell(1, '1. Type', '<div class="types">' + chk(F + 'vfr', 'VFR') + chk(F + 'ifr', 'IFR') + chk(F + 'dvfr', 'DVFR') + '</div>') +
        fpCell(1, '2. Aircraft ID', inp(F + 'acid')) +
        fpCell(1, '3. Aircraft Type / Special Equip.', inp(F + 'actype', 'placeholder="C172/G"')) +
        fpCell(1, '4. True Airspeed', inp(F + 'tas')) +
        fpCell(1, '5. Departure Point', inp(F + 'dep')) +
        fpCell(2, '6. Departure Time', split(sub('Proposed', inp(F + 'timeProp')), sub('Actual', inp(F + 'timeAct')))) +
        fpCell(1, '7. Cruising Altitude', inp(F + 'alt')) +
      '</tr><tr>' + fpCell(8, '8. Route of Flight', area(F + 'route', 2)) +
      '</tr><tr>' +
        fpCell(2, '9. Destination (Airport/City)', inp(F + 'dest')) +
        fpCell(2, '10. Est. Time Enroute', split(sub('Hours', inp(F + 'eteH')), sub('Minutes', inp(F + 'eteM')))) +
        fpCell(4, '11. Remarks', inp(F + 'remarks', 'class="left"')) +
      '</tr><tr>' +
        fpCell(2, '12. Fuel on Board', split(sub('Hours', inp(F + 'fuelH')), sub('Minutes', inp(F + 'fuelM')))) +
        fpCell(1, '13. Alternate Airport', inp(F + 'altn')) +
        fpCell(5, '14. Pilot\u2019s Name / Address / Phone / Aircraft Home Base', inp(F + 'pilot', 'class="left"')) +
      '</tr><tr>' +
        fpCell(1, '15. Number Aboard', inp(F + 'pob', 'inputmode="numeric"')) +
        fpCell(1, '16. Aircraft Color', inp(F + 'color')) +
        fpCell(6, '17. Destination Contact / Phone (optional)', inp(F + 'contact', 'class="left"')) +
      '</tr><tr><td colspan="8" class="fp-foot">' +
        '<div class="close-line">CLOSE VFR FLIGHT PLAN WITH ' + inp(F + 'fss') + ' FSS ON ARRIVAL.</div>' +
        '<div class="legend">/U = Transponder w/Mode C &nbsp; /A = DME &amp; Transponder w/Mode C &nbsp; /G = GPS with Enroute &amp; Terminal Capability</div>' +
      '</td></tr></table>';

    var mins = [['ceil', 'Personal Minimum Ceiling'], ['vis', 'Personal Minimum Visibility'],
      ['wind', 'Personal Maximum Wind'], ['xwind', 'Personal Maximum Crosswind']].map(function (m) {
      return '<label class="min"><span>' + m[1] + ' =</span>' + inp(W + 'min.' + m[0]) + '</label>';
    }).join('');

    return '<section class="sheet wx-sheet">' +
      '<header class="sheet-head"><span class="brief">Type of Briefing: ' + chk(W + 'standard', 'Standard') +
        chk(W + 'abbrev', 'Abbreviated') + chk(W + 'outlook', 'Outlook') + '</span>' +
        '<h1>Weather Log</h1><span class="route">Briefing 1-800-WX-BRIEF (992-7433)</span></header>' +
      '<div class="wx-body"><div class="wx-col">' +
        box('Adverse Conditions', area(W + 'adverse', 2)) +
        '<div class="wx-flag">' + chk(W + 'vfrNotRec', 'VFR FLIGHT NOT RECOMMENDED') + '</div>' +
        box('Synopsis', area(W + 'synopsis', 2)) +
        box('Current Conditions',
          condRow('Departure Airport', W + 'cur.dep', true) + condRow('En Route', W + 'cur.enr') +
          condRow('Destination Airport', W + 'cur.dest', true) + condRow('Alternate Airport', W + 'cur.altn', true) +
          condRow('PIREPs/RAREPs', W + 'cur.pireps')) +
        box('Forecast Conditions',
          condRow('Departure Airport', W + 'fc.dep', true) + condRow('En Route', W + 'fc.enr') +
          '<div class="wx-row freeze"><div class="wx-label">Freezing Level</div><div class="split">' +
            sub('Departure', inp(W + 'fc.frzDep')) + sub('En Route', inp(W + 'fc.frzEnr')) + sub('Destination', inp(W + 'fc.frzDest')) +
          '</div></div>' +
          condRow('Destination Airport', W + 'fc.dest', true) + condRow('Alternate Airport', W + 'fc.altn', true)) +
      '</div><div class="wx-col">' +
        box('Winds Aloft', winds, 'bare') +
        box('NOTAMs', area(W + 'notams', 3)) +
        box('Military Training / Parachute Activity', area(W + 'mil', 2)) +
        '<div class="mins"><div class="wx-title plain">No Go if Current or Forecast Weather is Worse Than:</div>' + mins + '</div>' +
        box('Flight Plan Form', fp, 'bare') +
      '</div></div></section>';
  }

  // ---------- render / refresh ----------

  function render() {
    normalize(state);
    var h = '';
    for (var p = 0; p < state.pages; p++) h += pageHtml(p);
    h += weatherHtml();
    sheets.innerHTML = h;
    sheets.querySelectorAll('[data-k]:not([data-calc])').forEach(function (el) {
      var v = getPath(state, el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v == null ? '' : v;
    });
    refresh();
  }

  function setOut(key, text) {
    sheets.querySelectorAll('[data-o="' + key + '"]').forEach(function (el) { el.textContent = text; });
  }

  function mark(k, bad, title) {
    var el = sheets.querySelector('[data-k="' + k + '"]');
    if (!el) return;
    el.classList.toggle('bad', !!bad);
    el.title = bad ? title : '';
  }

  function refresh() {
    var c = N.computeSheet(state);

    sheets.querySelectorAll('input[data-calc]').forEach(function (el) {
      var parts = el.dataset.k.split('.'), i = Number(parts[1]), f = parts[2];
      var leg = state.legs[i], r = c.legs[i], pin = leg.pin[f];
      var isPinned = filled(pin);
      if (el !== document.activeElement) el.value = isPinned ? pin : N.FORMAT[f](r[f]);
      el.classList.toggle('pinned', isPinned);
      var bad = (f === 'frem' && r.frem != null && r.frem < 0) || ((f === 'wca' || f === 'gse') && r.error);
      el.classList.toggle('bad', !!bad);
      el.title = r.error && (f === 'wca' || f === 'gse') ? r.error
        : isPinned ? 'Typed value — clear the cell to go back to the calculated one' : '';
    });

    var lastIdx = lastRouteLeg();
    var lastCp = lastIdx >= 0 ? state.legs[lastIdx].cp : '';
    setOut('route', filled(state.depCp) || filled(lastCp) ? (state.depCp || '?') + ' → ' + (lastCp || '?') : '');

    for (var p = 0; p < state.pages; p++) {
      var start = p * LEGS_PER_PAGE, end = start + LEGS_PER_PAGE;
      if (p === 0) {
        setOut('carry-rem-0', N.formatTenths(c.totalDist));
        setOut('carry-eta-0', N.formatClock(c.timeOff));
        setOut('carry-frem-0', N.formatTenths(c.totalFuel));
      } else {
        var k = start - 1, prev = c.legs[k], ata = N.clock(state.legs[k].ata);
        setOut('carry-cp-' + p, state.legs[k].cp || '');
        setOut('carry-rem-' + p, N.formatTenths(prev.rem));
        setOut('carry-eta-' + p, N.formatClock(ata != null ? ata : prev.eta));
        setOut('carry-frem-' + p, N.formatTenths(prev.frem));
      }
      var isLast = p === state.pages - 1;
      var from = isLast ? 0 : start;
      var slice = c.legs.slice(from, end), legs = state.legs.slice(from, end);
      setOut('tot-dist-' + p, N.formatTenths(N.sum(legs.map(function (l) { return N.num(l.dist); }))));
      setOut('tot-ete-' + p, N.formatDuration(N.sum(slice.map(function (r) { return r.ete; }))));
      setOut('tot-fuel-' + p, N.formatTenths(N.sum(slice.map(function (r) { return r.fuel; }))));
    }

    var wb = state.wb;
    ['takeoff', 'landing'].forEach(function (col) {
      var cg = N.cg(wb[col].weight, wb[col].moment);
      setOut('cg-' + col, cg == null ? '' : String(cg));
      var w = N.num(wb[col].weight), max = N.num(wb.max.weight);
      mark('wb.' + col + '.weight', w != null && max != null && w > max, 'Above maximum weight');
      var need = N.num(wb[col].clear50), have = N.num(wb[col].rwy);
      mark('wb.' + col + '.clear50', need != null && have != null && need > have, 'Longer than the runway length');
    });
    var lt = N.logTime(state.hobbsOut, state.hobbsIn);
    setOut('logtime', lt == null ? '' : String(lt));
  }

  function changed() { refresh(); saveLocal(); }

  function status(msg) { statusEl.textContent = msg; }

  // ---------- editing ----------

  sheets.addEventListener('input', function (e) {
    var el = e.target, k = el.dataset && el.dataset.k;
    if (!k) return;
    if (el.dataset.calc) {
      var parts = k.split('.'), leg = state.legs[Number(parts[1])];
      if (filled(el.value)) leg.pin[parts[2]] = el.value;
      else delete leg.pin[parts[2]];
    } else {
      setPath(state, k, el.type === 'checkbox' ? el.checked : el.value);
    }
    changed();
  });

  sheets.addEventListener('focusin', function (e) {
    var k = e.target.dataset && e.target.dataset.k;
    if (k && k.indexOf('legs.') === 0) lastLegCell = k;
    if (e.target.select && e.target.tagName === 'INPUT') e.target.select();
  });

  sheets.addEventListener('focusout', function (e) {
    if (e.target.dataset && e.target.dataset.calc) setTimeout(refresh, 0);
  });

  function cellInLeg(k, delta) {
    var parts = k.split('.');
    return sheets.querySelector('[data-k="legs.' + (Number(parts[1]) + delta) + '.' + parts[2] + '"]');
  }

  sheets.addEventListener('keydown', function (e) {
    var k = e.target.dataset && e.target.dataset.k;
    if (!k || e.target.tagName !== 'INPUT') return;
    if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); fillDown(); return; }
    if (k.indexOf('legs.') !== 0) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    var delta = e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey) ? 1
      : e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 0;
    if (!delta) return;
    var next = cellInLeg(k, delta);
    e.preventDefault();
    if (next) next.focus();
  });

  function fillDown() {
    if (!lastLegCell) { status('Click a cell in the leg to copy from, then Fill down.'); return; }
    var parts = lastLegCell.split('.'), i = Number(parts[1]), f = parts[2];
    if (CALC.indexOf(f) >= 0) { status('Fill down copies typed columns (wind, temp, TAS, var, dev, altitude…).'); return; }
    var end = lastRouteLeg();
    if (end <= i) { status('No legs with a route below this one to fill.'); return; }
    var val = state.legs[i][f] || '';
    for (var j = i + 1; j <= end; j++) {
      state.legs[j][f] = val;
      var el = sheets.querySelector('[data-k="legs.' + j + '.' + f + '"]');
      if (el) el.value = val;
    }
    changed();
    status('Copied “' + val + '” into ' + (end - i) + ' leg' + (end - i === 1 ? '' : 's') + ' below.');
  }

  // ---------- pages ----------

  function addPage() {
    state.pages++;
    render(); saveLocal();
    sheets.lastElementChild.scrollIntoView({ behavior: 'smooth' });
  }

  function removePage() {
    if (state.pages === 1) { status('The first page stays.'); return; }
    var start = (state.pages - 1) * LEGS_PER_PAGE;
    var used = state.legs.slice(start).some(legHasData);
    if (used && !confirm('Page ' + state.pages + ' has entries. Remove it and everything on it?')) return;
    state.pages--;
    render(); saveLocal();
  }

  // ---------- files ----------

  function slug(s) { return String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function saveFile() {
    var lastIdx = lastRouteLeg();
    var d = new Date();
    var date = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    var route = [slug(state.depCp), slug(lastIdx >= 0 ? state.legs[lastIdx].cp : '')].filter(Boolean).join('-');
    var name = 'navlog-' + (route ? route + '-' : '') + date + '.json';
    var body = JSON.stringify({ app: 'flight-planner', version: 1, savedAt: d.toISOString(), data: state }, null, 1);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    status('Saved ' + name);
  }

  function openNavlog(name, text) {
    var obj = JSON.parse(text);
    var data = obj && obj.data ? obj.data : obj;
    if (!data || !Array.isArray(data.legs)) throw new Error(name + ' is not a navlog saved by this page.');
    if (hasRoute() && !confirm('Replace the current sheet with ' + name + '?')) return;
    state = normalize(data);
    render(); saveLocal();
    status('Opened ' + name);
  }

  function importRoute(name, text) {
    var route = RouteImport.parse(name, text), pts = route.points;
    var legs = N.routeLegs(pts);
    if (hasRoute() && !confirm('Replace checkpoints, course and distances with the route in ' + name + '? Other columns stay on their rows.')) return;
    state.pages = Math.max(1, Math.ceil(legs.length / LEGS_PER_PAGE));
    normalize(state);
    state.depCp = pts[0].name;
    state.legs.forEach(function (l, i) {
      var r = legs[i];
      ROUTE_FIELDS.forEach(function (f) { l[f] = ''; });
      if (!r) return;
      l.cp = r.to;
      l.course = l.tc = N.formatHeading(r.tc);
      l.dist = String(r.dist);
      if (!filled(l.alt) && filled(route.altitude)) l.alt = route.altitude;
    });
    if (!filled(state.apt.dep.name)) state.apt.dep.name = pts[0].name;
    if (!filled(state.apt.dest.name)) state.apt.dest.name = pts[pts.length - 1].name;
    render(); saveLocal();
    var total = legs.reduce(function (t, l) { return t + l.dist; }, 0);
    status('Imported ' + legs.length + ' legs, ' + N.formatTenths(total) + ' nm from ' + name + '. TC is true course; add variation.');
  }

  function openFile(file) {
    if (!file) return;
    file.arrayBuffer().then(RouteImport.decode).then(function (text) {
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'json') openNavlog(file.name, text);
      else importRoute(file.name, text);
    }).catch(function (err) {
      alert(err.message || String(err));
    });
  }

  function newSheet() {
    if (!confirm('Clear every page, including the weather log? The current navlog is only kept if you used Save navlog.')) return;
    state = normalize(blank());
    render(); saveLocal();
    window.scrollTo(0, 0);
    status('Cleared');
  }

  // ---------- toolbar ----------

  function on(id, fn) { document.getElementById(id).addEventListener('click', fn); }
  var fileOpen = document.getElementById('file-open');
  var fileImport = document.getElementById('file-import');

  on('btn-clear', newSheet);
  on('btn-open', function () { fileOpen.click(); });
  on('btn-save', saveFile);
  on('btn-import', function () { fileImport.click(); });
  on('btn-fill', fillDown);
  on('btn-add-page', addPage);
  on('btn-remove-page', removePage);
  on('btn-print', function () { window.print(); });
  [fileOpen, fileImport].forEach(function (input) {
    input.addEventListener('change', function () { openFile(input.files[0]); input.value = ''; });
  });

  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    openFile(e.dataTransfer.files[0]);
  });

  // Scale the sheets down to fit narrow windows so no edge is cut off (print is always full size).
  var SHEET_WIDTH = 1016;
  function fitToWindow() {
    var z = Math.max(0.5, Math.min(1, (document.documentElement.clientWidth - 32) / SHEET_WIDTH));
    sheets.style.zoom = z < 1 ? String(z) : '';
  }
  window.addEventListener('resize', fitToWindow);
  fitToWindow();

  render();
  status(hasRoute() ? 'Restored from this browser' : 'Import a ForeFlight route or start typing');
})();
