import type { JsonObject } from './types.js';
import { validateJson } from './validation/json-validator.js';
import { buildXml } from './xml/builder.js';
import { parseXsd } from './xsd/parser.js';
import { SchemaWalker } from './xsd/walker.js';

// Re-export for external typing convenience
export type { SchemaModel } from './xsd/types.js';

/**
 * Options for `convertJsonToXml`.
 */
export interface ConverterOptions {
  /**
   * Whether to pretty-print the output XML (indentation + newlines).
   * @default false
   */
  prettyPrint?: boolean;
  /**
   * Whether to include an XML declaration (`<?xml version="1.0" encoding="..."?>`).
   * @default true
   */
  xmlDeclaration?: boolean;
  /**
   * Base directory to resolve relative XSD paths.
   * Defaults to `process.cwd()`.
   */
  xsdBaseDir?: string;
  /**
   * Encoding declared in the XML declaration.
   * @default 'UTF-8'
   */
  encoding?: string;
  /**
   * Prefix used in JSON keys to indicate XML attributes.
   * e.g. `{ "@id": "123" }` → `<element id="123"/>`
   * @default '@'
   */
  attributePrefix?: string;
  /**
   * JSON key used to represent text content of an element.
   * e.g. `{ "#text": "hello" }` → `<element>hello</element>`
   * @default '#text'
   */
  textNodeKey?: string;
  /**
   * When `true`, validates the JSON against the XSD schema before generating XML.
   * Throws `XsdValidationError` if any constraint is violated.
   * @default false
   */
  strict?: boolean;
  /**
   * Override the root element name used for XML generation.
   * Useful when the schema defines multiple top-level elements (e.g. WSDL) and
   * the desired root cannot be inferred automatically from the JSON structure.
   * @example `{ rootElement: 'solicitacaoStatusAutorizacaoWS' }`
   */
  rootElement?: string;
}

/**
 * Converts a JSON object to an XML string guided by the provided XSD schema.
 *
 * @param json     - The JSON data to convert.
 * @param xsdPath  - Path to the `.xsd` schema file (absolute or relative to `xsdBaseDir`).
 * @param options  - Optional configuration.
 * @returns        A string containing the generated XML.
 *
 * @throws `XsdParseError`      if the XSD file cannot be read or parsed.
 * @throws `XsdValidationError` if `strict: true` and the JSON violates schema constraints.
 * @throws `XsdMappingError`    if a structural mapping error occurs during XML generation.
 *
 * @example
 * ```typescript
 * import { convertJsonToXml } from 'json-xsd-to-xml';
 *
 * const xml = await convertJsonToXml(
 *   { person: { '@id': '1', name: 'Alice', age: 30 } },
 *   './person.xsd',
 *   { prettyPrint: true, strict: true }
 * );
 * console.log(xml);
 * ```
 */
export async function convertJsonToXml(
  json: JsonObject,
  xsdPath: string,
  options: ConverterOptions = {},
): Promise<string> {
  const {
    prettyPrint = false,
    xmlDeclaration = true,
    xsdBaseDir,
    encoding = 'UTF-8',
    attributePrefix = '@',
    textNodeKey = '#text',
    strict = false,
    rootElement: rootElementOverride,
  } = options;

  const rawModel = await parseXsd(xsdPath, xsdBaseDir);

  // Determine effective root element (priority: explicit option > single-key JSON > schema default).
  // When the JSON is wrapped under one key that is a known top-level element
  // (e.g. { solicitacaoStatusAutorizacaoWS: { … } }), use that key as root.
  let schemaModel = rawModel;
  const jsonKeys = Object.keys(json);
  if (rootElementOverride && rawModel.elements.has(rootElementOverride)) {
    // Explicit option always wins.
    if (rootElementOverride !== rawModel.rootElement) {
      schemaModel = { ...rawModel, rootElement: rootElementOverride };
    }
  } else if (
    jsonKeys.length === 1 &&
    rawModel.elements.has(jsonKeys[0]) &&
    jsonKeys[0] !== rawModel.rootElement
  ) {
    // Single JSON key that matches a known element — treat it as the wrapper.
    schemaModel = { ...rawModel, rootElement: jsonKeys[0] };
  }

  const walker = new SchemaWalker(schemaModel);

  if (strict) {
    validateJson(json, walker, attributePrefix, textNodeKey);
  }

  return buildXml(json, walker, {
    prettyPrint,
    xmlDeclaration,
    encoding,
    attributePrefix,
    textNodeKey,
    targetNamespace: schemaModel.targetNamespace,
  });
}
