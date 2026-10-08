// JS global Encanto Miranda
const BRL = v => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function telefoneExibicao(valor){
  const d=String(valor||'').replace(/\D/g,'');
  if(d.length===13 && d.startsWith('55')) return `(${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if(d.length===12 && d.startsWith('55')) return `(${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  if(d.length===11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if(d.length===10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return String(valor||'');
}
const getCart = () => { try{return JSON.parse(localStorage.getItem('em_cart')||'[]')}catch{return[]} };
const saveCart = c => { localStorage.setItem('em_cart', JSON.stringify(c)); updateCartBadge(); };
function codigoBuscaProduto(id){const s=String(id==null?'':id);if(/^p\d+$/i.test(s))return 'P'+s.slice(1);let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return 'P'+(h%60466176).toString(36).toUpperCase().padStart(5,'0');}
function descricaoSegura(valor){
  const s=String(valor==null?'':valor); if(!s.includes('<')) return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  const box=document.createElement('div'); box.innerHTML=s; const ok=new Set(['B','STRONG','I','EM','U','BR','P','DIV','SPAN','FONT']);
  box.querySelectorAll('*').forEach(el=>{ if(!ok.has(el.tagName)){el.replaceWith(document.createTextNode(el.textContent||''));return;} [...el.attributes].forEach(a=>{const f=el.tagName==='FONT'&&(a.name==='size'||(a.name==='color'&&/^#[0-9a-f]{3,8}$/i.test(a.value)));if(a.name!=='style'&&!f)el.removeAttribute(a.name);}); if(el.hasAttribute('style')){const st=String(el.getAttribute('style')).split(';').filter(x=>/^(\s*)(color|font-size|font-weight|text-align)\s*:/i.test(x)).join(';');st?el.setAttribute('style',st):el.removeAttribute('style');}});
  return box.innerHTML;
}
// O banco local (loja-db.js) já se aplica sozinho ao carregar.
function updateCartBadge(){
  const c = getCart();
  const qtd = c.reduce((s,i)=>s+i.qtd,0);
  document.querySelectorAll('.cart-count').forEach(el=>el.textContent=qtd);
}
function toast(msg){
  let t=document.querySelector('.toast');
  if(!t){ t=document.createElement('div'); t.className='toast'; document.body.appendChild(t); }
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.remove('show'),2200);
}
function addToCart(id, cor='', tam='', qtd=1){
  try {
    const p = (typeof prodById === 'function') ? prodById(id) : null;
    if (p && !(+p.estoque > 0)) { toast('Produto esgotado'); return; }
  } catch {}
  const cart=getCart();
  const key=`${id}|${cor}|${tam}`;
  const ex=cart.find(i=>i.key===key);
  if(ex) ex.qtd+=qtd; else cart.push({key,id: (typeof prodById === 'function' && prodById(id)) ? prodById(id).id : id,cor,tam,qtd});
  saveCart(cart); toast('Adicionado à sacola');
}
function cardHTML(p){
  const esgotado = !(+p.estoque > 0);
  const off = (!esgotado && p.antigo) ? Math.round((1-p.preco/p.antigo)*100) : 0;
  const selo = esgotado ? '<span class="selo selo-esgotado">Esgotado</span>' : p.selo==='lanc' ? '<span class="selo lanc">Novo</span>' : p.selo==='promo' ? '<span class="selo promo">Sale</span>' : (p.cat==='sale'||p.antigo?'<span class="selo sale">Sale</span>':'');
  // hover troca para a 2ª foto (quando o produto tem galeria)
  const gal = (typeof fotosDoProduto==='function') ? fotosDoProduto(p) : [imgProduto(p,1)];
  const f1 = gal[0] || imgProduto(p,1);
  const f2 = gal[1] || '';
  const hoverImg = (!esgotado && f2 && f2!==f1) ? `<img class="foto-2" loading="lazy" src="${f2}" alt="" aria-hidden="true">` : '';
  const idAttr = String(p.id).replace(/"/g, '');
  const cor0 = (p.cores && p.cores[0] || '').replace(/'/g, '');
  const tam0 = (p.tams && p.tams[0] || '').replace(/'/g, '');
  const btn = esgotado
    ? `<button class="btn btn-esgotado" disabled>Esgotado</button>`
    : `<button class="btn btn-rosa" onclick="addToCart('${idAttr}','${cor0}','${tam0}',1)">Adicionar</button>`;
  return `<div class="card${esgotado ? ' esgotado' : ''}">
    <a class="card-img" href="produto.html?id=${encodeURIComponent(p.id)}" ${esgotado ? 'aria-disabled="true"' : ''}>
      ${selo}${off?`<span class="off">-${off}%</span>`:''}
      <img class="foto-1" loading="lazy" src="${f1}" alt="${p.nome}">${hoverImg}
    </a>
    <div class="card-body">
      <h3><a href="produto.html?id=${encodeURIComponent(p.id)}">${p.nome}</a></h3>
      ${p.antigo?`<div class="preco-ant">${BRL(p.antigo)}</div>`:''}
      <div class="preco">${BRL(p.preco)}</div>
      <div class="parc">${(typeof textoParcela==='function') ? textoParcela(p) : ('6x de ' + BRL(p.preco*1.09/6))}</div>
      ${btn}
    </div>
  </div>`;
}
function renderGrade(el, lista){
  if(!el) return;
  // anti-duplicado: mesmo id aparece uma vez por grade
  const vistos = new Set();
  const unicos = (lista || []).filter(p => {
    const k = String(p && p.id);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  el.innerHTML = unicos.length? unicos.map(cardHTML).join('') : '<p>Nenhum produto encontrado.</p>';
  // cards entram com reveal em cascata ao rolar
  el.querySelectorAll('.card').forEach((c,i)=>{
    c.classList.add('reveal');
    c.style.transitionDelay=Math.min(i*70,420)+'ms';
  });
  initReveals();
}
// Reveal on scroll: mostra elementos com .reveal ao entrar na tela
let revealObs=null;
function initReveals(){
  const els=document.querySelectorAll('.reveal:not(.visivel)');
  if(!('IntersectionObserver' in window)){ els.forEach(el=>el.classList.add('visivel')); return; }
  if(!revealObs){
    revealObs=new IntersectionObserver(entries=>{
      entries.forEach(e=>{
        if(!e.isIntersecting) return;
        const t=e.target;
        t.classList.add('visivel');
        revealObs.unobserve(t);
        // limpa o delay da cascata p/ não atrasar o hover depois
        setTimeout(()=>{ t.style.transitionDelay=''; },900);
      });
    },{threshold:.1,rootMargin:'0px 0px -30px 0px'});
  }
  els.forEach(el=>revealObs.observe(el));
}
// header + drawer global
document.addEventListener('DOMContentLoaded', ()=>{
  updateCartBadge();
  const dr=document.getElementById('drawer'), ov=document.getElementById('overlay');
  const openDr=()=>{ if(dr)dr.classList.add('open'); if(ov)ov.classList.add('show'); document.body.classList.add('lock'); };
  const closeDr=()=>{ if(dr)dr.classList.remove('open'); if(ov)ov.classList.remove('show'); document.body.classList.remove('lock'); };
  const bO=document.getElementById('drawerOpen'), bC=document.getElementById('drawerClose');
  if(bO) bO.addEventListener('click',openDr);
  if(bC) bC.addEventListener('click',closeDr);
  if(ov) ov.addEventListener('click',closeDr);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDr(); });
  // (re)monta menus de categorias — chamado no load e quando a nuvem muda
  window.__rebuildMenus=function(){
    try{
      if(typeof CATEGORIAS==='undefined') return;
      const cur=new URLSearchParams(location.search).get('cat')||'';
      const dc=document.getElementById('drawerCats');
      if(dc) dc.innerHTML=CATEGORIAS.map(c=>`<li><a class="${c.slug===cur?'ativo':''}" href="categoria.html?cat=${c.slug}">${c.nome}<span>→</span></a></li>`).join('');
      const wrap=document.querySelector('.nav-categorias .container');
      if(wrap) wrap.innerHTML=CATEGORIAS.map(c=>`<a class="${c.slug===cur?'ativo':''}" href="categoria.html?cat=${c.slug}">${c.nome}</a>`).join('');
    }catch{}
  };
  window.__rebuildMenus();
  // NUVEM MANDA: espera o Supabase terminar (DB.ready) e reconstrói menus/config.
  // Sem isso o site mostra as 12 categorias fixas do data.js por 1-2s mesmo com nuvem vazia.
  try {
    if (typeof DB !== 'undefined' && DB.ready && typeof DB.ready.then === 'function') {
      DB.ready.then(() => { try { window.__rebuildMenus(); } catch {} try { window.__aplicaConfig(); } catch {} });
      // se a lib da nuvem chegar atrasada, tenta de novo em 6s
      setTimeout(() => { try { window.__rebuildMenus(); } catch {} try { window.__aplicaConfig(); } catch {} }, 6000);
    }
  } catch {}
  // Formas de pagamento exibidas na vitrine e no rodapé.
  // A mesma configuração usada pela sacola também controla os textos da loja.
  window.__atualizaFormasPagamento=function(st){
    try{
      st=st||((typeof DB!=='undefined'&&DB.getSettings)?DB.getSettings():{});
      const pg=st.pagamento||{};
      const nomes=[];
      if(pg.pix!==false) nomes.push('Pix');
      if(pg.boleto!==false) nomes.push('Boleto');
      if(pg.cartao!==false) nomes.push('Cartão');
      (Array.isArray(pg.extras)?pg.extras:[]).forEach(n=>{
        const nome=String(n||'').trim();
        if(nome && !nomes.some(x=>x.toLowerCase()===nome.toLowerCase())) nomes.push(nome);
      });
      const texto=nomes.length ? nomes.slice(0,4).join(' • ')+(nomes.length>4?` +${nomes.length-4}`:'') : 'Consulte na sacola';
      document.querySelectorAll('[data-pag-lista]').forEach(el=>{ el.textContent=texto; });
    }catch{}
  };
  // personalização do painel: cor, whatsapp, nome e pagamentos aplicados na loja
  window.__aplicaConfig=function(){
    try{
      if(typeof DB!=='undefined'){
        const st=DB.getSettings();
        if(st.cor){
           document.documentElement.style.setProperty('--brown',st.cor);
           document.documentElement.style.setProperty('--accent',st.cor);
           document.documentElement.style.setProperty('--brown-dark','color-mix(in srgb, '+st.cor+' 62%, black)');
           document.documentElement.style.setProperty('--brown-light','color-mix(in srgb, '+st.cor+' 10%, white)');
        }
          if(st.whatsapp){
            const zap=String(st.whatsapp).replace(/\D/g,'');
            document.querySelectorAll('[data-loja-info="telefone"]').forEach(el=>{ el.textContent=telefoneExibicao(zap); });
            document.querySelectorAll('a[href*="wa.me/"]').forEach(a=>{
              a.href=a.href.replace(/wa\.me\/\d+/, 'wa.me/'+zap);
            });
          }
          document.querySelectorAll('[data-loja-instagram]').forEach(a=>{
            let url='';
            try{
              const parsed=new URL(String(st.instagram||'').trim());
              if(parsed.protocol==='http:' || parsed.protocol==='https:') url=parsed.href;
            }catch{}
            a.hidden=!url;
            a.setAttribute('aria-hidden',url?'false':'true');
            if(url) a.href=url;
          });
          if(st.nomeLoja){
           document.querySelectorAll('.copy').forEach(el=>{ el.innerHTML=el.innerHTML.replace(/Encanto Miranda/g, st.nomeLoja); });
         }
         if(st.endereco){
           document.querySelectorAll('[data-loja-info="endereco"]').forEach(el=>{ el.textContent=st.endereco; });
         }
        const info=st.informacoes||{};
         const infoPadrao={atendimento:'Atendimento',horarioAtendimento:'Seg a Sáb, 9h–18h',trocasPrazo:'Trocas em até 30 dias',prazoEnvio:'Envio em até 2 dias úteis',envioDetalhe:'Correios com rastreio'};
        const visiveis=info.visiveis||{};
          Object.keys(infoPadrao).forEach(k=>{
          const valor=String(info[k]||infoPadrao[k]);
          document.querySelectorAll('[data-info="'+k+'"]').forEach(el=>{
           el.textContent=valor;
           el.style.display=visiveis[k]===false?'none':'';
          });
          const termos=st.termos||{};
          document.querySelectorAll('[data-termo]').forEach(el=>{
            const valor=String(termos[el.dataset.termo]||'').trim();
            if(valor) el.textContent=valor;
          });
         });
         // Não deixa um cartão vazio quando todas as informações dele foram desativadas.
         document.querySelectorAll('.benefit').forEach(card=>{
           const campos=card.querySelectorAll('[data-info]');
           if(!campos.length) return;
           card.style.display=Array.from(campos).some(el=>el.style.display!=='none')?'':'none';
         });
         window.__atualizaFormasPagamento(st);
      }
    }catch{}
  };
  window.__aplicaConfig();
  const fBusca=document.querySelectorAll('.busca');
  fBusca.forEach(f=>{
    const input=f.querySelector('input');
    const sugestoes=document.createElement('div'); sugestoes.className='busca-sugestoes'; sugestoes.hidden=true; f.appendChild(sugestoes);
    const escapar=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const atualizarSugestoes=()=>{
      const termo=String(input.value||'').trim().toLowerCase();
      if(!termo){ sugestoes.hidden=true; sugestoes.innerHTML=''; return; }
      const lista=(typeof DB!=='undefined'&&DB.listProducts?DB.listProducts(false):(typeof PRODUTOS!=='undefined'?PRODUTOS:[])).filter(p=>{
        const busca=[p.nome,p.id,codigoBuscaProduto(p.id)].join(' ').toLowerCase();
        return busca.includes(termo);
      }).slice(0,8);
      sugestoes.innerHTML=lista.map(p=>`<a class="busca-sugestao" href="produto.html?id=${encodeURIComponent(p.id)}"><b>${escapar(p.nome)}</b><small>ID: ${escapar(codigoBuscaProduto(p.id))}</small></a>`).join('')||'<div class="busca-sugestao" style="cursor:default">Nenhum produto encontrado.</div>';
      sugestoes.hidden=false;
    };
    input.addEventListener('input',atualizarSugestoes);
    input.addEventListener('focus',atualizarSugestoes);
    f.addEventListener('submit', e=>{
      e.preventDefault();
      const v=input.value.trim();
      location.href='categoria.html?busca='+encodeURIComponent(v);
    });
    document.addEventListener('click',e=>{if(!f.contains(e.target)) sugestoes.hidden=true;});
  });
  // anima blocos ao rolar: hero, títulos, vitrines, benefícios, painéis
  document.querySelectorAll('main section, .sec-titulo, .benefits, .cats, .filtros, .sidebar, .form-card, .resumo, .prod-grid, .texto, .info-contato, .layout-2, .cart-layout').forEach(el=>el.classList.add('reveal'));
  initReveals();
});


// Navegação editorial compartilhada em todas as páginas
 document.addEventListener('DOMContentLoaded',()=>{
   const header=document.querySelector('.header');
   if(header && typeof CATEGORIAS!=='undefined' && !document.querySelector('.nav-categorias')){
     const nav=document.createElement('nav'); nav.className='nav nav-categorias'; nav.setAttribute('aria-label','Navegação por categorias');
     const wrap=document.createElement('div'); wrap.className='container';
     const atual=new URLSearchParams(location.search).get('cat')||'';
     wrap.innerHTML=CATEGORIAS.map(c=>`<a class="${c.slug===atual?'ativo':''}" href="categoria.html?cat=${c.slug}">${c.nome}</a>`).join('');
     nav.appendChild(wrap); header.insertAdjacentElement('afterend',nav);
   }
 });
