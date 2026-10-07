const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'public', 'assets', 'js', name), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const product = (id = 'nvestido') => ({
  id, nome: 'VESTIDO FLORAL', preco: 150, estoque: 1, categoria: 'vestidos',
  tamanhos: ['P', 'M', 'G'], cores: ['Verde'], parcelas: 6, rascunho: false
});

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function boot({ storage = createStorage(), rows = [product()], offline = false, configure = () => {} } = {}) {
  const cloud = {
    produtos: copy(rows), categorias: [{ slug: 'vestidos', nome: 'Vestidos', ordem: 0 }],
    cupons: [], pedidos: []
  };
  const calls = [];
  const timers = new Map();
  let nextTimer = 0;
  let realtime;
  const SB = {
    ok: () => !offline,
    session: async () => ({ user: { id: 'test-admin' } }),
    ler: async table => copy(cloud[table] || []),
    lerUm: async () => ({ id: 1, nome_loja: 'Teste', banners: [] }),
    gravar: async (table, row) => {
      calls.push(['upsert', table, copy(row)]);
      const key = table === 'produtos' ? 'id' : 'slug';
      const index = cloud[table].findIndex(x => x[key] === row[key]);
      if (index < 0) cloud[table].push(copy(row));
      else cloud[table][index] = copy(row);
    },
    apagar: async (table, column, value) => {
      calls.push(['delete', table, value]);
      cloud[table] = cloud[table].filter(row => row[column] !== value);
    },
    aoMudar: (tables, callback) => { realtime = callback; }
  };
  configure(SB, cloud);
  const context = vm.createContext({
    SB, console, localStorage: storage, location: { href: 'http://localhost/admin/' },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext('var window = globalThis;', context);
  vm.runInContext(source('data.js'), context, { filename: 'data.js' });
  vm.runInContext(source('loja-db.js'), context, { filename: 'loja-db.js' });
  const evaluate = code => vm.runInContext(code, context);
  return {
    context, evaluate, DB: evaluate('DB'), storage, SB, cloud, calls,
    ids: () => copy(evaluate('DB.listProducts(true).map(p => String(p.id))')),
    shopIds: () => copy(evaluate('PRODUTOS.map(p => String(p.id))')),
    async emitChange() {
      realtime();
      for (const [id, timer] of timers) {
        if (timer.delay === 900) { timers.delete(id); await timer.callback(); }
      }
    }
  };
}

test('um registro continua sendo um após renderizações e sincronizações repetidas', async () => {
  const app = boot();
  await app.DB.ready;
  const counts = [app.ids().length];
  for (let i = 0; i < 5; i++) {
    app.DB.applyToShop();
    counts.push(app.ids().length);
  }
  assert.deepEqual(counts, [1, 1, 1, 1, 1, 1]);
  for (let i = 0; i < 5; i++) {
    await app.DB.sincronizar();
    await app.emitChange();
    assert.deepEqual(app.ids(), ['nvestido']);
    assert.deepEqual(app.shopIds(), ['nvestido']);
  }
  assert.equal(app.calls.length, 0, 'ler/renderizar não deve gravar nem excluir no Supabase');
});

test('20 recargas preservam um produto mesmo com login e realtime concorrentes', async () => {
  const storage = createStorage();
  for (let i = 0; i < 20; i++) {
    const app = boot({ storage });
    await Promise.all([app.DB.ready, app.DB.sincronizar(), app.DB.sincronizar()]);
    await app.emitChange();
    assert.deepEqual(app.ids(), ['nvestido']);
    assert.deepEqual(app.shopIds(), ['nvestido']);
    assert.equal(app.DB.listProducts(false).filter(p => p.estoque > 0 && p.estoque <= 10).length, 1);
    assert.equal(app.calls.length, 0);
  }
});

test('Produtos e Início do admin renderizam um card e um alerta de estoque', async () => {
  const app = boot();
  await app.DB.ready;
  const admin = fs.readFileSync(path.join(root, 'public', 'admin', 'index.html'), 'utf8');
  const elements = new Map();
  app.context.$ = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', addEventListener() {} });
    return elements.get(selector);
  };
  app.context.marcaOrigem = () => {};
  app.context.fotoSrc = () => 'foto.png';
  app.context.BRL = n => String(n);
  app.evaluate("let buscaP = '', filtroStatus = ''; ");
  for (const name of ['rProdutos', 'rInicio']) {
    const declaration = admin.match(new RegExp('function ' + name + '\\(\\) \\{[\\s\\S]*?\\n\\}'));
    assert.ok(declaration, name + ' existe no arquivo real');
    app.evaluate(declaration[0]);
  }
  for (let i = 0; i < 10; i++) {
    await app.DB.sincronizar();
    app.DB.applyToShop();
    app.evaluate('rProdutos()');
    assert.equal((elements.get('#admMain').innerHTML.match(/class="pcard"/g) || []).length, 1);
    app.evaluate('rInicio()');
    assert.match(elements.get('#admMain').innerHTML, /<b>1 produto\(s\)<\/b> com estoque baixo: VESTIDO FLORAL/);
  }
});

test('botões por cor encaminham as três ações sem inserir nomes nos comandos HTML', () => {
  const admin = fs.readFileSync(path.join(root, 'public', 'admin', 'index.html'), 'utf8');
  const source = admin.match(/function verEstoqueCores\(id\) \{[\s\S]*?\n\}/)[0];
  const cor = 'Azul "marinho" d\'água';
  const calls = [];
  let html = '';
  let buttons = [];
  const context = vm.createContext({
    DB: { getProduct: () => ({ nome: 'Produto', estoquePorCor: { [cor]: 5 } }) },
    escWiz: s => s.replace(/"/g, '&quot;'),
    abrirModal: value => {
      html = value;
      buttons = [...html.matchAll(/data-est-cor="(\d+)" data-est-modo="([^"]+)"/g)].map(m => ({
        dataset: { estCor: m[1], estModo: m[2] },
        addEventListener(event, fn) { assert.equal(event, 'click'); this.click = fn; }
      }));
    },
    document: { querySelectorAll: () => buttons },
    abrirMovEstoque: (...args) => calls.push(args)
  });
  vm.runInContext(source + '; verEstoqueCores("produto");', context);
  assert.equal(buttons.length, 3);
  buttons.forEach(btn => btn.click());
  assert.deepEqual(calls, ['entra', 'sai', 'corrige'].map(modo => ['produto', modo, cor]));
  assert.doesNotMatch(html, /onclick="(?:mexerEstoqueCor|corrigirEstoqueCor)/);
});

test('listas da interface contaminadas não são reutilizadas como fonte', async () => {
  const app = boot();
  await app.DB.ready;
  app.evaluate('PRODUTOS.push(...PRODUTOS, ...PRODUTOS); CATEGORIAS.push(...CATEGORIAS);');
  app.DB.applyToShop();
  assert.deepEqual(app.ids(), ['nvestido']);
  assert.deepEqual(app.shopIds(), ['nvestido']);
  assert.equal(app.DB.listCategories().length, 1);
});

test('rascunhos, IDs não numéricos e produtos distintos com mesmo nome são preservados', async () => {
  const rows = [product('uuid-a'), product('uuid-b'), { ...product('uuid-draft'), rascunho: true }];
  const app = boot({ rows });
  await app.DB.ready;
  for (let i = 0; i < 10; i++) app.DB.applyToShop();
  assert.deepEqual(app.ids(), ['uuid-a', 'uuid-b', 'uuid-draft']);
  assert.deepEqual(app.shopIds(), ['uuid-a', 'uuid-b']);
  assert.equal(app.calls.length, 0);
});

test('criar, editar, tornar rascunho e reabrir mantém a identidade do produto', async () => {
  const app = boot({ rows: [] });
  await app.DB.ready;
  const item = { nome: 'Novo vestido', preco: 99, estoque: 3, tams: ['M'], cores: ['Verde'], cat: 'vestidos', parcelas: 10 };
  const id = app.DB.saveProduct(item);
  await app.DB.sincronizar();
  assert.deepEqual(app.ids(), [id]);
  app.DB.saveProduct({ ...app.DB.getProduct(id), preco: 89, rascunho: true });
  await app.DB.sincronizar();
  for (let i = 0; i < 5; i++) app.DB.applyToShop();
  assert.deepEqual(app.ids(), [id]);
  assert.deepEqual(app.shopIds(), []);
  assert.equal(app.cloud.produtos.length, 1);
  assert.equal(app.cloud.produtos[0].parcelas, 10);
  const reloaded = boot({ rows: app.cloud.produtos, storage: app.storage });
  await reloaded.DB.ready;
  assert.deepEqual(reloaded.ids(), [id]);
  assert.deepEqual(reloaded.shopIds(), []);
});

test('snapshot vazio remove o cache visual sem enviar exclusões ao banco', async () => {
  const app = boot();
  await app.DB.ready;
  app.cloud.produtos = [];
  app.cloud.categorias = [];
  app.SB.lerUm = async () => null;
  await app.DB.sincronizar();
  for (let i = 0; i < 5; i++) app.DB.applyToShop();
  assert.deepEqual(app.ids(), []);
  assert.deepEqual(app.shopIds(), []);
  assert.equal(app.DB.listCategories().length, 0);
  assert.equal(app.calls.length, 0);
  const reloaded = boot({ storage: app.storage, rows: [] });
  await reloaded.DB.ready;
  assert.deepEqual(reloaded.ids(), []);
});

test('lápides antigas não autorizam a leitura a excluir um registro da nuvem', async () => {
  const storage = createStorage({
    em_db_v1: JSON.stringify({ products: {}, deleted: ['nvestido'] }),
    em_zera_cats_v1: '1'
  });
  const app = boot({ storage });
  await app.DB.ready;
  await app.DB.sincronizar();
  assert.deepEqual(app.ids(), ['nvestido']);
  assert.equal(app.cloud.produtos.length, 1);
  assert.equal(app.calls.length, 0);
});

test('falha de envio não apaga produtos nem perde o restante da fila', async () => {
  const photo = 'data:image/jpeg;base64,' + 'a'.repeat(400 * 1024);
  const pending = [
    { k: 'pUp', p: { ...product(), preco: 175, foto: photo, fotos: [photo] }, ts: 1, __soLocal: true },
    { k: 'pUp', p: { ...product('nsegundo'), preco: 80 }, ts: 1 }
  ];
  const storage = createStorage({ em_outbox: JSON.stringify(pending), em_zera_cats_v1: '1' });
  let upsert;
  const app = boot({ storage, configure(SB) {
    upsert = SB.gravar;
    SB.gravar = async () => { throw new Error('Falha de rede simulada'); };
  } });
  await app.DB.ready;
  await app.DB.sincronizar();
  assert.deepEqual(app.ids(), ['nvestido', 'nsegundo']);
  assert.equal(app.DB.getProduct('nvestido').preco, 175);
  assert.equal(app.DB.pendencias(), 2);
  assert.equal(app.calls.length, 0);
  assert.equal(JSON.parse(storage.getItem('em_db_v1')).deleted.length, 0);
  app.SB.gravar = upsert;
  await app.DB.sincronizar();
  assert.equal(app.DB.pendencias(), 0);
  assert.equal(app.cloud.produtos.length, 2);
  assert.deepEqual(app.ids(), ['nvestido', 'nsegundo']);
});

test('salvar offline e recarregar preserva uma única alteração pendente', async () => {
  const initial = boot();
  await initial.DB.ready;
  const app = boot({ storage: initial.storage, offline: true });
  await app.DB.ready;
  app.DB.saveProduct({ ...app.DB.getProduct('nvestido'), estoque: 5 });
  const reloaded = boot({ storage: app.storage, offline: true });
  await reloaded.DB.ready;
  for (let i = 0; i < 5; i++) reloaded.DB.applyToShop();
  assert.deepEqual(reloaded.ids(), ['nvestido']);
  assert.equal(reloaded.DB.getProduct('nvestido').estoque, 5);
  assert.equal(reloaded.DB.pendencias(), 1);
});

test('exclusão explícita durante um envio vence o envio, sem recriar o produto', async () => {
  const app = boot();
  await app.DB.ready;
  let started, release;
  const waiting = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const upsert = app.SB.gravar;
  app.SB.gravar = async (table, row) => {
    started();
    await blocked;
    await upsert(table, row);
  };
  app.DB.saveProduct({ ...app.DB.getProduct('nvestido'), estoque: 10 });
  await waiting;
  app.DB.deleteProduct('nvestido');
  release();
  await app.DB.sincronizar();
  assert.deepEqual(app.ids(), []);
  assert.deepEqual(app.cloud.produtos, []);
  assert.equal(app.DB.pendencias(), 0);
  assert.equal(app.calls.filter(c => c[0] === 'delete').length, 1);
});

test('uma leitura lenta não reapresenta um produto excluído durante a consulta', async () => {
  const app = boot();
  await app.DB.ready;
  let reading, release;
  const started = new Promise(resolve => { reading = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const read = app.SB.ler;
  let hold = true;
  app.SB.ler = async table => {
    const result = await read(table);
    if (table === 'pedidos' && hold) {
      hold = false;
      reading();
      await blocked;
    }
    return result;
  };
  const pull = app.DB.puxarNuvem();
  await started;
  app.DB.deleteProduct('nvestido');
  while (app.DB.pendencias()) await new Promise(resolve => setImmediate(resolve));
  release();
  await pull;
  app.DB.applyToShop();
  assert.deepEqual(app.ids(), []);
  assert.deepEqual(app.shopIds(), []);
  assert.equal(app.calls.filter(c => c[0] === 'delete').length, 1);
});

test('scripts reais da loja/admin compilam e todas as páginas usam o cache atualizado', () => {
  for (const name of ['data.js', 'loja-db.js', 'main.js', 'supabase.js']) new vm.Script(source(name), { filename: name });
  const publicDir = path.join(root, 'public');
  const pages = fs.readdirSync(publicDir).filter(name => name.endsWith('.html')).map(name => path.join(publicDir, name));
  pages.push(path.join(publicDir, 'admin', 'index.html'));
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    let index = 0;
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=/.test(match[1])) new vm.Script(match[2], { filename: path.basename(file) + ':' + (++index) });
    }
    if (html.includes('loja-db.js')) assert.ok(html.includes('loja-db.js?v=9'), file);
    assert.ok(!html.includes('limparSoAqui('), 'não oferece exclusão por prefixo do ID');
    assert.ok(!html.includes('limparDuplicados('), 'não oferece exclusão por nome/preço');
  }
});
