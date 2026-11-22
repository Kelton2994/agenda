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
  if (confirm('Sair da conta neste aparelho?')) await sb.auth.signOut();
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
    document.body.classList.remove('quadro-ativo');
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
    if (emNotas) carregarNotas(); else document.body.classList.remove('quadro-ativo');
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
  if (!t || !confirm(`Excluir "${t.titulo}"? Não dá para desfazer.`)) return;
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
  $('#btn-notif').title = ok ? 'Lembretes ativos' : 'Ativar lembretes';
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
let notas = [];
let notaEditandoId = null;
let corNotaSel = 'amarelo';
const ehQuadro = () => window.matchMedia('(min-width: 900px)').matches;
const corDe = (n) => CORES_NOTA[n.cor] || CORES_NOTA.amarelo;
const maxZ = () => notas.reduce((m, n) => Math.max(m, n.z || 0), 0);

async function carregarNotas() {
  const { data, error } = await sb.from('notas').select('*').order('z', { ascending: true });
  if (error) { toast('Erro nas notas: ' + error.message); return; }
  notas = data;
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

async function excluirNota(id) {
  const { error } = await sb.from('notas').delete().eq('id', id);
  if (error) { toast('Não excluiu: ' + error.message); return false; }
  notas = notas.filter((n) => n.id !== id);
  renderNotas();
  return true;
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
  document.body.classList.toggle('quadro-ativo', modo === 'quadro');
  if (c.dataset.modo !== modo) {
    c.dataset.modo = modo;
    c.style.height = '';
    c.innerHTML = modo === 'quadro'
      ? '<div class="quadro-area" id="quadro-area"></div><p class="dica-quadro" id="dica-quadro">Arraste pela barra de cima · puxe o canto para aumentar</p>'
      : '<div class="grade" id="grade"></div>';
  }
  if (modo === 'quadro') { renderQuadro(); ajustarAlturaQuadro(); }
  else renderGrade();
}

/* --- celular: grade --- */
function renderGrade() {
  const lista = [...notas].sort((a, b) => (b.atualizado_em || '').localeCompare(a.atualizado_em || ''));
  $('#grade').innerHTML = lista.length
    ? lista.map((n) => `<div class="postit-card" role="button" tabindex="0" data-id="${n.id}" style="background:${corDe(n)}">${
        n.texto ? esc(n.texto) : '<span class="nota-vazia">Nota vazia</span>'}</div>`).join('')
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
$('#n-cores').innerHTML = Object.entries(CORES_NOTA)
  .map(([k, v]) => `<button type="button" class="cor-bolha" data-cor="${k}" style="background:${v}" aria-label="${k}"></button>`).join('');
document.querySelectorAll('#n-cores button').forEach((b) => b.addEventListener('click', () => setCorNota(b.dataset.cor)));

function abrirNota(n) {
  notaEditandoId = n.id;
  $('#n-texto').value = n.texto || '';
  setCorNota(n.cor || 'amarelo');
  $('#dlg-nota').showModal();
}
$('#form-nota').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = notaEditandoId;
  $('#dlg-nota').close();
  await salvarNota(id, { texto: $('#n-texto').value, cor: corNotaSel });
  renderNotas();
});
$('#btn-nota-fechar').addEventListener('click', () => $('#dlg-nota').close());
$('#btn-nota-excluir').addEventListener('click', async () => {
  if (!confirm('Excluir esta nota?')) return;
  $('#dlg-nota').close();
  if (await excluirNota(notaEditandoId)) toast('Nota excluída');
});

/* --- computador: quadro --- */
const observadorTamanho = new ResizeObserver((entradas) => {
  for (const ent of entradas) {
    const el = ent.target;
    const n = notas.find((x) => x.id === el.dataset.id);
    if (!n || el.classList.contains('arrastando')) continue;
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (Math.abs(w - n.largura) > 2 || Math.abs(h - n.altura) > 2) {
      clearTimeout(el._tTam);
      el._tTam = setTimeout(() => salvarNota(n.id, { largura: w, altura: h }), 500);
    }
  }
});

function criarPostit(n) {
  const el = document.createElement('div');
  el.className = 'postit';
  el.dataset.id = n.id;
  el.innerHTML = `
    <div class="postit-barra" title="Arraste para mover">
      <span class="pega">⠿</span>
      <div class="postit-cores">${Object.entries(CORES_NOTA)
        .map(([k, v]) => `<button type="button" data-cor="${k}" style="background:${v}" title="${k}"></button>`).join('')}</div>
      <button type="button" class="postit-x" title="Excluir nota">✕</button>
    </div>
    <textarea placeholder="Escreva aqui..."></textarea>`;

  const ta = el.querySelector('textarea');
  ta.addEventListener('input', () => {
    clearTimeout(el._tTxt);
    el._tTxt = setTimeout(() => salvarNota(n.id, { texto: ta.value }), 600);
  });
  ta.addEventListener('blur', () => {
    clearTimeout(el._tTxt);
    const atual = notas.find((x) => x.id === n.id);
    if (atual && atual.texto !== ta.value) salvarNota(n.id, { texto: ta.value });
  });

  el.querySelectorAll('.postit-cores button').forEach((b) =>
    b.addEventListener('click', () => { el.style.background = CORES_NOTA[b.dataset.cor]; salvarNota(n.id, { cor: b.dataset.cor }); })
  );
  el.querySelector('.postit-x').addEventListener('click', async () => {
    if (ta.value.trim() && !confirm('Excluir esta nota?')) return;
    await excluirNota(n.id);
  });

  // trazer pra frente ao clicar
  el.addEventListener('pointerdown', () => {
    const atual = notas.find((x) => x.id === n.id);
    const topo = maxZ();
    if (atual && atual.z < topo) { el.style.zIndex = topo + 1; salvarNota(n.id, { z: topo + 1 }); }
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
      salvarNota(n.id, { x: Math.round(el.offsetLeft), y: Math.round(el.offsetTop) });
      ajustarTamanhoArea();
    };
    barra.addEventListener('pointermove', mover);
    barra.addEventListener('pointerup', soltar);
    barra.addEventListener('pointercancel', soltar);
  });

  observadorTamanho.observe(el);
  return el;
}

function ajustarTamanhoArea() {
  const area = $('#quadro-area');
  if (!area) return;
  let maxX = 0, maxY = 0;
  area.querySelectorAll('.postit').forEach((el) => {
    maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
    maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
  });
  area.style.width = maxX + 400 + 'px';
  area.style.height = maxY + 300 + 'px';
}

function renderQuadro() {
  const area = $('#quadro-area');
  const ids = new Set(notas.map((n) => n.id));
  area.querySelectorAll('.postit').forEach((el) => {
    if (!ids.has(el.dataset.id)) { observadorTamanho.unobserve(el); el.remove(); }
  });
  for (const n of notas) {
    let el = area.querySelector(`.postit[data-id="${n.id}"]`);
    if (!el) { el = criarPostit(n); area.appendChild(el); }
    if (el.classList.contains('arrastando')) continue;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    if (Math.abs(el.offsetWidth - n.largura) > 2) el.style.width = n.largura + 'px';
    if (Math.abs(el.offsetHeight - n.altura) > 2) el.style.height = n.altura + 'px';
    el.style.zIndex = n.z;
    el.style.background = corDe(n);
    const ta = el.querySelector('textarea');
    if (document.activeElement !== ta && ta.value !== (n.texto || '')) ta.value = n.texto || '';
  }
  $('#dica-quadro').textContent = notas.length
    ? 'Arraste pela barra de cima · puxe o canto de baixo para aumentar'
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
  const c = $('#notas');
  let x = 40, y = 40;
  if (quadro) [x, y] = espacoLivre(c);
  const { data, error } = await sb.from('notas')
    .insert({ texto: '', cor: 'amarelo', x, y, z: maxZ() + 1 }).select().single();
  if (error) { toast('Não criou a nota: ' + error.message); return; }
  notas.push(data);
  renderNotas();
  if (quadro) {
    const ta = document.querySelector(`.postit[data-id="${data.id}"] textarea`);
    if (ta) ta.focus();
  } else {
    abrirNota(data);
  }
}

window.addEventListener('resize', () => {
  if (aba !== 'notas') return;
  renderNotas();
});

/* ---------- início ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

if (SUPABASE_URL.includes('SEU-PROJETO')) {
  $('#tela-login').hidden = false;
  msgLogin('Falta configurar: cole a URL e a chave do Supabase no arquivo config.js.');
} else {
  sb.auth.getSession().then(({ data }) => mostrar(data.session));
  sb.auth.onAuthStateChange((_evento, session) => setTimeout(() => mostrar(session), 0));
}
