import { create } from 'xmlbuilder2';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { JsonObject, JsonValue } from '../types.js';
import { lookupCI, lowerSet } from '../utils.js';
import { XsdMappingError } from '../validation/errors.js';
import type { ElementDef } from '../xsd/types.js';
import type { SchemaWalker } from '../xsd/walker.js';

export interface BuildOptions {
  prettyPrint: boolean;
  xmlDeclaration: boolean;
  encoding: string;
  attributePrefix: string;
  textNodeKey: string;
  targetNamespace?: string;
}

/**
 * Builds an XML string from a JSON object using the schema walker as a guide.
 */
export function buildXml(json: JsonObject, walker: SchemaWalker, options: BuildOptions): string {
  const rootName = walker.schema.rootElement;
  const rootEl = walker.lookupElement(rootName);
  if (!rootEl) {
    throw new XsdMappingError('$', `Root element "${rootName}" not found in schema.`);
  }

  // The input JSON may be { rootName: { ...fields } } or just { ...fields }
  // Use case-insensitive lookup so keys like { "MensagemTISS": ... } still match
  const rootValue: JsonValue = lookupCI(json, rootName) !== undefined ? lookupCI(json, rootName)! : json;

  const xmlDeclarationOptions = options.xmlDeclaration
    ? { version: '1.0', encoding: options.encoding }
    : undefined;

  // create() always produces at least a minimal <?xml version="1.0"?> node.
  // Pass headless:true to end() when the caller doesn't want the declaration.
  const doc = create(xmlDeclarationOptions ?? {});

  if (options.targetNamespace) {
    const root = doc.ele(rootName, { xmlns: options.targetNamespace });
    buildElement(root, rootEl, rootValue, walker, options, `$.${rootName}`);
  } else {
    const root = doc.ele(rootName);
    buildElement(root, rootEl, rootValue, walker, options, `$.${rootName}`);
  }

  return doc.end({ prettyPrint: options.prettyPrint, headless: !options.xmlDeclaration });
}

/**
 * Recursively serializes a JSON value into XML without schema guidance.
 * Used for xs:any pass-through content.
 */
function buildWildcardValue(
  node: XMLBuilder,
  value: JsonValue,
  path: string,
  attributePrefix: string,
  textNodeKey: string,
): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') {
    node.txt(String(value));
    return;
  }
  if (Array.isArray(value)) {
    // Unexpected top-level array in wildcard — best-effort: emit as text
    node.txt(JSON.stringify(value));
    return;
  }
  const obj = value as JsonObject;
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) continue;
    if (key === textNodeKey) {
      node.txt(String(val));
      continue;
    }
    if (key.startsWith(attributePrefix)) {
      node.att(key.slice(attributePrefix.length), String(val));
      continue;
    }
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const childNode = node.ele(key);
        buildWildcardValue(
          childNode,
          val[i] as JsonValue,
          `${path}.${key}[${i}]`,
          attributePrefix,
          textNodeKey,
        );
      }
    } else {
      const childNode = node.ele(key);
      buildWildcardValue(
        childNode,
        val as JsonValue,
        `${path}.${key}`,
        attributePrefix,
        textNodeKey,
      );
    }
  }
}

function buildElement(
  node: XMLBuilder,
  el: ElementDef,
  value: JsonValue,
  walker: SchemaWalker,
  options: BuildOptions,
  path: string,
): void {
  const { attributePrefix, textNodeKey } = options;

  // Handle array values — only called for children, root arrays unwrapped by caller
  if (Array.isArray(value)) {
    throw new XsdMappingError(
      path,
      `Unexpected array passed to buildElement for "${el.name}". Arrays should be handled by the parent.`,
    );
  }

  if (value === null || value === undefined) {
    // Emit empty element
    return;
  }

  const ct = walker.resolveComplexTypeForElement(el);

  if (!ct) {
    // Simple type — serialize as text content
    node.txt(String(value));
    return;
  }

  if (typeof value !== 'object') {
    // Scalar value for a complex type — write as text (best-effort)
    node.txt(String(value));
    return;
  }

  const obj = value as JsonObject;

  // Apply attributes — lookup is case-insensitive; the attribute name in XML
  // always mirrors the schema declaration (attrDef.name), not the JSON key.
  for (const attrDef of walker.getAttributesForElement(el)) {
    const key = `${attributePrefix}${attrDef.name}`;
    const attrValue = lookupCI(obj, key);
    if (attrValue !== undefined && attrValue !== null) {
      node.att(attrDef.name, String(attrValue));
    } else if (attrDef.default !== undefined) {
      node.att(attrDef.name, attrDef.default);
    }
  }

  // Apply text content if xs:simpleContent
  if (ct.hasTextContent && obj[textNodeKey] !== undefined) {
    node.txt(String(obj[textNodeKey]));
    return;
  }

  // Apply child elements — lookup is case-insensitive; the element tag in XML
  // always mirrors the schema declaration (childEl.name), not the JSON key.
  const resolvedChildren = walker.getChildElementsForElement(el);
  // Keep a lowercased set for xs:any wildcard filtering (O(1) check)
  const knownChildNames = lowerSet(resolvedChildren.map((c) => c.name));
  for (const childEl of resolvedChildren) {
    const childValue = lookupCI(obj, childEl.name);
    if (childValue === undefined || childValue === null) {
      // Skip optional missing elements
      continue;
    }

    if (Array.isArray(childValue)) {
      // Multiple occurrences
      for (let i = 0; i < childValue.length; i++) {
        const item = childValue[i];
        const childNode = node.ele(childEl.name);
        buildElement(childNode, childEl, item, walker, options, `${path}.${childEl.name}[${i}]`);
      }
    } else {
      const childNode = node.ele(childEl.name);
      buildElement(childNode, childEl, childValue, walker, options, `${path}.${childEl.name}`);
    }
  }

  // xs:any pass-through: emit JSON keys that are not mapped by any schema child
  if (walker.hasWildcardForElement(el)) {
    for (const key of Object.keys(obj)) {
      if (key === textNodeKey) continue;
      if (key.startsWith(attributePrefix)) continue;
      if (knownChildNames.has(key.toLowerCase())) continue;
      const wildcardValue = obj[key];
      if (wildcardValue === null || wildcardValue === undefined) continue;
      if (Array.isArray(wildcardValue)) {
        for (let i = 0; i < wildcardValue.length; i++) {
          const childNode = node.ele(key);
          buildWildcardValue(
            childNode,
            wildcardValue[i] as JsonValue,
            `${path}.${key}[${i}]`,
            attributePrefix,
            textNodeKey,
          );
        }
      } else {
        const childNode = node.ele(key);
        buildWildcardValue(
          childNode,
          wildcardValue as JsonValue,
          `${path}.${key}`,
          attributePrefix,
          textNodeKey,
        );
      }
    }
  }
}
