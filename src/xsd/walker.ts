import type { AttributeDef, ComplexTypeDef, ElementDef, SchemaModel } from './types.js';

// Built-in XSD simple types that map to text content.
const XS_SIMPLE_TYPES = new Set([
  'xs:string',
  'xs:integer',
  'xs:int',
  'xs:long',
  'xs:short',
  'xs:decimal',
  'xs:float',
  'xs:double',
  'xs:boolean',
  'xs:date',
  'xs:time',
  'xs:dateTime',
  'xs:duration',
  'xs:anyURI',
  'xs:base64Binary',
  'xs:hexBinary',
  'xs:token',
  'xs:normalizedString',
  'xs:positiveInteger',
  'xs:nonNegativeInteger',
  'xs:negativeInteger',
  'xs:nonPositiveInteger',
  'xs:unsignedInt',
  'xs:unsignedLong',
  'xs:unsignedShort',
  'xs:byte',
  'xs:unsignedByte',
  'xs:ID',
  'xs:IDREF',
  'xs:NMTOKEN',
  'xs:Name',
  'xs:QName',
  'xs:anyType',
]);

export class SchemaWalker {
  constructor(private readonly model: SchemaModel) {}

  /**
   * Returns the top-level ElementDef for the given name, if it exists.
   */
  lookupElement(name: string): ElementDef | undefined {
    return this.model.elements.get(name);
  }

  /**
   * Returns the ComplexTypeDef for the given type name, if it exists.
   */
  lookupComplexType(name: string): ComplexTypeDef | undefined {
    return this.model.complexTypes.get(name);
  }

  /**
   * Resolves the full ComplexTypeDef for an element:
   * - If the element has an inline complexType, return that.
   * - If the element has a typeName referencing a complexType, return that.
   * - Otherwise return undefined (element is simple/text-only).
   */
  resolveComplexTypeForElement(el: ElementDef): ComplexTypeDef | undefined {
    if (el.inlineComplexType) return el.inlineComplexType;
    if (el.typeName) return this.model.complexTypes.get(el.typeName);
    return undefined;
  }

  /**
   * Returns true if the given type name resolves to a simple (text) type.
   */
  isSimpleType(typeName: string | undefined): boolean {
    if (!typeName) return true;
    if (XS_SIMPLE_TYPES.has(typeName)) return true;
    return this.model.simpleTypes.has(typeName);
  }

  /**
   * Gets all attributes declared for an element, including those inherited via
   * xs:complexContent/xs:extension from base types (recursive).
   */
  getAttributesForElement(el: ElementDef): AttributeDef[] {
    const ct = this.resolveComplexTypeForElement(el);
    if (!ct) return el.attributes;
    return this.resolveAllAttributes(ct);
  }

  /**
   * Gets all child ElementDefs declared in the element's type (sequence/all/choice),
   * including those inherited via xs:complexContent/xs:extension (recursive).
   */
  getChildElementsForElement(el: ElementDef): ElementDef[] {
    const ct = this.resolveComplexTypeForElement(el);
    if (!ct) return el.children;
    return this.resolveAllElements(ct);
  }

  /**
   * Recursively resolves all element children following the xs:extension inheritance chain.
   * Base type elements come first, then the derived type's own elements.
   */
  private resolveAllElements(ct: ComplexTypeDef, visited = new Set<string>()): ElementDef[] {
    if (visited.has(ct.name)) return ct.elements;
    visited.add(ct.name);
    if (!ct.extends) return ct.elements;
    const baseCt = this.model.complexTypes.get(ct.extends);
    if (!baseCt) return ct.elements;
    return [...this.resolveAllElements(baseCt, visited), ...ct.elements];
  }

  /**
   * Recursively resolves all attributes following the xs:extension inheritance chain.
   */
  private resolveAllAttributes(ct: ComplexTypeDef, visited = new Set<string>()): AttributeDef[] {
    if (visited.has(ct.name)) return ct.attributes;
    visited.add(ct.name);
    if (!ct.extends) return ct.attributes;
    const baseCt = this.model.complexTypes.get(ct.extends);
    if (!baseCt) return ct.attributes;
    return [...this.resolveAllAttributes(baseCt, visited), ...ct.attributes];
  }

  /**
   * Returns true when the element's type (or any ancestor via xs:extension) contains xs:any,
   * meaning arbitrary child elements should be accepted and passed through.
   */
  hasWildcardForElement(el: ElementDef): boolean {
    const ct = this.resolveComplexTypeForElement(el);
    if (!ct) return false;
    return this.resolveHasWildcard(ct);
  }

  /**
   * Recursively checks whether a complexType or any of its ancestors has xs:any.
   */
  private resolveHasWildcard(ct: ComplexTypeDef, visited = new Set<string>()): boolean {
    if (ct.hasWildcard) return true;
    if (!ct.extends || visited.has(ct.name)) return false;
    visited.add(ct.name);
    const baseCt = this.model.complexTypes.get(ct.extends);
    return baseCt ? this.resolveHasWildcard(baseCt, visited) : false;
  }

  /**
   * Finds a child ElementDef by name within the given list.
   */
  findChildElement(children: ElementDef[], name: string): ElementDef | undefined {
    return children.find((c) => c.name === name);
  }

  get schema(): SchemaModel {
    return this.model;
  }
}
