import type { ElementDef } from '../xsd/types.js';
import type { SchemaWalker } from '../xsd/walker.js';
import { XsdValidationError } from './errors.js';
import type { ValidationIssue } from './errors.js';
import type { JsonObject, JsonValue } from '../types.js';

/**
 * Validates a JSON object against the SchemaModel.
 * Collects all issues and throws a single XsdValidationError if any are found.
 *
 * Only called when `strict: true`.
 */
export function validateJson(
  json: JsonObject,
  walker: SchemaWalker,
  attributePrefix: string,
  textNodeKey: string,
): void {
  const issues: ValidationIssue[] = [];
  const rootName = walker.schema.rootElement;
  const rootEl = walker.lookupElement(rootName);

  if (!rootEl) {
    issues.push({ path: '$', message: `Root element "${rootName}" not found in schema.` });
    throw new XsdValidationError(issues);
  }

  const rootValue = json[rootName] !== undefined ? json : { [rootName]: json };
  validateElement(rootEl, rootValue[rootName] as JsonValue, `$.${rootName}`, walker, issues, attributePrefix, textNodeKey);

  if (issues.length > 0) {
    throw new XsdValidationError(issues);
  }
}

function validateElement(
  el: ElementDef,
  value: JsonValue,
  path: string,
  walker: SchemaWalker,
  issues: ValidationIssue[],
  attributePrefix: string,
  textNodeKey: string,
): void {
  // Handle arrays (maxOccurs > 1)
  if (Array.isArray(value)) {
    if (!el.isArray) {
      issues.push({
        path,
        message: `Element "${el.name}" does not allow multiple occurrences (maxOccurs=1), but an array was provided.`,
      });
      return;
    }
    for (let i = 0; i < value.length; i++) {
      validateElement(el, value[i], `${path}[${i}]`, walker, issues, attributePrefix, textNodeKey);
    }
    return;
  }

  const ct = walker.resolveComplexTypeForElement(el);

  if (!ct) {
    // Simple type element — value must be scalar or null
    if (value !== null && typeof value === 'object') {
      issues.push({
        path,
        message: `Element "${el.name}" is a simple type but received an object.`,
      });
    }
    return;
  }

  if (value === null || value === undefined) {
    if (el.minOccurs > 0) {
      issues.push({ path, message: `Required element "${el.name}" is null/undefined.` });
    }
    return;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    issues.push({
      path,
      message: `Element "${el.name}" expects an object (complexType) but received a scalar/array.`,
    });
    return;
  }

  const obj = value as JsonObject;

  // Validate required attributes
  for (const attrDef of walker.getAttributesForElement(el)) {
    if (attrDef.use === 'required') {
      const key = `${attributePrefix}${attrDef.name}`;
      if (obj[key] === undefined) {
        issues.push({
          path: `${path}.${key}`,
          message: `Required attribute "${attrDef.name}" is missing.`,
        });
      }
    }
  }

  // Validate child elements
  const resolvedChildren = walker.getChildElementsForElement(el);
  for (const childEl of resolvedChildren) {
    const childValue = obj[childEl.name];
    if (childEl.minOccurs > 0 && (childValue === undefined || childValue === null)) {
      issues.push({
        path: `${path}.${childEl.name}`,
        message: `Required element "${childEl.name}" (minOccurs=${childEl.minOccurs}) is missing.`,
      });
      continue;
    }
    if (childValue !== undefined && childValue !== null) {
      validateElement(childEl, childValue, `${path}.${childEl.name}`, walker, issues, attributePrefix, textNodeKey);
    }
  }

  // In strict mode, warn about keys not in schema (not attributes, not in children, not textNodeKey)
  const knownChildren = new Set(resolvedChildren.map((e) => e.name));
  const knownAttrs = new Set(walker.getAttributesForElement(el).map((a) => `${attributePrefix}${a.name}`));
  const elementHasWildcard = walker.hasWildcardForElement(el);
  for (const key of Object.keys(obj)) {
    if (key === textNodeKey) continue;
    if (knownChildren.has(key) || knownAttrs.has(key)) continue;
    if (elementHasWildcard) continue; // xs:any accepts any additional key
    issues.push({
      path: `${path}.${key}`,
      message: `Unknown property "${key}" not declared in schema for element "${el.name}".`,
    });
  }
}
