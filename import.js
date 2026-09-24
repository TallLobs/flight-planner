/* Reads a route exported from ForeFlight: .fpl (Garmin FlightPlan XML), with .gpx and .kml as fallbacks.
   Returns [{name, lat, lon}] in route order. Runs entirely in the browser; nothing is uploaded. */
(function (root) {
  'use strict';

  var MAX_POINTS = 200;

  function byLocal(node, name) {
    return Array.prototype.filter.call(node.getElementsByTagName('*'), function (e) {
      return e.localName === name;
    });
  }

  function childText(el, name) {
    var c = byLocal(el, name)[0];
    return c ? c.textContent.trim() : '';
  }

  function point(name, lat, lon) {
    lat = Number(lat); lon = Number(lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return { name: name, lat: lat, lon: lon };
  }

  function parseFpl(doc) {
    var table = {};
    byLocal(doc, 'waypoint').forEach(function (w) {
      var id = childText(w, 'identifier');
      var p = point(id, childText(w, 'lat'), childText(w, 'lon'));
      if (!p) return;
      table[id + '|' + childText(w, 'type')] = p;
      if (!table[id]) table[id] = p;
    });
    var routePoints = byLocal(doc, 'route-point');
    if (!routePoints.length) {
      return Object.keys(table).filter(function (k) { return k.indexOf('|') > 0; }).map(function (k) { return table[k]; });
    }
    var missing = [];
    var pts = routePoints.map(function (rp) {
      var id = childText(rp, 'waypoint-identifier');
      var p = table[id + '|' + childText(rp, 'waypoint-type')] || table[id];
      if (!p) missing.push(id);
      return p;
    });
    if (missing.length) throw new Error('These route points have no coordinates in the file: ' + missing.join(', '));
    return pts;
  }

  function parseGpx(doc) {
    var els = byLocal(doc, 'rtept');
    if (!els.length) els = byLocal(doc, 'wpt');
    if (!els.length) els = byLocal(doc, 'trkpt');
    return els.map(function (e, i) {
      return point(childText(e, 'name') || 'WP' + (i + 1), e.getAttribute('lat'), e.getAttribute('lon'));
    }).filter(Boolean);
  }

  function coords(text) {
    return text.trim().split(/\s+/).map(function (c) {
      var p = c.split(',');
      return { lon: Number(p[0]), lat: Number(p[1]) };
    });
  }

  function parseKml(doc) {
    var pts = [];
    byLocal(doc, 'Placemark').forEach(function (pm) {
      var pt = byLocal(pm, 'Point')[0];
      if (!pt) return;
      var c = coords(childText(pt, 'coordinates'))[0];
      var p = c && point(childText(pm, 'name') || 'WP' + (pts.length + 1), c.lat, c.lon);
      if (p) pts.push(p);
    });
    if (pts.length >= 2) return pts;
    var line = byLocal(doc, 'LineString')[0];
    if (!line) return pts;
    return coords(childText(line, 'coordinates')).map(function (c, i) {
      return point('WP' + (i + 1), c.lat, c.lon);
    }).filter(Boolean);
  }

  function parseRoute(fileName, text) {
    var ext = (fileName.split('.').pop() || '').toLowerCase();
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read ' + fileName + ' as a route file.');
    var root = doc.documentElement.localName;
    var pts;
    if (ext === 'fpl' || root === 'flight-plan') pts = parseFpl(doc);
    else if (ext === 'gpx' || root === 'gpx') pts = parseGpx(doc);
    else if (ext === 'kml' || root === 'kml') pts = parseKml(doc);
    else throw new Error('Unrecognised route file. Use a .fpl, .gpx or .kml export.');
    if (pts.length < 2) throw new Error('Found ' + pts.length + ' waypoint(s) in ' + fileName + '; a route needs at least 2.');
    if (pts.length > MAX_POINTS) throw new Error(fileName + ' has ' + pts.length + ' points; that looks like a recorded track, not a route.');
    var flightData = byLocal(doc, 'flight-data')[0];
    return {
      points: pts,
      altitude: flightData ? childText(flightData, 'altitude-ft') : ''
    };
  }

  // ForeFlight writes .fpl files as UTF-16 with a byte-order mark; other exports are UTF-8.
  function decode(buffer) {
    var b = new Uint8Array(buffer);
    var enc = b[0] === 0xFF && b[1] === 0xFE ? 'utf-16le' : b[0] === 0xFE && b[1] === 0xFF ? 'utf-16be' : 'utf-8';
    return new TextDecoder(enc).decode(buffer);
  }

  root.RouteImport = { parse: parseRoute, decode: decode };
})(this);
