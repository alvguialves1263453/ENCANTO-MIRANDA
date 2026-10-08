// Encanto Miranda — conexão com o banco na nuvem (Supabase)
// Usa a chave PÚBLICA (anon). A chave secreta NUNCA vai para o site.
// Se a internet/Supabase falhar, SB.ok fica false e a loja usa a cópia local.
const SB = (() => {
  const URL = 'https://qccboyqaskaiphlskmpa.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjY2JveXFhc2thaXBobHNrbXBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDMxMjQsImV4cCI6MjEwNjE3OTEyNH0.gBXTJ5G_CBOJT5WHVdie6nKYlNy9JD8ANOuwU8I3cOk';
  let client = null;
  function cli() {
    if (!client) {
      try {
        if (window.supabase && window.supabase.createClient) {
          client = window.supabase.createClient(URL, ANON);
        }
      } catch { client = null; }
    }
    return client;
  }
  const ok = () => !!cli();
  async function login(email, senha) {
    const c = cli();
    if (!c) return { erro: 'Sem conexão com a nuvem.' };
    const { error } = await c.auth.signInWithPassword({ email, password: senha });
    return error ? { erro: 'E-mail ou senha errados.' } : {};
  }
  async function logout() { try { const c = cli(); if (c) await c.auth.signOut(); } catch {} }
  async function senha(nova) {
    const c = cli();
    if (!c) return { erro: 'Sem conexão.' };
    const { error } = await c.auth.updateUser({ password: nova });
    return error ? { erro: 'Não consegui trocar. Tente de novo.' } : {};
  }
  async function session() {
    const c = cli();
    if (!c) return null;
    try { const { data } = await c.auth.getSession(); return data.session || null; }
    catch { return null; }
  }
  async function ler(tabela, ordem) {
    const c = cli();
    if (!c) throw new Error('offline');
    let q = c.from(tabela).select('*');
    if (ordem) q = q.order(ordem.col, { ascending: ordem.asc !== false });
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  async function lerUm(tabela, coluna, valor) {
    const c = cli();
    if (!c) throw new Error('offline');
    const { data, error } = await c.from(tabela).select('*').eq(coluna, valor).maybeSingle();
    if (error) throw error;
    return data || null;
  }
  async function rpc(nome, parametros) {
    const c = cli();
    if (!c) throw new Error('offline');
    const { data, error } = await c.rpc(nome, parametros || {});
    if (error) throw error;
    return data;
  }
  async function gravar(tabela, linha, opcoes) {
    const c = cli();
    if (!c) throw new Error('offline');
    // Visitantes só precisam criar pedidos. `returning: minimal` evita que
    // o PostgREST tente ler a linha criada, mantendo a leitura de pedidos
    // protegida para administradores autenticados.
    const query = (tabela === 'pedidos' && opcoes && opcoes.apenasInserir)
      ? c.from(tabela).insert(linha, { returning: 'minimal' })
      : c.from(tabela).upsert(linha);
    const { error } = await query;
    if (error) throw error;
  }
  async function apagar(tabela, coluna, valor) {
    const c = cli();
    if (!c) throw new Error('offline');
    const { error } = await c.from(tabela).delete().eq(coluna, valor);
    if (error) throw error;
  }
  async function foto(file, nome) {
    const c = cli();
    if (!c) throw new Error('offline');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
    const caminho = 'produtos/' + nome + '.' + ext;
    const { error } = await c.storage.from('fotos').upload(caminho, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    return c.storage.from('fotos').getPublicUrl(caminho).data.publicUrl;
  }
  function vivo(timeoutMs) {
    const c0 = cli();
    if (!c0) return Promise.resolve('OFFLINE');
    timeoutMs = timeoutMs || 9000;
    const c = cli();
    if (!c) return Promise.resolve('OFFLINE');
    return new Promise((resolve) => {
      let done = false;
      const canal = c.channel('teste-' + Date.now().toString(36));
      const t = setTimeout(() => { if (!done) { done = true; try { c.removeChannel(canal); } catch {} resolve('TIMEOUT'); } }, timeoutMs);
      try {
        canal.subscribe((status) => {
          if (!done && status) { done = true; clearTimeout(t); try { c.removeChannel(canal); } catch {} resolve(status); }
        });
      } catch { done = true; clearTimeout(t); resolve('ERROR'); }
    });
  }
  function aoMudar(tabelas, cb) {
    const c = cli();
    if (!c) return null;
    try {
      const canal = c.channel('loja-sync');
      tabelas.forEach(t => canal.on('postgres_changes', { event: '*', schema: 'public', table: t }, cb));
      canal.subscribe();
      return canal;
    } catch { return null; }
  }
  function presencaAdmin(cb) {
    const c = cli();
    if (!c || typeof cb !== 'function') return () => {};
    const key = 'admin-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const canal = c.channel('encanto-admin-presence', { config: { presence: { key } } });
    const atualizar = () => {
      try { cb(Object.keys(canal.presenceState()).length); } catch {}
    };
    canal.on('presence', { event: 'sync' }, atualizar);
    canal.on('presence', { event: 'join' }, atualizar);
    canal.on('presence', { event: 'leave' }, atualizar);
    canal.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        try { await canal.track({ painel: true, online_at: new Date().toISOString() }); } catch {}
        atualizar();
      }
    });
    return () => { try { c.removeChannel(canal); } catch {} };
  }

  return { ok, login, logout, senha, session, ler, lerUm, rpc, gravar, apagar, foto, aoMudar, presencaAdmin, vivo };
})();
