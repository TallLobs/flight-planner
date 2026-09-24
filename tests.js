/* Checks for navlog.js. Run with `node tests.js`, or open test.html in a browser. */
(function (root) {
  'use strict';

  function run(N) {
    var results = [];
    function ok(name, cond, got) { results.push({ name: name, pass: !!cond, got: got }); }
    function near(a, b, tol) { return a != null && Math.abs(a - b) <= tol; }

    // Wind triangle (wind FROM, degrees true)
    var t = N.windTriangle(90, 110, 45, 20);
    ok('TC 090, TAS 110, wind 045@20: WCA -7.4 (left)', near(t.wca, -7.39, 0.05), t.wca);
    ok('TC 090, TAS 110, wind 045@20: GS 95', near(t.gs, 94.95, 0.1), t.gs);
    t = N.windTriangle(360, 100, 180, 20);
    ok('Direct tailwind: WCA 0, GS 120', near(t.wca, 0, 1e-9) && near(t.gs, 120, 1e-9), t);
    t = N.windTriangle(360, 100, 360, 20);
    ok('Direct headwind: GS 80', near(t.gs, 80, 1e-9), t);
    t = N.windTriangle(360, 100, 90, 20);
    ok('Wind from the right: WCA +11.5, GS 98', near(t.wca, 11.54, 0.05) && near(t.gs, 97.98, 0.05), t);
    ok('Calm wind: GS = TAS', N.windTriangle(270, 105, null, null).gs === 105);
    ok('Crosswind stronger than TAS is an error', !!N.windTriangle(360, 50, 90, 60).error);

    // Heading wrap
    ok('355 + 10 wraps to 005', N.wrap360(365) === 5);
    ok('0 shows as 360', N.wrap360(0) === 360);
    ok('-5 wraps to 355', N.wrap360(-5) === 355);
    ok('359.6 rounds to 360', N.wrap360(359.6) === 360);

    // Parsing
    ok('Variation 7W = +7', N.variation('7W') === 7);
    ok('Variation 7E = -7', N.variation('7E') === -7);
    ok('Variation -3 = -3', N.variation('-3') === -3);
    ok('WCA 5L = -5', N.wcaValue('5L') === -5);
    ok('Clock 1430', N.clock('1430') === 870);
    ok('Clock 9:05', N.clock('9:05') === 545);
    ok('Clock 25:00 rejected', N.clock('25:00') === null);
    ok('Duration 12:30 = 12.5 min', N.duration('12:30') === 12.5);
    ok('Format 12.5 min as 12:30', N.formatDuration(12.5) === '12:30');
    ok('Clock wraps past midnight', N.formatClock(1450) === '00:10');

    // Geography
    ok('Bearing due east = 090', near(N.bearing(0, 0, 0, 1), 90, 1e-6));
    ok('Bearing due north = 000', near(N.bearing(0, 0, 1, 0), 0, 1e-6));
    ok('1 degree of latitude = 60.0 nm', near(N.distanceNm(0, 0, 1, 0), 60.04, 0.01), N.distanceNm(0, 0, 1, 0));

    // Whole sheet
    var s = {
      totalFuel: '40', gph: '10', timeOff: '1400',
      legs: [
        { cp: 'A', tc: '090', tas: '110', wdir: '045', wvel: '20', var: '5W', dist: '19' },
        { cp: 'B', tc: '090', tas: '110', var: '5W', dist: '20' },
        {}
      ]
    };
    var c = N.computeSheet(s), a = c.legs[0], b = c.legs[1];
    ok('Leg 1: WCA -7, TH 083, MH 088, CH 088', a.wca === -7 && a.th === 83 && a.mh === 88 && a.ch === 88, a);
    ok('Leg 1: GS 95, ETE 12:00, ETA 14:12', a.gse === 95 && N.formatDuration(a.ete) === '12:00' && N.formatClock(a.eta) === '14:12', a);
    ok('Leg 1: fuel 2.0, fuel rem 38.0, dist rem 20', near(a.fuel, 2, 1e-9) && near(a.frem, 38, 1e-9) && a.rem === 20, a);
    ok('Leg 2 (calm): GS 110, ETE 10:55', b.gse === 110 && N.formatDuration(b.ete) === '10:55', b);
    ok('Leg 2: ETA 14:23, fuel rem 36.2, dist rem 0', N.formatClock(b.eta) === '14:23' && N.formatTenths(b.frem) === '36.2' && b.rem === 0, b);
    ok('Empty row stays empty', c.legs[2].gse === null && c.legs[2].frem === null && c.legs[2].rem === null, c.legs[2]);
    ok('Total distance 39', c.totalDist === 39);

    s.legs[0].ata = '1415';
    c = N.computeSheet(s); a = c.legs[0]; b = c.legs[1];
    ok('ATA 14:15: ATE 15:00, actual GS 76', N.formatDuration(a.ate) === '15:00' && Math.round(a.gsa) === 76, a);
    ok('ATA 14:15: leg fuel uses actual time (2.5)', near(a.fuel, 2.5, 1e-9), a.fuel);
    ok('ATA 14:15: next ETA re-based to 14:26', N.formatClock(b.eta) === '14:26', b.eta);

    s.legs[0].pin = { gse: '100' };
    delete s.legs[0].ata;
    c = N.computeSheet(s);
    ok('Typed GS 100 overrides: ETE 11:24', N.formatDuration(c.legs[0].ete) === '11:24', c.legs[0].ete);
    s.legs[0].pin = { frem: '30' };
    c = N.computeSheet(s);
    ok('Typed Fuel Rem 30 re-bases the next leg (28.2)', N.formatTenths(c.legs[1].frem) === '28.2', c.legs[1].frem);

    // Weight and balance, Hobbs
    ok('CG 2300 lb / 95.3 (x1000) = 41.4 in', N.cg('2300', '95.3') === 41.4);
    ok('CG 2300 lb / 95300 lb-in = 41.4 in', N.cg('2300', '95300') === 41.4);
    ok('Log time 1234.5 -> 1236.1 = 1.6', N.logTime('1234.5', '1236.1') === 1.6);

    var legs = N.routeLegs([{ name: 'P0', lat: 0, lon: 0 }, { name: 'P1', lat: 0, lon: 1 }]);
    ok('Route leg: TC 090, 60.0 nm', legs[0].tc === 90 && legs[0].dist === 60, legs[0]);

    return results;
  }

  if (typeof module !== 'undefined' && module.exports) {
    var results = run(require('./navlog.js'));
    var failed = 0;
    results.forEach(function (r) {
      if (!r.pass) failed++;
      console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   got ' + JSON.stringify(r.got)));
    });
    console.log((results.length - failed) + '/' + results.length + ' passed');
    process.exitCode = failed ? 1 : 0;
  } else {
    root.NavlogTests = run;
  }
})(this);
