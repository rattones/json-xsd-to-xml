/**
 * Represents a single XSD attribute definition (xs:attribute).
 */
export interface AttributeDef {
  name: string;
  type: string;
  use: 'required' | 'optional' | 'prohibited';
  default?: string;
  fixed?: string;
}

/**
 * Represents an XSD element definition (xs:element).
 */
export interface ElementDef {
  name: string;
  /** Resolved type name (complexType or simpleType). Undefined for inline complexTypes. */
  typeName?: string;
  /** Inline complex type definition when no type reference is used. */
  inlineComplexType?: ComplexTypeDef;
  minOccurs: number;
  maxOccurs: number | 'unbounded';
  attributes: AttributeDef[];
  /** Direct child element definitions when the type is inline. */
  children: ElementDef[];
  namespace?: string;
  /** Whether this element can appear multiple times (maxOccurs > 1 or unbounded). */
  isArray: boolean;
}

/**
 * Compositor types supported.
 * - sequence: ordered list of elements
 * - all: any order, each 0 or 1 times (treated like sequence)
 * - choice: exactly one of the listed elements
 */
export type Compositor = 'sequence' | 'all' | 'choice';

/**
 * Represents a complex type definition (xs:complexType).
 */
export interface ComplexTypeDef {
  name: string;
  compositor: Compositor;
  elements: ElementDef[];
  attributes: AttributeDef[];
  /** Text content (xs:simpleContent / mixed="true") */
  hasTextContent: boolean;
  /** Base type name when using xs:complexContent/xs:extension */
  extends?: string;
  /** True when the compositor contains xs:any — accepts arbitrary child elements. */
  hasWildcard?: boolean;
}

/**
 * Represents a simple type definition (xs:simpleType).
 */
export interface SimpleTypeDef {
  name: string;
  /** xs:restriction base */
  base: string;
}

/**
 * The parsed and resolved internal schema model.
 */
export interface SchemaModel {
  /** Name of the root element (first xs:element at schema level). */
  rootElement: string;
  /** All top-level element definitions keyed by name. */
  elements: Map<string, ElementDef>;
  /** All named complex type definitions keyed by name. */
  complexTypes: Map<string, ComplexTypeDef>;
  /** All named simple type definitions keyed by name. */
  simpleTypes: Map<string, SimpleTypeDef>;
  /** xs:schema targetNamespace, if present. */
  targetNamespace?: string;
}
