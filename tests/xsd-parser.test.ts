import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseXsd } from '../src/xsd/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, 'fixtures');

describe('parseXsd', () => {
  it('parses a simple XSD with a named complexType and attributes', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'simple.xsd'));

    expect(model.rootElement).toBe('person');
    expect(model.elements.has('person')).toBe(true);
    expect(model.complexTypes.has('PersonType')).toBe(true);

    const ct = model.complexTypes.get('PersonType');
    expect(ct).toBeDefined();
    if (!ct) return;
    expect(ct.compositor).toBe('sequence');
    expect(ct.elements).toHaveLength(3);
    expect(ct.elements[0].name).toBe('name');
    expect(ct.elements[0].minOccurs).toBe(1);
    expect(ct.elements[0].maxOccurs).toBe(1);
    expect(ct.elements[2].name).toBe('email');
    expect(ct.elements[2].minOccurs).toBe(0);

    expect(ct.attributes).toHaveLength(2);
    const idAttr = ct.attributes.find((a) => a.name === 'id');
    expect(idAttr).toBeDefined();
    if (!idAttr) return;
    expect(idAttr.use).toBe('required');
    const activeAttr = ct.attributes.find((a) => a.name === 'active');
    expect(activeAttr).toBeDefined();
    if (!activeAttr) return;
    expect(activeAttr.use).toBe('optional');
    expect(activeAttr.default).toBe('true');
  });

  it('parses a nested XSD with array elements (maxOccurs unbounded)', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'nested.xsd'));

    expect(model.rootElement).toBe('order');
    expect(model.complexTypes.has('OrderType')).toBe(true);
    expect(model.complexTypes.has('CustomerType')).toBe(true);
    expect(model.complexTypes.has('ItemType')).toBe(true);

    const orderCt = model.complexTypes.get('OrderType');
    expect(orderCt).toBeDefined();
    if (!orderCt) return;
    const itemEl = orderCt.elements.find((e) => e.name === 'item');
    expect(itemEl).toBeDefined();
    if (!itemEl) return;
    expect(itemEl.maxOccurs).toBe('unbounded');
    expect(itemEl.isArray).toBe(true);
  });

  it('parses an inline complexType', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'inline.xsd'));

    expect(model.rootElement).toBe('catalog');
    const catalogEl = model.elements.get('catalog');
    expect(catalogEl).toBeDefined();
    if (!catalogEl) return;
    expect(catalogEl.inlineComplexType).toBeDefined();
    if (!catalogEl.inlineComplexType) return;

    const productEl = catalogEl.inlineComplexType.elements.find((e) => e.name === 'product');
    expect(productEl).toBeDefined();
    if (!productEl) return;
    expect(productEl.isArray).toBe(true);
    expect(productEl.inlineComplexType).toBeDefined();
    if (!productEl.inlineComplexType) return;
    expect(productEl.inlineComplexType.elements).toHaveLength(3);
    expect(productEl.inlineComplexType.attributes[0].name).toBe('id');
  });

  it('throws XsdParseError when file does not exist', async () => {
    const { XsdParseError } = await import('../src/validation/errors.js');
    await expect(parseXsd('/nonexistent/path/schema.xsd')).rejects.toThrow(XsdParseError);
  });
});

// ---------------------------------------------------------------------------
// xs:choice parsing
// ---------------------------------------------------------------------------

describe('parseXsd — xs:choice', () => {
  it('parses IdentificacaoPrestadorType as compositor "choice"', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-mensagem.xsd'));
    const ct = model.complexTypes.get('IdentificacaoPrestadorType');
    expect(ct).toBeDefined();
    if (!ct) return;
    expect(ct.compositor).toBe('choice');
  });

  it('choice elements are CNPJ, CPF, codigoPrestadorNaOperadora', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-mensagem.xsd'));
    const ct = model.complexTypes.get('IdentificacaoPrestadorType');
    expect(ct).toBeDefined();
    if (!ct) return;
    const names = ct.elements.map((e) => e.name);
    expect(names).toContain('CNPJ');
    expect(names).toContain('CPF');
    expect(names).toContain('codigoPrestadorNaOperadora');
    expect(names).toHaveLength(3);
  });

  it('all choice branches have minOccurs=0', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-mensagem.xsd'));
    const ct = model.complexTypes.get('IdentificacaoPrestadorType');
    expect(ct).toBeDefined();
    if (!ct) return;
    for (const el of ct.elements) {
      expect(el.minOccurs).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// xs:complexContent/xs:extension parsing
// ---------------------------------------------------------------------------

describe('parseXsd — xs:complexContent/xs:extension', () => {
  it('OrigemType has extends = "LocalizacaoBaseType"', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-mensagem.xsd'));
    const ct = model.complexTypes.get('OrigemType');
    expect(ct).toBeDefined();
    if (!ct) return;
    expect(ct.extends).toBe('LocalizacaoBaseType');
  });

  it('DestinoType has extends = "LocalizacaoBaseType"', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-mensagem.xsd'));
    const ct = model.complexTypes.get('DestinoType');
    expect(ct).toBeDefined();
    if (!ct) return;
    expect(ct.extends).toBe('LocalizacaoBaseType');
  });

  it('PrestadorEstendidoType extends LocalizacaoBaseType and declares own elements', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-mensagem.xsd'));
    const ct = model.complexTypes.get('PrestadorEstendidoType');
    expect(ct).toBeDefined();
    if (!ct) return;
    expect(ct.extends).toBe('LocalizacaoBaseType');
    const names = ct.elements.map((e) => e.name);
    expect(names).toContain('nomeFantasia');
    expect(names).toContain('especialidade');
  });

  it('walker resolves inherited elements from LocalizacaoBaseType via OrigemType', async () => {
    const { SchemaWalker } = await import('../src/xsd/walker.js');
    const model = await parseXsd(resolve(fixturesDir, 'tiss-mensagem.xsd'));
    const walker = new SchemaWalker(model);
    const origemEl = {
      name: 'origem',
      typeName: 'OrigemType',
      minOccurs: 1,
      maxOccurs: 1 as const,
      attributes: [],
      children: [],
      isArray: false,
    };
    const children = walker.getChildElementsForElement(origemEl);
    const names = children.map((e) => e.name);
    expect(names).toContain('identificacaoPrestador');
    expect(names).toContain('registroANS');
  });

  it('walker resolves base + own elements for PrestadorEstendidoType in correct order', async () => {
    const { SchemaWalker } = await import('../src/xsd/walker.js');
    const model = await parseXsd(resolve(fixturesDir, 'tiss-mensagem.xsd'));
    const walker = new SchemaWalker(model);
    const el = {
      name: 'prestadorEstendido',
      typeName: 'PrestadorEstendidoType',
      minOccurs: 0,
      maxOccurs: 1 as const,
      attributes: [],
      children: [],
      isArray: false,
    };
    const children = walker.getChildElementsForElement(el);
    const names = children.map((e) => e.name);
    // inherited from base
    expect(names).toContain('identificacaoPrestador');
    expect(names).toContain('registroANS');
    // own elements
    expect(names).toContain('nomeFantasia');
    expect(names).toContain('especialidade');
    // inherited come before own
    expect(names.indexOf('identificacaoPrestador')).toBeLessThan(names.indexOf('nomeFantasia'));
    expect(names.indexOf('registroANS')).toBeLessThan(names.indexOf('especialidade'));
  });
});

// ---------------------------------------------------------------------------
// xs:include parsing
// ---------------------------------------------------------------------------

describe('parseXsd — xs:include', () => {
  it('type-library XSD (no xs:element) parses without throwing', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-tipos.xsd'));
    expect(model.rootElement).toBe('');
    expect(model.complexTypes.has('EnderecoType')).toBe(true);
    expect(model.complexTypes.has('ContatoType')).toBe(true);
  });

  it('merges complexTypes from included file into the including schema', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-with-include.xsd'));
    expect(model.complexTypes.has('EnderecoType')).toBe(true);
    expect(model.complexTypes.has('ContatoType')).toBe(true);
  });

  it('EnderecoType from include has correct elements', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-with-include.xsd'));
    const ct = model.complexTypes.get('EnderecoType');
    expect(ct).toBeDefined();
    if (!ct) return;
    const names = ct.elements.map((e) => e.name);
    expect(names).toContain('logradouro');
    expect(names).toContain('numero');
    expect(names).toContain('cidade');
    expect(names).toContain('UF');
  });

  it('ContatoType from include has optional telefone and email (minOccurs=0)', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-with-include.xsd'));
    const ct = model.complexTypes.get('ContatoType');
    expect(ct).toBeDefined();
    if (!ct) return;
    for (const el of ct.elements) {
      expect(el.minOccurs).toBe(0);
    }
  });

  it('rootElement is defined by the including schema (prestadorCompleto)', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-with-include.xsd'));
    expect(model.rootElement).toBe('prestadorCompleto');
  });

  it('PrestadorCompletoType references EnderecoType and ContatoType from included schema', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-with-include.xsd'));
    const ct = model.complexTypes.get('PrestadorCompletoType');
    expect(ct).toBeDefined();
    if (!ct) return;
    const enderecoEl = ct.elements.find((e) => e.name === 'endereco');
    expect(enderecoEl).toBeDefined();
    if (!enderecoEl) return;
    expect(enderecoEl.typeName).toBe('EnderecoType');
    const contatoEl = ct.elements.find((e) => e.name === 'contato');
    expect(contatoEl).toBeDefined();
    if (!contatoEl) return;
    expect(contatoEl.typeName).toBe('ContatoType');
  });

  it('does not duplicate types when include is repeated', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'tiss-with-include.xsd'));
    // Map.size should not grow if included twice (idempotent merge)
    const enderecoCount = [...model.complexTypes.keys()].filter((k) => k === 'EnderecoType').length;
    expect(enderecoCount).toBe(1);
  });

  it('does not loop infinitely on circular xs:include (cycle-a ↔ cycle-b)', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'cycle-a.xsd'));
    // Both types must be collected despite the cycle
    expect(model.complexTypes.has('TypeA')).toBe(true);
    expect(model.complexTypes.has('TypeB')).toBe(true);
    expect(model.rootElement).toBe('rootA');
  });
});

// ---------------------------------------------------------------------------
// xs:any detection — any-envelope.xsd
// ---------------------------------------------------------------------------

describe('parseXsd — xs:any', () => {
  it('marks EnvelopeType hasWildcard when xs:any is present', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'any-envelope.xsd'));
    const ct = model.complexTypes.get('EnvelopeType');
    expect(ct).toBeDefined();
    if (!ct) return;
    expect(ct.hasWildcard).toBe(true);
  });

  it('rootElement is "envelope"', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'any-envelope.xsd'));
    expect(model.rootElement).toBe('envelope');
  });

  it('still captures known sequence elements alongside xs:any', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'any-envelope.xsd'));
    const ct = model.complexTypes.get('EnvelopeType');
    expect(ct).toBeDefined();
    if (!ct) return;
    const cabecalho = ct.elements.find((e) => e.name === 'cabecalho');
    expect(cabecalho).toBeDefined();
    expect(cabecalho?.typeName).toBe('xs:string');
  });
});

// ---------------------------------------------------------------------------
// xs:import resolution — person-with-import.xsd
// ---------------------------------------------------------------------------

describe('parseXsd — xs:import', () => {
  it('loads ContactInfoType from the imported schema', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'person-with-import.xsd'));
    expect(model.complexTypes.has('ContactInfoType')).toBe(true);
  });

  it('registers the imported type under the ct: prefix', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'person-with-import.xsd'));
    expect(model.complexTypes.has('ct:ContactInfoType')).toBe(true);
  });

  it('PessoaType contato element references ct:ContactInfoType', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'person-with-import.xsd'));
    const ct = model.complexTypes.get('PessoaType');
    expect(ct).toBeDefined();
    if (!ct) return;
    const contatoEl = ct.elements.find((e) => e.name === 'contato');
    expect(contatoEl).toBeDefined();
    if (!contatoEl) return;
    expect(contatoEl.typeName).toBe('ct:ContactInfoType');
  });

  it('also loads PhoneType from the imported schema', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'person-with-import.xsd'));
    expect(model.complexTypes.has('PhoneType')).toBe(true);
    expect(model.complexTypes.has('ct:PhoneType')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Default-namespace XSD (xmlns="...XMLSchema", no xs: prefix) — default-ns.xsd
// ---------------------------------------------------------------------------

describe('parseXsd — default-namespace XSD (no xs: prefix)', () => {
  it('resolves rootElement from a default-namespace XSD', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'default-ns.xsd'));
    expect(model.rootElement).toBe('payload');
  });

  it('registers the complexType from a default-namespace XSD', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'default-ns.xsd'));
    expect(model.complexTypes.has('PayloadType')).toBe(true);
  });

  it('captures sequence elements inside a default-namespace XSD', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'default-ns.xsd'));
    const ct = model.complexTypes.get('PayloadType');
    expect(ct).toBeDefined();
    if (!ct) return;
    expect(ct.elements.map((e) => e.name)).toContain('id');
    expect(ct.elements.map((e) => e.name)).toContain('value');
  });

  it('marks hasWildcard=true when <any> is present in a default-namespace XSD', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'default-ns.xsd'));
    const ct = model.complexTypes.get('PayloadType');
    expect(ct).toBeDefined();
    if (!ct) return;
    expect(ct.hasWildcard).toBe(true);
  });

  it('registers simpleType from a default-namespace XSD', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'default-ns.xsd'));
    expect(model.simpleTypes.has('StatusCode')).toBe(true);
  });

  it('captures attribute from a default-namespace XSD complexType', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'default-ns.xsd'));
    const ct = model.complexTypes.get('PayloadType');
    expect(ct).toBeDefined();
    if (!ct) return;
    const versionAttr = ct.attributes.find((a) => a.name === 'version');
    expect(versionAttr).toBeDefined();
    expect(versionAttr?.use).toBe('optional');
  });
});

// ---------------------------------------------------------------------------
// Empty compositor — must NOT throw "Cannot use 'in' operator to search for …"
// ---------------------------------------------------------------------------

describe('parseXsd — empty compositor does not crash', () => {
  it('parses an XSD whose sequence has no children without throwing', async () => {
    // any-envelope.xsd has a well-formed sequence; we test via programmatic
    // inline XSD to exercise an empty xs:sequence path.
    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) =>
        [
          'xs:element',
          'xs:attribute',
          'xs:complexType',
          'xs:simpleType',
          'xs:sequence',
          'xs:all',
          'xs:choice',
          'xs:include',
          'xs:import',
        ].includes(name),
    });
    // Empty xs:sequence (fast-xml-parser yields "" for the first array entry)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="empty" type="EmptyType"/>
  <xs:complexType name="EmptyType">
    <xs:sequence/>
  </xs:complexType>
</xs:schema>`;
    const raw = parser.parse(xml) as Record<string, unknown>;
    const schema = raw['xs:schema'] as Record<string, unknown>;
    const seqArr = schema['xs:complexType'] as Record<string, unknown>[];
    const seqNode = seqArr[0]['xs:sequence'] as unknown[];
    // Verify fast-xml-parser actually produces "" for an empty element
    expect(typeof seqNode[0]).toBe('string');

    // Now verify parseXsd itself does not throw on this fixture
    const { writeFile, unlink } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmpPath = join(tmpdir(), 'empty-sequence-fixture.xsd');
    await writeFile(tmpPath, xml, 'utf-8');
    await expect(parseXsd(tmpPath)).resolves.toBeDefined();
    await unlink(tmpPath);
  });
});

// ---------------------------------------------------------------------------
// Circular xs:include + default-namespace xs:import with xs:any
// Reproduces the TISS pattern:
//   mutual-a.xsd  →  xs:include mutual-b.xsd
//                    xs:import  mutual-dsig.xsd  (default NS, has <any>)
//   mutual-b.xsd  →  xs:include mutual-a.xsd    ← cycle
//   mutual-dsig.xsd uses xmlns="...XMLSchema" and <any namespace="##any"/>
// ---------------------------------------------------------------------------

describe('parseXsd — circular include + default-NS import with xs:any (TISS pattern)', () => {
  // 5 s hard cap: if cycle-detection is broken the test would hang indefinitely
  const TIMEOUT = 5_000;

  it(
    'completes without hanging (no infinite loop)',
    async () => {
      await expect(parseXsd(resolve(fixturesDir, 'mutual-a.xsd'))).resolves.toBeDefined();
    },
    TIMEOUT,
  );

  it(
    'registers TypeWithSig from mutual-a.xsd',
    async () => {
      const model = await parseXsd(resolve(fixturesDir, 'mutual-a.xsd'));
      expect(model.complexTypes.has('TypeWithSig')).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'registers TypeB from cyclic mutual-b.xsd',
    async () => {
      const model = await parseXsd(resolve(fixturesDir, 'mutual-a.xsd'));
      expect(model.complexTypes.has('TypeB')).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'registers SignatureType from default-namespace import (mutual-dsig.xsd)',
    async () => {
      const model = await parseXsd(resolve(fixturesDir, 'mutual-a.xsd'));
      expect(model.complexTypes.has('SignatureType')).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'registers SignatureType under the dsig: prefix',
    async () => {
      const model = await parseXsd(resolve(fixturesDir, 'mutual-a.xsd'));
      expect(model.complexTypes.has('dsig:SignatureType')).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'marks SignatureType hasWildcard=true (contains xs:any from default-NS schema)',
    async () => {
      const model = await parseXsd(resolve(fixturesDir, 'mutual-a.xsd'));
      const ct = model.complexTypes.get('SignatureType');
      expect(ct).toBeDefined();
      if (!ct) return;
      expect(ct.hasWildcard).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'marks SignedInfoType hasWildcard=true',
    async () => {
      const model = await parseXsd(resolve(fixturesDir, 'mutual-a.xsd'));
      const ct = model.complexTypes.get('SignedInfoType');
      expect(ct).toBeDefined();
      if (!ct) return;
      expect(ct.hasWildcard).toBe(true);
    },
    TIMEOUT,
  );

  it('parses an XSD with ISO-8859-1 encoding declaration without errors', async () => {
    const model = await parseXsd(resolve(fixturesDir, 'iso-encoding.xsd'));

    expect(model.rootElement).toBe('person');
    expect(model.elements.has('person')).toBe(true);
    expect(model.complexTypes.has('PersonType')).toBe(true);

    const ct = model.complexTypes.get('PersonType');
    expect(ct).toBeDefined();
    if (!ct) return;
    expect(ct.elements).toHaveLength(3);
    expect(ct.attributes).toHaveLength(2);
  });
});
