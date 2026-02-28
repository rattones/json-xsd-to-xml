import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { XsdParseError } from '../validation/errors.js';
import type {
  AttributeDef,
  ComplexTypeDef,
  Compositor,
  ElementDef,
  SchemaModel,
  SimpleTypeDef,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal raw types (fast-xml-parser output)
// ---------------------------------------------------------------------------

type RawNode = Record<string, unknown>;

// Local names that must always be parsed as arrays (with and without xs: prefix,
// to handle both prefixed XSDs and default-namespace XSDs like xmldsig-core-schema.xsd).
const XSD_ARRAY_LOCAL_NAMES = [
  'element',
  'attribute',
  'complexType',
  'simpleType',
  'sequence',
  'all',
  'choice',
  'include',
  'import',
];

const ALWAYS_ARRAY = [...XSD_ARRAY_LOCAL_NAMES.map((n) => `xs:${n}`), ...XSD_ARRAY_LOCAL_NAMES];

// ---------------------------------------------------------------------------
// Default-namespace normalisation (xs: prefix inferral)
// ---------------------------------------------------------------------------

/**
 * XSD element/attribute names that appear WITHOUT a prefix when the schema
 * declares xmlns="http://www.w3.org/2001/XMLSchema" as the default namespace.
 * We remap them to the xs:-prefixed equivalents so the rest of the parser can
 * work uniformly.
 */
const XSD_BARE_TO_PREFIXED: Record<string, string> = {
  schema: 'xs:schema',
  element: 'xs:element',
  attribute: 'xs:attribute',
  complexType: 'xs:complexType',
  simpleType: 'xs:simpleType',
  sequence: 'xs:sequence',
  all: 'xs:all',
  choice: 'xs:choice',
  include: 'xs:include',
  import: 'xs:import',
  complexContent: 'xs:complexContent',
  simpleContent: 'xs:simpleContent',
  extension: 'xs:extension',
  restriction: 'xs:restriction',
  any: 'xs:any',
  annotation: 'xs:annotation',
  documentation: 'xs:documentation',
  union: 'xs:union',
  list: 'xs:list',
};

function normalizeXsPrefix(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(normalizeXsPrefix);
  }
  if (node !== null && typeof node === 'object') {
    const result: RawNode = {};
    for (const [key, value] of Object.entries(node as RawNode)) {
      const normalizedKey = XSD_BARE_TO_PREFIXED[key] ?? key;
      result[normalizedKey] = normalizeXsPrefix(value);
    }
    return result;
  }
  return node;
}

/**
 * Normalises the XML encoding declaration to UTF-8.
 *
 * After `readFile(..., 'utf-8')` the file content is already a JS string (UTF-16
 * internally). Any `encoding="ISO-8859-1"` (or similar) declaration in the original
 * file is therefore misleading — the bytes have already been decoded correctly by
 * Node.js.  Leaving a non-UTF-8 encoding in the declaration causes `fast-xml-parser`
 * to reject the document with a "premature end of file" error at position 1:1.
 *
 * This function replaces the `encoding` attribute in the `<?xml ...?>` processing
 * instruction with `UTF-8` so the parser can proceed without errors.
 */
function normalizeXmlEncodingDeclaration(content: string): string {
  return content.replace(
    /(<\?xml\b[^?]*?)\s+encoding=["'][^"']*["']/i,
    '$1 encoding="UTF-8"',
  );
}

function makeParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ALWAYS_ARRAY.includes(name),
    allowBooleanAttributes: true,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attr(node: RawNode, name: string, fallback = ''): string {
  return (node[`@_${name}`] as string | undefined) ?? fallback;
}

function parseOccurs(value: string | undefined): number | 'unbounded' {
  if (value === 'unbounded') return 'unbounded';
  if (value === undefined) return 1;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 1 : n;
}

function isUnboundedOrMany(max: number | 'unbounded'): boolean {
  return max === 'unbounded' || max > 1;
}

// ---------------------------------------------------------------------------
// Attribute parsing
// ---------------------------------------------------------------------------

function parseAttribute(raw: RawNode): AttributeDef {
  const use = attr(raw, 'use', 'optional') as AttributeDef['use'];
  return {
    name: attr(raw, 'name'),
    type: attr(raw, 'type', 'xs:string'),
    use: ['required', 'optional', 'prohibited'].includes(use) ? use : 'optional',
    default: raw['@_default'] as string | undefined,
    fixed: raw['@_fixed'] as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// ComplexType parsing
// ---------------------------------------------------------------------------

/**
 * Safely coerces a raw compositor node (the first item of an ALWAYS_ARRAY
 * field) to a RawNode.  fast-xml-parser can return a primitive (e.g. `""`)
 * for empty compositors like `<xs:sequence/>`, so we must not rely on `?? {}`
 * because `"" ?? {}` stays as `""`, causing `'xs:any' in ""` to throw a
 * TypeError at runtime.
 */
function asObject(value: unknown): RawNode {
  return value !== null && value !== undefined && typeof value === 'object'
    ? (value as RawNode)
    : {};
}

function extractCompositorElements(raw: RawNode): {
  compositor: Compositor;
  elements: RawNode[];
  hasWildcard: boolean;
} {
  if (raw['xs:sequence']) {
    const seq = asObject((raw['xs:sequence'] as unknown[])[0]);
    return {
      compositor: 'sequence',
      elements: (seq['xs:element'] as RawNode[] | undefined) ?? [],
      hasWildcard: 'xs:any' in seq,
    };
  }
  if (raw['xs:all']) {
    const all = asObject((raw['xs:all'] as unknown[])[0]);
    return {
      compositor: 'all',
      elements: (all['xs:element'] as RawNode[] | undefined) ?? [],
      hasWildcard: 'xs:any' in all,
    };
  }
  if (raw['xs:choice']) {
    const choice = asObject((raw['xs:choice'] as unknown[])[0]);
    return {
      compositor: 'choice',
      elements: (choice['xs:element'] as RawNode[] | undefined) ?? [],
      hasWildcard: 'xs:any' in choice,
    };
  }
  return { compositor: 'sequence', elements: [], hasWildcard: false };
}

function parseComplexType(raw: RawNode, name: string): ComplexTypeDef {
  let compositor: Compositor = 'sequence';
  let rawElements: RawNode[] = [];
  let extendsBase: string | undefined;

  // xs:complexContent/xs:extension (type inheritance)
  let hasWildcard = false;

  const complexContent = raw['xs:complexContent'] as RawNode | undefined;
  if (complexContent) {
    const ext = complexContent['xs:extension'] as RawNode | undefined;
    if (ext) {
      extendsBase = attr(ext, 'base') || undefined;
      const inner = extractCompositorElements(ext);
      compositor = inner.compositor;
      rawElements = inner.elements;
      hasWildcard = inner.hasWildcard;
    }
  } else {
    const inner = extractCompositorElements(raw);
    compositor = inner.compositor;
    rawElements = inner.elements;
    hasWildcard = inner.hasWildcard;
  }

  const rawAttrs: RawNode[] = (raw['xs:attribute'] as RawNode[] | undefined) ?? [];

  // Collect attributes declared inside xs:complexContent/xs:extension
  if (complexContent) {
    const ext = complexContent['xs:extension'] as RawNode | undefined;
    if (ext) {
      const extAttrs = (ext['xs:attribute'] as RawNode[] | undefined) ?? [];
      rawAttrs.push(...extAttrs);
    }
  }

  // xs:simpleContent with xs:extension
  const simpleContent = raw['xs:simpleContent'] as RawNode | undefined;
  let hasTextContent = false;
  if (simpleContent) {
    hasTextContent = true;
    const ext = simpleContent['xs:extension'] as RawNode | undefined;
    if (ext) {
      const extAttrs = (ext['xs:attribute'] as RawNode[] | undefined) ?? [];
      rawAttrs.push(...extAttrs);
    }
  }

  return {
    name,
    compositor,
    elements: rawElements.map(parseElement),
    attributes: rawAttrs.map(parseAttribute),
    hasTextContent,
    extends: extendsBase,
    hasWildcard: hasWildcard || undefined,
  };
}

// ---------------------------------------------------------------------------
// Element parsing
// ---------------------------------------------------------------------------

function parseElement(raw: RawNode): ElementDef {
  const name = attr(raw, 'name');
  const typeName = attr(raw, 'type') || undefined;
  const minOccurs = parseOccurs(raw['@_minOccurs'] as string | undefined) as number;
  const maxOccurs = parseOccurs(raw['@_maxOccurs'] as string | undefined);

  // Check for inline complexType
  const inlineComplexTypes = raw['xs:complexType'] as RawNode[] | undefined;
  let inlineComplexType: ComplexTypeDef | undefined;
  if (inlineComplexTypes && inlineComplexTypes.length > 0) {
    inlineComplexType = parseComplexType(inlineComplexTypes[0], name);
  }

  return {
    name,
    typeName,
    inlineComplexType,
    minOccurs: minOccurs as number,
    maxOccurs,
    attributes: [],
    children: inlineComplexType?.elements ?? [],
    isArray: isUnboundedOrMany(maxOccurs),
    namespace: undefined,
  };
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

/**
 * Internal recursive implementation. Accepts a `visited` set of already-resolved
 * absolute paths so circular xs:include / xs:import chains do not cause infinite
 * recursion.  When a cycle is detected the function returns an empty model and
 * lets the caller continue with whatever types it has collected so far.
 */
async function parseXsdInternal(
  xsdPath: string,
  baseDir: string | undefined,
  visited: Set<string>,
): Promise<SchemaModel> {
  const resolvedPath = baseDir ? resolve(baseDir, xsdPath) : resolve(xsdPath);

  if (visited.has(resolvedPath)) {
    // Already processing this file up the call stack — break the cycle.
    return {
      rootElement: '',
      elements: new Map(),
      complexTypes: new Map(),
      simpleTypes: new Map(),
    };
  }
  visited.add(resolvedPath);

  let xsdContent: string;
  try {
    xsdContent = normalizeXmlEncodingDeclaration(await readFile(resolvedPath, 'utf-8'));
  } catch (err) {
    throw new XsdParseError(`Cannot read XSD file: ${resolvedPath}`, err);
  }

  let parsed: RawNode;
  try {
    const parser = makeParser();
    const rawParsed = parser.parse(xsdContent) as RawNode;
    // If the XSD uses a default namespace (e.g. xmlns="...XMLSchema") instead
    // of the xs: prefix, fast-xml-parser produces keys like 'schema',
    // 'element', 'sequence', etc.  Normalise them to xs:* so the rest of the
    // parser works uniformly.
    parsed =
      rawParsed.schema !== undefined && rawParsed['xs:schema'] === undefined
        ? (normalizeXsPrefix(rawParsed) as RawNode)
        : rawParsed;
  } catch (err) {
    throw new XsdParseError(`Failed to parse XSD XML content from: ${resolvedPath}`, err);
  }

  const schema = parsed['xs:schema'] as RawNode | undefined;
  if (!schema) {
    throw new XsdParseError(`Invalid XSD: root element <xs:schema> not found in ${resolvedPath}`);
  }

  const targetNamespace = schema['@_targetNamespace'] as string | undefined;

  // Build prefix → namespace URI map from xmlns:* attributes on xs:schema
  const prefixMap = new Map<string, string>();
  for (const [key, val] of Object.entries(schema)) {
    if (key.startsWith('@_xmlns:') && typeof val === 'string') {
      const prefix = key.slice('@_xmlns:'.length);
      if (prefix !== 'xs') prefixMap.set(prefix, val);
    }
  }

  // Collect top-level elements
  const rawTopElements: RawNode[] = (schema['xs:element'] as RawNode[] | undefined) ?? [];
  const elements = new Map<string, ElementDef>();
  for (const rawEl of rawTopElements) {
    const el = parseElement(rawEl);
    elements.set(el.name, el);
  }

  // Collect named complexTypes
  const rawComplexTypes: RawNode[] = (schema['xs:complexType'] as RawNode[] | undefined) ?? [];
  const complexTypes = new Map<string, ComplexTypeDef>();
  for (const rawCt of rawComplexTypes) {
    const name = attr(rawCt, 'name');
    if (!name) continue;
    const ct = parseComplexType(rawCt, name);
    complexTypes.set(name, ct);
  }

  // Collect named simpleTypes
  const rawSimpleTypes: RawNode[] = (schema['xs:simpleType'] as RawNode[] | undefined) ?? [];
  const simpleTypes = new Map<string, SimpleTypeDef>();
  for (const rawSt of rawSimpleTypes) {
    const name = attr(rawSt, 'name');
    if (!name) continue;
    const restriction = rawSt['xs:restriction'] as RawNode | undefined;
    const base = restriction ? attr(restriction, 'base', 'xs:string') : 'xs:string';
    simpleTypes.set(name, { name, base });
  }

  const rootElement = rawTopElements[0] ? attr(rawTopElements[0], 'name') : '';
  // Note: rootElement may be empty for type-library XSDs (no xs:element) used via xs:include.
  // The converter surfaces an XsdMappingError naturally when attempted without a root element.

  const schemaBaseDir = dirname(resolvedPath);

  // Process xs:include — parse referenced schemas and merge their definitions
  const rawIncludes: RawNode[] = (schema['xs:include'] as RawNode[] | undefined) ?? [];
  for (const rawInclude of rawIncludes) {
    const schemaLocation = attr(rawInclude, 'schemaLocation');
    if (!schemaLocation) continue;
    try {
      const includedModel = await parseXsdInternal(schemaLocation, schemaBaseDir, visited);
      for (const [k, v] of includedModel.elements) {
        if (!elements.has(k)) elements.set(k, v);
      }
      for (const [k, v] of includedModel.complexTypes) {
        if (!complexTypes.has(k)) complexTypes.set(k, v);
      }
      for (const [k, v] of includedModel.simpleTypes) {
        if (!simpleTypes.has(k)) simpleTypes.set(k, v);
      }
    } catch {
      // Non-resolvable includes are silently skipped
    }
  }

  // Process xs:import — load external-namespace schemas and register types under
  // both their local name and every prefix that maps to their namespace.
  const rawImports: RawNode[] = (schema['xs:import'] as RawNode[] | undefined) ?? [];
  for (const rawImport of rawImports) {
    const importNs = attr(rawImport, 'namespace');
    const schemaLocation = attr(rawImport, 'schemaLocation');
    if (!schemaLocation) continue;
    try {
      const importedModel = await parseXsdInternal(schemaLocation, schemaBaseDir, visited);
      // Collect all prefixes that map to the imported namespace
      const prefixes: string[] = [];
      for (const [pfx, uri] of prefixMap) {
        if (uri === importNs) prefixes.push(pfx);
      }
      for (const [k, v] of importedModel.complexTypes) {
        if (!complexTypes.has(k)) complexTypes.set(k, v);
        for (const pfx of prefixes) {
          const pk = `${pfx}:${k}`;
          if (!complexTypes.has(pk)) complexTypes.set(pk, v);
        }
      }
      for (const [k, v] of importedModel.simpleTypes) {
        if (!simpleTypes.has(k)) simpleTypes.set(k, v);
        for (const pfx of prefixes) {
          const pk = `${pfx}:${k}`;
          if (!simpleTypes.has(pk)) simpleTypes.set(pk, v);
        }
      }
      for (const [k, v] of importedModel.elements) {
        if (!elements.has(k)) elements.set(k, v);
      }
    } catch {
      // Non-resolvable imports are silently skipped
    }
  }

  return { rootElement, elements, complexTypes, simpleTypes, targetNamespace };
}

/**
 * Reads an XSD file from disk and parses it into a SchemaModel.
 *
 * @param xsdPath - Absolute or relative path to the .xsd file.
 * @param baseDir - Optional base directory for resolving relative paths.
 */
export async function parseXsd(xsdPath: string, baseDir?: string): Promise<SchemaModel> {
  return parseXsdInternal(xsdPath, baseDir, new Set<string>());
}
