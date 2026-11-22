// Entende frases faladas e separa: o QUE fazer e QUANDO lembrar.
// Ex.: "lembrar de perguntar à Jéssica sobre as férias daqui a 2 horas"
//   -> titulo: "Perguntar à Jéssica sobre as férias", quando: agora + 2h

const NUMEROS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7,
  oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15,
  dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
};
const NUM = '(\\d{1,3}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta)';
const DIAS = { domingo: 0, segunda: 1, 'terça': 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, 'sábado': 6, sabado: 6 };
const valor = (t) => (/^\d+$/.test(t) ? Number(t) : NUMEROS[t] ?? NUMEROS[t.replace('ê', 'e')]);

export function interpretarFala(frase, agora = new Date()) {
  let txt = ` ${frase.trim()} `;
  let quando = null;   // Date do lembrete
  let dia = null;      // Date (só a data) quando falou um dia
  let hora = null;     // [h, m]
  const tira = (re) => { txt = txt.replace(re, ' '); };

  // --- relativo: "daqui a 2 horas", "em 30 minutos", "daqui meia hora", "daqui a uma hora e meia"
  let m = txt.match(new RegExp(`\\s(?:daqui a|daqui|dentro de|em)\\s+(?:${NUM}\\s+)?(meia hora|minutos?|min|horas?|hrs?|hs?|dias?)(\\s+e\\s+meia)?(?=[\\s,.!?])`, 'i'));
  if (m) {
    const qtd = m[1] ? valor(m[1].toLowerCase()) : (m[2].toLowerCase() === 'meia hora' ? 0 : 1);
    const un = m[2].toLowerCase();
    let ms = 0;
    if (un === 'meia hora') ms = 30 * 60000;
    else if (un.startsWith('min')) ms = qtd * 60000;
    else if (un.startsWith('d')) ms = qtd * 86400000;
    else ms = qtd * 3600000;
    if (m[3]) ms += 30 * 60000;
    if (qtd !== undefined && ms > 0) { quando = new Date(agora.getTime() + ms); tira(m[0]); }
  }

  if (!quando) {
    // --- dia: "depois de amanhã", "amanhã", "hoje", "sexta", "na segunda-feira"
    const base = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    if ((m = txt.match(/\s(depois de amanh[ãa])(?=[\s,.!?])/i))) { dia = new Date(base); dia.setDate(dia.getDate() + 2); tira(m[0]); }
    else if ((m = txt.match(/\s(amanh[ãa])(?=[\s,.!?])/i))) { dia = new Date(base); dia.setDate(dia.getDate() + 1); tira(m[0]); }
    else if ((m = txt.match(/\s(hoje)(?=[\s,.!?])/i))) { dia = new Date(base); tira(m[0]); }
    else if ((m = txt.match(/\s(?:na |no |nesta |neste |essa |esta |pr[óo]xima |pr[óo]ximo )?(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(?:-feira| feira)?(?=[\s,.!?])/i))) {
      const alvo = DIAS[m[1].toLowerCase()];
      dia = new Date(base);
      do { dia.setDate(dia.getDate() + 1); } while (dia.getDay() !== alvo);
      tira(m[0]);
    }

    // --- hora: "às 9", "às 14h30", "as 9 da manhã", "às 3 da tarde", "meio-dia", "16:30"
    if ((m = txt.match(/\s(?:[àa]s?\s+|ao\s+)?meio[- ]dia(?:\s+e\s+meia)?(?=[\s,.!?])/i))) {
      hora = [12, /meia/i.test(m[0]) ? 30 : 0]; tira(m[0]);
    } else if ((m = txt.match(new RegExp(`\\s(?:[àa]s?|pelas|lá pelas)\\s+${NUM}(?:\\s*(?::|h|hs|horas?)\\s*(\\d{1,2})?)?(\\s+e\\s+meia)?(?:\\s*(?:h|hs|horas?))?(?:\\s+(?:da|de)\\s+(manh[ãa]|tarde|noite))?(?=[\\s,.!?])`, 'i')))
      || (m = txt.match(/\s(\d{1,2})\s*(?::|h|hs)\s*(\d{2})?(\s+e\s+meia)?(?:\s+(?:da|de)\s+(manh[ãa]|tarde|noite))?(?=[\s,.!?])/i))) {
      let h = valor(m[1].toLowerCase());
      let min = m[2] ? Number(m[2]) : (m[3] ? 30 : 0);
      const periodo = (m[4] || '').toLowerCase();
      if ((periodo === 'tarde' || periodo === 'noite') && h < 12) h += 12;
      if (h !== undefined && h <= 23 && min <= 59) { hora = [h, min]; tira(m[0]); }
    }

    if (dia || hora) {
      const d = dia ? new Date(dia) : new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
      const [h, min] = hora || [8, 0];                       // falou só o dia: lembra às 08:00
      d.setHours(h, min, 0, 0);
      if (!dia && d <= agora) d.setDate(d.getDate() + 1);    // "às 9" e já passou: amanhã
      quando = d;
    }
  }

  // --- limpa o começo: "me lembra de", "lembrar de", "lembrete:", "anota aí"
  txt = txt
    .replace(/^\s*(?:ok\s+)?(?:me\s+)?(?:lembr(?:e|a|ar)(?:-me)?(?:\s+me)?|lembrete|anot(?:a|ar|e)(?:\s+a[ií])?|criar?\s+(?:uma\s+)?tarefa)\s*(?:de|que|para|pra|:)?\s+/i, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[,.\-–:]+|[,\-–:]+$/g, '')
    .trim();
  const titulo = txt ? txt.charAt(0).toUpperCase() + txt.slice(1) : '';
  return { titulo, quando };
}
