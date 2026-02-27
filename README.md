# json-xsd-to-xml

> Convert a JSON object to an XML string guided by an XSD schema.

[![npm](https://img.shields.io/npm/v/json-xsd-to-xml)](https://www.npmjs.com/package/json-xsd-to-xml)
[![license](https://img.shields.io/npm/l/json-xsd-to-xml)](https://opensource.org/license/mit)
[![node](https://img.shields.io/node/v/json-xsd-to-xml)](https://nodejs.org)

## Features

- Parses an XSD schema file to guide XML generation (no guesswork)
- Maps JSON keys to XML elements and attributes via a simple convention
- Supports `xs:element`, `xs:attribute`, `xs:complexType` with `xs:sequence`/`xs:all`/`xs:choice`, `xs:simpleType`, inline complex types, and `maxOccurs="unbounded"` arrays
- Resolves type inheritance via `xs:complexContent`/`xs:extension` (single and multi-level)
- Resolves external type definitions via `xs:include`
- Optional **strict validation** that reports all constraint violations before generating XML
- Dual CJS + ESM build, TypeScript-first
- Zero native (C/C++) dependencies

## Install

```bash
npm install json-xsd-to-xml
```

## Quick Start

Given this XSD (`person.xsd`):

```xml
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="person" type="PersonType"/>
  <xs:complexType name="PersonType">
    <xs:sequence>
      <xs:element name="name"  type="xs:string"  minOccurs="1"/>
      <xs:element name="age"   type="xs:integer" minOccurs="1"/>
      <xs:element name="email" type="xs:string"  minOccurs="0"/>
    </xs:sequence>
    <xs:attribute name="id" type="xs:string" use="required"/>
  </xs:complexType>
</xs:schema>
```

```typescript
import { convertJsonToXml } from 'json-xsd-to-xml';

const xml = await convertJsonToXml(
  { '@id': '1', name: 'Alice', age: 30 },
  './person.xsd',
  { prettyPrint: true }
);

console.log(xml);
```

Output:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<person id="1">
  <name>Alice</name>
  <age>30</age>
</person>
```

## JSON → XML Mapping Convention

| JSON key              | XML output                         |
|-----------------------|------------------------------------|
| `"@attrName": value`  | `attrName="value"` (attribute)     |
| `"#text": value`      | Text node content of the element   |
| `"elementName": value`| `<elementName>value</elementName>` |
| `"elementName": [...]`| Multiple `<elementName>` elements  |
| `"elementName": {...}`| Nested element (complexType)       |

The prefixes `@` and `#text` are configurable via `ConverterOptions`.

## Input Formats

The root JSON object can be provided in two ways:

```typescript
// Option A: bare fields (root element name is inferred from XSD)
{ '@id': '1', name: 'Alice', age: 30 }

// Option B: namespaced under the root element key
{ person: { '@id': '1', name: 'Alice', age: 30 } }
```

## API

### `convertJsonToXml(json, xsdPath, options?)`

```typescript
async function convertJsonToXml(
  json: Record<string, unknown>,
  xsdPath: string,
  options?: ConverterOptions
): Promise<string>
```

| Parameter | Type             | Description                          |
|-----------|------------------|--------------------------------------|
| `json`    | `Record<string, unknown>` | The JSON data to convert    |
| `xsdPath` | `string`         | Path to the `.xsd` file              |
| `options` | `ConverterOptions` | Optional configuration (see below) |

### `ConverterOptions`

| Option            | Type      | Default     | Description                                                               |
|-------------------|-----------|-------------|---------------------------------------------------------------------------|
| `prettyPrint`     | `boolean` | `false`     | Indent and add newlines to the output XML                                 |
| `xmlDeclaration`  | `boolean` | `true`      | Include `<?xml version="1.0" encoding="..."?>` at the top                 |
| `encoding`        | `string`  | `'UTF-8'`   | Encoding declared in the XML declaration                                  |
| `xsdBaseDir`      | `string`  | `process.cwd()` | Base directory for resolving relative XSD paths                       |
| `attributePrefix` | `string`  | `'@'`       | JSON key prefix that indicates an XML attribute                            |
| `textNodeKey`     | `string`  | `'#text'`  | JSON key for the text node of an element (xs:simpleContent)               |
| `strict`          | `boolean` | `false`     | Validate JSON against the schema before generating; throws `XsdValidationError` on failure |

## Error Types

| Class               | When thrown                                                         |
|---------------------|---------------------------------------------------------------------|
| `XsdParseError`     | XSD file not found or is not valid XML                              |
| `XsdValidationError`| `strict: true` and the JSON violates schema constraints             |
| `XsdMappingError`   | A structural mapping error during XML generation (e.g. unknown type)|

```typescript
import { convertJsonToXml, XsdValidationError } from 'json-xsd-to-xml';

try {
  const xml = await convertJsonToXml(incompleteJson, './schema.xsd', { strict: true });
} catch (err) {
  if (err instanceof XsdValidationError) {
    for (const issue of err.issues) {
      console.error(`[${issue.path}] ${issue.message}`);
    }
  }
}
```

## xs:choice

When a `xs:complexType` uses `xs:choice`, only the JSON keys with non-`null` values are emitted. All other branches are silently skipped.

```xml
<!-- schema.xsd -->
<xs:complexType name="IdentificacaoType">
  <xs:choice>
    <xs:element name="CNPJ" type="xs:string" minOccurs="0"/>
    <xs:element name="CPF"  type="xs:string" minOccurs="0"/>
    <xs:element name="codigo" type="xs:string" minOccurs="0"/>
  </xs:choice>
</xs:complexType>
```

```typescript
// JSON — only supply the winning branch; set the others to null
const json = {
  identificacao: { CNPJ: null, CPF: null, codigo: '51100001' }
};
```

Output:

```xml
<identificacao>
  <codigo>51100001</codigo>
</identificacao>
```

If every branch is `null`, the parent element is emitted as an empty/self-closing tag. If the parent element itself is `null`, it is omitted entirely.

## xs:complexContent / xs:extension (type inheritance)

Named complex types that extend a base type via `xs:complexContent`/`xs:extension` are fully resolved. The generated XML includes the base type's elements first, followed by the extending type's own elements.

```xml
<!-- schema.xsd -->
<xs:complexType name="BaseType">
  <xs:sequence>
    <xs:element name="codigo" type="xs:string" minOccurs="0"/>
    <xs:element name="registro" type="xs:string" minOccurs="0"/>
  </xs:sequence>
</xs:complexType>

<xs:complexType name="ExtendedType">
  <xs:complexContent>
    <xs:extension base="BaseType">
      <xs:sequence>
        <xs:element name="nomeFantasia"  type="xs:string" minOccurs="0"/>
        <xs:element name="especialidade" type="xs:string" minOccurs="0"/>
      </xs:sequence>
    </xs:extension>
  </xs:complexContent>
</xs:complexType>
```

```typescript
const json = {
  prestador: {
    // inherited from BaseType
    codigo: '007',
    registro: 'ANS-42',
    // own elements defined in ExtendedType
    nomeFantasia: 'Clinica Central',
    especialidade: 'Cardiologia',
  }
};
```

Output:

```xml
<prestador>
  <codigo>007</codigo>
  <registro>ANS-42</registro>
  <nomeFantasia>Clinica Central</nomeFantasia>
  <especialidade>Cardiologia</especialidade>
</prestador>
```

Inheritance chains are resolved recursively. Cycles are detected and protected against infinite loops.

## xs:include (external type libraries)

XSD files that split type definitions across multiple files using `xs:include` are supported. Referenced schemas are loaded relative to the directory of the including file, and their `xs:complexType`/`xs:simpleType`/`xs:element` definitions are merged transparently.

```xml
<!-- types.xsd — no root xs:element needed -->
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="AddressType">
    <xs:sequence>
      <xs:element name="street" type="xs:string"/>
      <xs:element name="city"   type="xs:string"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>
```

```xml
<!-- main.xsd -->
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="types.xsd"/>

  <xs:element name="company" type="CompanyType"/>
  <xs:complexType name="CompanyType">
    <xs:sequence>
      <xs:element name="name"    type="xs:string"/>
      <xs:element name="address" type="AddressType"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>
```

```typescript
const xml = await convertJsonToXml(
  { name: 'Acme', address: { street: 'Rua A', city: 'São Paulo' } },
  './main.xsd',
  { prettyPrint: true, xmlDeclaration: false }
);
```

Output:

```xml
<company>
  <name>Acme</name>
  <address>
    <street>Rua A</street>
    <city>São Paulo</city>
  </address>
</company>
```

Includes are resolved recursively. Non-resolvable `schemaLocation` paths are silently skipped (no error), matching standard lenient XSD tooling behaviour.

## xs:any (wildcard child elements)

When a `xs:complexType` contains `xs:any`, any JSON keys that are not declared as explicit child elements are serialized as free-form XML child elements — no schema constraint is applied to them.

```xml
<!-- envelope.xsd -->
<xs:complexType name="EnvelopeType">
  <xs:sequence>
    <xs:element name="cabecalho" type="xs:string"/>
    <xs:any namespace="##any" processContents="lax" minOccurs="0" maxOccurs="unbounded"/>
  </xs:sequence>
</xs:complexType>
```

```typescript
const xml = await convertJsonToXml(
  {
    cabecalho: 'v1',
    // arbitrary structure accepted by xs:any
    dados: { campo1: 'a', campo2: 'b' },
    itens: ['x', 'y'],
  },
  './envelope.xsd',
  { prettyPrint: true, xmlDeclaration: false }
);
```

Output:

```xml
<envelope>
  <cabecalho>v1</cabecalho>
  <dados>
    <campo1>a</campo1>
    <campo2>b</campo2>
  </dados>
  <itens>x</itens>
  <itens>y</itens>
</envelope>
```

In `strict` mode, unknown keys are NOT reported as validation errors when the type contains `xs:any`.

## xs:import (cross-namespace type libraries)

`xs:import` allows an XSD to reference type definitions from a different target namespace. Imported schemas are loaded relative to the importing file's directory, and their types are registered under both their local name and every namespace prefix declared via `xmlns:prefix` on the root `xs:schema` element.

```xml
<!-- contact-types.xsd (targetNamespace="http://example.com/contact") -->
<xs:complexType name="ContactInfoType">
  <xs:sequence>
    <xs:element name="email"    type="xs:string" minOccurs="0"/>
    <xs:element name="telefone" type="PhoneType" minOccurs="0"/>
  </xs:sequence>
</xs:complexType>
```

```xml
<!-- person.xsd -->
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:ct="http://example.com/contact">

  <xs:import namespace="http://example.com/contact"
             schemaLocation="contact-types.xsd"/>

  <xs:element name="pessoa" type="PessoaType"/>
  <xs:complexType name="PessoaType">
    <xs:sequence>
      <xs:element name="nome"    type="xs:string"/>
      <xs:element name="contato" type="ct:ContactInfoType" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>
```

```typescript
const xml = await convertJsonToXml(
  { nome: 'Maria', contato: { email: 'maria@info.com' } },
  './person.xsd',
  { prettyPrint: true, xmlDeclaration: false }
);
```

Output:

```xml
<pessoa>
  <nome>Maria</nome>
  <contato>
    <email>maria@info.com</email>
  </contato>
</pessoa>
```

Non-resolvable `schemaLocation` paths in `xs:import` are silently skipped, consistent with the behaviour of `xs:include`.


## XSD Features Supported

| Feature                                      | Status |
|----------------------------------------------|--------|
| `xs:element` (top-level & nested)            | ✅     |
| `xs:attribute` (required / optional)         | ✅     |
| `xs:complexType` with `xs:sequence`          | ✅     |
| `xs:complexType` with `xs:all`               | ✅     |
| `xs:complexType` with `xs:choice`            | ✅     |
| Inline `xs:complexType`                      | ✅     |
| `maxOccurs="unbounded"` (arrays)             | ✅     |
| `minOccurs` / `maxOccurs` validation         | ✅     |
| `xs:simpleType` (restriction)                | ✅     |
| `xs:simpleContent` (text + attrs)            | ✅     |
| `targetNamespace` (xmlns on root)            | ✅     |
| `xs:complexContent` / `xs:extension`         | ✅     |
| `xs:include` (external type libraries)       | ✅     |
| `xs:any`                                     | ✅     |
| `xs:import` (cross-namespace)                | ✅     |


## License

MIT

---

Gostou? Me paga um café. ☕

<img src="src/assets/qrcode-pix.png" alt="QR Code Pix" width="180"/>
