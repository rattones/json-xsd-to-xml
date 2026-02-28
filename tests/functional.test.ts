/**
 * Functional roundtrip test: JSON → XML → JSON
 *
 * Convention:
 *   Every file in tests/input/<name>.json is converted to XML using the single
 *   shared schema at tests/schema/tiss-comunicacao-040300/tissWebServicesV4_03_00.xsd.
 *   The file name of each JSON is irrelevant for schema resolution.
 *
 *   The generated XML is saved to tests/output/<name>.xml.
 *
 *   Validation: the XML is parsed back to JSON with fast-xml-parser and compared
 *   against the original JSON with the following adjustments:
 *     - null/undefined fields are stripped (they don't appear in XML)
 *     - scalar values (number, boolean) are normalised to string (XML text nodes
 *       are always strings)
 *     - the root-level wrapper that fast-xml-parser adds is stripped before
 *       comparing, so only the content is compared
 *     - comparison uses toMatchObject (asymmetric), so extra keys that the XML
 *       parser may produce are ignored
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { convertJsonToXml } from '../src/converter.js';
import type { JsonValue } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const inputDir = resolve(__dirname, 'input');
const outputDir = resolve(__dirname, 'output');
const schemaDir = resolve(__dirname, 'schema', 'tiss-comunicacao-040300');
const tissFile = 'tissWebServicesV4_03_00';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the shared schema file (WSDL preferred, XSD as fallback).
 * Throws if the file is missing to fail fast during collection.
 */
function getSchema(): string {
  for (const ext of ['.wsdl', '.xsd']) {
    const candidate = resolve(schemaDir, `${tissFile}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Schema not found: ${schemaDir}/${tissFile}.{wsdl,xsd}`);
}

/**
 * Recursively removes null/undefined fields and normalises scalar values to
 * string so they are comparable with XML text-node values.
 * Returns undefined when the entire subtree is empty after stripping.
 */
function stripNulls(value: JsonValue): JsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    const arr = (value as JsonValue[])
      .map(stripNulls)
      .filter((v): v is JsonValue => v !== undefined);
    return arr.length > 0 ? arr : undefined;
  }

  // Plain object
  const result: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(value as Record<string, JsonValue>)) {
    const stripped = stripNulls(v);
    if (stripped !== undefined) result[k] = stripped;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Strips the single root-level wrapper key that fast-xml-parser adds to its
 * parse result (e.g. { loteGuiasWS: { ... } } → { ... }).
 * If there are multiple top-level keys the object is returned as-is.
 */
function stripXmlRoot(parsed: Record<string, unknown>): unknown {
  const keys = Object.keys(parsed);
  if (keys.length === 1) return parsed[keys[0]];
  return parsed;
}

// ---------------------------------------------------------------------------
// XML parser (used only for validation)
// ---------------------------------------------------------------------------

const xmlParser = new XMLParser({
  ignoreDeclaration: true,
  // Keep all values as strings for reliable string-to-string comparison with
  // the normalised JSON (which also converts numbers/booleans to strings).
  parseTagValue: false,
  // TISS JSON inputs do not use XML attributes (@-prefixed keys),
  // so we can safely ignore them to simplify comparison.
  ignoreAttributes: true,
  trimValues: true,
});

// ---------------------------------------------------------------------------
// Input entries
// ---------------------------------------------------------------------------

interface InputEntry {
  filename: string;
  name: string;
  json: Record<string, JsonValue>;
  schemaPath: string;
}

const schemaPath = getSchema();

function loadInputEntries(): InputEntry[] {
  return readdirSync(inputDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const name = f.replace(/\.json$/, '');
      const json = JSON.parse(
        readFileSync(resolve(inputDir, f), 'utf-8'),
      ) as Record<string, JsonValue>;
      return { filename: f, name, json, schemaPath };
    });
}

const entries = loadInputEntries();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('functional — JSON → XML → JSON roundtrip', () => {
  if (entries.length === 0) {
    it.skip('nenhum arquivo com schema correspondente encontrado em tests/input/', () => {});
    return;
  }

  it.each(entries)(
    'roundtrip: $filename',
    async ({ filename: _filename, name, json, schemaPath }) => {
      // ── 1. JSON → XML ───────────────────────────────────────────────────
      const xml = await convertJsonToXml(json, schemaPath, {
        prettyPrint: true,
        xmlDeclaration: true,
      });

      // ── 2. Basic XML sanity ─────────────────────────────────────────────
      expect(xml, 'XML deve iniciar com declaração XML').toMatch(/^<\?xml/);
      expect(xml.length, 'XML não deve ser vazio').toBeGreaterThan(0);

      // ── 3. Save output ──────────────────────────────────────────────────
      await mkdir(outputDir, { recursive: true });
      await writeFile(resolve(outputDir, `${name}.xml`), xml, 'utf-8');

      // ── 4. XML → JSON (roundtrip) ───────────────────────────────────────
      const rawParsed = xmlParser.parse(xml) as Record<string, unknown>;
      const xmlJson = stripXmlRoot(rawParsed);

      // ── 5. Prepare expected: strip nulls + normalise scalars ────────────
      // If the JSON is wrapped under a single root element key (e.g.
      // { loteGuiasWS: { ... } }) strip that wrapper so the comparison is at
      // the same nesting level as the XML content (which also has its root
      // stripped by stripXmlRoot).
      const jsonKeys = Object.keys(json);
      const jsonForComparison: JsonValue =
        jsonKeys.length === 1 &&
        typeof json[jsonKeys[0]] === 'object' &&
        json[jsonKeys[0]] !== null
          ? (json[jsonKeys[0]] as JsonValue)
          : (json as JsonValue);
      const expected = stripNulls(jsonForComparison) as Record<string, JsonValue>;

      // ── 6. Roundtrip assertion ──────────────────────────────────────────
      // toMatchObject is asymmetric: xmlJson may have additional keys (e.g.
      // schema-required defaults not present in the input JSON); we only
      // verify that every non-null field from the original JSON is present
      // and equal in the roundtripped XML-JSON.
      expect(xmlJson).toMatchObject(expected);
    },
    15_000,
  );
});
