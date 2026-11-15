// AE MCP - https://shivamthapliyal.com
// Copyright (C) 2026 Shivam Thapliyal
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * AE MCP engine — ExtendScript side.
 *
 * Three entry points, called by mcp/server.js (through the AEGP bridge, or osascript as a
 * fallback) with this whole file prepended to the call expression:
 *
 *   claudeGetContext()        → text outline of the comp/selection, every layer line ending in #id
 *   claudePreviewOps(ops)     → before → after rows, read off the LIVE project
 *   claudeApplyOps(ops)       → performs the ops inside one undo group
 *
 * `ops` arrives as a real ES3 array literal interpolated into the script, because
 * ExtendScript has no JSON.parse. Everything returned is a JSON string built by hand, for the
 * same reason — see the escStr/respond helpers at the bottom, which follow the bundle convention.
 *
 * ES3 only: no JSON, no forEach/map/indexOf/trim, no const/let, no arrow functions.
 */

/* ---------------------------------------------------------------- identity */

/**
 * A stable address for a layer.
 *
 * `layer.index` is NOT stable — it shifts whenever anything is added, deleted or reordered, so a
 * plan built from an outline would target the wrong layer after its own first op. After Effects
 * 22.0+ exposes `layer.id`, which is stable for the life of the layer; older versions do not, so
 * we fall back to index+name and say so.
 */
function layerRef(layer) {
  if (typeof layer.id !== 'undefined' && layer.id !== null) return 'L' + layer.id;
  return 'i' + layer.index + ':' + layer.name;
}

/** Resolve a ref produced by layerRef back to a live layer, or null. */
function findLayer(comp, ref) {
  if (!comp || !ref) return null;
  var i;

  if (ref.charAt(0) === 'L') {
    var wanted = parseInt(ref.substring(1), 10);
    for (i = 1; i <= comp.numLayers; i++) {
      var candidate = comp.layer(i);
      if (typeof candidate.id !== 'undefined' && candidate.id === wanted) return candidate;
    }
    return null;
  }

  // Legacy fallback: index:name. The name must still match, otherwise the indices have shifted
  // under us and applying would hit the wrong layer — better to fail loudly.
  var colon = ref.indexOf(':');
  if (ref.charAt(0) === 'i' && colon > 0) {
    var idx = parseInt(ref.substring(1, colon), 10);
    var name = ref.substring(colon + 1);
    if (idx >= 1 && idx <= comp.numLayers) {
      var atIndex = comp.layer(idx);
      if (atIndex.name === name) return atIndex;
    }
    for (i = 1; i <= comp.numLayers; i++) {
      if (comp.layer(i).name === name) return comp.layer(i);
    }
  }
  return null;
}

function activeComp() {
  var comp = app.project ? app.project.activeItem : null;
  if (!comp || !(comp instanceof CompItem)) return null;
  return comp;
}

/* ---------------------------------------------------------------- describe */

function round2(n) {
  return Math.round(n * 100) / 100;
}

function vecToStr(v) {
  if (v === null || typeof v === 'undefined') return '—';
  if (typeof v.length !== 'number') return String(round2(v));
  var parts = [];
  for (var i = 0; i < v.length; i++) parts.push(round2(v[i]));
  return parts.join(',');
}

/** Safe property read — a layer type without the property must not abort the whole outline. */
function propValue(layer, name) {
  try {
    var prop = layer.property(name);
    if (!prop) return null;
    return prop.value;
  } catch (e) {
    return null;
  }
}

var BLEND_NAMES = [
  'NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY', 'DARKEN', 'LIGHTEN', 'ADD',
  'HARD_LIGHT', 'SOFT_LIGHT', 'DIFFERENCE', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY'
];

function blendName(layer) {
  try {
    var mode = layer.blendingMode;
    for (var i = 0; i < BLEND_NAMES.length; i++) {
      if (BlendingMode[BLEND_NAMES[i]] === mode) return BLEND_NAMES[i];
    }
    return String(mode);
  } catch (e) {
    return 'unknown';
  }
}

function layerKind(layer) {
  if (layer instanceof TextLayer) return 'TEXT';
  if (layer instanceof ShapeLayer) return 'SHAPE';
  if (layer instanceof CameraLayer) return 'CAMERA';
  if (layer instanceof LightLayer) return 'LIGHT';
  if (layer instanceof AVLayer) {
    if (layer.nullLayer) return 'NULL';
    if (layer.source && layer.source instanceof CompItem) return 'PRECOMP';
    if (layer.adjustmentLayer) return 'ADJUSTMENT';
    return 'AV';
  }
  return 'LAYER';
}

function truncate(s, max) {
  var flat = String(s).replace(/[\r\n]+/g, ' ');
  if (flat.length <= max) return flat;
  return flat.substring(0, max) + '…';
}

/** One layer as a block of outline lines. Bias: what someone organising a comp actually asks about. */
function describeLayer(layer, comp, lines) {
  var flags = [];
  if (!layer.enabled) flags.push('hidden');
  if (layer.locked) flags.push('locked');
  if (layer.shy) flags.push('shy');
  if (layer.solo) flags.push('solo');
  if (layer.threeDLayer) flags.push('3D');
  try { if (layer.guideLayer) flags.push('guide'); } catch (e) {}
  try { if (layer.adjustmentLayer) flags.push('adjustment'); } catch (e) {}
  var flagStr = flags.length ? '  [' + flags.join(' ') + ']' : '';

  lines.push(
    '  ' + layer.index + '. ' + layerKind(layer) + ' "' + layer.name + '"' + flagStr +
    '  #' + layerRef(layer)
  );

  var detail = [];
  detail.push('label ' + layer.label);
  if (layer.parent) detail.push('parent "' + layer.parent.name + '" #' + layerRef(layer.parent));
  detail.push('in ' + round2(layer.inPoint) + 's out ' + round2(layer.outPoint) + 's');
  if (layer.startTime !== 0) detail.push('start ' + round2(layer.startTime) + 's');
  lines.push('     ' + detail.join('  '));

  var transform = [];
  var pos = propValue(layer, 'Position');
  if (pos !== null) transform.push('pos ' + vecToStr(pos));
  var scale = propValue(layer, 'Scale');
  if (scale !== null) transform.push('scale ' + vecToStr(scale));
  var rot = propValue(layer, 'Rotation');
  if (rot !== null) transform.push('rot ' + round2(rot));
  var op = propValue(layer, 'Opacity');
  if (op !== null) transform.push('opacity ' + round2(op));
  if (transform.length) lines.push('     ' + transform.join('  '));

  if (layer instanceof AVLayer) {
    var av = [];
    av.push('blend ' + blendName(layer));
    if (layer.motionBlur) av.push('motion blur');
    if (av.length) lines.push('     ' + av.join('  '));
  }

  if (layer instanceof TextLayer) {
    try {
      var doc = layer.property('Source Text').value;
      lines.push('     text "' + truncate(doc.text, 120) + '"');
      lines.push('     font ' + doc.font + '  ' + round2(doc.fontSize) + 'px');
    } catch (e) {
      lines.push('     text (unreadable)');
    }
  }

  try {
    var fx = layer.property('Effects');
    if (fx && fx.numProperties > 0) {
      var names = [];
      for (var e = 1; e <= fx.numProperties; e++) names.push(fx.property(e).name);
      lines.push('     effects: ' + names.join(', '));
    }
  } catch (e2) {}

  if (layer.comment && layer.comment !== '') {
    lines.push('     comment "' + truncate(layer.comment, 100) + '"');
  }
}

/**
 * Text outline of the comp. Selected layers when there is a selection, otherwise the whole comp
 * capped — an instruction like "organise this comp" needs every layer, but an outline that runs
 * to thousands of lines is neither promptable nor useful.
 */
function claudeGetContext() {
  try {
    var comp = activeComp();
    if (!comp) return respond(false, 'No active composition. Open a comp and try again.');

    var selected = comp.selectedLayers;
    var useSelection = selected.length > 0;
    var MAX = 80;

    var lines = [];
    lines.push(
      'Comp "' + comp.name + '"  ' + comp.width + 'x' + comp.height +
      '  ' + round2(comp.frameRate) + 'fps  ' + round2(comp.duration) + 's' +
      '  ' + comp.numLayers + ' layer(s)'
    );
    lines.push(
      useSelection
        ? selected.length + ' layer(s) selected, listed below. Each layer line ends with its id (#id).'
        : 'Nothing selected, so the whole comp is listed. Each layer line ends with its id (#id).'
    );

    var truncated = false;
    var count = 0;
    var i;

    if (useSelection) {
      for (i = 0; i < selected.length; i++) {
        if (count >= MAX) { truncated = true; break; }
        describeLayer(selected[i], comp, lines);
        count++;
      }
    } else {
      for (i = 1; i <= comp.numLayers; i++) {
        if (count >= MAX) { truncated = true; break; }
        describeLayer(comp.layer(i), comp, lines);
        count++;
      }
    }

    if (truncated) {
      lines.push('  … outline truncated at ' + MAX + ' layers.');
    }

    return respondWithData(true, 'Context collected.', lines.join('\n'));
  } catch (e) {
    return respond(false, 'Context error: ' + e.message);
  }
}

/* ---------------------------------------------------------------- preview */

var STRUCTURAL = {
  createNull: true,
  createAdjustment: true,
  duplicateLayer: true,
  deleteLayer: true,
  moveLayer: true,
  setParent: true
};

function isStructural(kind) {
  return STRUCTURAL[kind] === true;
}

/**
 * Describe one op against the live project. Returns a row object; a non-empty `problem` means the
 * op will be refused rather than applied.
 */
function describeOp(comp, op) {
  var row = {
    field: op.kind,
    before: '—',
    after: '—',
    problem: '',
    name: ''
  };

  // Create ops have no target layer.
  if (op.kind === 'createNull' || op.kind === 'createAdjustment') {
    row.field = 'add layer';
    row.before = comp.numLayers + ' layers';
    row.after = (op.name ? '"' + op.name + '"' : 'new layer') +
      (op.kind === 'createAdjustment' ? ' (adjustment)' : ' (null)');
    row.name = comp.name;
    return row;
  }

  var layer = findLayer(comp, op.layerId);
  if (!layer) {
    row.problem = 'Layer ' + (op.layerId || '(none)') + ' not found in this comp.';
    return row;
  }
  row.name = layer.name;

  switch (op.kind) {
    case 'renameLayer':
      row.field = 'name';
      row.before = layer.name;
      row.after = op.name;
      return row;

    case 'setLabel':
      row.field = 'label';
      row.before = String(layer.label);
      row.after = String(op.label);
      if (!(op.label >= 0 && op.label <= 16)) row.problem = 'Label must be 0-16.';
      return row;

    case 'setComment':
      row.field = 'comment';
      row.before = layer.comment === '' ? '(none)' : truncate(layer.comment, 40);
      row.after = op.comment === '' ? '(cleared)' : truncate(op.comment, 40);
      return row;

    case 'setEnabled':
      row.field = 'visible';
      row.before = String(layer.enabled);
      row.after = String(boolOf(op));
      return row;

    case 'setShy':
      row.field = 'shy';
      row.before = String(layer.shy);
      row.after = String(boolOf(op));
      return row;

    case 'setLocked':
      row.field = 'locked';
      row.before = String(layer.locked);
      row.after = String(boolOf(op));
      return row;

    case 'setSolo':
      row.field = 'solo';
      row.before = String(layer.solo);
      row.after = String(boolOf(op));
      return row;

    case 'setGuide':
      row.field = 'guide';
      try {
        row.before = String(layer.guideLayer);
      } catch (e) {
        row.problem = 'This layer type has no guide flag.';
        return row;
      }
      row.after = String(boolOf(op));
      return row;

    case 'setThreeD':
      row.field = '3D';
      row.before = String(layer.threeDLayer);
      row.after = String(boolOf(op));
      if (!(layer instanceof AVLayer)) row.problem = 'Only AV layers can be 3D.';
      return row;

    case 'setMotionBlur':
      row.field = 'motion blur';
      row.before = String(layer.motionBlur);
      row.after = String(boolOf(op));
      return row;

    case 'setBlendingMode':
      row.field = 'blend';
      row.before = blendName(layer);
      row.after = op.mode;
      if (typeof BlendingMode[op.mode] === 'undefined') {
        row.problem = 'Unknown blending mode "' + op.mode + '".';
      }
      return row;

    case 'moveLayer':
      row.field = 'order';
      row.before = 'index ' + layer.index;
      row.after = 'index ' + op.index;
      if (!(op.index >= 1 && op.index <= comp.numLayers)) {
        row.problem = 'Index must be between 1 and ' + comp.numLayers + '.';
      }
      return row;

    case 'setParent':
      row.field = 'parent';
      row.before = layer.parent ? layer.parent.name : '(none)';
      if (!op.parentId) {
        row.after = '(none)';
        return row;
      }
      var parent = findLayer(comp, op.parentId);
      if (!parent) {
        row.after = op.parentId;
        row.problem = 'Parent layer ' + op.parentId + ' not found.';
        return row;
      }
      if (parent === layer) {
        row.after = parent.name;
        row.problem = 'A layer cannot be its own parent.';
        return row;
      }
      row.after = parent.name;
      return row;

    case 'setPosition':
    case 'setScale':
    case 'setAnchorPoint': {
      var propName =
        op.kind === 'setPosition' ? 'Position' : (op.kind === 'setScale' ? 'Scale' : 'Anchor Point');
      row.field = propName.toLowerCase();
      var current = propValue(layer, propName);
      if (current === null) {
        row.problem = 'This layer has no ' + propName + '.';
        return row;
      }
      row.before = vecToStr(current);
      row.after = vecToStr(mergeVector(current, op));
      return row;
    }

    case 'setRotation':
      row.field = 'rotation';
      var rot = propValue(layer, 'Rotation');
      if (rot === null) {
        row.problem = 'This layer has no Rotation (3D layers use orientation).';
        return row;
      }
      row.before = String(round2(rot));
      row.after = String(round2(op.value));
      return row;

    case 'setOpacity':
      row.field = 'opacity';
      var op0 = propValue(layer, 'Opacity');
      if (op0 === null) {
        row.problem = 'This layer has no Opacity.';
        return row;
      }
      row.before = String(round2(op0));
      row.after = String(round2(op.value));
      if (!(op.value >= 0 && op.value <= 100)) row.problem = 'Opacity is 0-100.';
      return row;

    case 'setKeyframe': {
      var kfName = op.property;
      var kfIsVector = kfName === 'Position' || kfName === 'Scale' || kfName === 'Anchor Point';
      var kfIsScalar = kfName === 'Rotation' || kfName === 'Opacity';
      if (!kfIsVector && !kfIsScalar) {
        row.problem = 'Keyframes are supported for Position, Scale, Anchor Point, Rotation or Opacity.';
        return row;
      }
      var kfProp;
      try {
        kfProp = layer.property(kfName);
      } catch (e) {
        kfProp = null;
      }
      if (!kfProp) {
        row.problem = 'This layer has no ' + kfName + '.';
        return row;
      }
      var kfTime = typeof op.time === 'number' ? op.time : comp.time;
      row.field = kfName.toLowerCase() + ' @ ' + round2(kfTime) + 's';
      var kfExisting = kfProp.valueAtTime(kfTime, false);
      var kfNext = kfIsVector ? mergeVector(kfExisting, op) : op.value;
      row.before = kfIsVector ? vecToStr(kfExisting) : String(round2(kfExisting));
      row.after = kfIsVector ? vecToStr(kfNext) : String(round2(kfNext));
      if (kfName === 'Opacity' && !(op.value >= 0 && op.value <= 100)) {
        row.problem = 'Opacity is 0-100.';
      }
      return row;
    }

    case 'setInPoint':
    case 'setOutPoint':
    case 'setStartTime': {
      var which =
        op.kind === 'setInPoint' ? 'in' : (op.kind === 'setOutPoint' ? 'out' : 'start');
      row.field = which + ' time';
      var was =
        which === 'in' ? layer.inPoint : (which === 'out' ? layer.outPoint : layer.startTime);
      row.before = round2(was) + 's';
      row.after = round2(op.time) + 's';
      if (which === 'out' && op.time <= layer.inPoint) {
        row.problem = 'Out point must be after the in point.';
      }
      return row;
    }

    case 'setTextContent':
      row.field = 'text';
      if (!(layer instanceof TextLayer)) {
        row.problem = 'Not a text layer.';
        return row;
      }
      try {
        row.before = '"' + truncate(layer.property('Source Text').value.text, 40) + '"';
      } catch (e) {
        row.before = '(unreadable)';
      }
      row.after = '"' + truncate(op.text, 40) + '"';
      return row;

    case 'duplicateLayer':
      row.field = 'duplicate';
      row.before = layer.name;
      row.after = 'copy of "' + layer.name + '"';
      return row;

    case 'deleteLayer':
      row.field = 'delete';
      row.before = layerKind(layer) + ' "' + layer.name + '"';
      row.after = 'removed';
      return row;

    default:
      row.problem = 'Unsupported op kind "' + op.kind + '".';
      return row;
  }
}

/**
 * Boolean ops read `flag`. A numeric `value` is accepted as a fallback because a model that has
 * just used `value` for opacity will sometimes reach for it again — 1/0 and true/false mean the
 * same thing here, and refusing one would fail a plan that is obviously correct.
 */
function boolOf(op) {
  if (typeof op.flag === 'boolean') return op.flag;
  if (typeof op.value === 'number') return op.value !== 0;
  if (typeof op.value === 'boolean') return op.value;
  return false;
}

/** Merge op.x/y/z onto the current vector, leaving unspecified components alone. */
function mergeVector(current, op) {
  var next = [];
  for (var i = 0; i < current.length; i++) next.push(current[i]);
  if (typeof op.x === 'number') next[0] = op.x;
  if (typeof op.y === 'number' && next.length > 1) next[1] = op.y;
  if (typeof op.z === 'number' && next.length > 2) next[2] = op.z;
  return next;
}

function claudePreviewOps(ops) {
  try {
    var comp = activeComp();
    if (!comp) return respond(false, 'No active composition.');
    if (!ops || typeof ops.length !== 'number') return respond(false, 'No ops given.');

    var rows = [];
    var blocked = 0;
    var structural = 0;

    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var row;
      try {
        row = describeOp(comp, op);
      } catch (e) {
        row = { field: op.kind, before: '—', after: '—', problem: e.message, name: '' };
      }
      var ok = row.problem === '';
      if (!ok) blocked++;
      if (isStructural(op.kind)) structural++;

      rows.push(
        '{"index":' + i +
        ',"kind":"' + escStr(op.kind) +
        '","layerId":"' + escStr(op.layerId || '') +
        '","name":"' + escStr(row.name) +
        '","field":"' + escStr(row.field) +
        '","before":"' + escStr(row.before) +
        '","after":"' + escStr(row.after) +
        '","ok":' + ok +
        ',"structural":' + isStructural(op.kind) +
        ',"problem":"' + escStr(row.problem) + '"}'
      );
    }

    return '{"success":true,"rows":[' + rows.join(',') +
      '],"blocked":' + blocked + ',"structural":' + structural + '}';
  } catch (e) {
    return respond(false, 'Preview error: ' + e.message);
  }
}

/* ---------------------------------------------------------------- apply */

/**
 * Move a layer so it ends up at `index` (1 = top). Layer has no moveTo(index) — only
 * moveBefore/moveAfter/moveToBeginning/moveToEnd — so pick the neighbour that lands it there:
 * moving down, go after the layer currently at `index`; moving up, go before it.
 */
function moveToIndex(comp, layer, index) {
  if (index === layer.index) return;
  if (index <= 1) { layer.moveToBeginning(); return; }
  if (index >= comp.numLayers) { layer.moveToEnd(); return; }
  var target = comp.layer(index);
  if (layer.index < index) layer.moveAfter(target);
  else layer.moveBefore(target);
}

function applyOne(comp, op) {
  var layer;

  if (op.kind === 'createNull' || op.kind === 'createAdjustment') {
    var created;
    if (op.kind === 'createNull') {
      created = comp.layers.addNull();
    } else {
      created = comp.layers.addSolid([0, 0, 0], 'Adjustment', comp.width, comp.height, 1);
      created.adjustmentLayer = true;
    }
    if (op.name) created.name = op.name;
    if (typeof op.index === 'number' && op.index >= 1 && op.index <= comp.numLayers) {
      moveToIndex(comp, created, op.index);
    }
    return;
  }

  layer = findLayer(comp, op.layerId);
  if (!layer) throw new Error('Layer ' + op.layerId + ' not found.');

  switch (op.kind) {
    case 'renameLayer':   layer.name = op.name; return;
    case 'setLabel':      layer.label = op.label; return;
    case 'setComment':    layer.comment = op.comment; return;
    case 'setEnabled':    layer.enabled = boolOf(op); return;
    case 'setShy':        layer.shy = boolOf(op); return;
    case 'setLocked':     layer.locked = boolOf(op); return;
    case 'setSolo':       layer.solo = boolOf(op); return;
    case 'setGuide':      layer.guideLayer = boolOf(op); return;
    case 'setThreeD':     layer.threeDLayer = boolOf(op); return;
    case 'setMotionBlur': layer.motionBlur = boolOf(op); return;

    case 'setBlendingMode':
      layer.blendingMode = BlendingMode[op.mode];
      return;

    case 'moveLayer':
      moveToIndex(comp, layer, op.index);
      return;

    case 'setParent':
      if (!op.parentId) {
        layer.parent = null;
      } else {
        var parent = findLayer(comp, op.parentId);
        if (!parent) throw new Error('Parent ' + op.parentId + ' not found.');
        layer.parent = parent;
      }
      return;

    case 'setPosition':
    case 'setScale':
    case 'setAnchorPoint': {
      var propName =
        op.kind === 'setPosition' ? 'Position' : (op.kind === 'setScale' ? 'Scale' : 'Anchor Point');
      var prop = layer.property(propName);
      // 2D vs 3D: mergeVector keeps the component count the layer already has.
      prop.setValue(mergeVector(prop.value, op));
      return;
    }

    case 'setRotation':
      layer.property('Rotation').setValue(op.value);
      return;

    case 'setOpacity':
      layer.property('Opacity').setValue(op.value);
      return;

    case 'setKeyframe': {
      var kfProp2 = layer.property(op.property);
      var kfTime2 = typeof op.time === 'number' ? op.time : comp.time;
      var kfIsVector2 =
        op.property === 'Position' || op.property === 'Scale' || op.property === 'Anchor Point';
      var kfValue2 = kfIsVector2 ? mergeVector(kfProp2.valueAtTime(kfTime2, false), op) : op.value;
      kfProp2.setValueAtTime(kfTime2, kfValue2);
      return;
    }

    case 'setInPoint':    layer.inPoint = op.time; return;
    case 'setOutPoint':   layer.outPoint = op.time; return;
    case 'setStartTime':  layer.startTime = op.time; return;

    case 'setTextContent': {
      var srcProp = layer.property('Source Text');
      var doc = srcProp.value;
      doc.text = op.text;
      srcProp.setValue(doc);
      return;
    }

    case 'duplicateLayer':
      layer.duplicate();
      return;

    case 'deleteLayer':
      layer.remove();
      return;

    default:
      throw new Error('Unsupported op kind "' + op.kind + '".');
  }
}

/**
 * Apply the confirmed ops inside a single undo group, so the whole batch is one Cmd+Z.
 *
 * Ops are independent edits, so one failure does not abort the rest — a user who confirmed nine
 * good ops and one stale one should get the nine, with the failure named.
 */
function claudeApplyOps(ops) {
  var applied = 0;
  var failed = 0;
  var errors = [];

  try {
    var comp = activeComp();
    if (!comp) return respond(false, 'No active composition.');
    if (!ops || typeof ops.length !== 'number') return respond(false, 'No ops given.');

    app.beginUndoGroup('Claude Edit');
    for (var i = 0; i < ops.length; i++) {
      try {
        applyOne(comp, ops[i]);
        applied++;
      } catch (e) {
        failed++;
        if (errors.length < 8) errors.push(ops[i].kind + ': ' + e.message);
      }
    }
    app.endUndoGroup();

    var errStrings = [];
    for (var k = 0; k < errors.length; k++) errStrings.push('"' + escStr(errors[k]) + '"');
    return '{"success":true,"applied":' + applied + ',"failed":' + failed +
      ',"errors":[' + errStrings.join(',') + ']}';
  } catch (e) {
    // endUndoGroup is safe to call even if the group never opened.
    app.endUndoGroup();
    return respond(false, 'Apply error: ' + e.message);
  }
}

/* ---------------------------------------------------------------- helpers */

function respond(success, message) {
  return '{"success":' + success + ',"message":"' + escStr(message) + '"}';
}

function respondWithData(success, message, data) {
  return '{"success":' + success +
    ',"message":"' + escStr(message) +
    '","data":"' + escStr(data) + '"}';
}

function escStr(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/\t/g, '\\t');
}
