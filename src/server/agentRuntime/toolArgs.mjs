function describeToolArgShape(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { rootType: args === null ? 'null' : Array.isArray(args) ? 'array' : typeof args };
  }
  return { rootType: 'object', keys: Object.keys(args).slice(0, 20) };
}

export function parseRawToolArguments(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      args: raw,
      rawArgsComplete: true,
      parseError: null,
      argumentOrigin: 'structured',
      receivedShape: describeToolArgShape(raw),
      byteLength: JSON.stringify(raw).length,
    };
  }
  const text = raw == null ? '' : String(raw);
  const byteLength = text.length;
  if (!text.trim()) {
    return {
      args: {},
      rawArgsComplete: true,
      parseError: null,
      argumentOrigin: 'empty',
      receivedShape: describeToolArgShape({}),
      byteLength,
    };
  }
  try {
    const args = JSON.parse(text);
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return {
        args: {},
        rawArgsComplete: false,
        parseError: 'Root value must be a JSON object',
        argumentOrigin: 'raw_stream',
        receivedShape: { ...describeToolArgShape(args), byteLength },
        byteLength,
      };
    }
    return {
      args,
      rawArgsComplete: true,
      parseError: null,
      argumentOrigin: 'raw_stream',
      receivedShape: describeToolArgShape(args),
      byteLength,
    };
  } catch (error) {
    return {
      args: {},
      rawArgsComplete: false,
      parseError: String(error?.message || 'invalid json'),
      argumentOrigin: 'raw_stream',
      receivedShape: { rootType: 'unparsed', byteLength, preview: text.slice(0, 80) },
      byteLength,
    };
  }
}

function toolPartFromPartial(partial, contentIndex) {
  const parts = Array.isArray(partial?.content) ? partial.content : [];
  const part = parts[contentIndex] || parts.find((item) => item?.type === 'toolCall');
  if (!part || part.type !== 'toolCall') return null;
  return { id: part.id || '', name: part.name || '' };
}

export function createRawToolArgCollector() {
  const byIndex = new Map();
  const byId = new Map();
  const ensure = (index) => {
    let record = byIndex.get(index);
    if (!record) {
      record = { id: '', name: '', raw: '' };
      byIndex.set(index, record);
    }
    return record;
  };
  return {
    reset() {
      byIndex.clear();
      byId.clear();
    },
    onEvent(event) {
      if (event?.type !== 'toolcall_delta') return;
      const index = Number.isFinite(event.contentIndex) ? event.contentIndex : byIndex.size;
      const record = ensure(index);
      record.raw += String(event.delta || '');
      const fromPartial = toolPartFromPartial(event.partial, index);
      if (fromPartial?.id && !record.id) {
        record.id = fromPartial.id;
        byId.set(fromPartial.id, record);
      }
      if (fromPartial?.name) record.name = fromPartial.name;
      if (event.id && !record.id) {
        record.id = event.id;
        byId.set(event.id, record);
      }
    },
    snapshot() {
      return [...byIndex.values()].map((record) => ({ ...record }));
    },
    lookup(part, index) {
      return (part?.id && byId.get(part.id))
        || byIndex.get(index)
        || [...byIndex.values()][index]
        || null;
    },
  };
}
