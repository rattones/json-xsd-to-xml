import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertJsonToXml } from '../src/converter.js';
import { XsdMappingError, XsdValidationError } from '../src/validation/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, 'fixtures');
const simple = resolve(fixturesDir, 'simple.xsd');
const nested = resolve(fixturesDir, 'nested.xsd');
const inline = resolve(fixturesDir, 'inline.xsd');
const tiss = resolve(fixturesDir, 'tiss-mensagem.xsd');
const tissTipos = resolve(fixturesDir, 'tiss-tipos.xsd');

// ---------------------------------------------------------------------------
// simple.xsd — person
// ---------------------------------------------------------------------------

describe('converter — simple.xsd', () => {
  it('converts a minimal valid person JSON to XML', async () => {
    const xml = await convertJsonToXml(
      { '@id': '42', name: 'Alice', age: 30 },
      simple,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<person');
    expect(xml).toContain('id="42"');
    expect(xml).toContain('<name>Alice</name>');
    expect(xml).toContain('<age>30</age>');
  });

  it('wraps the object in the root element name when provided', async () => {
    const xml = await convertJsonToXml(
      { person: { '@id': '1', name: 'Bob', age: 25 } },
      simple,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<person');
    expect(xml).toContain('id="1"');
    expect(xml).toContain('<name>Bob</name>');
  });

  it('includes optional email when provided', async () => {
    const xml = await convertJsonToXml(
      { '@id': '7', name: 'Carol', age: 22, email: 'carol@example.com' },
      simple,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<email>carol@example.com</email>');
  });

  it('omits optional email when absent', async () => {
    const xml = await convertJsonToXml(
      { '@id': '8', name: 'Dan', age: 40 },
      simple,
      { xmlDeclaration: false },
    );
    expect(xml).not.toContain('<email>');
  });

  it('pretty-prints the XML when prettyPrint: true', async () => {
    const xml = await convertJsonToXml(
      { '@id': '1', name: 'Eve', age: 28 },
      simple,
      { prettyPrint: true, xmlDeclaration: false },
    );
    expect(xml).toMatch(/\n/);
    expect(xml).toMatch(/^\s{2}/m);
  });

  it('includes XML declaration by default', async () => {
    const xml = await convertJsonToXml({ '@id': '1', name: 'Frank', age: 50 }, simple);
    expect(xml).toMatch(/^<\?xml/);
  });
});

// ---------------------------------------------------------------------------
// nested.xsd — order with customer and array of items
// ---------------------------------------------------------------------------

describe('converter — nested.xsd', () => {
  it('converts an order with a single item', async () => {
    const xml = await convertJsonToXml(
      {
        '@orderId': 'ORD-001',
        customer: { firstName: 'John', lastName: 'Doe' },
        item: [{ '@sku': 'SKU-1', description: 'Widget', quantity: 2, price: 9.99 }],
      },
      nested,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('orderId="ORD-001"');
    expect(xml).toContain('<firstName>John</firstName>');
    expect(xml).toContain('<lastName>Doe</lastName>');
    expect(xml).toContain('sku="SKU-1"');
    expect(xml).toContain('<description>Widget</description>');
    expect(xml).toContain('<quantity>2</quantity>');
    expect(xml).toContain('<price>9.99</price>');
  });

  it('converts an order with multiple items', async () => {
    const xml = await convertJsonToXml(
      {
        '@orderId': 'ORD-002',
        customer: { firstName: 'Jane', lastName: 'Smith' },
        item: [
          { '@sku': 'A1', description: 'A', quantity: 1, price: 1.0 },
          { '@sku': 'B2', description: 'B', quantity: 3, price: 2.5 },
        ],
      },
      nested,
      { xmlDeclaration: false },
    );
    const itemMatches = xml.match(/<item\b/g);
    expect(itemMatches).toHaveLength(2);
  });

  it('converts an order without items (minOccurs=0)', async () => {
    const xml = await convertJsonToXml(
      {
        '@orderId': 'ORD-003',
        customer: { firstName: 'Alice', lastName: 'A' },
      },
      nested,
      { xmlDeclaration: false },
    );
    expect(xml).not.toContain('<item');
  });
});

// ---------------------------------------------------------------------------
// inline.xsd — catalog with inline complexType
// ---------------------------------------------------------------------------

describe('converter — inline.xsd', () => {
  it('converts a catalog with inline product complexType', async () => {
    const xml = await convertJsonToXml(
      {
        product: [
          { '@id': 'P1', title: 'Gadget', price: 19.99, inStock: true },
          { '@id': 'P2', title: 'Widget', price: 4.5 },
        ],
      },
      inline,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<title>Gadget</title>');
    expect(xml).toContain('<title>Widget</title>');
    expect(xml).toContain('id="P1"');
    expect(xml).toContain('<inStock>true</inStock>');
    // P2 section (after id="P2") should not contain <inStock>
    const p2Section = xml.slice(xml.indexOf('id="P2"'));
    expect(p2Section).not.toContain('<inStock>');
  });
});

// ---------------------------------------------------------------------------
// Validation (strict mode)
// ---------------------------------------------------------------------------

describe('converter — strict validation', () => {
  it('throws XsdValidationError when a required attribute is missing', async () => {
    await expect(
      convertJsonToXml(
        { name: 'NoId', age: 20 }, // missing required @id
        simple,
        { strict: true, xmlDeclaration: false },
      ),
    ).rejects.toThrow(XsdValidationError);
  });

  it('throws XsdValidationError when a required element is missing', async () => {
    await expect(
      convertJsonToXml(
        { '@id': '1', age: 20 }, // missing required name
        simple,
        { strict: true, xmlDeclaration: false },
      ),
    ).rejects.toThrow(XsdValidationError);
  });

  it('throws XsdValidationError with details about all issues', async () => {
    let error: XsdValidationError | undefined;
    try {
      await convertJsonToXml(
        { age: 20 }, // missing @id AND name
        simple,
        { strict: true, xmlDeclaration: false },
      );
    } catch (e) {
      error = e as XsdValidationError;
    }
    expect(error).toBeInstanceOf(XsdValidationError);
    expect(error!.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('passes validation when all required fields are present', async () => {
    await expect(
      convertJsonToXml(
        { '@id': '1', name: 'Valid', age: 10 },
        simple,
        { strict: true, xmlDeclaration: false },
      ),
    ).resolves.toContain('<name>Valid</name>');
  });
});

// ---------------------------------------------------------------------------
// XsdMappingError — erros estruturais no builder
// ---------------------------------------------------------------------------

describe('converter — XsdMappingError (erros estruturais)', () => {
  it('lança XsdMappingError ao tentar converter um schema tipo-biblioteca sem xs:element raiz', async () => {
    // tiss-tipos.xsd não possui nenhum xs:element no nível raiz (rootElement = '').
    // O builder não consegue localizar o elemento e deve lançar XsdMappingError.
    await expect(
      convertJsonToXml({ qualquerCoisa: 'valor' }, tissTipos, { xmlDeclaration: false }),
    ).rejects.toThrow(XsdMappingError);
  });

  it('a mensagem da XsdMappingError identifica o root element ausente', async () => {
    let err: XsdMappingError | undefined;
    try {
      await convertJsonToXml({ qualquerCoisa: 'valor' }, tissTipos, { xmlDeclaration: false });
    } catch (e) {
      err = e as XsdMappingError;
    }
    expect(err).toBeInstanceOf(XsdMappingError);
    expect(err!.message).toContain('not found in schema');
  });

  it('a propriedade path da XsdMappingError aponta para a raiz ($)', async () => {
    let err: XsdMappingError | undefined;
    try {
      await convertJsonToXml({ qualquerCoisa: 'valor' }, tissTipos, { xmlDeclaration: false });
    } catch (e) {
      err = e as XsdMappingError;
    }
    expect(err).toBeInstanceOf(XsdMappingError);
    expect(err!.path).toBe('$');
  });

  it('lança XsdMappingError quando o valor do elemento raiz é um array (estrutura inválida)', async () => {
    // O builder espera um objeto para o elemento raiz, não um array.
    // Passando { envelope: ['a', 'b'] } — o converter extrai json[rootName] = ['a','b']
    // e buildElement recebe um array diretamente, lançando XsdMappingError.
    const anyEnvelope = resolve(fixturesDir, 'any-envelope.xsd');
    await expect(
      convertJsonToXml(
        { envelope: ['a', 'b'] } as never,
        anyEnvelope,
        { xmlDeclaration: false },
      ),
    ).rejects.toThrow(XsdMappingError);
  });
});

// ---------------------------------------------------------------------------
// Custom options
// ---------------------------------------------------------------------------

describe('converter — custom options', () => {
  it('respects custom attributePrefix', async () => {
    const xml = await convertJsonToXml(
      { '!id': '99', name: 'Custom', age: 5 },
      simple,
      { xmlDeclaration: false, attributePrefix: '!' },
    );
    expect(xml).toContain('id="99"');
  });
});

// ---------------------------------------------------------------------------
// tiss-mensagem.xsd — tissSolicitacaoStatusAutorizacao (TISS 4.03)
// Exercita: xs:choice, xs:complexContent/xs:extension, named complexTypes
// ---------------------------------------------------------------------------

const tissJson = {
  cabecalho: {
    identificacaoTransacao: {
      tipoTransacao: 'SOLICITA_STATUS_AUTORIZACAO',
      sequencialTransacao: '1001',
      dataRegistroTransacao: '2025-09-16',
      horaRegistroTransacao: '10:54:58',
    },
    falhaNegocio: null,
    origem: {
      identificacaoPrestador: {
        CNPJ: null,
        CPF: null,
        codigoPrestadorNaOperadora: '51100001',
      },
      registroANS: null,
    },
    destino: {
      identificacaoPrestador: null,
      registroANS: '000582',
    },
    Padrao: '4.01.00',
    loginSenhaPrestador: {
      loginPrestador: '00058578_WS',
      senhaPrestador: 'e2e636fd480a18fb888765a8830b1196',
    },
  },
  situacaoAutorizacao: {
    mensagemErro: {
      codigoGlosa: '1412',
      descricaoGlosa: 'PROBLEMAS NO SISTEMA AUTORIZADOR',
    },
    autorizacaoInternacao: null,
    autorizacaoServico: null,
    autorizacaoProrrogacao: null,
    autorizacaoServicoOdonto: null,
  },
  hash: '3f64256fa67a6b72b85768722c635c4b',
  Signature: null,
};

describe('converter — tiss-mensagem.xsd (TISS 4.03)', () => {
  it('generates root element mensagemTISS', async () => {
    const xml = await convertJsonToXml(tissJson, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<mensagemTISS>');
    expect(xml).toContain('</mensagemTISS>');
  });

  it('renders identificacaoTransacao fields (sequence)', async () => {
    const xml = await convertJsonToXml(tissJson, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<tipoTransacao>SOLICITA_STATUS_AUTORIZACAO</tipoTransacao>');
    expect(xml).toContain('<sequencialTransacao>1001</sequencialTransacao>');
    expect(xml).toContain('<dataRegistroTransacao>2025-09-16</dataRegistroTransacao>');
    expect(xml).toContain('<horaRegistroTransacao>10:54:58</horaRegistroTransacao>');
  });

  it('renders only the non-null choice branch (xs:choice)', async () => {
    const xml = await convertJsonToXml(tissJson, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<codigoPrestadorNaOperadora>51100001</codigoPrestadorNaOperadora>');
    expect(xml).not.toContain('<CNPJ>');
    expect(xml).not.toContain('<CPF>');
  });

  it('renders destino.registroANS via xs:extension inheritance', async () => {
    const xml = await convertJsonToXml(tissJson, tiss, { xmlDeclaration: false });
    // destino has identificacaoPrestador=null (skipped) and registroANS="000582"
    expect(xml).toContain('<registroANS>000582</registroANS>');
  });

  it('skips null elements (falhaNegocio, Signature, autorizacao*)', async () => {
    const xml = await convertJsonToXml(tissJson, tiss, { xmlDeclaration: false });
    expect(xml).not.toContain('<falhaNegocio>');
    expect(xml).not.toContain('<Signature>');
    expect(xml).not.toContain('<autorizacaoInternacao>');
    expect(xml).not.toContain('<autorizacaoServico>');
    expect(xml).not.toContain('<autorizacaoProrrogacao>');
    expect(xml).not.toContain('<autorizacaoServicoOdonto>');
  });

  it('renders mensagemErro with codigoGlosa and descricaoGlosa', async () => {
    const xml = await convertJsonToXml(tissJson, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<codigoGlosa>1412</codigoGlosa>');
    expect(xml).toContain('<descricaoGlosa>PROBLEMAS NO SISTEMA AUTORIZADOR</descricaoGlosa>');
  });

  it('renders loginSenhaPrestador credentials', async () => {
    const xml = await convertJsonToXml(tissJson, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<loginPrestador>00058578_WS</loginPrestador>');
    expect(xml).toContain('<senhaPrestador>e2e636fd480a18fb888765a8830b1196</senhaPrestador>');
  });

  it('renders hash and Padrao', async () => {
    const xml = await convertJsonToXml(tissJson, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<hash>3f64256fa67a6b72b85768722c635c4b</hash>');
    expect(xml).toContain('<Padrao>4.01.00</Padrao>');
  });

  it('produces well-formed XML with pretty-print', async () => {
    const xml = await convertJsonToXml(tissJson, tiss, { prettyPrint: true, xmlDeclaration: true });
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toMatch(/\n/);
    // no unclosed tags
    const openTags = (xml.match(/<[a-zA-Z]/g) ?? []).length;
    const closeTags = (xml.match(/<\/[a-zA-Z]|\/>/g) ?? []).length;
    expect(openTags).toBe(closeTags);
  });
});

// ---------------------------------------------------------------------------
// xs:choice — cada ramo da identificacaoPrestador (TISS 4.03)
// ---------------------------------------------------------------------------

const choiceBase = {
  cabecalho: {
    identificacaoTransacao: {
      tipoTransacao: 'SOLICITA_STATUS_AUTORIZACAO',
      sequencialTransacao: '1',
      dataRegistroTransacao: '2025-01-01',
      horaRegistroTransacao: '00:00:00',
    },
    falhaNegocio: null,
    destino: { identificacaoPrestador: null, registroANS: '000001' },
    Padrao: '4.03.00',
    loginSenhaPrestador: null,
    prestadorEstendido: null,
  },
  situacaoAutorizacao: {
    mensagemErro: null,
    autorizacaoInternacao: null,
    autorizacaoServico: null,
    autorizacaoProrrogacao: null,
    autorizacaoServicoOdonto: null,
  },
  hash: 'abc123',
  Signature: null,
};

describe('xs:choice — cada ramo do identificacaoPrestador', () => {
  it('renders <CNPJ> when only CNPJ is provided (choice branch)', async () => {
    const json = {
      ...choiceBase,
      cabecalho: {
        ...choiceBase.cabecalho,
        origem: {
          identificacaoPrestador: { CNPJ: '12345678000195', CPF: null, codigoPrestadorNaOperadora: null },
          registroANS: null,
        },
      },
    };
    const xml = await convertJsonToXml(json, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<CNPJ>12345678000195</CNPJ>');
    expect(xml).not.toContain('<CPF>');
    expect(xml).not.toContain('<codigoPrestadorNaOperadora>');
  });

  it('renders <CPF> when only CPF is provided (choice branch)', async () => {
    const json = {
      ...choiceBase,
      cabecalho: {
        ...choiceBase.cabecalho,
        origem: {
          identificacaoPrestador: { CNPJ: null, CPF: '12345678909', codigoPrestadorNaOperadora: null },
          registroANS: null,
        },
      },
    };
    const xml = await convertJsonToXml(json, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<CPF>12345678909</CPF>');
    expect(xml).not.toContain('<CNPJ>');
    expect(xml).not.toContain('<codigoPrestadorNaOperadora>');
  });

  it('renders <codigoPrestadorNaOperadora> when only codigo is provided (choice branch)', async () => {
    const json = {
      ...choiceBase,
      cabecalho: {
        ...choiceBase.cabecalho,
        origem: {
          identificacaoPrestador: { CNPJ: null, CPF: null, codigoPrestadorNaOperadora: '51100001' },
          registroANS: null,
        },
      },
    };
    const xml = await convertJsonToXml(json, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<codigoPrestadorNaOperadora>51100001</codigoPrestadorNaOperadora>');
    expect(xml).not.toContain('<CNPJ>');
    expect(xml).not.toContain('<CPF>');
  });

  it('emits empty <identificacaoPrestador> when all choice branches are null', async () => {
    const json = {
      ...choiceBase,
      cabecalho: {
        ...choiceBase.cabecalho,
        origem: {
          identificacaoPrestador: { CNPJ: null, CPF: null, codigoPrestadorNaOperadora: null },
          registroANS: null,
        },
      },
    };
    const xml = await convertJsonToXml(json, tiss, { xmlDeclaration: false });
    // xmlbuilder2 emits self-closing <identificacaoPrestador/> when no children are rendered
    expect(xml).toMatch(/<identificacaoPrestador[\s/>]/);
    expect(xml).not.toContain('<CNPJ>');
    expect(xml).not.toContain('<CPF>');
    expect(xml).not.toContain('<codigoPrestadorNaOperadora>');
  });

  it('omits <identificacaoPrestador> entirely when the element itself is null', async () => {
    const json = {
      ...choiceBase,
      cabecalho: {
        ...choiceBase.cabecalho,
        origem: { identificacaoPrestador: null, registroANS: '999999' },
      },
    };
    const xml = await convertJsonToXml(json, tiss, { xmlDeclaration: false });
    expect(xml).not.toContain('<identificacaoPrestador>');
    expect(xml).toContain('<registroANS>999999</registroANS>');
  });

  it('strict mode: passes when a known choice key has a value', async () => {
    const json = {
      ...choiceBase,
      cabecalho: {
        ...choiceBase.cabecalho,
        origem: {
          identificacaoPrestador: { CNPJ: null, CPF: null, codigoPrestadorNaOperadora: '11111' },
          registroANS: null,
        },
      },
    };
    await expect(
      convertJsonToXml(json, tiss, { xmlDeclaration: false, strict: true }),
    ).resolves.toContain('<codigoPrestadorNaOperadora>');
  });
});

// ---------------------------------------------------------------------------
// xs:complexContent/xs:extension — herança com elementos próprios (TISS 4.03)
// PrestadorEstendidoType extends LocalizacaoBaseType and adds nomeFantasia + especialidade
// ---------------------------------------------------------------------------

const extensionBase = {
  cabecalho: {
    identificacaoTransacao: {
      tipoTransacao: 'SOLICITA_STATUS_AUTORIZACAO',
      sequencialTransacao: '2',
      dataRegistroTransacao: '2025-06-01',
      horaRegistroTransacao: '08:00:00',
    },
    falhaNegocio: null,
    origem: { identificacaoPrestador: null, registroANS: '000100' },
    destino: { identificacaoPrestador: null, registroANS: '000582' },
    Padrao: '4.03.00',
    loginSenhaPrestador: null,
  },
  situacaoAutorizacao: {
    mensagemErro: null,
    autorizacaoInternacao: null,
    autorizacaoServico: null,
    autorizacaoProrrogacao: null,
    autorizacaoServicoOdonto: null,
  },
  hash: 'deadbeef',
  Signature: null,
};

describe('xs:complexContent/xs:extension — herança com elementos próprios', () => {
  it('renders inherited field (registroANS) from LocalizacaoBaseType via extension', async () => {
    const json = {
      ...extensionBase,
      cabecalho: {
        ...extensionBase.cabecalho,
        prestadorEstendido: {
          identificacaoPrestador: null,
          registroANS: '007777',
          nomeFantasia: null,
          especialidade: null,
        },
      },
    };
    const xml = await convertJsonToXml(json, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<registroANS>007777</registroANS>');
  });

  it('renders own extension elements (nomeFantasia, especialidade)', async () => {
    const json = {
      ...extensionBase,
      cabecalho: {
        ...extensionBase.cabecalho,
        prestadorEstendido: {
          identificacaoPrestador: null,
          registroANS: null,
          nomeFantasia: 'Clinica Saude Total',
          especialidade: 'Cardiologia',
        },
      },
    };
    const xml = await convertJsonToXml(json, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<nomeFantasia>Clinica Saude Total</nomeFantasia>');
    expect(xml).toContain('<especialidade>Cardiologia</especialidade>');
  });

  it('renders both inherited AND own elements together', async () => {
    const json = {
      ...extensionBase,
      cabecalho: {
        ...extensionBase.cabecalho,
        prestadorEstendido: {
          identificacaoPrestador: { CNPJ: '98765432000100', CPF: null, codigoPrestadorNaOperadora: null },
          registroANS: '001234',
          nomeFantasia: 'Hospital Central',
          especialidade: 'Ortopedia',
        },
      },
    };
    const xml = await convertJsonToXml(json, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<CNPJ>98765432000100</CNPJ>');
    expect(xml).toContain('<registroANS>001234</registroANS>');
    expect(xml).toContain('<nomeFantasia>Hospital Central</nomeFantasia>');
    expect(xml).toContain('<especialidade>Ortopedia</especialidade>');
  });

  it('omits extension-own elements when null (optional)', async () => {
    const json = {
      ...extensionBase,
      cabecalho: {
        ...extensionBase.cabecalho,
        prestadorEstendido: {
          identificacaoPrestador: null,
          registroANS: '005050',
          nomeFantasia: null,
          especialidade: null,
        },
      },
    };
    const xml = await convertJsonToXml(json, tiss, { xmlDeclaration: false });
    expect(xml).not.toContain('<nomeFantasia>');
    expect(xml).not.toContain('<especialidade>');
    expect(xml).toContain('<registroANS>005050</registroANS>');
  });

  it('inherited OrigemType renders identificacaoPrestador + registroANS together', async () => {
    const json = {
      ...extensionBase,
      cabecalho: {
        ...extensionBase.cabecalho,
        origem: {
          identificacaoPrestador: { CNPJ: null, CPF: null, codigoPrestadorNaOperadora: '22222' },
          registroANS: '333333',
        },
        prestadorEstendido: null,
      },
    };
    const xml = await convertJsonToXml(json, tiss, { xmlDeclaration: false });
    expect(xml).toContain('<codigoPrestadorNaOperadora>22222</codigoPrestadorNaOperadora>');
    expect(xml).toContain('<registroANS>333333</registroANS>');
  });
});

// ---------------------------------------------------------------------------
// xs:include — carregamento de tipos externos (tiss-with-include.xsd)
// ---------------------------------------------------------------------------

const tissInclude = resolve(fixturesDir, 'tiss-with-include.xsd');

describe('xs:include — carregamento de tipos externos', () => {
  it('renders root element from the including schema', async () => {
    const xml = await convertJsonToXml(
      {
        nome: 'Clinica Teste',
        endereco: { logradouro: 'Rua A', numero: '10', cidade: 'Sao Paulo', UF: 'SP' },
      },
      tissInclude,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<prestadorCompleto>');
    expect(xml).toContain('</prestadorCompleto>');
  });

  it('resolves EnderecoType from included file and renders its fields', async () => {
    const xml = await convertJsonToXml(
      {
        nome: 'Clinica B',
        endereco: { logradouro: 'Av Brasil', numero: '200', cidade: 'Rio de Janeiro', UF: 'RJ' },
      },
      tissInclude,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<logradouro>Av Brasil</logradouro>');
    expect(xml).toContain('<numero>200</numero>');
    expect(xml).toContain('<cidade>Rio de Janeiro</cidade>');
    expect(xml).toContain('<UF>RJ</UF>');
  });

  it('resolves ContatoType from included file and renders optional contact fields', async () => {
    const xml = await convertJsonToXml(
      {
        nome: 'Lab Diagnose',
        endereco: { logradouro: 'Rua B', cidade: 'Curitiba', UF: 'PR' },
        contato: { telefone: '41999990000', email: 'lab@diagnose.com' },
      },
      tissInclude,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<telefone>41999990000</telefone>');
    expect(xml).toContain('<email>lab@diagnose.com</email>');
  });

  it('omits optional contato element when absent', async () => {
    const xml = await convertJsonToXml(
      {
        nome: 'Posto Saude',
        endereco: { logradouro: 'Travessa C', cidade: 'Belem', UF: 'PA' },
      },
      tissInclude,
      { xmlDeclaration: false },
    );
    expect(xml).not.toContain('<contato>');
    expect(xml).not.toContain('<telefone>');
    expect(xml).not.toContain('<email>');
  });

  it('omits optional number field inside endereco when absent', async () => {
    const xml = await convertJsonToXml(
      {
        nome: 'UPA Norte',
        endereco: { logradouro: 'Estrada D', cidade: 'Manaus', UF: 'AM' },
      },
      tissInclude,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<logradouro>Estrada D</logradouro>');
    expect(xml).not.toContain('<numero>');
  });
});

// ---------------------------------------------------------------------------
// any-envelope.xsd — xs:any pass-through
// ---------------------------------------------------------------------------

const anyEnvelope = resolve(fixturesDir, 'any-envelope.xsd');

describe('converter — xs:any (any-envelope.xsd)', () => {
  it('renders the known cabecalho field normally', async () => {
    const xml = await convertJsonToXml(
      { cabecalho: 'v1' },
      anyEnvelope,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<cabecalho>v1</cabecalho>');
  });

  it('passes through an unknown scalar element via xs:any', async () => {
    const xml = await convertJsonToXml(
      { cabecalho: 'v1', payload: 'dado livre' },
      anyEnvelope,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<payload>dado livre</payload>');
  });

  it('passes through an unknown nested object element via xs:any', async () => {
    const xml = await convertJsonToXml(
      { cabecalho: 'v1', dados: { campo1: 'a', campo2: 'b' } },
      anyEnvelope,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<dados>');
    expect(xml).toContain('<campo1>a</campo1>');
    expect(xml).toContain('<campo2>b</campo2>');
  });

  it('passes through multiple occurrences of an unknown element (array)', async () => {
    const xml = await convertJsonToXml(
      { cabecalho: 'v1', item: ['x', 'y', 'z'] },
      anyEnvelope,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<item>x</item>');
    expect(xml).toContain('<item>y</item>');
    expect(xml).toContain('<item>z</item>');
  });

  it('skips null wildcard values', async () => {
    const xml = await convertJsonToXml(
      { cabecalho: 'v1', vazio: null },
      anyEnvelope,
      { xmlDeclaration: false },
    );
    expect(xml).not.toContain('vazio');
  });

  it('attributes still work alongside xs:any content', async () => {
    const xml = await convertJsonToXml(
      { '@versao': '1.0', cabecalho: 'v1', extra: 'livre' },
      anyEnvelope,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('versao="1.0"');
    expect(xml).toContain('<extra>livre</extra>');
  });

  it('strict mode does NOT report unknown keys as errors when xs:any is present', async () => {
    await expect(
      convertJsonToXml(
        { cabecalho: 'v1', qualquerCoisa: 'ok' },
        anyEnvelope,
        { xmlDeclaration: false, strict: true },
      ),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// person-with-import.xsd — xs:import type resolution
// ---------------------------------------------------------------------------

const personWithImport = resolve(fixturesDir, 'person-with-import.xsd');

describe('converter — xs:import (person-with-import.xsd)', () => {
  it('converts a person JSON with imported contact type', async () => {
    const xml = await convertJsonToXml(
      {
        nome: 'Maria',
        contato: { email: 'maria@exemplo.com', telefone: { ddd: '11', numero: '99999-0000' } },
      },
      personWithImport,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<nome>Maria</nome>');
    expect(xml).toContain('<email>maria@exemplo.com</email>');
    expect(xml).toContain('<ddd>11</ddd>');
    expect(xml).toContain('<numero>99999-0000</numero>');
  });

  it('renders the root pessoa element', async () => {
    const xml = await convertJsonToXml(
      { nome: 'João' },
      personWithImport,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('<pessoa>');
    expect(xml).toContain('</pessoa>');
  });

  it('omits optional contato when absent', async () => {
    const xml = await convertJsonToXml(
      { nome: 'Carlos', idade: '30' },
      personWithImport,
      { xmlDeclaration: false },
    );
    expect(xml).not.toContain('<contato>');
    expect(xml).not.toContain('<email>');
  });

  it('renders telefone with tipo attribute from imported PhoneType', async () => {
    const xml = await convertJsonToXml(
      {
        nome: 'Ana',
        contato: {
          telefone: { '@tipo': 'celular', ddd: '21', numero: '98888-1234' },
        },
      },
      personWithImport,
      { xmlDeclaration: false },
    );
    expect(xml).toContain('tipo="celular"');
    expect(xml).toContain('<numero>98888-1234</numero>');
  });
});
