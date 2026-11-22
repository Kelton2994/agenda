import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLICA } from './config.js';
import { interpretarFala } from './voz.js?v=19';

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
let repSel = '';
let filtroTile = null;
let termoBusca = '';
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

/* ---------- repetição (mensal / semanal) ---------- */
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const pad2 = (n) => String(n).padStart(2, '0');
const ontem = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoLocal(d); };
const ultimoDiaMes = (a, m) => new Date(a, m, 0).getDate(); // m = 1..12
function descreverRec(t) {
  if (t.recorrencia === 'mensal') return `Todo dia ${t.dia_mes}`;
  const d = Number(t.dia_semana);
  return `${d === 0 || d === 6 ? 'Todo' : 'Toda'} ${DIAS_SEMANA[d]}`;
}
// primeira data da regra DEPOIS de 'depoisDe' (YYYY-MM-DD)
function proximaOcorrencia(t, depoisDe) {
  const [a, m, d] = depoisDe.split('-').map(Number);
  if (t.recorrencia === 'mensal') {
    let ano = a, mes = m;
    for (let i = 0; i < 14; i++) {
      const dia = Math.min(Number(t.dia_mes) || 1, ultimoDiaMes(ano, mes));
      const iso = `${ano}-${pad2(mes)}-${pad2(dia)}`;
      if (iso > depoisDe) return iso;
      mes++; if (mes > 12) { mes = 1; ano++; }
    }
  }
  const base = new Date(a, m - 1, d);
  for (let i = 1; i <= 7; i++) {
    const x = new Date(a, m - 1, d + i);
    if (x.getDay() === Number(t.dia_semana)) return isoLocal(x);
  }
  return isoLocal(base);
}
// quando começam os avisos: prazo - dias antes, no horário escolhido
function inicioAvisos(t, prazo) {
  const [a, m, d] = prazo.split('-').map(Number);
  const [hh, mm] = (t.hora_aviso || '08:00').split(':').map(Number);
  return new Date(a, m - 1, d - (Number(t.avisar_dias_antes) || 0), hh, mm, 0, 0);
}
function primeiroAviso(t, prazo) {
  let x = inicioAvisos(t, prazo);
  const agora = new Date();
  if (x <= agora) {               // já está no período de aviso: próximo horário (hoje ou amanhã)
    const [hh, mm] = (t.hora_aviso || '08:00').split(':').map(Number);
    x = new Date(); x.setHours(hh, mm, 0, 0);
    if (x <= agora) x.setDate(x.getDate() + 1);
  }
  return x;
}
const emPeriodoDeAviso = (t) => t.recorrencia && t.prazo && isoLocal(inicioAvisos(t, t.prazo)) <= hoje();
const fmtDiaMes = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };

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

function marcarTema() {
  document.querySelectorAll('#chips-tema button').forEach((b) => b.classList.toggle('sel', b.dataset.tema === temaEscolhido()));
}
$('#btn-menu').addEventListener('click', () => { marcarTema(); mostrarStatusNotif(); $('#dlg-menu').showModal(); });
$('#menu-fechar').addEventListener('click', () => $('#dlg-menu').close());
$('#dlg-menu').addEventListener('click', (e) => { if (e.target === $('#dlg-menu')) $('#dlg-menu').close(); });
document.querySelectorAll('#chips-tema button').forEach((b) => b.addEventListener('click', () => {
  try { localStorage.setItem('agenda-tema', b.dataset.tema); } catch { /* sem armazenamento */ }
  aplicarTema(); marcarTema();
}));
$('#menu-sair').addEventListener('click', async () => {
  $('#dlg-menu').close();
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

// Atualiza NA HORA na tela e salva no servidor em segundo plano (sem travar)
async function atualizar(id, campos) {
  const t = tarefas.find((x) => x.id === id);
  const antes = t ? { ...t } : null;
  const agora = agoraISO();
  if (t) { Object.assign(t, campos, { atualizado_em: agora }); render(); }
  const { error } = await sb.from('tarefas').update({ ...campos, atualizado_em: agora }).eq('id', id);
  if (error) {
    if (t && antes) { Object.assign(t, antes); render(); }
    toast('Não salvou (sem internet?): ' + error.message);
    return false;
  }
  return true;
}

/* ---------- ações rápidas ---------- */
async function comecar(id) {
  const outras = tarefas.filter((t) => t.status === 'fazendo' && t.id !== id);
  outras.forEach((t) => { t.status = 'pausado'; });
  if (outras.length) {
    toast(`"${outras[0].titulo}" foi para Pausadas`);
    sb.from('tarefas').update({ status: 'pausado', atualizado_em: agoraISO() }).eq('status', 'fazendo').neq('id', id).then(() => {});
  }
  await atualizar(id, { status: 'fazendo' });
}

async function concluirRecorrente(t) {
  const h = hoje();
  let proximo = proximaOcorrencia(t, t.prazo || ontem());
  while (proximo <= h) proximo = proximaOcorrencia(t, proximo);
  const agora = agoraISO();
  sb.from('tarefas_historico').insert({ tarefa_id: t.id, prazo: t.prazo, concluido_em: agora }).then(() => {});
  atualizar(t.id, {
    status: 'a_fazer', concluido_em: null, ultima_conclusao: agora,
    prazo: proximo, lembrar_em: primeiroAviso(t, proximo).toISOString(),
  });
  const ini = inicioAvisos(t, proximo);
  toast(`Feito ✓ Próximo prazo ${fmtDiaMes(proximo)} · avisos a partir de ${pad2(ini.getDate())}/${pad2(ini.getMonth() + 1)}`);
}

async function concluir(id) {
  const t = tarefas.find((x) => x.id === id);
  if (t?.recorrencia) return concluirRecorrente(t);
  atualizar(id, { status: 'concluido', concluido_em: agoraISO() });
  toast('Concluída ✓');
}

async function pularAmanha(id) {
  atualizar(id, { prazo: amanha() });
  toast('Passou para amanhã');
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
  if (t.recorrencia) chips.push(`<span class="chip chip-rec">🔁 ${descreverRec(t)}</span>`);
  if (t.recorrencia && t.ultima_conclusao) chips.push(`<span class="chip chip-ok">✓ Último: ${fmtHora(t.ultima_conclusao).slice(0, 5)}</span>`);
  if (t.lembrar_em && !feita) chips.push(`<span class="chip">⏰ ${fmtHora(t.lembrar_em)}</span>`);
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
      t.prazo !== amanha() && !t.recorrencia ? `<button data-acao="amanha">→ Amanhã</button>` : '',
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
  return `<section class="secao"><div class="secao-titulo ${classe}"><span><i class="ponto"></i>${titulo}</span><span class="contador">${itens.length}</span></div><div class="cards">${itens.map(card).join('')}</div></section>`;
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
  const sel = (f) => (filtroTile === f ? 'tile-sel' : '');
  $('#resumo').innerHTML = `
    <button type="button" data-filtro="atrasadas" class="tile ${atrasadas.length ? 'tile-perigo' : ''} ${sel('atrasadas')}"><b>${atrasadas.length}</b><span>Atrasadas</span></button>
    <button type="button" data-filtro="hoje" class="tile ${sel('hoje')}"><b>${paraHoje.length}</b><span>Pra hoje</span></button>
    <button type="button" data-filtro="pausadas" class="tile ${pausadas.length ? 'tile-alerta' : ''} ${sel('pausadas')}"><b>${pausadas.length}</b><span>Pausadas</span></button>
    <button type="button" data-filtro="abertas" class="tile ${sel('abertas')}"><b>${abertas.length}</b><span>Abertas</span></button>`;
  const hora = new Date().getHours();
  $('#saudacao').textContent = hora < 12 ? 'Bom dia 👋' : hora < 18 ? 'Boa tarde 👋' : 'Boa noite 👋';
  const d0 = new Date();
  const semana = d0.toLocaleDateString('pt-BR', { weekday: 'long' }).replace('-feira', '');
  const mesCurto = d0.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  $('#data-hoje').textContent = `${semana.charAt(0).toUpperCase() + semana.slice(1)}, ${d0.getDate()} ${mesCurto}`;

  if (termoBusca.trim()) {
    $('#lista').hidden = false;
    $('#notas').hidden = true;
    $('#lista').innerHTML = resultadoBusca(termoBusca);
    return;
  }
  $('#lista').hidden = aba === 'notas';
  $('#notas').hidden = aba !== 'notas';
  if (aba === 'notas') return;
  let html = '';
  if (aba === 'todas' && filtroTile) {
    const filtros = {
      atrasadas: ['Atrasadas', (t) => t.prazo && t.prazo < h],
      hoje: ['Pra hoje', (t) => t.prazo === h],
      pausadas: ['Pausadas', (t) => t.status === 'pausado'],
      abertas: ['Abertas', () => true],
    };
    const [nome, fn] = filtros[filtroTile];
    const lista = abertas.filter(fn);
    html = `<div class="filtro-ativo">Mostrando: <b>${nome}</b> (${lista.length})<button type="button" data-limpar-filtro>✕ Limpar filtro</button></div>`;
    html += lista.length ? `<div class="cards">${lista.map(card).join('')}</div>` : `<div class="vazio"><strong>Nada aqui 🎉</strong>Nenhuma tarefa ${nome.toLowerCase()}.</div>`;
    $('#lista').innerHTML = html;
    return;
  }
  if (aba === 'hoje') {
    const usados = new Set();
    const pega = (fn) => abertas.filter((t) => !usados.has(t.id) && fn(t)).map((t) => (usados.add(t.id), t));
    html += secao('Atrasadas', pega((t) => t.prazo && t.prazo < h), 'perigo');
    html += secao('Fazendo agora', pega((t) => t.status === 'fazendo'));
    html += secao('Para hoje', pega((t) => t.prazo === h));
    html += secao('Pausadas — você parou no meio', pega((t) => t.status === 'pausado'));
    html += secao('Aguardando alguém', pega((t) => t.status === 'aguardando'));
    html += secao('Amanhã', pega((t) => t.prazo === am));
    html += secao('Repetitivas — já no período de aviso', pega((t) => emPeriodoDeAviso(t)));
    html += secao('Sem prazo', pega((t) => !t.prazo));
    const futuras = abertas.filter((t) => !usados.has(t.id) && t.recorrencia);
    if (futuras.length) html += `<p class="dica-futuras">🔁 ${futuras.length} tarefa(s) repetitiva(s) aguardando o período de aviso — veja em "Todas".</p>`;
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
    filtroTile = null;
    document.querySelectorAll('.abas button').forEach((x) => x.classList.toggle('ativa', x === b));
    $('#busca-wrap').hidden = true;
    const emNotas = aba === 'notas';
    $('#lista').hidden = emNotas;
    $('#notas').hidden = !emNotas;
    $('#fab').setAttribute('aria-label', emNotas ? 'Nova nota' : 'Nova tarefa');
    $('#fab-voz').hidden = emNotas;
    if (emNotas) carregarNotas();
    render();
  })
);
$('#busca').addEventListener('input', render);

function irParaAba(nome) {
  aba = nome;
  document.querySelectorAll('.abas button').forEach((x) => x.classList.toggle('ativa', x.dataset.aba === nome));
  $('#fab').setAttribute('aria-label', nome === 'notas' ? 'Nova nota' : 'Nova tarefa');
}
$('#resumo').addEventListener('click', (e) => {
  const t = e.target.closest('[data-filtro]');
  if (!t) return;
  fecharBusca(false);
  filtroTile = filtroTile === t.dataset.filtro && aba === 'todas' ? null : t.dataset.filtro;
  irParaAba(filtroTile ? 'todas' : 'hoje');
  render();
});

/* ---------- pesquisa rápida (tarefas + notas) ---------- */
const normalizar = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function resultadoBusca(termo) {
  const q = normalizar(termo.trim());
  const achaT = tarefas.filter((t) => normalizar(`${t.titulo} ${t.quem_pediu || ''} ${t.notas || ''}`).includes(q));
  const achaN = notas.filter((n) => normalizar(`${n.titulo || ''} ${textoPuro(htmlDaNota(n))}`).includes(q));
  let html = `<div class="busca-resumo">${achaT.length + achaN.length} resultado(s) para <b>"${esc(termo.trim())}"</b></div>`;
  if (achaT.length) {
    const abertas = achaT.filter((t) => t.status !== 'concluido');
    const feitas = achaT.filter((t) => t.status === 'concluido');
    html += secao('Tarefas', abertas);
    html += secao('Tarefas concluídas', feitas);
  }
  if (achaN.length) {
    html += `<div class="secao-titulo"><span><i class="ponto"></i>Notas</span><span class="contador">${achaN.length}</span></div><div class="res-notas">` +
      achaN.map((n) => `<div class="res-nota ${n.destaque ? 'd-' + n.destaque : ''}" role="button" tabindex="0" data-nota-id="${n.id}" style="background:${corDe(n)}">
        ${etiquetaDestaque(n)}${n.titulo ? `<div class="card-nota-titulo">${esc(n.titulo)}</div>` : ''}
        <div class="card-nota-texto">${esc(textoPuro(htmlDaNota(n))).slice(0, 160)}</div></div>`).join('') + '</div>';
  }
  if (!achaT.length && !achaN.length) html += `<div class="vazio"><strong>Nada encontrado</strong>Tente outra palavra.</div>`;
  return html;
}
function abrirBusca() {
  $('#barra-busca').hidden = false;
  $('#busca-global').focus();
  if (!notas.length) carregarNotas().then(render);
}
function fecharBusca(renderizar = true) {
  termoBusca = '';
  $('#busca-global').value = '';
  $('#barra-busca').hidden = true;
  if (renderizar) { render(); if (aba === 'notas') renderNotas(); }
}
$('#btn-busca').addEventListener('click', () => ($('#barra-busca').hidden ? abrirBusca() : fecharBusca()));
$('#busca-fechar').addEventListener('click', () => fecharBusca());
$('#busca-global').addEventListener('input', (e) => { termoBusca = e.target.value; render(); if (!termoBusca.trim() && aba === 'notas') renderNotas(); });
$('#busca-global').addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharBusca(); });

$('#lista').addEventListener('click', (e) => {
  if (e.target.closest('[data-limpar-filtro]')) { filtroTile = null; render(); return; }
  const rn = e.target.closest('[data-nota-id]');
  if (rn) { const n = notas.find((x) => x.id === rn.dataset.notaId); if (n) abrirNota(n); return; }
  const alvo = e.target.closest('[data-acao]');
  const el = e.target.closest('.card');
  if (!alvo || !el) return;
  const t = tarefas.find((x) => x.id === el.dataset.id);
  if (!t || String(t.id).startsWith('tmp-')) return;
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

function setRep(v, inicial = false) {
  repSel = v || '';
  document.querySelectorAll('#chips-repetir button').forEach((b) => b.classList.toggle('sel', b.dataset.rep === repSel));
  $('#campos-recorrencia').hidden = !repSel;
  $('#campo-prazo').hidden = !!repSel;
  $('#campo-lembrar').hidden = !!repSel;
  $('#lbl-dia-mes').hidden = repSel !== 'mensal';
  $('#lbl-dia-semana').hidden = repSel !== 'semanal';
  if (!inicial) {
    if (repSel === 'semanal' && $('#f-dias-antes').value === '5') $('#f-dias-antes').value = '1';
    if (repSel === 'mensal' && $('#f-dias-antes').value === '1') $('#f-dias-antes').value = '5';
  }
  atualizarDicaRec();
}
function regraDoFormulario() {
  return {
    recorrencia: repSel,
    dia_mes: Math.min(31, Math.max(1, parseInt($('#f-dia-mes').value, 10) || 1)),
    dia_semana: Number($('#f-dia-semana').value),
    avisar_dias_antes: Math.min(31, Math.max(0, parseInt($('#f-dias-antes').value, 10) || 0)),
    hora_aviso: $('#f-hora-aviso').value || '08:00',
  };
}
function atualizarDicaRec() {
  if (!repSel) return;
  const r = regraDoFormulario();
  const prazo = proximaOcorrencia(r, ontem());
  const ini = inicioAvisos(r, prazo);
  $('#dica-rec').textContent =
    `Próximo prazo: ${fmtDiaMes(prazo)}. Vai avisar todo dia às ${r.hora_aviso} a partir de ${pad2(ini.getDate())}/${pad2(ini.getMonth() + 1)}, até você concluir. Ao concluir, pula pro próximo ${repSel === 'mensal' ? 'mês' : 'semana'}.`;
}
document.querySelectorAll('#chips-repetir button').forEach((b) => b.addEventListener('click', () => setRep(b.dataset.rep)));
['#f-dia-mes', '#f-dia-semana', '#f-dias-antes', '#f-hora-aviso'].forEach((id) => $(id).addEventListener('input', atualizarDicaRec));

function abrirTarefa(t = null) {
  statusVoz('');
  $('#f-dia-mes').value = t?.dia_mes ?? 15;
  $('#f-dia-semana').value = String(t?.dia_semana ?? 1);
  $('#f-dias-antes').value = t?.avisar_dias_antes ?? 5;
  $('#f-hora-aviso').value = t?.hora_aviso ?? '08:00';
  setRep(t?.recorrencia || '', true);
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
$('#dlg-tarefa').addEventListener('close', () => { if (ouvindo) ouvindo.abort(); });

$('#form-tarefa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const titulo = $('#f-titulo').value.trim();
  if (!titulo) return;
  const campos = {
    titulo,
    prazo: valorPrazo(),
    quem_pediu: $('#f-quem').value.trim() || null,
    lembrar_em: $('#f-lembrar').value ? new Date($('#f-lembrar').value).toISOString() : null,
    tipo_aviso: 'alarme',
  };

  if (repSel) {
    const r = regraDoFormulario();
    const antes = editandoId ? tarefas.find((t) => t.id === editandoId) : null;
    const mesmaRegra = antes && antes.recorrencia === r.recorrencia && antes.dia_mes === (r.recorrencia === 'mensal' ? r.dia_mes : null) &&
      antes.dia_semana === (r.recorrencia === 'semanal' ? r.dia_semana : null);
    const prazo = antes?.recorrencia && antes.prazo && (mesmaRegra || antes.prazo < hoje()) ? antes.prazo : proximaOcorrencia(r, ontem());
    Object.assign(campos, {
      recorrencia: r.recorrencia,
      dia_mes: r.recorrencia === 'mensal' ? r.dia_mes : null,
      dia_semana: r.recorrencia === 'semanal' ? r.dia_semana : null,
      avisar_dias_antes: r.avisar_dias_antes,
      hora_aviso: r.hora_aviso,
      prazo,
      lembrar_em: primeiroAviso(r, prazo).toISOString(),
    });
  } else {
    Object.assign(campos, { recorrencia: null, dia_mes: null, dia_semana: null });
  }

  $('#dlg-tarefa').close();          // fecha NA HORA; o salvamento continua em segundo plano
  if (editandoId) {
    const antes = tarefas.find((t) => t.id === editandoId);
    campos.status = $('#f-status').value;
    campos.notas = $('#f-notas').value.trim() || null;
    if (campos.status === 'concluido' && antes?.status !== 'concluido') campos.concluido_em = agoraISO();
    if (campos.status !== 'concluido') campos.concluido_em = null;
    atualizar(editandoId, campos);
    return;
  }
  const temp = { id: 'tmp-' + Date.now(), status: 'a_fazer', notas: null, criado_em: agoraISO(), concluido_em: null, ...campos };
  tarefas.push(temp);
  render();
  toast(campos.lembrar_em ? `Anotada ✓ · lembrete ${fmtHora(campos.lembrar_em)}` : 'Anotada ✓');
  const { data, error } = await sb.from('tarefas').insert(campos).select().single();
  if (error) {
    tarefas = tarefas.filter((t) => t !== temp);
    render();
    toast('Não salvou (sem internet?): ' + error.message);
    return;
  }
  Object.assign(temp, data);
  render();
});

$('#btn-excluir').addEventListener('click', async () => {
  const t = tarefas.find((x) => x.id === editandoId);
  if (!t || !(await confirmar(`Excluir "${t.titulo}"? Não dá para desfazer.`, 'Excluir', true))) return;
  $('#dlg-tarefa').close();
  const pos = tarefas.indexOf(t);
  tarefas = tarefas.filter((x) => x !== t);
  render();
  toast('Excluída');
  const { error } = await sb.from('tarefas').delete().eq('id', t.id);
  if (error) { tarefas.splice(pos, 0, t); render(); toast('Não excluiu: ' + error.message); }
});

/* ---------- criar tarefa falando ---------- */
const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
let ouvindo = null;
if (!Reconhecimento) { $('#btn-voz').hidden = true; $('#fab-voz').hidden = true; }

function statusVoz(msg) { const el = $('#voz-status'); el.hidden = !msg; el.textContent = msg || ''; }

function aplicarFala(frase) {
  const { titulo, quando } = interpretarFala(frase);
  $('#f-titulo').value = titulo || frase;
  if (quando) {
    $('#f-lembrar').value = paraInputLocal(quando);
    const iso = isoLocal(quando);
    if (iso === hoje()) setPrazo('hoje');
    else if (iso === amanha()) setPrazo('amanha');
    else { $('#f-prazo').value = iso; setPrazo('data'); }
    statusVoz(`✓ Entendi: lembrete ${quando.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Confira e toque em Salvar.`);
  } else {
    statusVoz('✓ Entendi. Não ouvi horário — escolha o lembrete abaixo, se quiser.');
  }
}

function ouvir() {
  if (!Reconhecimento) return;
  if (ouvindo) { ouvindo.stop(); return; }
  const r = new Reconhecimento();
  r.lang = 'pt-BR';
  r.interimResults = true;
  r.maxAlternatives = 1;
  let final = '';
  ouvindo = r;
  $('#btn-voz').classList.add('ouvindo');
  statusVoz('🎙️ Pode falar… (ex.: "ligar pro RH amanhã às 9")');
  r.onresult = (e) => {
    let parcial = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else parcial += e.results[i][0].transcript;
    }
    $('#f-titulo').value = (final + parcial).trim();
  };
  r.onerror = (e) => {
    statusVoz(e.error === 'not-allowed' || e.error === 'service-not-allowed'
      ? 'Microfone bloqueado. Libere em Configurações > Aplicativos > Agenda > Permissões.'
      : e.error === 'no-speech' ? 'Não ouvi nada. Toque no 🎤 e fale de novo.' : 'Não deu pra ouvir agora (precisa de internet). Tente de novo.');
  };
  r.onend = () => {
    ouvindo = null;
    $('#btn-voz').classList.remove('ouvindo');
    if (final.trim()) aplicarFala(final.trim());
  };
  r.start();
}
$('#btn-voz').addEventListener('click', ouvir);
$('#fab-voz').addEventListener('click', () => { abrirTarefa(); ouvir(); });

/* ---------- lembretes ---------- */
const NOTIF_KEY = 'agenda-notificados';
function lerNotificados() {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]')); } catch { return new Set(); }
}
function salvarNotificados(s) {
  try { localStorage.setItem(NOTIF_KEY, JSON.stringify([...s].slice(-300))); } catch { /* sem armazenamento */ }
}

/* ---------- alarme DENTRO do app (funciona mesmo se o computador bloquear notificações) ---------- */
const MAX_ALARMES = 12;
let filaAlarme = [];
let alarmeAtual = null;
let somAlarme = null;
let ctxAudio = null;
let tituloOriginal = document.title;
let piscaTitulo = null;

// o navegador só libera som depois do primeiro toque/clique na página
document.addEventListener('pointerdown', () => {
  try {
    ctxAudio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctxAudio.state === 'suspended') ctxAudio.resume();
  } catch { /* sem áudio */ }
}, { capture: true });

function bip() {
  if (!ctxAudio || ctxAudio.state !== 'running') return;
  const t0 = ctxAudio.currentTime;
  [0, 0.25, 0.5].forEach((d) => {
    const o = ctxAudio.createOscillator(), g = ctxAudio.createGain();
    o.type = 'square'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
    o.connect(g).connect(ctxAudio.destination);
    o.start(t0 + d); o.stop(t0 + d + 0.2);
  });
}
function tocarAlarme() {
  pararSom();
  bip();
  const inicio = Date.now();
  somAlarme = setInterval(() => { if (Date.now() - inicio > 2 * 60000) pararSom(); else bip(); }, 1500);
  let alterna = false;
  piscaTitulo = setInterval(() => { document.title = (alterna = !alterna) ? '⏰ LEMBRETE!' : tituloOriginal; }, 1000);
  if (navigator.vibrate) navigator.vibrate([600, 250, 600, 250, 900]);
}
function pararSom() {
  clearInterval(somAlarme); somAlarme = null;
  clearInterval(piscaTitulo); piscaTitulo = null;
  document.title = tituloOriginal;
}

function mostrarAlarme(t) {
  alarmeAtual = t;
  $('#alarme-titulo').textContent = t.titulo;
  const info = [];
  if (t.quem_pediu) info.push(`Pedido de ${t.quem_pediu}`);
  if (t.recorrencia) info.push(`🔁 ${descreverRec(t)}`);
  if (t.prazo) info.push(`Prazo: ${fmtData(t.prazo)}`);
  $('#alarme-info').textContent = info.join(' · ');
  if (!$('#dlg-alarme').open) $('#dlg-alarme').showModal();
  tocarAlarme();
}
function proximoAlarme() {
  pararSom();
  alarmeAtual = null;
  if ($('#dlg-alarme').open) $('#dlg-alarme').close();
  const prox = filaAlarme.shift();
  if (prox) mostrarAlarme(prox);
}
function amanhaNoHorario(hora) {
  const [hh, mm] = (hora || '08:00').split(':').map(Number);
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  while (d <= new Date()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
$('#alarme-adiar').addEventListener('click', () => {
  const t = alarmeAtual; proximoAlarme();
  if (t) { atualizar(t.id, { lembrar_em: new Date(Date.now() + 10 * 60000).toISOString() }); toast('Adiado 10 min'); }
});
$('#alarme-parar').addEventListener('click', () => {
  const t = alarmeAtual; proximoAlarme();
  if (!t) return;
  if (t.recorrencia) { atualizar(t.id, { lembrar_em: amanhaNoHorario(t.hora_aviso) }); toast('Parado por hoje · avisa de novo amanhã'); }
  else { atualizar(t.id, { avisos_enviados: MAX_ALARMES }); toast('Alarme parado'); }
});
$('#alarme-concluir').addEventListener('click', () => {
  const t = alarmeAtual; proximoAlarme();
  if (t) concluir(t.id);
});

// alarme ainda "valendo": já passou da hora, não foi parado e não é muito antigo (evita disparar coisa velha)
function alarmeValendo(t, agora) {
  if (t.status === 'concluido' || !t.lembrar_em) return false;
  const quando = new Date(t.lembrar_em).getTime();
  return quando <= agora && agora - quando < 2 * 3600000 && (t.avisos_enviados ?? 0) < MAX_ALARMES;
}

function verificarLembretes() {
  const agora = Date.now();
  // se o alarme aberto já foi resolvido em outro aparelho, fecha sozinho
  if (alarmeAtual) {
    const t = tarefas.find((x) => x.id === alarmeAtual.id);
    if (!t || !alarmeValendo(t, agora)) proximoAlarme();
  }
  const ja = lerNotificados();
  let mudou = false;
  for (const t of tarefas) {
    if (!alarmeValendo(t, agora)) continue;
    const chave = `${t.id}|${t.lembrar_em}`;
    if (ja.has(chave)) continue;
    ja.add(chave);
    mudou = true;
    const notificacoesFuncionam = 'Notification' in window && Notification.permission === 'granted';
    if (notificacoesFuncionam) { toast(`⏰ ${t.titulo}`); continue; }   // o alarme já chega pela notificação
    if (alarmeAtual || filaAlarme.length) { if (alarmeAtual?.id !== t.id) filaAlarme.push(t); }
    else mostrarAlarme(t);
  }
  if (mudou) salvarNotificados(ja);
}

setInterval(() => { if (logado) { verificarLembretes(); render(); } }, 15000);

/* ---------- notificações (push) ---------- */
function base64ParaBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Sem sino na tela: o estado dos lembretes fica só no menu ⋯
function atualizarSino() { if ($('#dlg-menu').open) mostrarStatusNotif(); }
function mostrarStatusNotif() {
  const el = $('#menu-notif');
  if (!('Notification' in window)) { el.innerHTML = '<p>Este navegador não tem notificações.</p>'; return; }
  const p = Notification.permission;
  if (p === 'granted') el.innerHTML = '<p class="ok-txt">✓ Ativados</p>';
  else if (p === 'default') el.innerHTML = '<button type="button" id="menu-ativar" class="menu-item">🔔 Ativar lembretes</button>';
  else el.innerHTML = `<p class="aviso-txt">Bloqueados pelo navegador deste aparelho.</p>
    <p class="ajuda-txt">No computador: clique no cadeado 🔒 ao lado do endereço → Notificações → Permitir → F5.<br>
    No celular: Configurações → Aplicativos → Agenda → Notificações → ligar.<br>
    Se aparecer "gerenciado pela organização", quem bloqueia é a TI da empresa.</p>`;
}
document.addEventListener('click', async (e) => {
  if (e.target.closest('#menu-ativar')) ativarNotificacoes(true).then(mostrarStatusNotif);

});

// Pede a permissão sozinho no primeiro toque depois de entrar (o celular exige um toque)
document.addEventListener('click', () => {
  if (logado && 'Notification' in window && Notification.permission === 'default') ativarNotificacoes(true);
}, true);

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
    if (perguntar) {
      let jaAvisou = false;
      try { jaAvisou = localStorage.getItem('agenda-aviso-bloqueio') === '1'; localStorage.setItem('agenda-aviso-bloqueio', '1'); } catch { /* ok */ }
      if (!jaAvisou) toast('Lembretes bloqueados neste aparelho — veja como liberar no menu ⋯');
    }
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
const TAGS_OK = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SPAN', 'A']);
const RE_LINK = /((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;
const hrefSeguro = (u) => {
  const url = /^www\./i.test(u) ? 'https://' + u : u;
  return /^https?:\/\//i.test(url) ? url : null;
};
// procura endereços no texto (fora de links) e transforma em <a>
function linkificar(raiz, doc) {
  const andar = (no) => {
    [...no.childNodes].forEach((f) => {
      if (f.nodeType === 1 && f.tagName !== 'A') andar(f);
      if (f.nodeType !== 3 || !RE_LINK.test(f.nodeValue)) return;
      RE_LINK.lastIndex = 0;
      const frag = doc.createDocumentFragment();
      let ultimo = 0;
      f.nodeValue.replace(RE_LINK, (m, _g, pos) => {
        frag.append(doc.createTextNode(f.nodeValue.slice(ultimo, pos)));
        const a = doc.createElement('a');
        a.setAttribute('href', hrefSeguro(m));
        a.textContent = m;
        frag.append(a);
        ultimo = pos + m.length;
        return m;
      });
      frag.append(doc.createTextNode(f.nodeValue.slice(ultimo)));
      f.replaceWith(frag);
    });
  };
  andar(raiz);
  RE_LINK.lastIndex = 0;
}
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
      const href = f.tagName === 'A' ? hrefSeguro(f.getAttribute('href') || '') : null;
      [...f.attributes].forEach((a) => f.removeAttribute(a.name));
      if (f.tagName === 'A') {
        if (!href) { limpar(f); f.replaceWith(...f.childNodes); return; }
        f.setAttribute('href', href);
      }
      limpar(f);
      if (f.tagName === 'SPAN') {
        if (negrito) { const b = doc.createElement('b'); b.append(...f.childNodes); f.replaceWith(b); }
        else f.replaceWith(...f.childNodes);
      }
    });
  };
  const raiz = doc.body.firstChild;
  limpar(raiz);
  linkificar(raiz, doc);
  return raiz.innerHTML;
}
// notas antigas eram texto puro
const htmlDaNota = (n) => {
  const t = n.texto || '';
  return limparHtml(/<[a-z][\s\S]*>/i.test(t) ? t : esc(t).replace(/\n/g, '<br>'));
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
  if (termoBusca) render();
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

function abrirLink(a) {
  const href = hrefSeguro(a.getAttribute('href') || '');
  if (href) window.open(href, '_blank', 'noopener');
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('.postit-texto a, .postit-card a, .n-texto a');
  if (!a) return;
  e.preventDefault();
  e.stopPropagation();
  abrirLink(a);
}, true);

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
  if (termoBusca) render();
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
  texto.addEventListener('blur', () => {
    const html = limparHtml(texto.innerHTML);
    if (html !== texto.innerHTML) texto.innerHTML = html;
    salvarNotaDepois(n.id, { texto: html }, 0);
    enviarPendentes(n.id);
  });
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
const VERSAO_APP = 19;
// Tema pelo horário: claro das 07h às 18h, escuro das 18h às 07h (confere a cada minuto)
function temaEscolhido() { try { return localStorage.getItem('agenda-tema') || 'auto'; } catch { return 'auto'; } }
function aplicarTema() {
  const h = new Date().getHours();
  const pref = temaEscolhido();
  const escuro = pref === 'escuro' || (pref === 'auto' && (h >= 18 || h < 7));
  document.documentElement.classList.toggle('escuro', escuro);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', escuro ? '#0b1120' : '#1d4ed8');
}
aplicarTema();
setInterval(aplicarTema, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) aplicarTema(); });
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
