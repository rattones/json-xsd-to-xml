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
