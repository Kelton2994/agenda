import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLICA } from './config.js';
import { interpretarFala } from './voz.js?v=24';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- ícones (traço fino, estilo app) ---------- */
const ICONES = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3.5"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  hoje: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="m9 15 2 2 4-4"/>',
  sino: '<path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9"/><path d="M10.3 20.5a2 2 0 0 0 3.4 0"/>',
  alarme: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.2 2.2M4.5 4 2 6.5M19.5 4 22 6.5"/>',
  pessoa: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  repetir: '<path d="m17 2.5 3.5 3.5-3.5 3.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13"/><path d="m7 21.5-3.5-3.5L7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/>',
  lista: '<path d="M9 6h11.5M9 12h11.5M9 18h11.5"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  nota: '<path d="M15 3.5H6A2.5 2.5 0 0 0 3.5 6v12A2.5 2.5 0 0 0 6 20.5h12a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14.5 3.5V9h6"/>',
  feito: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  lapis: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  lixo: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2M6 6.5l1 13a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5l1-13"/>',
  desfazer: '<path d="M4 8h10.5a5.5 5.5 0 0 1 0 11H8"/><path d="M8 4 4 8l4 4"/>',
  bandeira: '<path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5"/>',
  ampulheta: '<path d="M6.5 3h11M6.5 21h11M7.5 3c0 5 9 5 9 9s-9 4-9 9M16.5 3c0 5-9 5-9 9s9 4 9 9"/>',
};
const ic = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] || ''}</svg>`;
function pintarIcones(raiz = document) { raiz.querySelectorAll('i[data-ic]').forEach((el) => { el.innerHTML = ic(el.dataset.ic); el.classList.add('i'); }); }
pintarIcones();
// Ponte com o app Android (só existe dentro do .apk)
const NATIVO = window.AgendaNativa || null;
if (NATIVO) document.documentElement.classList.add('nativo');
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
// "Hoje 15:00", "Amanhã 06:30", "Ontem 09:10" ou "27/11 08:00"
function fmtQuando(ts) {
  const d = new Date(ts);
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = isoLocal(d);
  if (dia === hoje()) return `Hoje ${hm}`;
  if (dia === amanha()) return `Amanhã ${hm}`;
  if (dia === ontem()) return `Ontem ${hm}`;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${hm}`;
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
function toast(msg, rotulo = null, acao = null) {
  const t = $('#toast');
  $('#toast-msg').textContent = msg;
  const b = $('#toast-acao');
  b.hidden = !rotulo;
  b.textContent = rotulo || '';
  b.onclick = () => { t.hidden = true; if (acao) acao(); };
  t.hidden = false;
  clearTimeout(tToast);
  tToast = setTimeout(() => (t.hidden = true), rotulo ? 5000 : 3000);
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
$('#btn-menu').addEventListener('click', () => { marcarTema(); mostrarStatusNotif(); mostrarMenuNativo(); $('#dlg-menu').showModal(); });
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
    mostrarCache();
    carregar();
    assinar();
    if (NATIVO) registrarAparelhoNativo();
    else ativarNotificacoes(false);
  } else if (!session) {
    logado = false;
    tarefas = [];
    notas = [];
    if (canal) { sb.removeChannel(canal); canal = null; }
    try { localStorage.removeItem(CACHE_TAREFAS); } catch { /* ok */ }
    if (NATIVO) NATIVO.sair();
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
  try { localStorage.setItem(CACHE_TAREFAS, JSON.stringify(tarefas)); } catch { /* cheio */ }
  sincronizarNativo();
}

// Abre na hora com a última lista salva; a lista nova chega logo depois
const CACHE_TAREFAS = 'agenda-cache-tarefas';
function mostrarCache() {
  try {
    const salvas = JSON.parse(localStorage.getItem(CACHE_TAREFAS) || 'null');
    if (Array.isArray(salvas) && salvas.length) { tarefas = salvas; render(); }
  } catch { /* ignora */ }
}

/* ---------- como avisar: alarme ou só notificação ---------- */
let avisoSel = 'alarme';
function setAviso(v) {
  avisoSel = v === 'notificacao' ? 'notificacao' : 'alarme';
  document.querySelectorAll('#chips-aviso button').forEach((b) => b.classList.toggle('sel', b.dataset.aviso === avisoSel));
  atualizarProps();
}
document.querySelectorAll('#chips-aviso button').forEach((b) => b.addEventListener('click', () => setAviso(b.dataset.aviso)));
function mostrarAviso() { if ($('#f-lembrar').value) lembreteSel = 'outro'; atualizarProps(); }

/* ---------- configurações do app Android ---------- */
function mostrarMenuNativo() {
  if (!NATIVO) return;
  $('#menu-nativo').hidden = false;
  try { $('#nome-som').textContent = NATIVO.nomeSom(); } catch { /* ok */ }
  try { $('#versao-nativa').textContent = '(versão ' + NATIVO.versao() + ')'; } catch { /* ok */ }
}
window.somNativo = (nome) => { $('#nome-som').textContent = nome; toast('Som do alarme: ' + nome); };
if (NATIVO) {
  $('#menu-som').addEventListener('click', () => NATIVO.escolherSom());
  $('#menu-som-notif').addEventListener('click', () => NATIVO.somNotificacao());
  $('#menu-atualizar').addEventListener('click', () => { $('#dlg-menu').close(); NATIVO.verificarAtualizacao(); });
}

/* ---------- alarmes do Android ---------- */
// Manda para o celular a lista de lembretes; o Android agenda os alarmes de verdade
function sincronizarNativo() {
  if (!NATIVO) return;
  const lista = tarefas
    .filter((t) => t.status !== 'concluido' && t.lembrar_em && !String(t.id).startsWith('tmp-'))
    .map((t) => ({
      id: t.id,
      titulo: t.titulo,
      quem: t.quem_pediu || '',
      quando: new Date(t.lembrar_em).getTime(),
      recorrente: !!t.recorrencia,
      avisos: t.avisos_enviados ?? 0,
      tipo: t.tipo_aviso || 'alarme',
    }));
  try { NATIVO.agendar(JSON.stringify(lista)); } catch (e) { console.error(e); }
}

// Cada celular ganha um código secreto; com ele o Android busca as tarefas e responde aos botões do alarme
async function registrarAparelhoNativo() {
  let codigo = null;
  try { codigo = localStorage.getItem('agenda-aparelho'); } catch { /* ok */ }
  if (!codigo) {
    codigo = 'nativo:' + crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
    const { error } = await sb.from('push_inscricoes').upsert(
      { endpoint: codigo, p256dh: '-', auth: '-', aparelho: 'App Android' },
      { onConflict: 'endpoint' }
    );
    if (error) { toast('Alarmes: não consegui registrar o celular (' + error.message + ')'); return; }
    try { localStorage.setItem('agenda-aparelho', codigo); } catch { /* ok */ }
  }
  NATIVO.configurar(JSON.stringify({ url: SUPABASE_URL + '/functions/v1/lembretes', aparelho: codigo }));
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
  const antes = t ? t.status : 'a_fazer';
  atualizar(id, { status: 'concluido', concluido_em: agoraISO() });
  toast('Concluída ✓', 'Desfazer', () => atualizar(id, { status: antes, concluido_em: null }));
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
  const meta = [];
  if (t.prazo && !feita && (t.prazo !== h || aba !== 'hoje')) {
    meta.push(`<span class="${atrasada ? 'm-perigo' : ''}">${ic('calendario')}${atrasada ? 'Atrasada · ' : ''}${fmtData(t.prazo)}</span>`);
  }
  if (t.lembrar_em && !feita) meta.push(`<span>${ic(t.tipo_aviso === 'notificacao' ? 'sino' : 'alarme')}${fmtQuando(t.lembrar_em)}</span>`);
  if (t.quem_pediu) meta.push(`<span>${ic('pessoa')}${esc(t.quem_pediu)}</span>`);
  if (t.recorrencia) meta.push(`<span>${ic('repetir')}${descreverRec(t)}</span>`);
  if (feita && t.concluido_em) meta.push(`<span>${ic('check')}${fmtQuando(t.concluido_em)}</span>`);
  const tags = { fazendo: 'Fazendo', pausado: 'Pausada', aguardando: 'Aguardando' };
  const tag = !feita && tags[t.status] ? `<span class="tag tag-${t.status}">${tags[t.status]}</span>` : '';
  const nota = t.notas && !feita
    ? `<p class="linha-nota">${t.status === 'pausado' ? '<b>Parou em:</b> ' : ''}${esc(t.notas)}</p>` : '';
  return `<article class="linha s-${t.status}${atrasada ? ' atrasada' : ''}${feita ? ' feita' : ''}" data-id="${t.id}">
    <button type="button" class="check" data-acao="${feita ? 'reabrir' : 'concluir'}" aria-label="${feita ? 'Reabrir' : 'Concluir'}">${ic('check')}</button>
    <div class="linha-corpo" data-acao="menu">
      <div class="linha-titulo">${esc(t.titulo)}${tag}</div>
      ${meta.length ? `<div class="linha-meta">${meta.join('')}</div>` : ''}
      ${nota}
    </div>
  </article>`;
}

function secao(titulo, itens, classe = '') {
  if (!itens.length) return '';
  return `<section class="secao ${classe}"><div class="secao-titulo"><span>${titulo}</span><span class="contador">${itens.length}</span></div><div class="cards">${itens.map(card).join('')}</div></section>`;
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
  const pilula = (f, n, nome, cor) =>
    `<button type="button" data-filtro="${f}" class="pilula p-${cor} ${n ? '' : 'zerada'} ${sel(f)}"><b>${n}</b>${nome}</button>`;
  $('#resumo').innerHTML =
    pilula('atrasadas', atrasadas.length, atrasadas.length === 1 ? 'atrasada' : 'atrasadas', 'vermelho') +
    pilula('hoje', paraHoje.length, 'pra hoje', 'azul') +
    pilula('pausadas', pausadas.length, pausadas.length === 1 ? 'pausada' : 'pausadas', 'ambar') +
    pilula('abertas', abertas.length, 'abertas', 'cinza');
  const hora = new Date().getHours();
  $('#saudacao').textContent = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const d0 = new Date();
  const semana = d0.toLocaleDateString('pt-BR', { weekday: 'long' }).replace('-feira', '');
  const mes = d0.toLocaleDateString('pt-BR', { month: 'long' });
  $('#data-hoje').textContent = `${semana.charAt(0).toUpperCase() + semana.slice(1)}, ${d0.getDate()} de ${mes}`;

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
    html = `<div class="filtro-ativo"><span>${nome} · ${lista.length}</span><button type="button" data-limpar-filtro>Limpar filtro</button></div>`;
    html += lista.length ? `<section class="secao"><div class="cards">${lista.map(card).join('')}</div></section>` : `<div class="vazio"><strong>Nada aqui 🎉</strong>Nenhuma tarefa ${nome.toLowerCase()}.</div>`;
    $('#lista').innerHTML = html;
    return;
  }
  if (aba === 'hoje') {
    const usados = new Set();
    const pega = (fn) => abertas.filter((t) => !usados.has(t.id) && fn(t)).map((t) => (usados.add(t.id), t));
    html += secao('Atrasadas', pega((t) => t.prazo && t.prazo < h), 'perigo');
    html += secao('Fazendo agora', pega((t) => t.status === 'fazendo'));
    html += secao('Para hoje', pega((t) => t.prazo === h));
    html += secao('Pausadas', pega((t) => t.status === 'pausado'));
    html += secao('Aguardando alguém', pega((t) => t.status === 'aguardando'));
    html += secao('Amanhã', pega((t) => t.prazo === am));
    html += secao('Repetitivas no período de aviso', pega((t) => emPeriodoDeAviso(t)));
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
  const el = e.target.closest('.linha');
  if (!alvo || !el) return;
  const t = tarefas.find((x) => x.id === el.dataset.id);
  if (!t || String(t.id).startsWith('tmp-')) return;
  const acao = alvo.dataset.acao;
  if (acao === 'menu') abrirAcoes(t);
  else if (acao === 'editar') abrirTarefa(t);
  else if (acao === 'fazer') comecar(t.id);
  else if (acao === 'pausar') abrirPausa(t);
  else if (acao === 'concluir') { el.classList.add('saindo'); setTimeout(() => concluir(t.id), 260); }
  else if (acao === 'amanha') pularAmanha(t.id);
  else if (acao === 'reabrir') reabrir(t.id);
});

/* ---------- menu de ações da tarefa (toque na tarefa) ---------- */
let acoesId = null;
function abrirAcoes(t) {
  acoesId = t.id;
  const feita = t.status === 'concluido';
  $('#acoes-titulo').textContent = t.titulo;
  const linha = document.createElement('div');
  linha.innerHTML = card(t);
  $('#acoes-meta').innerHTML = linha.querySelector('.linha-meta')?.innerHTML || '';
  const item = (acao, icone, texto, classe = '') =>
    `<button type="button" data-a="${acao}" class="acao ${classe}">${ic(icone)}<span>${texto}</span></button>`;
  const itens = [];
  if (!feita) {
    if (t.status === 'fazendo') itens.push(item('pausar', 'pause', 'Pausar e anotar onde parei'));
    else itens.push(item('fazer', 'play', t.status === 'pausado' ? 'Retomar agora' : 'Começar agora', 'destaque'));
    itens.push(item('concluir', 'check', 'Concluir', 'ok'));
    if (t.prazo !== amanha() && !t.recorrencia) itens.push(item('amanha', 'seta', 'Passar para amanhã'));
  } else {
    itens.push(item('reabrir', 'desfazer', 'Reabrir tarefa'));
  }
  itens.push(item('editar', 'lapis', 'Editar'));
  itens.push(item('excluir', 'lixo', 'Excluir', 'perigo'));
  $('#acoes-lista').innerHTML = itens.join('');
  $('#dlg-acoes').showModal();
}
$('#acoes-lista').addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const t = tarefas.find((x) => x.id === acoesId);
  $('#dlg-acoes').close();
  if (!t) return;
  const a = b.dataset.a;
  if (a === 'fazer') comecar(t.id);
  else if (a === 'pausar') abrirPausa(t);
  else if (a === 'concluir') concluir(t.id);
  else if (a === 'amanha') pularAmanha(t.id);
  else if (a === 'reabrir') reabrir(t.id);
  else if (a === 'editar') abrirTarefa(t);
  else if (a === 'excluir') excluirTarefa(t);
});
$('#dlg-acoes').addEventListener('click', (e) => { if (e.target === $('#dlg-acoes')) $('#dlg-acoes').close(); });

/* ---------- nova / editar ---------- */
$('#f-status').innerHTML = Object.entries(STATUS).map(([v, n]) => `<option value="${v}">${n}</option>`).join('');

function setPrazo(v) {
  prazoSel = v;
  document.querySelectorAll('#chips-prazo button').forEach((b) => b.classList.toggle('sel', b.dataset.prazo === v));
  $('#f-prazo').hidden = v !== 'data';
  if (v === 'data' && !$('#f-prazo').value) $('#f-prazo').value = hoje();
  atualizarProps();
}

// tudo fica à vista: aqui só se atualiza o que está marcado
function abrirPainel() {}
function fecharPaineis() {}
let lembreteSel = '';
function atualizarProps() {
  const tem = !!$('#f-lembrar').value;
  if (!tem && lembreteSel !== 'outro') lembreteSel = '';
  document.querySelectorAll('#chips-lembrar button').forEach((b) => b.classList.toggle('sel', b.dataset.lembrar === lembreteSel));
  $('#f-lembrar').hidden = lembreteSel !== 'outro';
  $('#bloco-aviso').hidden = !tem;
  if (tem) {
    $('#dica-aviso').innerHTML = `<b>${fmtQuando(new Date($('#f-lembrar').value).toISOString())}</b> · ` +
      (avisoSel === 'alarme' ? 'toca alto, mesmo no silencioso, até você responder' : 'aparece no topo da tela, com som de notificação');
  }
  const q = $('#f-quem').value.trim();
  document.querySelectorAll('#sugestoes-quem button').forEach((b) => b.classList.toggle('sel', b.dataset.nome === q));
}
$('#f-quem').addEventListener('input', () => { mostrarSugestoesQuem(); atualizarProps(); });
$('#f-notas').addEventListener('input', atualizarProps);
$('#f-prazo').addEventListener('input', atualizarProps);

function mostrarSugestoesQuem() {
  const q = normalizar($('#f-quem').value.trim());
  const cont = {};
  tarefas.forEach((t) => { if (t.quem_pediu) cont[t.quem_pediu] = (cont[t.quem_pediu] || 0) + 1; });
  const nomes = Object.keys(cont).sort((a, b) => cont[b] - cont[a])
    .filter((n) => !q || normalizar(n).includes(q) || n === $('#f-quem').value.trim()).slice(0, 8);
  $('#sugestoes-quem').innerHTML = nomes.map((n) => `<button type="button" data-nome="${esc(n)}">${esc(n)}</button>`).join('');
}
$('#sugestoes-quem').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nome]');
  if (!b) return;
  $('#f-quem').value = $('#f-quem').value.trim() === b.dataset.nome ? '' : b.dataset.nome;
  mostrarSugestoesQuem();
  atualizarProps();
});
$('#f-quem').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

// status (só ao editar)
$('#opcoes-status').innerHTML = ['a_fazer', 'fazendo', 'pausado', 'aguardando', 'concluido']
  .map((v) => `<button type="button" data-status="${v}">${STATUS[v]}</button>`).join('');
function setStatusForm(v) {
  $('#f-status').value = v;
  document.querySelectorAll('#opcoes-status button').forEach((b) => b.classList.toggle('sel', b.dataset.status === v));
  atualizarProps();
}
$('#opcoes-status').addEventListener('click', (e) => {
  const b = e.target.closest('[data-status]');
  if (b) setStatusForm(b.dataset.status);
});

// título cresce com o texto; Enter salva
function ajustarTitulo() { const t = $('#f-titulo'); t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
$('#f-titulo').addEventListener('input', ajustarTitulo);
$('#f-titulo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#form-tarefa').requestSubmit(); } });
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
    lembreteSel = v;
    if (v === 'outro') {
      if (!$('#f-lembrar').value) { const x = new Date(Date.now() + 3600e3); x.setMinutes(0, 0, 0); $('#f-lembrar').value = paraInputLocal(x); }
      atualizarProps();
      return;
    }
    let d = null;
    if (v === '15min') d = new Date(Date.now() + 15 * 60e3);
    if (v === '1h') d = new Date(Date.now() + 3600e3);
    if (v === '3h') d = new Date(Date.now() + 3 * 3600e3);
    if (v === 'amanha-0630') { d = new Date(); d.setDate(d.getDate() + 1); d.setHours(6, 30, 0, 0); }
    $('#f-lembrar').value = d ? paraInputLocal(d) : '';
    atualizarProps();
  })
);
$('#f-lembrar').addEventListener('input', atualizarProps);

function setRep(v, inicial = false) {
  repSel = v || '';
  document.querySelectorAll('#chips-repetir button').forEach((b) => b.classList.toggle('sel', b.dataset.rep === repSel));
  $('#campos-recorrencia').hidden = !repSel;
  $('#linha-prazo').hidden = !!repSel;
  $('#linha-lembrar').hidden = !!repSel;
  $('#lbl-dia-mes').hidden = repSel !== 'mensal';
  $('#lbl-dia-semana').hidden = repSel !== 'semanal';
  if (!inicial) {
    if (repSel === 'semanal' && $('#f-dias-antes').value === '5') $('#f-dias-antes').value = '1';
    if (repSel === 'mensal' && $('#f-dias-antes').value === '1') $('#f-dias-antes').value = '5';
  }
  atualizarDicaRec();
  atualizarProps();
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
['#f-dia-mes', '#f-dia-semana', '#f-dias-antes', '#f-hora-aviso'].forEach((id) => $(id).addEventListener('input', () => { atualizarDicaRec(); atualizarProps(); }));

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
  setAviso(t?.tipo_aviso || 'alarme');
  $('#f-notas').value = t?.notas ?? '';
  $('#f-prazo').value = '';
  $('#linha-status').hidden = !t;
  $('#linha-notas').hidden = !t;
  lembreteSel = t?.lembrar_em ? 'outro' : '';
  mostrarSugestoesQuem();
  $('#btn-excluir').hidden = !t;
  fecharPaineis();

  if (!t) setPrazo('hoje');
  else if (!t.prazo) setPrazo('');
  else if (t.prazo === hoje()) setPrazo('hoje');
  else if (t.prazo === amanha()) setPrazo('amanha');
  else { $('#f-prazo').value = t.prazo; setPrazo('data'); }

  setStatusForm(t?.status ?? 'a_fazer');
  $('#btn-salvar').textContent = t ? 'Salvar' : 'Adicionar';
  $('#dlg-tarefa').showModal();
  ajustarTitulo();
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
    tipo_aviso: avisoSel,
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

$('#btn-excluir').addEventListener('click', () => {
  const t = tarefas.find((x) => x.id === editandoId);
  if (t) excluirTarefa(t);
});
async function excluirTarefa(t) {
  if (!(await confirmar(`Excluir "${t.titulo}"? Não dá para desfazer.`, 'Excluir', true))) return;
  if ($('#dlg-tarefa').open) $('#dlg-tarefa').close();
  const pos = tarefas.indexOf(t);
  tarefas = tarefas.filter((x) => x !== t);
  render();
  toast('Excluída');
  const { error } = await sb.from('tarefas').delete().eq('id', t.id);
  if (error) { tarefas.splice(pos, 0, t); render(); toast('Não excluiu: ' + error.message); }
}

/* ---------- criar tarefa falando ---------- */
const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
let ouvindo = null;
if (!Reconhecimento && !NATIVO) { $('#btn-voz').hidden = true; $('#fab-voz').hidden = true; }

// No app Android a voz é captada pelo próprio celular (Google)
window.falaNativa = (texto, erro) => {
  $('#btn-voz').classList.remove('ouvindo');
  if (texto) { $('#f-titulo').value = texto; aplicarFala(texto); }
  else statusVoz(erro === 'indisponivel' ? 'Este celular não tem o reconhecimento de voz do Google.' : 'Não ouvi nada. Toque no 🎤 e fale de novo.');
};

function statusVoz(msg) { const el = $('#voz-status'); el.hidden = !msg; el.textContent = msg || ''; }

function aplicarFala(frase) {
  const { titulo, quando } = interpretarFala(frase);
  $('#f-titulo').value = titulo || frase;
  if (quando) {
    $('#f-lembrar').value = paraInputLocal(quando);
    mostrarAviso();
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
  if (!Reconhecimento && NATIVO) {
    $('#btn-voz').classList.add('ouvindo');
    statusVoz('🎙️ Pode falar… (ex.: "ligar pro RH amanhã às 9")');
    NATIVO.ouvir();
    return;
  }
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
  if (NATIVO) return;   // no app Android quem toca é o alarme do celular
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
  if (NATIVO) { el.innerHTML = '<p class="ok-txt">✓ Alarmes do celular ativados</p>'; return; }
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
      ? `<div class="quadro-scroll" id="quadro-scroll">
           <div class="quadro-sizer" id="quadro-sizer"><div class="quadro-area" id="quadro-area"></div></div>
         </div>
         <div class="zoom-ctrl">
           <button type="button" data-zoom="-" aria-label="Diminuir zoom">−</button>
           <button type="button" data-zoom="100" id="zoom-valor" aria-label="Voltar para 100%">100%</button>
           <button type="button" data-zoom="+" aria-label="Aumentar zoom">+</button>
           <button type="button" data-zoom="tudo" class="zoom-tudo">Ver tudo</button>
         </div>
         <p class="dica-quadro" id="dica-quadro"></p>`
      : '<div class="grade" id="grade"></div>';
    if (modo === 'quadro') prepararZoom();
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
      el.style.left = Math.max(0, origX + (ev.clientX - inicioX) / zoomQuadro) + 'px';
      el.style.top = Math.max(0, origY + (ev.clientY - inicioY) / zoomQuadro) + 'px';
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
  const sc = $('#quadro-scroll');
  const W = Math.max(maxX + 400, sc ? sc.clientWidth / zoomQuadro : 0);
  const H = Math.max(maxY + 300, sc ? sc.clientHeight / zoomQuadro : 0);
  area.style.width = W + 'px';
  area.style.height = H + 'px';
  area.style.transform = `scale(${zoomQuadro})`;
  const sizer = $('#quadro-sizer');
  if (sizer) { sizer.style.width = W * zoomQuadro + 'px'; sizer.style.height = H * zoomQuadro + 'px'; }
  const v = $('#zoom-valor');
  if (v) v.textContent = Math.round(zoomQuadro * 100) + '%';
}

/* --- zoom do quadro (Ctrl + rolar, Ctrl +/−/0, botões) --- */
let zoomQuadro = (() => { try { return Number(localStorage.getItem('agenda-zoom')) || 1; } catch { return 1; } })();
function aplicarZoom(novo, ancoraX, ancoraY) {
  const sc = $('#quadro-scroll');
  if (!sc) return;
  novo = Math.min(2, Math.max(0.25, Math.round(novo * 100) / 100));
  const ax = ancoraX ?? sc.clientWidth / 2;
  const ay = ancoraY ?? sc.clientHeight / 2;
  const cx = (sc.scrollLeft + ax) / zoomQuadro;   // ponto do quadro embaixo do mouse
  const cy = (sc.scrollTop + ay) / zoomQuadro;
  zoomQuadro = novo;
  try { localStorage.setItem('agenda-zoom', String(novo)); } catch { /* ok */ }
  ajustarTamanhoArea();
  sc.scrollLeft = cx * novo - ax;                  // mantém esse ponto embaixo do mouse
  sc.scrollTop = cy * novo - ay;
}
function verTudo() {
  const sc = $('#quadro-scroll');
  if (!sc || !notas.length) { aplicarZoom(1); return; }
  const maxX = Math.max(...notas.map((n) => n.x + n.largura)) + 40;
  const maxY = Math.max(...notas.map((n) => n.y + n.altura)) + 40;
  const z = Math.min(1, sc.clientWidth / maxX, sc.clientHeight / maxY);
  aplicarZoom(z, 0, 0);
  sc.scrollLeft = 0; sc.scrollTop = 0;
}
function prepararZoom() {
  const sc = $('#quadro-scroll');
  sc.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;                         // rolar normal continua rolando
    e.preventDefault();                             // Ctrl+rolar: zoom só no quadro
    const r = sc.getBoundingClientRect();
    aplicarZoom(zoomQuadro * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $('#notas').querySelector('.zoom-ctrl').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]');
    if (!b) return;
    const z = b.dataset.zoom;
    if (z === '+') aplicarZoom(zoomQuadro * 1.2);
    else if (z === '-') aplicarZoom(zoomQuadro / 1.2);
    else if (z === '100') aplicarZoom(1);
    else verTudo();
  });
  // arrastar o fundo vazio move a visão
  sc.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !(e.target === sc || e.target.id === 'quadro-area' || e.target.id === 'quadro-sizer')) return;
    const x0 = e.clientX, y0 = e.clientY, sl = sc.scrollLeft, st = sc.scrollTop;
    sc.classList.add('movendo');
    sc.setPointerCapture(e.pointerId);
    const mover = (ev) => { sc.scrollLeft = sl - (ev.clientX - x0); sc.scrollTop = st - (ev.clientY - y0); };
    const soltar = () => { sc.classList.remove('movendo'); sc.removeEventListener('pointermove', mover); sc.removeEventListener('pointerup', soltar); };
    sc.addEventListener('pointermove', mover);
    sc.addEventListener('pointerup', soltar);
  });
}
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || aba !== 'notas' || $('#notas').dataset.modo !== 'quadro') return;
  if (e.key === '+' || e.key === '=') { e.preventDefault(); aplicarZoom(zoomQuadro * 1.2); }
  else if (e.key === '-') { e.preventDefault(); aplicarZoom(zoomQuadro / 1.2); }
  else if (e.key === '0') { e.preventDefault(); aplicarZoom(1); }
});

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
    ? 'Ctrl + rolar = zoom · arraste o fundo para mover · Ctrl+B = negrito'
    : 'Quadro vazio — clique no + para colar o primeiro post-it';
  ajustarTamanhoArea();
}

// procura um lugar vazio na parte visível do quadro (lado a lado, sem empilhar)
function espacoLivre(c) {
  const L = 230, A = 210, gap = 24;
  const x0 = c.scrollLeft / zoomQuadro + gap, y0 = c.scrollTop / zoomQuadro + gap;
  const colunas = Math.max(1, Math.floor((c.clientWidth / zoomQuadro - gap) / (L + gap)));
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
  if (quadro) [x, y] = espacoLivre($('#quadro-scroll'));
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
const VERSAO_APP = 24;
// Tema pelo horário: claro das 07h às 18h, escuro das 18h às 07h (confere a cada minuto)
function temaEscolhido() { try { return localStorage.getItem('agenda-tema') || 'auto'; } catch { return 'auto'; } }
function aplicarTema() {
  const h = new Date().getHours();
  const pref = temaEscolhido();
  const escuro = pref === 'escuro' || (pref === 'auto' && (h >= 18 || h < 7));
  document.documentElement.classList.toggle('escuro', escuro);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', escuro ? '#0b1120' : '#f4f6fa');
  // no app Android, a barra de status e a de baixo acompanham a cor da tela
  if (NATIVO && NATIVO.cores) { try { NATIVO.cores(escuro ? '#0b1120' : '#f4f6fa', escuro ? '#141c2e' : '#ffffff', escuro); } catch { /* versão antiga */ } }
}
aplicarTema();
setInterval(aplicarTema, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) aplicarTema(); });
// Atualização automática: ao abrir/voltar pro app, busca versão nova e recarrega sozinho
if ('serviceWorker' in navigator && !NATIVO) {
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
