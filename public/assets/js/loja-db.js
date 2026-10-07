// Encanto Miranda — cache do Supabase e fila de alterações pendentes.
// PRODUTOS/CATEGORIAS são saídas para a interface, nunca fontes do cache.
const DB = (() => {
  const KEY = 'em_db_v1';
  const initialProducts = typeof PRODUTOS !== 'undefined' ? JSON.parse(JSON.stringify(PRODUTOS)) : [];
  const initialCategories = typeof CATEGORIAS !== 'undefined' ? JSON.parse(JSON.stringify(CATEGORIAS)) : [];
  const baseProdutos = () => initialProducts;
  const baseCategorias = () => initialCategories;
  const blank = () => ({ products: {}, deleted: [], categories: {}, catDeleted: [], catOrder: null, orders: [], seq: 1, coupons: {}, settings: null, catalogSynced: false });

  function load() {
    try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch { return blank(); }
  }
  let S = load();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  // ZERAR CATEGORIAS (pedido do dono, uma única vez por aparelho):
  // limpa customs locais + fila pendente de categorias. Novas criações depois funcionam normal.
  try {
    if (!localStorage.getItem('em_zera_cats_v1')) {
      S.categories = {}; S.catDeleted = []; S.catOrder = [];
      try {
        const f = JSON.parse(localStorage.getItem('em_outbox') || '[]').filter(op => op.k !== 'cUp' && op.k !== 'cDel');
        localStorage.setItem('em_outbox', JSON.stringify(f));
      } catch {}
      localStorage.setItem('em_zera_cats_v1', '1');
      persist();
    }
  } catch {}

  // ---------- NUVEM (Supabase: vale em todos os aparelhos) ----------
  const nuvemLigada = () => (typeof SB !== 'undefined' && SB.ok());
  // Multi-foto sem migração: se tem >1 foto, salva JSON no campo `foto`; se 1, salva URL direta.
  const fotosArr = p => (Array.isArray(p.fotos) && p.fotos.length ? p.fotos : (p.foto ? [p.foto] : []));
  const fotoParaNuvem = p => { const a = fotosArr(p); return a.length > 1 ? JSON.stringify(a) : (a[0] || null); };
  const fotosDaNuvem = foto => {
    if (!foto) return [];
    if (typeof foto === 'string' && foto.trim().startsWith('[')) { try { const a = JSON.parse(foto); if (Array.isArray(a)) return a.filter(Boolean); } catch {} }
    return [foto];
  };
  const estoqueCoresNormalizado = valor => {
    const entrada = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
    const saida = {};
    Object.keys(entrada).forEach(cor => { const nome = String(cor).trim(); if (nome) saida[nome] = Math.max(0, Math.round(+entrada[cor] || 0)); });
    return saida;
  };
  const totalEstoqueCores = mapa => Object.values(mapa).reduce((s, n) => s + (+n || 0), 0);
  const pToRow = p => ({ id: String(p.id), nome: p.nome, descricao: p.desc || '', tecido: p.tecido || '', preco: +p.preco || 0, preco_antigo: p.antigo == null ? null : +p.antigo, categoria: p.cat || null, selo: p.selo || null, cores: p.cores || [], tamanhos: p.tams || [], estoque: p.estoque || 0, estoque_por_cor: estoqueCoresNormalizado(p.estoquePorCor), parcelas: Math.min(12, Math.max(1, Math.round(+p.parcelas || 6))), foto: fotoParaNuvem(p), rascunho: !!p.rascunho, destaque: !!p.destaque });
  const pFromRow = r => { const fa = fotosDaNuvem(r.foto); const porCor = estoqueCoresNormalizado(r.estoque_por_cor); return { id: r.id, nome: r.nome, desc: r.descricao || '', tecido: r.tecido || '', preco: +r.preco, antigo: r.preco_antigo == null ? null : +r.preco_antigo, cat: r.categoria, selo: r.selo, cores: r.cores || [], tams: r.tamanhos || [], estoque: r.estoque || 0, estoquePorCor: porCor, controlaEstoquePorCor: Object.keys(porCor).length > 0, parcelas: Math.min(12, Math.max(1, Math.round(+r.parcelas || 6))), foto: fa[0] || null, fotos: fa, rascunho: !!r.rascunho, destaque: !!r.destaque }; };
  const oToRow = o => ({ numero: o.numero, data: o.data, cliente_nome: o.nome || '', cliente_fone: o.fone || '', cliente_endereco: o.endereco || '', itens: o.itens || [], subtotal: +o.subtotal || 0, desconto: +o.desconto || 0, total: +o.total || 0, pagamento: o.pag || '', cupom: o.cupom || '', status: o.status || 'Novo', estoque_baixado: !!o.baixado });
  const oFromRow = r => ({ numero: r.numero, data: r.data, nome: r.cliente_nome, fone: r.cliente_fone, endereco: r.cliente_endereco || '', itens: r.itens || [], subtotal: +r.subtotal, desconto: +r.desconto, total: +r.total, pag: r.pagamento, cupom: r.cupom, status: r.status, baixado: !!r.estoque_baixado });
  const sToRow = () => { const s = getSettings(); return { id: 1, nome_loja: s.nomeLoja, whatsapp: s.whatsapp, whatsapp_config: s.whatsappConfig, email: s.email, endereco: s.endereco, instagram: s.instagram, frete_gratis: s.freteGratis, cor: s.cor, banners: s.banners, pagamento: s.pagamento, informacoes: s.informacoes }; };
  const limpaExtras = a => {
    if (!Array.isArray(a)) return [];
    const vistos = new Set(), out = [];
    a.forEach(x => {
      const nome = String(x == null ? '' : (typeof x === 'object' ? (x.nome || x.value || '') : x)).trim().replace(/\s+/g, ' ').slice(0, 30);
      const chave = nome.toLowerCase();
      if (!nome || vistos.has(chave)) return;
      vistos.add(chave);
      out.push(nome);
    });
    return out.slice(0, 10);
  };
  const normalizaPagamento = pg => {
    pg = (pg && typeof pg === 'object') ? pg : {};
    return { pix: pg.pix !== false, boleto: pg.boleto !== false, cartao: pg.cartao !== false, extras: limpaExtras(pg.extras || pg.outros || []), mostrarCarrinho: pg.mostrarCarrinho !== false };
  };
  const normalizaInformacoes = info => {
    info = (info && typeof info === 'object') ? info : {};
    const texto = (v, padrao) => String(v == null || v === '' ? padrao : v).trim().slice(0, 120);
    const antigoVisivel = info.visivel !== false;
    const visiveis = (info.visiveis && typeof info.visiveis === 'object') ? info.visiveis : {};
    return {
      atendimento: texto(info.atendimento, 'Atendimento'),
      horarioAtendimento: texto(info.horarioAtendimento, 'Seg a Sáb, 9h–18h'),
      trocasPrazo: texto(info.trocasPrazo, 'Trocas em até 30 dias'),
      prazoEnvio: texto(info.prazoEnvio, 'Envio em até 2 dias úteis'),
      envioDetalhe: texto(info.envioDetalhe, 'Correios com rastreio'),
      freteGratisAtivo: info.freteGratisAtivo === true,
      fretePadrao: Math.max(0, +info.fretePadrao || 0),
      visiveis: {
        atendimento: visiveis.atendimento == null ? antigoVisivel : visiveis.atendimento !== false,
        horarioAtendimento: visiveis.horarioAtendimento == null ? antigoVisivel : visiveis.horarioAtendimento !== false,
        trocasPrazo: visiveis.trocasPrazo == null ? antigoVisivel : visiveis.trocasPrazo !== false,
        prazoEnvio: visiveis.prazoEnvio == null ? antigoVisivel : visiveis.prazoEnvio !== false,
        envioDetalhe: visiveis.envioDetalhe == null ? antigoVisivel : visiveis.envioDetalhe !== false
      }
    };
  };
  const normalizaWhatsappConfig = cfg => ({ mensagemPedido: String(cfg && cfg.mensagemPedido || 'Olá! Sou [nome], quero finalizar meu pedido [pedido] na [loja].\n\n[itens]\n\nSubtotal: [subtotal]\nDesconto: [desconto]\nCupom: [cupom]\nTotal: [valor total]\nPagamento: [pagamento]').slice(0, 2000) });
  const sFromRow = r => ({ whatsapp: r.whatsapp, whatsappConfig: normalizaWhatsappConfig(r.whatsapp_config), email: r.email, endereco: r.endereco, instagram: r.instagram, freteGratis: +r.frete_gratis, cor: r.cor, nomeLoja: r.nome_loja, banners: r.banners || [], pagamento: normalizaPagamento(r.pagamento), informacoes: normalizaInformacoes(r.informacoes) });

  const QUEUE_KEY = 'em_outbox';
  let queueSequence = 0, queuePromise = null, syncPromise = null, pullPromise = null, writeRevision = 0;
  function readQueue() {
    try { const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); return Array.isArray(q) ? q.filter(Boolean) : []; }
    catch { return []; }
  }
  function opKey(op) {
    if (op.k === 'pUp' && op.p) return 'p:' + String(op.p.id);
    if (op.k === 'pDel') return 'p:' + String(op.id);
    if (op.k === 'cUp' && op.row) return 'c:' + op.row.slug;
    if (op.k === 'cDel') return 'c:' + op.slug;
    if ((op.k === 'oNew' || op.k === 'oUpd') && op.o) return 'o:' + op.o.numero;
    if (op.k === 'kUp' && op.row) return 'k:' + op.row.codigo;
    if (op.k === 'kDel') return 'k:' + op.codigo;
    if (op.k === 'sUp') return 's:1';
    return op._qid;
  }
  function compactQueue(queue) {
    const last = new Map();
    queue.forEach((op, i) => last.set(opKey(op), i));
    return queue.filter((op, i) => last.get(opKey(op)) === i);
  }
  function filaPush(item) {
    const op = Object.assign({}, item, { ts: Date.now(), _qid: Date.now().toString(36) + '-' + (++queueSequence) + '-' + Math.random().toString(36).slice(2) });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(compactQueue(readQueue().concat(op))));
  }
  async function execOp(op) {
    switch (op.k) {
      case 'pUp': await SB.gravar('produtos', pToRow(op.p)); break;
      case 'pDel': await SB.apagar('produtos', 'id', op.id); break;
      case 'cUp': await SB.gravar('categorias', op.row); break;
      case 'cDel': await SB.apagar('categorias', 'slug', op.slug); break;
      case 'oNew': await SB.gravar('pedidos', oToRow(op.o), { apenasInserir: true }); break;
      case 'oUpd': await SB.gravar('pedidos', oToRow(op.o)); break;
      case 'kUp': await SB.gravar('cupons', op.row); break;
      case 'kDel': await SB.apagar('cupons', 'codigo', op.codigo); break;
      case 'sUp': await SB.gravar('configuracoes', sToRow()); break;
    }
  }
  function avisaLocal() {
    try { if (String(location.href).includes('/admin/') && typeof toast === 'function') toast('Sem nuvem agora: salvo só neste aparelho.'); } catch {}
  }
  function paraNuvem(op) {
    // Registra a intenção antes da rede: uma falha nunca apaga o produto.
    filaPush(op);
    if (nuvemLigada()) empurraFila().catch(avisaLocal);
    else avisaLocal();
  }
  async function sincronizar() {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      await empurraFila();
      const mudou = await puxarNuvem();
      applyToShop();
      return mudou;
    })();
    try { return await syncPromise; }
    finally { syncPromise = null; }
  }
  async function empurraFila() {
    if (!nuvemLigada()) return;
    if (queuePromise) return queuePromise;
    queuePromise = (async () => {
      const session = await SB.session();
      const queue = compactQueue(readQueue()).map(op => Object.assign({}, op, {
        _qid: op._qid || 'legacy-' + (++queueSequence) + '-' + Date.now().toString(36)
      }));
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      while (true) {
        // Visitantes podem enviar pedidos, mas não alterações administrativas.
        const op = readQueue().find(item => session || item.k === 'oNew');
        if (!op) break;
        try {
          await execOp(op);
          writeRevision++;
          // Remove só a operação concluída, preservando as criadas durante o envio.
          localStorage.setItem(QUEUE_KEY, JSON.stringify(readQueue().filter(item => item._qid !== op._qid)));
        } catch {
          avisaLocal();
          break; // mantém esta operação E todo o restante para uma nova tentativa
        }
      }
    })();
    try { return await queuePromise; }
    finally { queuePromise = null; }
  }
  const resumoEstado = () => JSON.stringify({ p: S.products, d: S.deleted, c: S.categories, cd: S.catDeleted, o: S.catOrder, k: S.coupons, s: S.settings, ped: S.orders.map(x => x.numero + x.status + (x.baixado ? '1' : '0')), seq: S.seq, catalogSynced: S.catalogSynced });
  async function puxarNuvem() {
    if (!nuvemLigada()) return false;
    if (pullPromise) return pullPromise;
    pullPromise = lerSnapshot();
    try { return await pullPromise; }
    finally { pullPromise = null; }
  }
  async function lerSnapshot() {
    const antes = resumoEstado();
    try {
      let snapshot, revision;
      do {
        revision = writeRevision;
        snapshot = await Promise.all([
          SB.ler('categorias', { col: 'ordem' }), SB.ler('produtos'),
          SB.ler('cupons'), SB.lerUm('configuracoes', 'id', 1),
          SB.ler('pedidos', { col: 'data', asc: false }).catch(() => [])
        ]);
      } while (revision !== writeRevision);
      const [cats, prods, cups, cfg, peds] = snapshot;
      const products = new Map(prods.map(r => [String(r.id), pFromRow(r)]));
      const categories = new Map(cats.map(c => [c.slug, { nome: c.nome, icone: c.icone || '•', ordem: c.ordem }]));
      const deleted = [], catDeleted = [];
      // Só intenções explícitas ainda pendentes sobrepõem a nuvem. Ler o banco
      // nunca envia DELETE por causa de uma lápide/cache antigo.
      compactQueue(readQueue()).forEach(op => {
        if (op.k === 'pUp' && op.p) products.set(String(op.p.id), op.p);
        if (op.k === 'pDel') { products.delete(String(op.id)); deleted.push(String(op.id)); }
        if (op.k === 'cUp' && op.row) categories.set(op.row.slug, op.row);
        if (op.k === 'cDel') { categories.delete(op.slug); catDeleted.push(op.slug); }
      });
      S.products = Object.fromEntries(products);
      S.categories = Object.fromEntries(categories);
      S.deleted = deleted;
      S.catDeleted = catDeleted;
      S.catOrder = [...categories.keys()].sort((a, b) => (categories.get(a).ordem || 0) - (categories.get(b).ordem || 0));
      S.catalogSynced = true;
      S.coupons = {};
      cups.forEach(c => { S.coupons[c.codigo] = { codigo: c.codigo, tipo: c.tipo, valor: +c.valor, validade: c.validade || '', minimo: +c.minimo || 0 }; });
      if (cfg) S.settings = sFromRow(cfg);
      if (peds.length) {
        const locais = {};
        S.orders.forEach(o => locais[o.numero] = o);
        peds.forEach(r => { locais[r.numero] = oFromRow(r); });
        S.orders = Object.values(locais).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
        const max = S.orders.reduce((m, o) => { const n = parseInt(String(o.numero).replace(/\D/g, ''), 10); return isNaN(n) ? m : Math.max(m, n); }, 0);
        S.seq = Math.max(S.seq, max + 1);
      }
      persist();
    } catch { return false; }
    return resumoEstado() !== antes;
  }
  let syncTimer = null;
  function avisaSync() {
    try { if (typeof window !== 'undefined' && window.__syncRender) window.__syncRender(); } catch {}
  }
  let rtLigado = false;
  function ligaTempoReal() {
    if (rtLigado || !nuvemLigada()) return;
    rtLigado = true;
    SB.aoMudar(['produtos', 'categorias', 'cupons', 'configuracoes', 'pedidos'], () => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(async () => {
        if (await sincronizar()) avisaSync();
      }, 900);
    });
  }
  const pronto = (async () => {
    const mudou = await sincronizar();
    if (mudou) avisaSync();
    ligaTempoReal();
    // se a biblioteca da nuvem chegou atrasada, tenta de novo em 5s
    setTimeout(async () => {
      if (!rtLigado) {
        if (await sincronizar()) avisaSync();
        ligaTempoReal();
      }
    }, 5000);
    return mudou;
  })();

  // traz ajustes antigos (versão anterior do painel) para o formato novo
  (function migrarAntigo() {
    try {
      const ov = JSON.parse(localStorage.getItem('em_overrides') || 'null');
      if (ov && typeof ov === 'object') {
        Object.keys(ov).forEach(id => {
          const o = ov[id] || {};
          S.products[id] = Object.assign({}, S.products[id], { preco: o.preco, antigo: o.antigo, estoque: o.estoque });
        });
        localStorage.removeItem('em_overrides');
        persist();
      }
    } catch {}
  })();

  const customId = () => 'n' + Date.now().toString(36);

  function listProducts(includeDrafts) {
    const byId = new Map();
    if (!S.catalogSynced) baseProdutos().forEach(p => byId.set(String(p.id), Object.assign({}, p)));
    Object.entries(S.products).forEach(([key, p]) => {
      if (!p) return;
      const id = String(p.id == null ? key : p.id);
      byId.set(id, Object.assign({}, byId.get(id), p, { id }));
    });
    return [...byId.values()].filter(p => !S.deleted.includes(String(p.id)) && (includeDrafts || !p.rascunho));
  }
  const getProduct = id => listProducts(true).find(p => String(p.id) === String(id));

  function saveProduct(p) {
    if (!p.id) p.id = customId();
    const id = String(p.id);
    S.deleted = S.deleted.filter(deletedId => String(deletedId) !== id);
    const fa = fotosArr(p);
    const capa = fa[0] || p.foto || null;
    const isBase = baseProdutos().some(b => String(b.id) === id);
    if (isBase) {
       S.products[id] = Object.assign({}, S.products[id], { nome: p.nome, desc: p.desc, tecido: p.tecido, preco: +p.preco, antigo: p.antigo === '' || p.antigo == null ? null : +p.antigo, cat: p.cat, selo: p.selo || null, cores: p.cores || [], tams: p.tams || [], estoque: Math.max(0, Math.round(+p.estoque || 0)), estoquePorCor: estoqueCoresNormalizado(p.estoquePorCor), controlaEstoquePorCor: !!p.controlaEstoquePorCor, parcelas: Math.min(12, Math.max(1, Math.round(+p.parcelas || (S.products[id] || {}).parcelas || 6))), foto: capa, fotos: fa, rascunho: !!p.rascunho, destaque: !!p.destaque });
    } else {
       S.products[id] = Object.assign({}, p, { preco: +p.preco, antigo: p.antigo === '' || p.antigo == null ? null : +p.antigo, estoque: Math.max(0, Math.round(+p.estoque || 0)), estoquePorCor: estoqueCoresNormalizado(p.estoquePorCor), controlaEstoquePorCor: !!p.controlaEstoquePorCor, parcelas: Math.min(12, Math.max(1, Math.round(+p.parcelas || 6))), foto: capa, fotos: fa });
    }
    persist();
    paraNuvem({ k: 'pUp', p: getProduct(id) });
    return id;
  }
  function deleteProduct(id) {
    id = String(id);
    // lápide: vale p/ base e p/ customs — o pull da nuvem respeita e não ressuscita
    if (!S.deleted.includes(id)) S.deleted.push(id);
    delete S.products[id];
    // limpa envios pendentes desse id (evita recriar) e enfileira o delete
    try {
      const f = JSON.parse(localStorage.getItem('em_outbox') || '[]')
        .filter(op => !(op && ((op.k === 'pUp' && op.p && String(op.p.id) === id) || (op.k === 'pDel' && String(op.id) === id))));
      localStorage.setItem('em_outbox', JSON.stringify(f));
    } catch {}
    persist();
    paraNuvem({ k: 'pDel', id });
  }
  function adjustStock(id, delta, cor) {
    const p = getProduct(id);
    if (!p) return 0;
    const mapa = estoqueCoresNormalizado(p.estoquePorCor);
    const usaCor = cor && Object.prototype.hasOwnProperty.call(mapa, cor);
    const novoCor = usaCor ? Math.max(0, (mapa[cor] || 0) + delta) : null;
    if (usaCor) mapa[cor] = novoCor;
    const novo = usaCor ? totalEstoqueCores(mapa) : Math.max(0, (p.estoque || 0) + delta);
    const sid = String(id);
    const alteracao = usaCor ? { estoque: novo, estoquePorCor: mapa } : { estoque: novo };
    if (baseProdutos().some(b => String(b.id) === sid)) S.products[sid] = Object.assign({}, S.products[sid], alteracao);
    else if (S.products[sid]) Object.assign(S.products[sid], alteracao);
    persist();
    paraNuvem({ k: 'pUp', p: getProduct(sid) });
    return novo;
  }
  const setStock = (id, qty, cor) => {
    const p = getProduct(id);
    if (!p) return 0;
    const mapa = estoqueCoresNormalizado(p.estoquePorCor);
    if (cor && Object.prototype.hasOwnProperty.call(mapa, cor)) {
      mapa[cor] = Math.max(0, Math.round(+qty || 0));
      const total = totalEstoqueCores(mapa), sid = String(id), alteracao = { estoque: total, estoquePorCor: mapa };
      if (baseProdutos().some(b => String(b.id) === sid)) S.products[sid] = Object.assign({}, S.products[sid], alteracao);
      else if (S.products[sid]) Object.assign(S.products[sid], alteracao);
      persist(); paraNuvem({ k: 'pUp', p: getProduct(sid) }); return mapa[cor];
    }
    return adjustStock(id, Math.max(0, Math.round(+qty || 0)) - (p.estoque || 0));
  };

  function listCategories() {
    const base = (S.catalogSynced ? [] : baseCategorias()).filter(c => !S.catDeleted.includes(c.slug));
    const customs = Object.keys(S.categories).map(slug => Object.assign({ slug }, S.categories[slug]));
    const todas = base.map(c => Object.assign({}, c, S.categories[c.slug] || {})).concat(customs.filter(c => !base.some(b => b.slug === c.slug))).filter(c => !S.catDeleted.includes(c.slug));
    if (Array.isArray(S.catOrder) && S.catOrder.length) {
      const pos = {}; S.catOrder.forEach((s, i) => pos[s] = i);
      todas.sort((a, b) => (pos[a.slug] ?? 999) - (pos[b.slug] ?? 999));
    }
    return todas;
  }
  function empurraCategoria(slug) {
    const lista = listCategories();
    const c = lista.find(x => x.slug === slug);
    if (!c) return;
    paraNuvem({ k: 'cUp', row: { slug, nome: c.nome, icone: c.icone || '•', ordem: lista.findIndex(x => x.slug === slug) } });
  }
  function saveCategory(slug, nome) {
    if (baseCategorias().some(c => c.slug === slug)) S.categories[slug] = Object.assign({}, S.categories[slug], { nome });
    else S.categories[slug] = Object.assign({}, S.categories[slug], { nome, icone: '•' });
    persist();
    empurraCategoria(slug);
  }
  function newCategory(nome) {
    const slug = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('cat-' + Date.now().toString(36));
    S.categories[slug] = { nome, icone: '•' };
    persist();
    empurraCategoria(slug);
    return slug;
  }
  function deleteCategory(slug) {
    const emUso = listProducts(true).filter(p => p.cat === slug).length;
    if (emUso > 0) return emUso;
    if (baseCategorias().some(c => c.slug === slug)) { if (!S.catDeleted.includes(slug)) S.catDeleted.push(slug); }
    delete S.categories[slug];
    if (Array.isArray(S.catOrder)) S.catOrder = S.catOrder.filter(s => s !== slug);
    persist();
    paraNuvem({ k: 'cDel', slug });
    return 0;
  }
  function moveCategory(slug, dir) {
    const ordem = listCategories().map(c => c.slug);
    const i = ordem.indexOf(slug);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordem.length) return;
    const t = ordem[i]; ordem[i] = ordem[j]; ordem[j] = t;
    S.catOrder = ordem;
    persist();
    ordem.forEach((s, idx) => { const c = listCategories().find(x => x.slug === s); paraNuvem({ k: 'cUp', row: { slug: s, nome: c ? c.nome : s, icone: '•', ordem: idx } }); });
  }
  const countByCat = slug => listProducts(true).filter(p => p.cat === slug).length;

  function logOrder(o) {
    const numero = 'EM' + String(S.seq).padStart(4, '0');
    S.seq += 1;
    const pedido = Object.assign({ numero, data: new Date().toISOString(), status: 'Novo', baixado: false }, o);
    S.orders.unshift(pedido);
    persist();
    paraNuvem({ k: 'oNew', o: pedido });
    return pedido;
  }
  const listOrders = () => S.orders;
  function setOrderStatus(numero, status) {
    const ped = S.orders.find(o => o.numero === numero);
    if (!ped) return;
    ped.status = status;
    if ((status === 'Enviado' || status === 'Concluído') && !ped.baixado) {
      (ped.itens || []).forEach(it => adjustStock(it.id, -(it.qtd || 0)));
      ped.baixado = true;
    }
    persist();
    paraNuvem({ k: 'oUpd', o: ped });
  }
  function clients() {
    const mapa = {};
    S.orders.filter(o => o.status !== 'Cancelado').forEach(o => {
      const chave = (o.fone || '').replace(/\D/g, '') || o.nome;
      if (!chave) return;
      if (!mapa[chave]) mapa[chave] = { nome: o.nome || '—', fone: o.fone || '—', compras: 0, total: 0, ultima: null };
      mapa[chave].compras += 1;
      mapa[chave].total += +o.total || 0;
      if (!mapa[chave].ultima || o.data > mapa[chave].ultima) mapa[chave].ultima = o.data;
    });
    return Object.values(mapa).sort((a, b) => b.total - a.total);
  }

  function saveCoupon(cupom) {
    const codigo = String(cupom.codigo || '').trim().toUpperCase();
    if (!codigo) return 'Dê um nome para o cupom (ex: BEMVINDA10).';
    S.coupons[codigo] = { codigo, tipo: cupom.tipo === 'reais' ? 'reais' : 'porcento', valor: Math.max(0, +cupom.valor || 0), validade: cupom.validade || '', minimo: Math.max(0, +cupom.minimo || 0) };
    persist();
    paraNuvem({ k: 'kUp', row: { codigo, tipo: S.coupons[codigo].tipo, valor: S.coupons[codigo].valor, validade: S.coupons[codigo].validade || null, minimo: S.coupons[codigo].minimo } });
    return null;
  }
  function deleteCoupon(codigo) { delete S.coupons[codigo]; persist(); paraNuvem({ k: 'kDel', codigo }); }
  const listCoupons = () => Object.values(S.coupons);
  function validateCoupon(codigo, subtotal) {
    const c = S.coupons[String(codigo || '').trim().toUpperCase()];
    if (!c) return { erro: 'Esse cupom não existe. Confira o código.' };
    if (c.validade && new Date(c.validade + 'T23:59:59') < new Date()) return { erro: 'Esse cupom já venceu.' };
    if (subtotal < (c.minimo || 0)) return { erro: 'Esse cupom vale para compras acima de ' + BRL(c.minimo) + '.' };
    const desc = c.tipo === 'porcento' ? subtotal * (c.valor / 100) : Math.min(subtotal, c.valor);
    return { cupom: c, desconto: Math.round(desc * 100) / 100 };
  }

  const DEFAULT_BANNERS = [
    { tag: 'ENCANTO MIRANDA · NOVA TEMPORADA', titulo: 'Seu estilo,', destaque: 'seu encanto.', texto: 'Peças versáteis, detalhes que fazem a diferença e looks para acompanhar você em todos os momentos.', botao: 'Ver catálogo', link: 'categoria.html?cat=ver-tudo', botao2: 'Ver ofertas especiais', link2: 'categoria.html?cat=sale', foto: '' },
    { tag: 'ENCONTRE SEU LOOK', titulo: 'Elegância em', destaque: 'cada detalhe.', texto: 'Descubra peças que valorizam seu estilo e deixam cada ocasião ainda mais especial.', botao: 'Explorar coleção', link: 'categoria.html?cat=ver-tudo', botao2: '', link2: '', foto: '' },
    { tag: 'ESCOLHAS ESPECIAIS', titulo: 'Seu próximo look', destaque: 'está aqui.', texto: 'Renove seu guarda-roupa com novidades e peças para combinar do seu jeito.', botao: 'Ver novidades', link: 'categoria.html?cat=ver-tudo', botao2: '', link2: '', foto: '' }
  ];
   const DEFAULT_SETTINGS = { whatsapp: '5511968422230', whatsappConfig: { mensagemPedido: 'Olá! Sou [nome], quero finalizar meu pedido [pedido] na [loja].\n\n[itens]\n\nSubtotal: [subtotal]\nDesconto: [desconto]\nCupom: [cupom]\nFrete: [frete]\nTotal: [valor total]\nPagamento: [pagamento]' }, email: 'contato@encantomiranda.com.br', endereco: 'Rua Ponche Verde, 49 — SP', instagram: '', freteGratis: 399, cor: '#78583E', nomeLoja: 'Encanto Miranda', banners: DEFAULT_BANNERS, pagamento: { pix: true, boleto: true, cartao: true, extras: [], mostrarCarrinho: true }, informacoes: { atendimento: 'Atendimento', horarioAtendimento: 'Seg a Sáb, 9h–18h', trocasPrazo: 'Trocas em até 30 dias', prazoEnvio: 'Envio em até 2 dias úteis', envioDetalhe: 'Correios com rastreio', freteGratisAtivo: false, fretePadrao: 0, visiveis: { atendimento: true, horarioAtendimento: true, trocasPrazo: true, prazoEnvio: true, envioDetalhe: true } } };
  const getSettings = () => Object.assign({}, DEFAULT_SETTINGS, S.settings || {}, { whatsappConfig: normalizaWhatsappConfig(Object.assign({}, DEFAULT_SETTINGS.whatsappConfig, (S.settings || {}).whatsappConfig || {})), pagamento: normalizaPagamento(Object.assign({}, DEFAULT_SETTINGS.pagamento, (S.settings || {}).pagamento || {})), informacoes: normalizaInformacoes(Object.assign({}, DEFAULT_SETTINGS.informacoes, (S.settings || {}).informacoes || {})) });
  function saveSettings(novas) { S.settings = Object.assign({}, getSettings(), novas); persist(); paraNuvem({ k: 'sUp' }); }

  // aplica tudo nas listas globais que a loja usa (chamar antes de renderizar)
  function applyToShop() {
    if (typeof PRODUTOS !== 'undefined') {
      const lista = listProducts(false);
      PRODUTOS.length = 0;
      lista.forEach(p => PRODUTOS.push(p));
    }
    if (typeof CATEGORIAS !== 'undefined') {
      const lista = listCategories();
      CATEGORIAS.length = 0;
      lista.forEach(c => CATEGORIAS.push(c));
    }
    if (!window.__imgWrapped && typeof imgProduto === 'function') {
      const original = imgProduto;
      imgProduto = function (p, n) {
        n = n || 1;
        try {
          if (p && Array.isArray(p.fotos) && p.fotos.length) return p.fotos[Math.min(Math.max(n - 1, 0), p.fotos.length - 1)];
          if (p && typeof p.foto === 'string' && p.foto.trim().startsWith('[')) {
            try { const a = JSON.parse(p.foto); if (Array.isArray(a) && a.length) return a[Math.min(Math.max(n - 1, 0), a.length - 1)]; } catch {}
          }
        } catch {}
        if (p && p.foto && typeof p.foto === 'string' && !p.foto.trim().startsWith('[')) return p.foto;
        return SEM_FOTO;
      };
      window.__imgWrapped = true;
    }
  }

  function resetAll() { S = blank(); persist(); }

  const SEM_FOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#EEE4D8"/><text x="150" y="195" font-family="Georgia,serif" font-size="22" fill="#9A8978" text-anchor="middle">Sem foto</text><text x="150" y="220" font-family="Arial" font-size="12" fill="#B8AFA4" text-anchor="middle">adicione uma foto no painel</text></svg>');

  const pendencias = () => { try { return JSON.parse(localStorage.getItem('em_outbox') || '[]').length; } catch { return 0; } };

  return { listProducts, getProduct, saveProduct, deleteProduct, adjustStock, setStock, listCategories, saveCategory, newCategory, deleteCategory, moveCategory, countByCat, logOrder, listOrders, setOrderStatus, clients, saveCoupon, deleteCoupon, listCoupons, validateCoupon, getSettings, saveSettings, applyToShop, resetAll, semFoto: SEM_FOTO, ready: pronto, puxarNuvem, sincronizar, nuvem: nuvemLigada, pendencias };
})();
if (typeof DB !== 'undefined' && typeof PRODUTOS !== 'undefined') DB.applyToShop();
