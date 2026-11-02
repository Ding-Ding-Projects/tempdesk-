// Small JSON Schema validator covering the keywords used by catalog.schema.json:
// $ref (local), type, const, enum, required, properties, additionalProperties,
// items, minItems, uniqueItems, minLength, minimum, pattern, allOf, if/then.

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function validate(schema, data) {
  const errors = [];
  const resolve = (ref) => {
    if (!ref.startsWith('#/')) throw new Error('only local refs are supported: ' + ref);
    return ref.slice(2).split('/').reduce((o, k) => o[k], schema);
  };
  const check = (s, v, path) => {
    if (s.$ref) return check(resolve(s.$ref), v, path);
    const before = errors.length;
    if (s.type && !(Array.isArray(s.type) ? s.type.some((t) => typeMatches(v, t)) : typeMatches(v, s.type))) {
      errors.push(`${path}: expected ${s.type}, got ${typeOf(v)}`);
      return false;
    }
    if ('const' in s && !deepEqual(s.const, v)) errors.push(`${path}: must equal ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.some((e) => deepEqual(e, v))) errors.push(`${path}: ${JSON.stringify(v)} not in enum`);
    if (typeof v === 'string') {
      if (s.minLength !== undefined && v.length < s.minLength) errors.push(`${path}: shorter than ${s.minLength}`);
      if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errors.push(`${path}: does not match ${s.pattern}`);
    }
    if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) errors.push(`${path}: below ${s.minimum}`);
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
      if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) errors.push(`${path}: items are not unique`);
      if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`));
    }
    if (typeOf(v) === 'object') {
      for (const r of s.required || []) if (!(r in v)) errors.push(`${path}: missing ${r}`);
      for (const [k, x] of Object.entries(v)) {
        if (s.properties && k in s.properties) check(s.properties[k], x, `${path}.${k}`);
        else if (s.additionalProperties === false) errors.push(`${path}: unexpected property ${k}`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') check(s.additionalProperties, x, `${path}.${k}`);
      }
    }
    for (const sub of s.allOf || []) {
      if (sub.if) {
        const saved = errors.length;
        const ok = check(sub.if, v, path);
        errors.length = saved;
        if (ok && sub.then) check(sub.then, v, path);
      } else check(sub, v, path);
    }
    return errors.length === before;
  };
  check(schema, data, '$');
  return errors;
}
