/**
 * The op vocabulary — the one contract between the model and engine.jsx.
 *
 * OPS_SCHEMA is the JSON Schema for the `ops` argument of ae_preview_ops / ae_apply_ops. Only
 * kinds in its enum validate, so the model can never send code. OP_CATALOG documents each kind.
 *
 * Keep in step with describeOp() and applyOne() in engine.jsx.
 */
var OPS_SCHEMA = {
  type: 'array',
  description: 'The edits to apply, in order. Empty when the instruction needs no change.',
  items: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: [
          'renameLayer', 'setLabel', 'setComment',
          'setEnabled', 'setShy', 'setLocked', 'setSolo', 'setGuide',
          'setThreeD', 'setMotionBlur', 'setBlendingMode',
          'moveLayer', 'setParent',
          'setPosition', 'setScale', 'setRotation', 'setAnchorPoint', 'setOpacity',
          'setKeyframe',
          'setInPoint', 'setOutPoint', 'setStartTime',
          'setTextContent',
          'createNull', 'createAdjustment', 'duplicateLayer', 'deleteLayer'
        ]
      },
      layerId: {
        type: 'string',
        description: 'Layer id exactly as it appears after the # in the context outline.'
      },
      parentId: { type: 'string', description: 'Target parent layer id for setParent. Empty string unparents.' },
      name: { type: 'string' },
      comment: { type: 'string' },
      text: { type: 'string' },
      mode: {
        type: 'string',
        description: 'Blending mode for setBlendingMode, e.g. MULTIPLY, SCREEN, ADD, OVERLAY.'
      },
      label: { type: 'number', description: 'Label colour index, 0-16. 0 is none.' },
      value: { type: 'number', description: 'Numeric value: rotation in degrees, or opacity 0-100.' },
      // Booleans get their own field. Folded into the numeric `value`, a literal true/false
      // failed schema validation — so the model sent 1/0 and the preview row then read
      // "1" where it should have read "true".
      flag: {
        type: 'boolean',
        description:
          'On/off value for setEnabled, setShy, setLocked, setSolo, setGuide, setThreeD ' +
          'and setMotionBlur.'
      },
      property: {
        type: 'string',
        description:
          'For setKeyframe only: which property to keyframe — Position, Scale, ' +
          '"Anchor Point", Rotation or Opacity.'
      },
      time: {
        type: 'number',
        description:
          'Seconds. For in/out/start time, the new boundary. For setKeyframe, the time the ' +
          'keyframe is placed at (defaults to the current time if omitted).'
      },
      index: { type: 'number', description: '1-based layer index. 1 is the top layer.' },
      x: { type: 'number' },
      y: { type: 'number' },
      z: { type: 'number' }
    },
    required: ['kind'],
    additionalProperties: false
  }
};

/**
 * Per-op documentation, since the schema's `kind` enum is just a flat list of strings with no
 * per-value description. This is what actually teaches the model what each op does and which
 * fields it reads.
 */
var OP_CATALOG = [
  'Op catalog — name: what it does (fields it reads).',
  'renameLayer: rename a layer (name)',
  'setLabel: set the label colour (label, 0-16, 0 = none)',
  'setComment: set or clear the layer comment (comment)',
  'setEnabled / setShy / setLocked / setSolo / setGuide / setThreeD / setMotionBlur: toggle that switch (flag)',
  'setBlendingMode: change blend mode (mode, e.g. MULTIPLY, SCREEN, ADD, OVERLAY)',
  'moveLayer: reorder in the stack (index, 1 = top)',
  'setParent: parent to another layer, or unparent (parentId, empty = none)',
  'setPosition / setScale / setAnchorPoint: overwrite the STATIC value at the current time — no keyframe (x/y/z; an axis left out keeps its current value)',
  'setRotation: overwrite the STATIC rotation — no keyframe (value, degrees)',
  'setOpacity: overwrite the STATIC opacity — no keyframe (value, 0-100)',
  'setKeyframe: add a REAL keyframe — the only op that actually animates something (property: "Position" | "Scale" | "Anchor Point" | "Rotation" | "Opacity"; time in seconds; value for Rotation/Opacity, x/y/z for the vector properties). Call it once per keyframe, one op per time, in time order.',
  'setInPoint / setOutPoint / setStartTime: move a time boundary (time, seconds)',
  'setTextContent: replace the text of a text layer (text)',
  'createNull / createAdjustment: add a new layer (name?, index?)',
  'duplicateLayer: duplicate a layer as-is (layerId only)',
  'deleteLayer: remove a layer (layerId only)'
].join('\n');

module.exports = { OPS_SCHEMA: OPS_SCHEMA, OP_CATALOG: OP_CATALOG };
