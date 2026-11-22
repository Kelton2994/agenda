import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLICA } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (s) => document.querySelector(s);

const STATUS = {
  a_fazer: 'A fazer',
  fazendo: 'Fazendo',
  pausado: 'Pausado',
  aguardando: 'Aguardando alguém',
  concluido: 'Concluído',
};

let tarefas = [];
let aba = 'hoje';
let editandoId = null;
let pausandoId = null;
let prazoSel = 'hoje';
let tipoSel = 'simples';
let logado = false;
let canal = null;

/* ---------- datas ---------- */
function isoLocal(d) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}
const hoje = () => isoLocal(new Date());
const amanha = () => { const d = new Date(); d.setDate(d.getDate() + 1); return isoLocal(d); };
function fmtData(iso) {
  if (!iso) return '';
  if (iso === hoje()) return 'Hoje';
  if (iso === amanha()) return 'Amanhã';
  const [a, m, d] = iso.split('-');
  return a === String(new Date().getFullYear()) ? `${d}/${m}` : `${d}/${m}/${a}`;
}
function fmtHora(ts) {
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function paraInputLocal(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
const agoraISO = () => new Date().toISOString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- aviso ---------- */
let tToast;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(tToast);
  tToast = setTimeout(() => (t.hidden = true), 3500);
}

/* ---------- confirmação do próprio app ---------- */
function confirmar(mensagem, textoOk = 'Confirmar', perigo = false) {
  return new Promise((resolve) => {
    const dlg = $('#dlg-confirma');
    $('#confirma-msg').textContent = mensagem;
    const ok = $('#confirma-ok');
    ok.textContent = textoOk;
    ok.className = 'btn ' + (perigo ? 'perigo-forte' : 'primario');
    const fim = (v) => { dlg.close(); ok.onclick = null; $('#confirma-cancelar').onclick = null; resolve(v); };
    ok.onclick = () => fim(true);
    $('#confirma-cancelar').onclick = () => fim(false);
    dlg.oncancel = (e) => { e.preventDefault(); fim(false); };
    dlg.showModal();
  });
}

/* ---------- login ---------- */
function msgLogin(m) { $('#login-msg').textContent = m; }
function traduz(e) {
  const m = (e?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail pelo link enviado e tente de novo.';
  if (m.includes('already registered')) return 'Esse e-mail já tem conta. Use "Entrar".';
  if (m.includes('signups not allowed')) return 'Criação de contas está desligada.';
  if (m.includes('password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  return e?.message || 'Algo deu errado. Tente de novo.';
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  msgLogin('');
  const { error } = await sb.auth.signInWithPassword({
    email: $('#login-email').value.trim(),
    password: $('#login-senha').value,
  });
  if (error) msgLogin(traduz(error));
});

$('#btn-criar-conta').addEventListener('click', async () => {
  const email = $('#login-email').value.trim();
  const password = $('#login-senha').value;
  if (!email || password.length < 6) { msgLogin('Preencha o e-mail e uma senha de pelo menos 6 caracteres.'); return; }
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) msgLogin(traduz(error));
  else if (!data.session) msgLogin('Conta criada! Abra o link que chegou no seu e-mail e depois clique em Entrar.');
});

$('#btn-sair').addEventListener('click', async () => {
  if (await confirmar('Sair da conta neste aparelho?', 'Sair')) await sb.auth.signOut();
});

function mostrar(session) {
  if (session && !logado) {
    logado = true;
    $('#tela-login').hidden = true;
    $('#tela-app').hidden = false;
    carregar();
    assinar();
    ativarNotificacoes(false);
  } else if (!session) {
    logado = false;
    tarefas = [];
    notas = [];
    if (canal) { sb.removeChannel(canal); canal = null; }
    $('#tela-app').hidden = true;
    $('#tela-login').hidden = false;
  }
}

/* ---------- dados ---------- */
async function carregar() {
  const [abertas, feitas] = await Promise.all([
    sb.from('tarefas').select('*').neq('status', 'concluido')
      .order('prazo', { ascending: true, nullsFirst: false })
      .order('criado_em', { ascending: true }),
    sb.from('tarefas').select('*').eq('status', 'concluido')
      .order('concluido_em', { ascending: false }).limit(200),
  ]);
  const erro = abertas.error || feitas.error;
  if (erro) { toast('Erro ao carregar: ' + erro.message); return; }
  tarefas = [...abertas.data, ...feitas.data];
  render();
  verificarLembretes();
}

let tRecarga;
function agendarRecarga() { clearTimeout(tRecarga); tRecarga = setTimeout(carregar, 300); }

function assinar() {
  canal = sb.channel('tarefas-mudancas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tarefas' }, agendarRecarga)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notas' }, () => agendarNotas())
    .subscribe();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && logado) carregar();
});

async function atualizar(id, campos, recarregar = true) {
  const { error } = await sb.from('tarefas').update({ ...campos, atualizado_em: agoraISO() }).eq('id', id);
  if (error) { toast('Não salvou: ' + error.message); return false; }
  if (recarregar) await carregar();
  return true;
}

/* ---------- ações rápidas ---------- */
async function comecar(id) {
  const outras = tarefas.filter((t) => t.status === 'fazendo' && t.id !== id);
  if (outras.length) {
    await sb.from('tarefas').update({ status: 'pausado', atualizado_em: agoraISO() })
      .eq('status', 'fazendo').neq('id', id);
  }
  await atualizar(id, { status: 'fazendo' });
  if (outras.length) toast(`"${outras[0].titulo}" foi para Pausadas`);
}

async function concluir(id) {
  if (await atualizar(id, { status: 'concluido', concluido_em: agoraISO() })) toast('Concluída ✓');
}

async function pularAmanha(id) {
  if (await atualizar(id, { prazo: amanha() })) toast('Passou para amanhã');
}

async function reabrir(id) {
  await atualizar(id, { status: 'a_fazer', concluido_em: null });
}

function abrirPausa(t) {
  pausandoId = t.id;
  $('#pausa-nome').textContent = t.titulo;
  $('#p-notas').value = t.notas || '';
  $('#dlg-pausa').showModal();
}

$('#form-pausa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = pausandoId;
  $('#dlg-pausa').close();
  await atualizar(id, { status: 'pausado', notas: $('#p-notas').value.trim() || null });
});
$('#btn-pausa-cancelar').addEventListener('click', () => $('#dlg-pausa').close());

/* ---------- tela ---------- */
function card(t) {
  const h = hoje();
  const feita = t.status === 'concluido';
  const atrasada = !feita && t.prazo && t.prazo < h;
  const chips = [`<span class="chip st-${t.status}">${STATUS[t.status]}</span>`];
  if (t.prazo && !feita) chips.push(`<span class="chip ${atrasada ? 'chip-perigo' : ''}">📅 ${atrasada ? 'Atrasada · ' : ''}${fmtData(t.prazo)}</span>`);
  if (t.quem_pediu) chips.push(`<span class="chip">👤 ${esc(t.quem_pediu)}</span>`);
  if (t.lembrar_em && !feita) chips.push(`<span class="chip">${t.tipo_aviso === 'alarme' ? '⏰' : '🔔'} ${fmtHora(t.lembrar_em)}</span>`);
  if (feita && t.concluido_em) chips.push(`<span class="chip">✓ ${fmtHora(t.concluido_em)}</span>`);

  const nota = t.notas
    ? `<p class="nota">${t.status === 'pausado' ? '<b>Parou em:</b> ' : ''}${esc(t.notas)}</p>`
    : '';

  let acoes;
  if (feita) {
    acoes = `<button data-acao="reabrir">↺ Reabrir</button>`;
  } else {
    acoes = [
      t.status === 'fazendo'
        ? `<button data-acao="pausar">⏸ Pausar</button>`
        : `<button data-acao="fazer">▶ ${t.status === 'pausado' ? 'Retomar' : 'Fazer'}</button>`,
      `<button data-acao="concluir" class="ok">✓ Concluir</button>`,
      t.prazo !== amanha() ? `<button data-acao="amanha">→ Amanhã</button>` : '',
    ].join('');
  }

  const classes = ['card', `s-${t.status}`, atrasada ? 'atrasada' : '', t.status === 'fazendo' ? 'fazendo' : '', feita ? 'feita' : ''].join(' ');
  return `<article class="${classes}" data-id="${t.id}">
    <div class="card-corpo" data-acao="editar">
      <h3>${esc(t.titulo)}</h3>
      <div class="chips-linha">${chips.join('')}</div>
      ${nota}
    </div>
    <div class="card-acoes">${acoes}</div>
  </article>`;
}

function secao(titulo, itens, classe = '') {
  if (!itens.length) return '';
  return `<div class="secao-titulo ${classe}"><span><i class="ponto"></i>${titulo}</span><span class="contador">${itens.length}</span></div>${itens.map(card).join('')}`;
}

function filtroBusca(lista) {
  const q = $('#busca').value.trim().toLowerCase();
  if (!q) return lista;
  return lista.filter((t) => `${t.titulo} ${t.quem_pediu || ''} ${t.notas || ''}`.toLowerCase().includes(q));
}

function render() {
  const h = hoje();
  const am = amanha();
  const abertas = tarefas.filter((t) => t.status !== 'concluido');
  const atrasadas = abertas.filter((t) => t.prazo && t.prazo < h);
  const paraHoje = abertas.filter((t) => t.prazo === h);
  const pausadas = abertas.filter((t) => t.status === 'pausado');
  $('#resumo').innerHTML = `
    <div class="tile ${atrasadas.length ? 'tile-perigo' : ''}"><b>${atrasadas.length}</b><span>Atrasadas</span></div>
    <div class="tile"><b>${paraHoje.length}</b><span>Pra hoje</span></div>
    <div class="tile ${pausadas.length ? 'tile-alerta' : ''}"><b>${pausadas.length}</b><span>Pausadas</span></div>
    <div class="tile"><b>${abertas.length}</b><span>Abertas</span></div>`;
  const hora = new Date().getHours();
  $('#saudacao').textContent = hora < 12 ? 'Bom dia 👋' : hora < 18 ? 'Boa tarde 👋' : 'Boa noite 👋';
  const dataTxt = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#data-hoje').textContent = dataTxt.charAt(0).toUpperCase() + dataTxt.slice(1);

  if (aba === 'notas') return;
  let html = '';
  if (aba === 'hoje') {
    const usados = new Set();
    const pega = (fn) => abertas.filter((t) => !usados.has(t.id) && fn(t)).map((t) => (usados.add(t.id), t));
    html += secao('Atrasadas', pega((t) => t.prazo && t.prazo < h), 'perigo');
    html += secao('Fazendo agora', pega((t) => t.status === 'fazendo'));
    html += secao('Para hoje', pega((t) => t.prazo === h));
    html += secao('Pausadas — você parou no meio', pega((t) => t.status === 'pausado'));
    html += secao('Aguardando alguém', pega((t) => t.status === 'aguardando'));
    html += secao('Amanhã', pega((t) => t.prazo === am));
    html += secao('Sem prazo', pega((t) => !t.prazo));
    if (!html) html = `<div class="vazio"><strong>Tudo em dia 🎉</strong>Quando alguém te pedir algo, toque no + e anote na hora.</div>`;
  } else if (aba === 'todas') {
    const lista = filtroBusca(abertas);
    for (const st of ['fazendo', 'pausado', 'a_fazer', 'aguardando']) {
      html += secao(STATUS[st], lista.filter((t) => t.status === st));
    }
    if (!html) html = `<div class="vazio"><strong>Nada encontrado</strong>Nenhuma tarefa aberta${$('#busca').value ? ' com essa busca' : ''}.</div>`;
  } else {
    const lista = filtroBusca(tarefas.filter((t) => t.status === 'concluido'));
    html = secao('Concluídas recentemente', lista) ||
      `<div class="vazio"><strong>Nenhuma concluída ainda</strong>O que você terminar aparece aqui.</div>`;
  }
  $('#lista').innerHTML = html;
}

document.querySelectorAll('.abas button').forEach((b) =>
  b.addEventListener('click', () => {
    aba = b.dataset.aba;
    document.querySelectorAll('.abas button').forEach((x) => x.classList.toggle('ativa', x === b));
    $('#busca-wrap').hidden = aba === 'hoje' || aba === 'notas';
    const emNotas = aba === 'notas';
    $('#lista').hidden = emNotas;
    $('#notas').hidden = !emNotas;
    $('#fab').setAttribute('aria-label', emNotas ? 'Nova nota' : 'Nova tarefa');
    if (emNotas) carregarNotas();
    render();
  })
);
$('#busca').addEventListener('input', render);

$('#lista').addEventListener('click', (e) => {
  const alvo = e.target.closest('[data-acao]');
  const el = e.target.closest('.card');
  if (!alvo || !el) return;
  const t = tarefas.find((x) => x.id === el.dataset.id);
  if (!t) return;
  const acao = alvo.dataset.acao;
  if (acao === 'editar') abrirTarefa(t);
  else if (acao === 'fazer') comecar(t.id);
  else if (acao === 'pausar') abrirPausa(t);
  else if (acao === 'concluir') concluir(t.id);
  else if (acao === 'amanha') pularAmanha(t.id);
  else if (acao === 'reabrir') reabrir(t.id);
});

/* ---------- nova / editar ---------- */
$('#f-status').innerHTML = Object.entries(STATUS).map(([v, n]) => `<option value="${v}">${n}</option>`).join('');

function setPrazo(v) {
  prazoSel = v;
  document.querySelectorAll('#chips-prazo button').forEach((b) => b.classList.toggle('sel', b.dataset.prazo === v));
  $('#f-prazo').hidden = v !== 'data';
  if (v === 'data' && !$('#f-prazo').value) $('#f-prazo').value = hoje();
}
function valorPrazo() {
  if (prazoSel === 'hoje') return hoje();
  if (prazoSel === 'amanha') return amanha();
  if (prazoSel === 'data') return $('#f-prazo').value || null;
  return null;
}
document.querySelectorAll('#chips-prazo button').forEach((b) => b.addEventListener('click', () => setPrazo(b.dataset.prazo)));

document.querySelectorAll('#chips-lembrar button').forEach((b) =>
  b.addEventListener('click', () => {
    const v = b.dataset.lembrar;
    let d = null;
    if (v === '5min') d = new Date(Date.now() + 5 * 60e3);
    if (v === '1h') d = new Date(Date.now() + 3600e3);
    if (v === 'amanha-0630') { d = new Date(); d.setDate(d.getDate() + 1); d.setHours(6, 30, 0, 0); }
    $('#f-lembrar').value = d ? paraInputLocal(d) : '';
  })
);

function setTipo(v) {
  tipoSel = v;
  document.querySelectorAll('#chips-tipo button').forEach((b) => b.classList.toggle('sel', b.dataset.tipo === v));
}
document.querySelectorAll('#chips-tipo button').forEach((b) => b.addEventListener('click', () => setTipo(b.dataset.tipo)));

function abrirTarefa(t = null) {
  setTipo(t?.tipo_aviso ?? 'simples');
  editandoId = t?.id ?? null;
  $('#dlg-titulo').textContent = t ? 'Editar tarefa' : 'Nova tarefa';
  $('#f-titulo').value = t?.titulo ?? '';
  $('#f-quem').value = t?.quem_pediu ?? '';
  $('#f-lembrar').value = paraInputLocal(t?.lembrar_em);
  $('#f-notas').value = t?.notas ?? '';
  $('#f-status').value = t?.status ?? 'a_fazer';
  $('#f-prazo').value = '';
  $('#campos-edicao').hidden = !t;
  $('#btn-excluir').hidden = !t;

  if (!t) setPrazo('hoje');
  else if (!t.prazo) setPrazo('');
  else if (t.prazo === hoje()) setPrazo('hoje');
  else if (t.prazo === amanha()) setPrazo('amanha');
  else { $('#f-prazo').value = t.prazo; setPrazo('data'); }

  const nomes = [...new Set(tarefas.map((x) => x.quem_pediu).filter(Boolean))].sort();
  $('#lista-quem').innerHTML = nomes.map((n) => `<option value="${esc(n)}">`).join('');

  $('#dlg-tarefa').showModal();
}

$('#fab').addEventListener('click', () => (aba === 'notas' ? novaNota() : abrirTarefa()));
$('#btn-cancelar').addEventListener('click', () => $('#dlg-tarefa').close());

$('#form-tarefa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const titulo = $('#f-titulo').value.trim();
  if (!titulo) return;
  const campos = {
    titulo,
    prazo: valorPrazo(),
    quem_pediu: $('#f-quem').value.trim() || null,
    lembrar_em: $('#f-lembrar').value ? new Date($('#f-lembrar').value).toISOString() : null,
    tipo_aviso: tipoSel,
  };

  const btn = $('#btn-salvar');
  btn.disabled = true;
  let ok;
  if (editandoId) {
    const antes = tarefas.find((t) => t.id === editandoId);
    campos.status = $('#f-status').value;
    campos.notas = $('#f-notas').value.trim() || null;
    if (campos.status === 'concluido' && antes?.status !== 'concluido') campos.concluido_em = agoraISO();
    if (campos.status !== 'concluido') campos.concluido_em = null;
    ok = await atualizar(editandoId, campos);
  } else {
    const { error } = await sb.from('tarefas').insert(campos);
    if (error) toast('Não salvou: ' + error.message);
    ok = !error;
    if (ok) await carregar();
  }
  btn.disabled = false;
  if (ok) { $('#dlg-tarefa').close(); if (!editandoId) toast('Anotada ✓'); }
});

$('#btn-excluir').addEventListener('click', async () => {
  const t = tarefas.find((x) => x.id === editandoId);
  if (!t || !(await confirmar(`Excluir "${t.titulo}"? Não dá para desfazer.`, 'Excluir', true))) return;
  const { error } = await sb.from('tarefas').delete().eq('id', t.id);
  if (error) { toast('Não excluiu: ' + error.message); return; }
  $('#dlg-tarefa').close();
  await carregar();
  toast('Excluída');
});

/* ---------- lembretes ---------- */
const NOTIF_KEY = 'agenda-notificados';
function lerNotificados() {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]')); } catch { return new Set(); }
}
function salvarNotificados(s) {
  try { localStorage.setItem(NOTIF_KEY, JSON.stringify([...s].slice(-300))); } catch { /* sem armazenamento */ }
}

// Com o app aberto, mostra um aviso na tela (a notificação do celular vem do servidor)
function avisar(t) {
  toast(`${t.tipo_aviso === 'alarme' ? '⏰' : '🔔'} ${t.titulo}`);
}

function verificarLembretes() {
  const agora = Date.now();
  const ja = lerNotificados();
  let mudou = false;
  for (const t of tarefas) {
    if (t.status === 'concluido' || !t.lembrar_em) continue;
    const chave = `${t.id}|${t.lembrar_em}`;
    if (new Date(t.lembrar_em).getTime() <= agora && !ja.has(chave)) {
      ja.add(chave);
      mudou = true;
      avisar(t);
    }
  }
  if (mudou) salvarNotificados(ja);
}

setInterval(() => { if (logado) { verificarLembretes(); render(); } }, 30000);

/* ---------- notificações (push) ---------- */
function base64ParaBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function atualizarSino() {
  const ok = 'Notification' in window && Notification.permission === 'granted';
  $('#btn-notif').textContent = ok ? '🔔' : '🔕';
}

async function ativarNotificacoes(perguntar) {
  const avisa = (m) => { if (perguntar) toast(m); };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    avisa('Este navegador não suporta notificações. No celular, use o app instalado.');
    return;
  }
  let permissao = Notification.permission;
  if (permissao === 'default' && perguntar) permissao = await Notification.requestPermission();
  atualizarSino();
  if (permissao !== 'granted') {
    avisa('Notificações bloqueadas. Libere em Configurações > Apps > Notificações.');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ParaBytes(VAPID_PUBLICA) });
    const j = sub.toJSON();
    const { error } = await sb.from('push_inscricoes').upsert(
      { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, aparelho: navigator.userAgent.slice(0, 200) },
      { onConflict: 'endpoint' }
    );
    if (error) throw error;
    avisa('Lembretes ativados neste aparelho ✓');
  } catch (e) {
    avisa('Não consegui ativar: ' + (e.message || e));
  }
}

$('#btn-notif').addEventListener('click', () => ativarNotificacoes(true));

/* ---------- notas (post-its) ---------- */
const CORES_NOTA = {
  amarelo: '#fef08a', azul: '#bfdbfe', verde: '#bbf7d0',
  rosa: '#fbcfe8', laranja: '#fed7aa', roxo: '#ddd6fe',
};
const DESTAQUES = { importante: '⭐ Importante', urgente: '🔴 Urgente' };
let notas = [];
let notaEditandoId = null;
let corNotaSel = 'amarelo';
let destaqueSel = '';
const ehQuadro = () => window.matchMedia('(min-width: 900px)').matches;
const corDe = (n) => CORES_NOTA[n.cor] || CORES_NOTA.amarelo;
const maxZ = () => notas.reduce((m, n) => Math.max(m, n.z || 0), 0);

// Texto com negrito: só deixa passar formatação simples (segurança)
const TAGS_OK = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SPAN']);
function limparHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const limpar = (no) => {
    [...no.childNodes].forEach((f) => {
      if (f.nodeType === 3) return;
      if (f.nodeType !== 1 || !TAGS_OK.has(f.tagName)) {
        if (f.nodeType === 1) { limpar(f); f.replaceWith(...f.childNodes); } else f.remove();
        return;
      }
      const negrito = f.tagName === 'SPAN' && /font-weight:\s*(bold|[6-9]00)/i.test(f.getAttribute('style') || '');
      [...f.attributes].forEach((a) => f.removeAttribute(a.name));
      limpar(f);
      if (f.tagName === 'SPAN') {
        if (negrito) { const b = doc.createElement('b'); b.append(...f.childNodes); f.replaceWith(b); }
        else f.replaceWith(...f.childNodes);
      }
    });
  };
  const raiz = doc.body.firstChild;
  limpar(raiz);
  return raiz.innerHTML;
}
// notas antigas eram texto puro
const htmlDaNota = (n) => {
  const t = n.texto || '';
  return /<[a-z][\s\S]*>/i.test(t) ? limparHtml(t) : esc(t).replace(/\n/g, '<br>');
};
const textoPuro = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.trim(); };

async function carregarNotas() {
  const { data, error } = await sb.from('notas').select('*').order('z', { ascending: true });
  if (error) { toast('Erro nas notas: ' + error.message); return; }
  notas = data;
  // não perde o que ainda está sendo digitado
  for (const [id, p] of Object.entries(pendentes)) {
    const n = notas.find((x) => x.id === id);
    if (n) Object.assign(n, p.campos);
  }
  renderNotas();
}

let tNotas;
function agendarNotas() {
  clearTimeout(tNotas);
  tNotas = setTimeout(() => { if (logado && aba === 'notas') carregarNotas(); }, 500);
}

async function salvarNota(id, campos) {
  const n = notas.find((x) => x.id === id);
  if (n) Object.assign(n, campos);
  const { error } = await sb.from('notas').update({ ...campos, atualizado_em: agoraISO() }).eq('id', id);
  if (error) toast('Nota não salvou: ' + error.message);
}

// guarda a mudança na hora (na tela) e envia pro banco um instante depois
const pendentes = {};
function salvarNotaDepois(id, campos, ms = 600) {
  const n = notas.find((x) => x.id === id);
  if (n) Object.assign(n, campos);
  const p = (pendentes[id] ||= { campos: {} });
  Object.assign(p.campos, campos);
  clearTimeout(p.t);
  p.t = setTimeout(() => enviarPendentes(id), ms);
}
function enviarPendentes(id) {
  const p = pendentes[id];
  if (!p) return;
  clearTimeout(p.t);
  delete pendentes[id];
  salvarNota(id, p.campos);
}
window.addEventListener('pagehide', () => Object.keys(pendentes).forEach(enviarPendentes));

async function excluirNota(id) {
  const { error } = await sb.from('notas').delete().eq('id', id);
  if (error) { toast('Não excluiu: ' + error.message); return false; }
  notas = notas.filter((n) => n.id !== id);
  renderNotas();
  return true;
}

async function pedirExclusaoNota(id) {
  const n = notas.find((x) => x.id === id);
  const nome = n && (n.titulo || textoPuro(htmlDaNota(n)).slice(0, 40));
  const ok = await confirmar(nome ? `Excluir a nota "${nome}"?` : 'Excluir esta nota?', 'Excluir', true);
  if (ok && (await excluirNota(id))) toast('Nota excluída');
  return ok;
}

function ajustarAlturaQuadro() {
  const c = $('#notas');
  if (c.dataset.modo !== 'quadro' || c.hidden) return;
  c.style.height = Math.max(420, window.innerHeight - c.getBoundingClientRect().top - 16) + 'px';
}

function renderNotas() {
  if (aba !== 'notas') return;
  const c = $('#notas');
  const modo = ehQuadro() ? 'quadro' : 'grade';
  if (c.dataset.modo !== modo) {
    c.dataset.modo = modo;
    c.style.height = '';
    c.innerHTML = modo === 'quadro'
      ? '<div class="quadro-area" id="quadro-area"></div><p class="dica-quadro" id="dica-quadro"></p>'
      : '<div class="grade" id="grade"></div>';
  }
  if (modo === 'quadro') { ajustarAlturaQuadro(); renderQuadro(); }
  else renderGrade();
}

const etiquetaDestaque = (n) => n.destaque ? `<span class="etiqueta-destaque ${n.destaque}">${DESTAQUES[n.destaque]}</span>` : '';

/* --- celular: grade --- */
function renderGrade() {
  const peso = (n) => (n.destaque === 'urgente' ? 0 : n.destaque === 'importante' ? 1 : 2);
  const lista = [...notas].sort((a, b) => peso(a) - peso(b) || (b.atualizado_em || '').localeCompare(a.atualizado_em || ''));
  $('#grade').innerHTML = lista.length
    ? lista.map((n) => {
        const corpo = htmlDaNota(n);
        return `<div class="postit-card ${n.destaque ? 'd-' + n.destaque : ''}" role="button" tabindex="0" data-id="${n.id}" style="background:${corDe(n)}">
          ${etiquetaDestaque(n)}
          ${n.titulo ? `<div class="card-nota-titulo">${esc(n.titulo)}</div>` : ''}
          <div class="card-nota-texto">${corpo || (n.titulo ? '' : '<span class="nota-vazia">Nota vazia</span>')}</div>
        </div>`;
      }).join('')
    : `<div class="vazio"><strong>Nenhuma nota ainda</strong>Toque no + para criar um post-it.</div>`;
}

$('#notas').addEventListener('click', (e) => {
  const card = e.target.closest('.postit-card');
  if (!card) return;
  const n = notas.find((x) => x.id === card.dataset.id);
  if (n) abrirNota(n);
});

function setCorNota(c) {
  corNotaSel = c;
  document.querySelectorAll('#n-cores button').forEach((b) => b.classList.toggle('sel', b.dataset.cor === c));
}
function setDestaque(d) {
  destaqueSel = d || '';
  document.querySelectorAll('#n-destaque button').forEach((b) => b.classList.toggle('sel', b.dataset.destaque === destaqueSel));
}
$('#n-cores').innerHTML = Object.entries(CORES_NOTA)
  .map(([k, v]) => `<button type="button" class="cor-bolha" data-cor="${k}" style="background:${v}" aria-label="${k}"></button>`).join('');
document.querySelectorAll('#n-cores button').forEach((b) => b.addEventListener('click', () => setCorNota(b.dataset.cor)));
document.querySelectorAll('#n-destaque button').forEach((b) => b.addEventListener('click', () => setDestaque(b.dataset.destaque)));

// botão B (negrito) — não tira o foco do texto
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-cmd="bold"]');
  if (!b) return;
  e.preventDefault();
  document.execCommand('bold');
});

function abrirNota(n) {
  notaEditandoId = n.id;
  $('#n-titulo').value = n.titulo || '';
  $('#n-texto').innerHTML = htmlDaNota(n);
  setCorNota(n.cor || 'amarelo');
  setDestaque(n.destaque);
  $('#dlg-nota').showModal();
}
$('#form-nota').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = notaEditandoId;
  $('#dlg-nota').close();
  await salvarNota(id, {
    titulo: $('#n-titulo').value.trim(),
    texto: limparHtml($('#n-texto').innerHTML),
    cor: corNotaSel,
    destaque: destaqueSel || null,
  });
  renderNotas();
});
$('#btn-nota-fechar').addEventListener('click', () => $('#dlg-nota').close());
$('#btn-nota-excluir').addEventListener('click', async () => {
  $('#dlg-nota').close();
  const excluiu = await pedirExclusaoNota(notaEditandoId);
  if (!excluiu) $('#dlg-nota').showModal();
});

/* --- computador: quadro --- */
function aplicarDestaque(el, n) {
  el.classList.toggle('d-importante', n.destaque === 'importante');
  el.classList.toggle('d-urgente', n.destaque === 'urgente');
  el.querySelector('.postit-etiqueta').innerHTML = etiquetaDestaque(n);
  el.querySelectorAll('[data-destaque]').forEach((b) => b.classList.toggle('ativo', b.dataset.destaque === n.destaque));
}

function criarPostit(n) {
  const el = document.createElement('div');
  el.className = 'postit';
  el.dataset.id = n.id;
  el.innerHTML = `
    <div class="postit-barra">
      <span class="pega">⠿</span>
      <span class="postit-etiqueta"></span>
      <div class="postit-ferramentas">
        <button type="button" class="ferr btn-b" data-cmd="bold" aria-label="Negrito"><b>B</b></button>
        <button type="button" class="ferr" data-destaque="importante" aria-label="Importante">⭐</button>
        <button type="button" class="ferr" data-destaque="urgente" aria-label="Urgente">🔴</button>
        <button type="button" class="ferr btn-paleta" aria-label="Cor">🎨</button>
      </div>
      <div class="paleta">${Object.entries(CORES_NOTA).map(([k, v]) => `<button type="button" class="bolinha" data-cor="${k}" style="background:${v}" aria-label="${k}"></button>`).join('')}</div>
      <button type="button" class="postit-x" aria-label="Excluir nota">✕</button>
    </div>
    <input class="postit-titulo" placeholder="Título" autocomplete="off">
    <div class="postit-texto" contenteditable="true" data-placeholder="Escreva aqui..."></div>`;

  const titulo = el.querySelector('.postit-titulo');
  const texto = el.querySelector('.postit-texto');
  const atual = () => notas.find((x) => x.id === n.id);

  titulo.addEventListener('input', () => salvarNotaDepois(n.id, { titulo: titulo.value.trim() }));
  titulo.addEventListener('blur', () => enviarPendentes(n.id));
  titulo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); texto.focus(); } });
  texto.addEventListener('input', () => salvarNotaDepois(n.id, { texto: limparHtml(texto.innerHTML) }, 700));
  texto.addEventListener('blur', () => enviarPendentes(n.id));
  texto.addEventListener('paste', (e) => {           // cola só o texto, sem formatação estranha
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });

  el.querySelector('.btn-paleta').addEventListener('click', () => el.classList.toggle('paleta-aberta'));
  el.addEventListener('mouseleave', () => el.classList.remove('paleta-aberta'));
  el.querySelectorAll('.bolinha').forEach((b) =>
    b.addEventListener('click', () => {
      el.style.background = CORES_NOTA[b.dataset.cor];
      el.classList.remove('paleta-aberta');
      salvarNota(n.id, { cor: b.dataset.cor });
    })
  );
  el.querySelectorAll('[data-destaque]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = atual();
      const novo = a && a.destaque === b.dataset.destaque ? null : b.dataset.destaque;
      salvarNota(n.id, { destaque: novo });
      aplicarDestaque(el, { ...a, destaque: novo });
    })
  );
  el.querySelector('.postit-x').addEventListener('click', () => pedirExclusaoNota(n.id));

  // clicar traz pra frente; e o tamanho só é salvo quando VOCÊ redimensiona
  el.addEventListener('pointerdown', () => {
    const a = atual();
    const topo = maxZ();
    if (a && a.z < topo) { el.style.zIndex = topo + 1; salvarNota(n.id, { z: topo + 1 }); }
    const w0 = el.offsetWidth, h0 = el.offsetHeight;
    window.addEventListener('pointerup', () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w > 0 && h > 0 && (Math.abs(w - w0) > 2 || Math.abs(h - h0) > 2)) {
        salvarNota(n.id, { largura: Math.round(w), altura: Math.round(h) });
        ajustarTamanhoArea();
      }
    }, { once: true });
  });

  // arrastar pela barra
  const barra = el.querySelector('.postit-barra');
  barra.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const inicioX = e.clientX, inicioY = e.clientY;
    const origX = el.offsetLeft, origY = el.offsetTop;
    el.classList.add('arrastando');
    barra.setPointerCapture(e.pointerId);
    const mover = (ev) => {
      el.style.left = Math.max(0, origX + ev.clientX - inicioX) + 'px';
      el.style.top = Math.max(0, origY + ev.clientY - inicioY) + 'px';
    };
    const soltar = () => {
      barra.removeEventListener('pointermove', mover);
      barra.removeEventListener('pointerup', soltar);
      barra.removeEventListener('pointercancel', soltar);
      el.classList.remove('arrastando');
      const x = Math.round(el.offsetLeft), y = Math.round(el.offsetTop);
      const a = atual();
      if (a && (a.x !== x || a.y !== y)) salvarNota(n.id, { x, y });
      ajustarTamanhoArea();
    };
    barra.addEventListener('pointermove', mover);
    barra.addEventListener('pointerup', soltar);
    barra.addEventListener('pointercancel', soltar);
  });

  return el;
}

function ajustarTamanhoArea() {
  const area = $('#quadro-area');
  if (!area) return;
  let maxX = 0, maxY = 0;
  for (const n of notas) {
    maxX = Math.max(maxX, n.x + n.largura);
    maxY = Math.max(maxY, n.y + n.altura);
  }
  area.style.width = maxX + 400 + 'px';
  area.style.height = maxY + 300 + 'px';
}

function renderQuadro() {
  const area = $('#quadro-area');
  const ids = new Set(notas.map((n) => n.id));
  area.querySelectorAll('.postit').forEach((el) => { if (!ids.has(el.dataset.id)) el.remove(); });
  for (const n of notas) {
    let el = area.querySelector(`.postit[data-id="${n.id}"]`);
    if (!el) { el = criarPostit(n); area.appendChild(el); }
    if (el.classList.contains('arrastando')) continue;
    // posição e tamanho vêm SEMPRE do que está salvo
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.style.width = Math.max(160, n.largura) + 'px';
    el.style.height = Math.max(120, n.altura) + 'px';
    el.style.zIndex = n.z;
    el.style.background = corDe(n);
    aplicarDestaque(el, n);
    const editando = el.contains(document.activeElement);
    if (!editando) {
      el.querySelector('.postit-titulo').value = n.titulo || '';
      const html = htmlDaNota(n);
      const tx = el.querySelector('.postit-texto');
      if (tx.innerHTML !== html) tx.innerHTML = html;
    }
  }
  $('#dica-quadro').textContent = notas.length
    ? 'Arraste pela barra de cima · puxe o canto de baixo para aumentar · Ctrl+B para negrito'
    : 'Quadro vazio — clique no + para colar o primeiro post-it';
  ajustarTamanhoArea();
}

// procura um lugar vazio na parte visível do quadro (lado a lado, sem empilhar)
function espacoLivre(c) {
  const L = 230, A = 210, gap = 24;
  const x0 = c.scrollLeft + gap, y0 = c.scrollTop + gap;
  const colunas = Math.max(1, Math.floor((c.clientWidth - gap) / (L + gap)));
  const sobrepoe = (x, y) => notas.some((n) =>
    x < n.x + n.largura + 8 && x + L + 8 > n.x && y < n.y + n.altura + 8 && y + A + 8 > n.y);
  for (let linha = 0; linha < 30; linha++) {
    for (let col = 0; col < colunas; col++) {
      const x = x0 + col * (L + gap), y = y0 + linha * (A + gap);
      if (!sobrepoe(x, y)) return [Math.round(x), Math.round(y)];
    }
  }
  return [Math.round(x0 + 30), Math.round(y0 + 30)];
}

async function novaNota() {
  const quadro = ehQuadro();
  let x = 40, y = 40;
  if (quadro) [x, y] = espacoLivre($('#notas'));
  const { data, error } = await sb.from('notas')
    .insert({ titulo: '', texto: '', cor: 'amarelo', x, y, z: maxZ() + 1 }).select().single();
  if (error) { toast('Não criou a nota: ' + error.message); return; }
  notas.push(data);
  renderNotas();
  if (quadro) {
    const t = document.querySelector(`.postit[data-id="${data.id}"] .postit-titulo`);
    if (t) t.focus();
  } else {
    abrirNota(data);
  }
}

window.addEventListener('resize', () => { if (aba === 'notas') renderNotas(); });

/* ---------- início ---------- */
const VERSAO_APP = 9;
// Atualização automática: ao abrir/voltar pro app, busca versão nova e recarrega sozinho
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    const checar = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checar(); });
    setInterval(checar, 30 * 60 * 1000);
  }).catch(() => {});
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregou) return;
    recarregou = true;
    window.location.reload();
  });
}
document.querySelectorAll('.versao-app').forEach((e) => (e.textContent = `Minha Agenda · versão ${VERSAO_APP}`));

if (SUPABASE_URL.includes('SEU-PROJETO')) {
  $('#tela-login').hidden = false;
  msgLogin('Falta configurar: cole a URL e a chave do Supabase no arquivo config.js.');
} else {
  sb.auth.getSession().then(({ data }) => mostrar(data.session));
  sb.auth.onAuthStateChange((_evento, session) => setTimeout(() => mostrar(session), 0));
}
