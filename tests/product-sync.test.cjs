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
      const key = table === 'produtos' ? 'id' : table === 'pedidos' ? 'numero' : 'slug';
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

test('remove do cache os três pedidos confirmados como ausentes do Supabase', () => {
  const ids = ['CHECKOUT-TEST-1791374008945', '#EM1791374008946', '#EM0002'];
  const keep = { numero: '#EM0001', status: 'Novo' };
  const storage = createStorage({
    em_db_v1: JSON.stringify({ orders: [...ids.map(numero => ({ numero, status: 'Novo' })), keep] }),
    em_outbox: JSON.stringify(ids.map(numero => ({ k: 'oNew', o: { numero } })))
  });
  const app = boot({ storage });
  assert.deepEqual(JSON.parse(storage.getItem('em_db_v1')).orders.map(o => o.numero), [keep.numero]);
  assert.deepEqual(JSON.parse(storage.getItem('em_outbox')), []);
  assert.deepEqual(JSON.parse(JSON.stringify(app.DB.listOrders().map(o => o.numero))), [keep.numero]);
});

test('snapshot substitui pedidos locais e realtime limpa uma tabela esvaziada', async () => {
  const storage = createStorage({ em_db_v1: JSON.stringify({ orders: [{ numero: '#LOCAL-ANTIGO', status: 'Novo' }] }) });
  const app = boot({ storage, configure: (SB, cloud) => {
    cloud.pedidos = [{ numero: '#000001', status: 'Novo', data: '2026-10-08T12:00:00Z' }];
  } });
  await app.DB.ready;
  assert.deepEqual(copy(app.DB.listOrders()).map(o => o.numero), ['#000001']);
  app.cloud.pedidos = [];
  await app.emitChange();
  assert.deepEqual(copy(app.DB.listOrders()), []);
  assert.deepEqual(JSON.parse(storage.getItem('em_db_v1')).orders, []);
  assert.equal(app.calls.length, 0);
});

test('erro de leitura ou ausência de sessão não é tratado como tabela vazia', async () => {
  for (const mode of ['error', 'visitor']) {
    const storage = createStorage({ em_db_v1: JSON.stringify({ orders: [{ numero: '#000001', status: 'Novo' }] }) });
    const app = boot({ storage, configure: SB => {
      if (mode === 'visitor') SB.session = async () => null;
      else {
        const read = SB.ler;
        SB.ler = async table => { if (table === 'pedidos') throw new Error('Sem acesso'); return read(table); };
      }
    } });
    await app.DB.ready;
    assert.deepEqual(copy(app.DB.listOrders()).map(o => o.numero), ['#000001']);
  }
});

test('snapshot vazio preserva pedido com envio pendente sem preservar cache órfão', async () => {
  const pending = { numero: '#PENDENTE', status: 'Novo' };
  const storage = createStorage({
    em_db_v1: JSON.stringify({ orders: [pending, { numero: '#ORFAO' }] }),
    em_outbox: JSON.stringify([{ k: 'oNew', o: pending }])
  });
  const app = boot({ storage, configure: SB => { SB.rpc = async () => { throw new Error('Falha de envio'); }; } });
  await app.DB.ready;
  assert.deepEqual(copy(app.DB.listOrders()).map(o => o.numero), ['#PENDENTE']);
  assert.equal(JSON.parse(storage.getItem('em_outbox')).length, 1);
});

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

test('estoque por cor não usa o estoque geral quando a cor está zerada ou inválida', () => {
  const main = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'main.js'), 'utf8');
  const declaration = main.match(/function estoqueDisponivelProduto\(p, cor\)\s*\{[\s\S]*?\r?\n\}/)[0];
  const context = vm.createContext({});
  vm.runInContext(declaration, context);
  assert.equal(vm.runInContext("estoqueDisponivelProduto({estoque: 10, estoquePorCor: {Preta: 0, Azul: 3}}, 'Preta')", context), 0);
  assert.equal(vm.runInContext("estoqueDisponivelProduto({estoque: 10, estoquePorCor: {Preta: 0, Azul: 3}}, 'Rosa')", context), 0);
  assert.equal(vm.runInContext("estoqueDisponivelProduto({estoque: 10, estoquePorCor: {Preta: 0, Azul: 3}})", context), 3);
});

test('seletor de produto do pedido abre seleção com fotos para cores configuradas no estoque', () => {
  const admin = fs.readFileSync(path.join(root, 'public', 'admin', 'index.html'), 'utf8');
  const selecionar = admin.match(/function selecionarProdutoEdicao\(id\)\{[\s\S]*?\n  \}/);
  assert.ok(selecionar);
  assert.match(selecionar[0], /cores\.length>1/);
  assert.match(selecionar[0], /renderCoresProdutoEdicao\(produto,cores\)/);
  assert.match(admin, /function coresProdutoEdicao\(produto\)/);
  const variantes = admin.match(/function renderCoresProdutoEdicao\(produto,cores\)\{[\s\S]*?\n  \}/);
  assert.ok(variantes);
  assert.match(variantes[0], /imagemCorProdutoEdicao\(produto,c\)/);
  assert.match(variantes[0], /data-edicao-variante/);
  assert.match(admin, /function inserirProdutoEdicao\(produto,cor\)/);
});

test('cache local mantém somente os sete pedidos mais recentes', async () => {
  const app = boot({ offline: true });
  await app.DB.ready;
  for (let day = 1; day <= 8; day++) {
    app.DB.logOrder({
      nome: `Cliente ${day}`,
      data: new Date(Date.UTC(2026, 0, day)).toISOString(),
      itens: [], subtotal: 0, total: 0
    });
  }
  assert.equal(app.DB.listOrders().length, 7);
  assert.deepEqual(copy(app.DB.listOrders().map(order => order.nome)), [
    'Cliente 8', 'Cliente 7', 'Cliente 6', 'Cliente 5', 'Cliente 4', 'Cliente 3', 'Cliente 2'
  ]);
});

test('migration apaga dependências antigas sem devolver estoque e trava novas criações para reter sete', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase-sales-migration.sql'), 'utf8');
  assert.match(sql, /create or replace function public\.purge_old_orders\(p_keep integer default 7\)/);
  assert.match(sql, /perform pg_advisory_xact_lock\(72819430\)/);
  assert.match(sql, /perform public\.purge_old_orders\(7\)/);
  const purge = sql.match(/create or replace function public\.purge_old_orders\(p_keep integer default 7\)([\s\S]*?)revoke all on function public\.purge_old_orders\(integer\)/);
  assert.ok(purge);
  for (const table of ['movimentacoes_caixa','pagamentos','movimentacoes_estoque','auditoria_vendas','historico_pedidos','vendas','pedidos']) {
    assert.match(purge[1], new RegExp(`delete from public\\.${table}`));
  }
  assert.doesNotMatch(purge[1], /update public\.produtos/);
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
    if (html.includes('loja-db.js')) assert.ok(/loja-db\.js\?v=(10|11|12|13|14|15|16|17)\b/.test(html), file);
    assert.ok(!html.includes('limparSoAqui('), 'não oferece exclusão por prefixo do ID');
    assert.ok(!html.includes('limparDuplicados('), 'não oferece exclusão por nome/preço');
  }
});
test('fechar venda baixa o estoque da cor e cancelar estorna uma única vez', async () => {
  const app = boot({ rows: [{ ...product(), estoque: 2, estoque_por_cor: { Verde: 2 } }] });
  await app.DB.ready;
  const pedido = app.DB.logOrder({ nome: 'Cliente Caixa', itens: [{ id: 'nvestido', nome: 'VESTIDO FLORAL', cor: 'Verde', qtd: 1, preco: 150 }], subtotal: 150, desconto: 10, total: 140, pag: 'Pix', pagamentoStatus: 'Pago' });
  app.DB.setOrderStatus(pedido.numero, 'Concluído');
  assert.equal(app.DB.getProduct('nvestido').estoque, 1);
  assert.equal(app.DB.getProduct('nvestido').estoquePorCor.Verde, 1);
  app.DB.setOrderStatus(pedido.numero, 'Cancelado');
  assert.equal(app.DB.getProduct('nvestido').estoque, 2);
  assert.equal(app.DB.getProduct('nvestido').estoquePorCor.Verde, 2);
  assert.equal(app.DB.listOrders()[0].estornado, true);
});

test('editar venda recalcula total e exclusão física remove o pedido', async () => {
  const app = boot();
  await app.DB.ready;
  const cloudRow={numero:'EM-MIGRATED',data:new Date().toISOString(),cliente_nome:'Cliente',cliente_fone:'',cliente_endereco:'',itens:[{id:'nvestido',nome:'VESTIDO FLORAL',qtd:1,preco:150}],subtotal:150,desconto:0,frete:0,total:150,pagamento:'',pagamento_status:'Pendente',status:'Pendente',estoque_baixado:false};
   app.SB.rpc=async(name,args)=>{if(name==='site_criar_pedido'){app.cloud.pedidos.push(copy(cloudRow));return copy(cloudRow);}if(name==='admin_editar_pedido'){Object.assign(app.cloud.pedidos[0],{desconto:args.p_desconto,frete:args.p_frete,total:135});return app.cloud.pedidos[0];}if(name==='admin_atualizar_status_pedido'){return app.cloud.pedidos[0];}if(name==='admin_excluir_pedido'){app.cloud.pedidos=app.cloud.pedidos.filter(p=>p.numero!==args.p_numero);return {numero:args.p_numero,deleted:true};}throw Error('unexpected rpc '+name);};
  const pedido = app.DB.logOrder({ itens: [{ id: 'nvestido', nome: 'VESTIDO FLORAL', qtd: 1, preco: 150 }], subtotal: 150, total: 150 });
  app.DB.updateOrder(pedido.numero, { desconto: 25, frete: 10 });
  assert.equal(app.DB.listOrders()[0].total, 135);
  while (app.DB.pendencias()) await new Promise(resolve => setImmediate(resolve));
  await app.DB.deleteOrder(pedido.numero);
   assert.equal(app.DB.listOrders().length, 0);
   assert.equal(app.cloud.pedidos.length, 0);
  assert.equal(app.DB.getProduct('nvestido').estoque, 1);
});

test('pedido do site só é aceito após confirmação do RPC e usa snapshot do Supabase', async () => {
  const app=boot(); await app.DB.ready; let chamada;
  app.SB.rpc=async(nome,args)=>{chamada={nome,args};return {numero:'EM-TESTE1234',data:new Date().toISOString(),cliente_nome:'Maria',cliente_fone:'11999999999',itens:[{id:'nvestido',nome:'VESTIDO FLORAL',foto:'https://img.test/produto.jpg',cor:'Verde',tam:'M',qtd:1,preco:150,subtotal:150}],subtotal:150,desconto:0,frete:0,total:150,pagamento:'Pix',pagamento_status:'Pendente',status:'Pendente',origem:'Site',estoque_baixado:false};};
  const pedido=await app.DB.createSiteOrder({nome:'Maria',fone:'11999999999',itens:[{id:'nvestido',qtd:1,preco:1}],pag:'Pix'},'00000000-0000-4000-8000-000000000001');
  assert.equal(chamada.nome,'site_criar_pedido');
  assert.equal(chamada.args.p_itens[0].id,'nvestido');
  assert.equal(chamada.args.p_itens[0].qtd,1);
  assert.equal(pedido.total,150,'valor do banco prevalece sobre o preço enviado pelo browser');
  assert.equal(pedido.itens[0].foto,'https://img.test/produto.jpg');
  assert.equal(app.DB.listOrders()[0].status,'Pendente');
});

test('falha do RPC de checkout não cria pedido local nem permite abrir WhatsApp com sucesso falso', async () => {
  const app=boot();await app.DB.ready;app.SB.rpc=async()=>{throw new Error('network failure');};
  await assert.rejects(app.DB.createSiteOrder({nome:'Maria',fone:'11999999999',itens:[{id:'nvestido',qtd:1}]},'00000000-0000-4000-8000-000000000002'),/network failure/);
  assert.equal(app.DB.listOrders().length,0);
});

test('finalização delega atomicidade ao RPC e falha sem alterar cache local', async () => {
  const app=boot();await app.DB.ready;const pedido=app.DB.logOrder({itens:[{id:'nvestido',qtd:1,preco:150}],subtotal:150,total:150});
  app.SB.rpc=async(nome,args)=>{assert.equal(nome,'admin_finalizar_venda');assert.equal(args.p_numero,pedido.numero);throw new Error('insufficient_stock');};
  await assert.rejects(app.DB.finalizeOrder(pedido.numero,150,[{forma:'PIX',valor:150,entregue:150}],''),/insufficient_stock/);
  assert.equal(app.DB.getProduct('nvestido').estoque,1);
  assert.equal(app.DB.listOrders()[0].status,'Novo');
});
