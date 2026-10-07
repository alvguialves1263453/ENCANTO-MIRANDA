// Encanto Miranda — catálogo de moda feminina
// NUVEM MANDA: base zerada de propósito — Supabase vazio = site vazio.
const CATEGORIAS = [];

const PRODUTOS = [
  {id:1, nome:'VESTIDO PRAIANO ALÇA REGULÁVEL', preco:35, antigo:null, cat:'vestidos', selo:'lanc', cores:['Preto','Laranja','Verde','Marrom','Rosa'], tams:['P','M','G'], estoque:169, tecido:'Malha Liz Premium - veste 36 ao 44 - sem bojo - forro duplo no busto', desc:'Vestido leve e fresquinho, um dos mais queridos da loja.'},
  {id:2, nome:'CALÇA BOLSO CHAPADO PREMIUM', preco:65, antigo:null, cat:'jeans', selo:'lanc', cores:['Azul Clara','Azul Escura','Preta'], tams:['36','38','40','42','44'], estoque:84, tecido:'Jeans premium com elastano', desc:'Modelagem que valoriza o corpo, bolso chapado funcional.'},
  {id:3, nome:'CALÇA BALLON DUO CINTURA ALTA', preco:70, antigo:null, cat:'calcas', selo:'lanc', cores:['Bege','Preta','Off'], tams:['P','M','G'], estoque:62, tecido:'Alfaiataria premium', desc:'Calça ballon tendência, cintura alta com dois botões.'},
  {id:4, nome:'CROPPED MIA OMBRO A OMBRO DRAPEADO', preco:17, antigo:null, cat:'croppeds', selo:'lanc', cores:['Branca','Preta','Rosa','Verde'], tams:['P','M','G'], estoque:220, tecido:'Suplex + drapeado frontal', desc:'Cropped ombro a ombro mais vendido da semana.'},
  {id:5, nome:'BLUSA ANGEL ALCINHA', preco:15, antigo:null, cat:'bodys', selo:'lanc', cores:['Branca','Preta','Nude'], tams:['P','M','G'], estoque:310, tecido:'Ribaninha premium', desc:'Básica que não pode faltar: alcinha com ótimo caimento.'},
  {id:6, nome:'VESTIDO BORBOLETA MIDI OMBRO SÓ', preco:35, antigo:null, cat:'vestidos', selo:'lanc', cores:['Estampada','Preta','Terracota'], tams:['P','M','G'], estoque:95, tecido:'Malha fria estampada', desc:'Midi ombro só, elegante para qualquer ocasião.'},
  {id:7, nome:'VESTIDO MARMORIZADO ESTER', preco:35, antigo:null, cat:'tropical', selo:'lanc', cores:['Marmorizada Azul','Marmorizada Rosa'], tams:['P','M','G'], estoque:77, tecido:'Viscose marmorizada', desc:'Estampa exclusiva marmorizada.'},
  {id:8, nome:'SHORTS LISTRINHA COM ELÁSTICO', preco:18, antigo:null, cat:'calcas', selo:'lanc', cores:['Listrado P/B','Bege'], tams:['P','M','G','GG'], estoque:140, tecido:'Viscolinho listrado', desc:'Short fresquinho, ideal para verão.'},
  {id:9, nome:'CALÇA MONTARIA SUPLEX FLANELADO', preco:20, antigo:35, cat:'inverno', selo:'promo', cores:['Preta','Grafite'], tams:['P','M','G','GG'], estoque:200, tecido:'Suplex flanelado', desc:'A queridinha do inverno com 42% OFF.'},
  {id:10, nome:'BODY PLUS ISIS BICOLOR ALCINHA', preco:10, antigo:28, cat:'plus', selo:'promo', cores:['Preto/Branco','Marrom/Bege'], tams:['G','GG'], estoque:150, tecido:'Suplex bicolor', desc:'Queima de estoque plus: de R$28 por R$10.'},
  {id:11, nome:'BODY TOMARA QUE CAIA ANARRUGA', preco:15, antigo:18, cat:'bodys', selo:'promo', cores:['Preta','Branca','Chocolate'], tams:['P','M','G'], estoque:180, tecido:'Anarruga', desc:'Tomara que caia liso, não amassa.'},
  {id:12, nome:'KIMONO LISTRADO (somente kimono)', preco:20, antigo:30, cat:'tropical', selo:'promo', cores:['Listrado'], tams:['Único'], estoque:60, tecido:'Viscose leve', desc:'Terceira peça que agrega valor no look.'},
  {id:13, nome:'VESTIDO SOL COM BABADO', preco:28, antigo:null, cat:'vestidos', selo:'lanc', cores:['Amarelo','Laranja','Off'], tams:['P','M','G'], estoque:110, tecido:'Malha fria', desc:'Rodado com babado, ótimo giro.'},
  {id:14, nome:'BLUSA MARIA MULA DRAPEADA', preco:17, antigo:null, cat:'bodys', selo:'lanc', cores:['Café','Preta','Off'], tams:['P','M','G'], estoque:130, tecido:'Mula drapeada', desc:'Blusa com drapeado lateral que disfarça.'},
  {id:15, nome:'CAMISETA COM RENDA NA BARRA', preco:25, antigo:null, cat:'bodys', selo:'lanc', cores:['Branca','Preta'], tams:['P','M','G','GG'], estoque:90, tecido:'Viscolycra + renda', desc:'Camiseta com detalhe renda premium.'},
  {id:16, nome:'CONJUNTO NEW YORK CROPPED + SHORT', preco:45, antigo:60, cat:'vestidos', selo:'promo', cores:['Preto','Cinza','Bege'], tams:['P','M','G'], estoque:55, tecido:'Moletom fino', desc:'Conjunto 25% OFF, peça certeira para o inverno.'},
  {id:17, nome:'CALÇA CARGO JEANS', preco:65, antigo:null, cat:'jeans', selo:null, cores:['Lavagem Clara','Lavagem Escura'], tams:['36','38','40','42'], estoque:70, tecido:'Jeans cargo com bolso lateral', desc:'Cargo jeans utilitária.'},
  {id:18, nome:'MACACÃO NINA COSTAS NUA', preco:25, antigo:null, cat:'calcas', selo:'lanc', cores:['Preto','Verde Militar','Terracota'], tams:['P','M','G'], estoque:88, tecido:'Bengaline', desc:'Macacão costas nua com amarração.'},
  {id:19, nome:'BIQUINI DE FITA SUPLEX', preco:20, antigo:null, cat:'biquini', selo:null, cores:['Preto','Neon','Estampado'], tams:['P','M','G'], estoque:120, tecido:'Suplex', desc:'Biquini fita regulável.'},
  {id:20, nome:'BLUSA GOLA REDONDA PELUCIADA', preco:25, antigo:null, cat:'inverno', selo:null, cores:['Off','Rosa BB','Cinza'], tams:['P','M','G','GG'], estoque:100, tecido:'Moletom peluciado', desc:'Quentinha e macia para o frio.'},
  {id:21, nome:'SAIA JADE ESTAMPADA', preco:25, antigo:null, cat:'calcas', selo:null, cores:['Estampada'], tams:['P','M','G'], estoque:75, tecido:'Viscose', desc:'Saia midi estampada.'},
  {id:22, nome:'VESTIDO SERENA SUPLEX', preco:30, antigo:null, cat:'mais-vendidos', selo:null, cores:['Preto','Vinho','Azul Marinho'], tams:['P','M','G'], estoque:134, tecido:'Suplex grosso', desc:'Básico que vende o ano todo.'},
  {id:23, nome:'PLUS VESTIDO LUD MIDI', preco:35, antigo:null, cat:'plus', selo:null, cores:['Preto','Estampado'], tams:['G','GG'], estoque:66, tecido:'Suplex plus', desc:'Midi plus com ótimo caimento.'},
  {id:24, nome:'CALÇA BRILHO WIDE LEG', preco:85, antigo:null, cat:'mais-vendidos', selo:'lanc', cores:['Preta','Champanhe'], tams:['P','M','G'], estoque:40, tecido:'Brilho lurex', desc:'Peça festa com maior margem.'},
];

function fotosDoProduto(p){
  if (!p) return [];
  if (Array.isArray(p.fotos) && p.fotos.length) return p.fotos;
  if (p && typeof p.foto === 'string' && p.foto.startsWith('[')) {
    try { const a = JSON.parse(p.foto); if (Array.isArray(a) && a.length) return a; } catch {}
  }
  if (p && p.foto) return [p.foto];
  return [];
}
const IMG_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#EEE4D8"/><text x="300" y="390" font-family="Georgia,serif" font-size="28" fill="#9A8978" text-anchor="middle">Sem foto</text><text x="300" y="420" font-family="Arial" font-size="14" fill="#B8AFA4" text-anchor="middle">adicione uma foto no painel</text></svg>');
function imgProduto(p, n=1){
  const arr = fotosDoProduto(p);
  if (arr.length) return arr[Math.min(Math.max(n - 1, 0), arr.length - 1)];
  try { if (typeof DB !== 'undefined' && DB.semFoto) return DB.semFoto; } catch {}
  return IMG_PLACEHOLDER;
}
function parcelasDoProduto(p){
  const n = Math.round(+(p && p.parcelas) || 6);
  return Math.min(12, Math.max(1, n));
}
function textoParcela(p){
  const n = parcelasDoProduto(p);
  if (n <= 1) return 'À vista ' + BRL(p.preco);
  return n + 'x de ' + BRL(p.preco * 1.09 / n);
}
function catNome(slug){
  const c = CATEGORIAS.find(x=>x.slug===slug);
  return c ? c.nome : slug.toUpperCase();
}
function prodById(id){ return PRODUTOS.find(p=>String(p.id)===String(id)); }
