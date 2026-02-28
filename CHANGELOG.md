# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed
- XSD files declaring `encoding="ISO-8859-1"` (or any non-UTF-8 encoding) in their
  `<?xml ...?>` header no longer cause a _"premature end of file (1:1)"_ parse error.
  Node.js already decodes the file as UTF-8 via `readFile(..., 'utf-8')`; the new
  `normalizeXmlEncodingDeclaration` helper rewrites the declaration to
  `encoding="UTF-8"` before handing the content to `fast-xml-parser`.

---

## [0.1.7] – 2026-02-27

### Fixed
- **`xs:any` empty compositor crash** – `fast-xml-parser` can return a primitive
  (e.g. `""`) for empty `<xs:sequence/>` nodes; the new `asObject()` helper prevents
  a `TypeError` when checking `'xs:any' in ""`.
- **Default-namespace schemas** – XSD files that use
  `xmlns="http://www.w3.org/2001/XMLSchema"` (no `xs:` prefix) are now normalised
  to the `xs:*` key convention before parsing, enabling full compatibility with
  schemas such as `xmldsig-core-schema.xsd`.
- **Circular `xs:include` / `xs:import` cycles** – a `visited` set is threaded
  through `parseXsdInternal` so that mutually-referencing schema files no longer
  cause infinite recursion.

### Style
- Fixed Biome formatting violations on the TISS-pattern test suite.

---

## [0.1.1] – 2026-02-27

### Added
- **`xs:any` support** – unknown JSON keys are passed through as free XML children
  when the schema declares `<xs:any/>`.
- **`xs:import` support** – cross-namespace type resolution with automatic namespace
  prefix registration (e.g. `ct:Type`).
- New test fixtures: `any-envelope.xsd`, `contact-types.xsd`, `person-with-import.xsd`.
- 22 new tests covering `xs:any` and `xs:import` scenarios (total: 81 tests passing).
- `XsdMappingError` error paths now covered (root-not-found, array-as-root).
- **GitHub Actions** CI/CD workflow for automated testing and npm package publishing
  on release creation.

### Changed
- Replaced all non-null assertions (`!`) in tests with `toBeDefined()` + type narrowing.

### Fixed
- Biome `organizeImports` and formatting violations across `src/` and `tests/`.

---

## [0.1.0] – 2026-02-27

### Added
- Initial release of `json-xsd-to-xml`.
- `convertJsonToXml(json, xsdPath, options)` – converts a JSON object to an XML
  string guided by an XSD schema.
- XSD parser (`fast-xml-parser`) supporting `xs:element`, `xs:complexType`,
  `xs:simpleType`, `xs:sequence`, `xs:all`, `xs:choice`, `xs:attribute`,
  `xs:complexContent`, `xs:simpleContent`, `xs:extension`, `xs:restriction`,
  `xs:include`, `xs:import`.
- XML builder (`xmlbuilder2`) with configurable pretty-print, XML declaration,
  encoding, attribute prefix and text-node key.
- Optional strict JSON validation against the XSD schema before XML generation.
- Exported error types: `XsdParseError`, `XsdValidationError`, `XsdMappingError`.
- Dual CJS + ESM build via `tsup`.
- Full test suite with Vitest and coverage via `@vitest/coverage-v8`.
- Biome for linting and formatting.

[Unreleased]: https://github.com/rattones/json-xsd-to-xml/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/rattones/json-xsd-to-xml/compare/v0.1.1...v0.1.7
[0.1.1]: https://github.com/rattones/json-xsd-to-xml/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rattones/json-xsd-to-xml/releases/tag/v0.1.0
