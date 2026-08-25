// api/dashboard.js
// Le todas as abas da planilha PERPETUO GERAL e devolve um JSON unico
// com os dados dos 5 produtos. O index carrega isso uma vez e filtra local.

import { verifyToken } from '../lib/auth.js';
import { getValues } from '../lib/sheets.js';

const SPREADSHEET_ID = '1yw82Xywh0pTDj10Kwq7jfpezE14gyBGwFsbDLiAXjYY';

// Cada produto sabe de quais abas puxar seus dados.
//
// As colunas do investimento sao descobertas pelo CABECALHO, nao pela
// posicao: cada rede exporta num layout diferente e as abas mudam de tempos
// em tempos. Os indices abaixo sao so o plano B, usados quando o cabecalho
// nao e' reconhecido.
const PRODUTOS = {
  'PFCC BRASIL': {
    leads:  'LEADS PFCC BRASIL',
    etapa:  'ETAPA PFCC BRASIL',
    ganhos: 'GANHOS PFCC BRASIL',
    investimento: [
      { rede: 'Meta',     aba: 'INVESTIMENTO META PFCC BRASIL',     colData: 6, colValor: 7 },
      { rede: 'Google',   aba: 'INVESTIMENTO GOOGLE PFCC BRASIL',   colData: 5, colValor: 6 },
      { rede: 'LinkedIn', aba: 'INVESTIMENTO LINKEDIN PFCC BRASIL', colData: 6, colValor: 7 },
    ],
  },
  'PFCC MÉXICO': {
    leads:  'LEADS PFCC MÉXICO',
    etapa:  'ETAPA PFCC MÉXICO',
    ganhos: 'GANHOS PFCC MÉXICO',
    investimento: [
      { rede: 'Meta',     aba: 'INVESTIMENTO META PFCC MEXICO',     colData: 6, colValor: 7 },
      { rede: 'Google',   aba: 'INVESTIMENTO GOOGLE PFCC MEXICO',   colData: 5, colValor: 6 },
      { rede: 'LinkedIn', aba: 'INVESTIMENTO LINKEDIN PFCC MEXICO', colData: 6, colValor: 7 },
    ],
  },
  'PFCC CHILE': {
    leads:  'LEADS PFCC CHILE',
    etapa:  'ETAPA PFCC CHILE',
    ganhos: 'GANHOS PFCC CHILE',
    investimento: [
      { rede: 'Meta',     aba: 'INVESTIMENTO META PFCC CHILE',     colData: 6, colValor: 7 },
      { rede: 'Google',   aba: 'INVESTIMENTO GOOGLE PFCC CHILE',   colData: 5, colValor: 6 },
      { rede: 'LinkedIn', aba: 'INVESTIMENTO LINKEDIN PFCC CHILE', colData: 6, colValor: 7 },
    ],
  },
  'LEAN': {
    leads:  'LEADS LEAN',
    etapa:  'ETAPA LEAN',
    ganhos: 'GANHOS LEAN',
    investimento: [
      { rede: 'Meta',     aba: 'INVESTIMENTO META LEAN',     colData: 6, colValor: 7 },
      { rede: 'LinkedIn', aba: 'INVESTIMENTO LINKEDIN LEAN', colData: 6, colValor: 7 },
    ],
  },
  'CES': {
    leads:  'LEADS CES',
    etapa:  'ETAPA CES',
    ganhos: 'GANHOS CES',
    investimento: [
      { rede: 'Meta',     aba: 'INVESTIMENTO META CES',     colData: 7, colValor: 8 },
      { rede: 'LinkedIn', aba: 'INVESTIMENTO LINKEDIN CES', colData: 6, colValor: 7 },
    ],
  },
};

// ── Separacao por pais dentro da mesma conta ─────────────────────────────
// Google e LinkedIn exportam Brasil, Mexico e Chile misturados: o pais so
// aparece no nome da campanha. Sem separar, o gasto de LATAM era somado no
// Brasil e os tres CPLs saiam errados.
//
// Comparamos sobre o nome normalizado (minusculo, sem acento, pontuacao
// virando espaco), entao "[MX]", "[ MX ]" e "MEXICO" caem no mesmo teste.
// O \b evita que "mx" case dentro de outra palavra.
//
// ATENCAO ao editar: MX = Mexico, CL = Chile, pelo codigo ISO. Se as
// campanhas estiverem nomeadas ao contrario na plataforma, e' aqui que se
// inverte — e so aqui.
const MARCA_PAIS = {
  'PFCC MÉXICO': /\b(mx|mexico)\b/,
  'PFCC CHILE':  /\b(cl|chile)\b/,
};

// Brasil e' o que sobra: entra tudo que NAO carrega marca de outro pais.
// Mesma logica que o update_all.py usa pra classificar os leads.
const MARCA_LATAM = /\b(mx|mexico|cl|chile)\b/;

// Campanhas que existem mas nao sao de aquisicao dos produtos: eventos,
// pesquisas e afins.
//
// Espelha a CAMPANHAS_FORA do update_all.py de proposito. La estes termos
// ja tiram os LEADS, em todas as redes — se o investimento nao tirasse os
// mesmos, uma campanha de workshop entraria com gasto e sem lead nenhum, e
// o CPL do produto subiria por um motivo que ninguem consegue rastrear.
const CAMPANHAS_FORA = [
  'hotseat', 'summit', 'ppc', 'pesquisa', 'masterclass', 'coautoria',
  'workshop',
];

// Minusculo, sem acento, pontuacao virando espaco: "[TD][PFCC][MX]" vira
// "td pfcc mx", e ai o \b funciona nos testes acima
const normNome = s => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const ABA_BACKLOG  = 'BACKLOG MQL';
const ABA_REUNIOES = 'BACKLOG REUNIÕES';
const ABA_PERDIDOS = 'BACKLOG PERDIDOS';
const ABA_META     = 'ATUALIZAÇÃO';

function checkAuth(req) {
  const secret = process.env.SESSION_SECRET;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return secret ? verifyToken(token, secret) : null;
}

function parseNum(v) {
  if (v === undefined || v === null || v === '') return 0;
  const s = String(v).replace(/[R$\s%]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Score tem parser proprio: o parseNum acima e' de moeda brasileira e
// descarta o ponto achando que e' separador de milhar — "6.45" viraria 645.
// Aqui o ponto E' decimal, e a virgula tambem, por seguranca.
function parseScore(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).trim().replace(',', '.'));
  if (isNaN(n)) return null;
  // Score de verdade vai de 0 a 10; acima disso e' lixo no campo
  return n >= 0 && n <= 100 ? n : null;
}

// Aceita 12/08/2026 ou 2026-08-12 e devolve sempre DD/MM
function normalizarData(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.includes('/')) {
    const [d, m] = s.split('/');
    if (!d || !m) return null;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}`;
  }
  if (s.includes('-')) {
    const [, m, d] = s.split('-');
    if (!d || !m) return null;
    return `${d.slice(0, 2).padStart(2, '0')}/${m.padStart(2, '0')}`;
  }
  return null;
}

// Minusculas, sem acento — pra comparar cabecalho sem depender de grafia
const chave = s => String(s || '').toLowerCase().trim()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ── Onde estao as colunas do investimento ────────────────────────────────
// Cada rede exporta com nomes proprios (Meta em ingles, Google e LinkedIn
// as vezes em portugues), entao cada campo aceita varios rotulos. O que nao
// for encontrado volta -1 e simplesmente nao e' lido.
const ROTULOS = {
  data:     ['day', 'dia', 'data', 'date', 'reporting starts'],
  // "campaign name" antes de "campaign": no LinkedIn existem as duas
  // colunas (Campaign Name e Campaign Group Name) e a busca frouxa por
  // "campaign" acharia a primeira que aparecesse
  campanha: ['campaign name', 'campanha', 'nome da campanha', 'campaign'],
  conjunto: ['ad set name', 'conjunto', 'nome do conjunto de anuncios',
             'ad set', 'grupo de anuncios', 'ad group name', 'ad group'],
  anuncio:  ['ad name', 'anuncio', 'nome do anuncio', 'creative name', 'ad'],
  // Campo proprio, nao um apelido de conjunto: no LinkedIn a hierarquia e'
  // Campaign Group > Campaign > Ad, ou seja, o inverso do Meta. O grupo e'
  // o nivel de cima — e e' ele que a utm_campaign do lead carrega.
  grupo:    ['campaign group name', 'campaign group', 'grupo de campanhas'],
  // O Google grava o ID numerico na utm_campaign do lead, nao o nome.
  // Entao o cruzamento e' por ID e o nome serve so pra exibir. Precisa vir
  // como campo proprio: 'ad id' bate exato na passada 1 e fica reservado,
  // senao a busca frouxa por 'ad' levaria essa coluna pro anuncio.
  idCampanha: ['ad id', 'campaign id', 'id da campanha', 'ad group id', 'id'],
  valor:    ['amount spent', 'cost in local currency', 'valor gasto',
             'valor usado', 'investimento', 'custo', 'cost', 'spend', 'gasto'],
};

function acharColunas(cabecalho) {
  const cols = {};
  const norm = (cabecalho || []).map(chave);
  const campos = Object.keys(ROTULOS);

  // Passada 1: igualdade exata. E' inequivoca, entao vem antes — sem ela,
  // procurar "ad" acharia "Ad Set Name" e trocaria anuncio por conjunto.
  for (const campo of campos) {
    const nomes = ROTULOS[campo];
    cols[campo] = norm.findIndex(c => c && nomes.some(n => c === chave(n)));
  }

  // Passada 2: "contem", pra pegar "Amount spent (BRL)" e
  // "Cost In Local Currency (Spend)". Colunas ja tomadas na passada 1
  // ficam de fora — no LinkedIn, "campaign" bateria em Campaign Name de
  // novo e o conjunto herdaria a coluna errada.
  const usadas = new Set(Object.values(cols).filter(i => i >= 0));
  for (const campo of campos) {
    if (cols[campo] >= 0) continue;
    const nomes = ROTULOS[campo];
    const i = norm.findIndex((c, idx) =>
      c && !usadas.has(idx) && nomes.some(n => c.includes(chave(n))));
    if (i >= 0) { cols[campo] = i; usadas.add(i); }
  }

  return cols;
}

// ── Um cliente, uma venda ────────────────────────────────────────────────
// O mesmo comprador aparece em varios negocios no Pipedrive (o combo
// CES + HBC vira tres linhas). Somamos o valor e deixamos uma linha so,
// senao o Vol. Ganhos conta a mesma pessoa tres vezes e o CAC sai menor
// do que e'.
//
// Agrupamos por email E MES, nao so por email. A consolidacao roda aqui,
// antes de o front filtrar por periodo — juntar uma venda de maio com uma
// de agosto daria uma linha com uma data so, e o faturamento de um dos
// meses mudaria de lugar. Dentro do mes, o total de cada periodo fica
// identico e so a contagem muda.
//
// A planilha continua intacta: isto e' leitura, nao escrita.
function consolidarPorEmail(ganhos) {
  const grupos = new Map();
  const soltos = [];

  for (const g of ganhos) {
    const email = String(g.email || '').trim().toLowerCase();
    // Sem email nao da pra saber se e' a mesma pessoa — fica como esta
    if (!email) { soltos.push({ ...g, negocios: 1, ids: [g.id] }); continue; }

    // A data ja vem normalizada como DD/MM
    const mes = String(g.data || '').slice(3, 5);
    const chave = email + '|' + mes;

    const atual = grupos.get(chave);
    if (!atual) {
      grupos.set(chave, { ...g, negocios: 1, ids: [g.id], maiorValor: g.valor });
      continue;
    }

    atual.valor += g.valor;
    atual.negocios += 1;
    atual.ids.push(g.id);

    // "Vale?" e' marcacao manual por negocio. Se qualquer um do grupo foi
    // validado, a venda consolidada vale — por isso o campo NAO entra na
    // chave de agrupamento: senao o mesmo comprador viraria duas linhas,
    // uma com os negocios marcados e outra com os nao marcados.
    if (g.vale === 'sim') atual.vale = 'sim';

    // Utms e produto vem do negocio de maior valor: e' o que melhor
    // representa a compra na atribuicao por campanha
    if (g.valor > atual.maiorValor) {
      atual.maiorValor = g.valor;
      atual.id       = g.id;
      atual.produto  = g.produto;
      atual.campanha = g.campanha;
      atual.source   = g.source;
      atual.medium   = g.medium;
      atual.content  = g.content;
      atual.term     = g.term;
    }

    // Data: a mais recente do grupo. Como todos sao do mesmo mes, comparar
    // DD/MM como texto ja ordena certo.
    if ((g.data || '') > (atual.data || '')) atual.data = g.data;
  }

  return [...grupos.values(), ...soltos];
}

// "DD/MM" vira MMDD, pra comparar data sem montar objeto Date
function paraOrdem(ddmm) {
  const [d, m] = String(ddmm || '').split('/');
  return (Number(m) || 0) * 100 + (Number(d) || 0);
}

// Le uma aba e nunca derruba a resposta inteira se ela nao existir
async function lerAba(range) {
  try {
    return await getValues({ spreadsheetId: SPREADSHEET_ID, range: `'${range}'` });
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  if (!checkAuth(req)) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

  try {
    // Monta a lista de todas as abas que precisamos e busca em paralelo
    const tarefas = [];
    const indice  = {};

    for (const [produto, cfg] of Object.entries(PRODUTOS)) {
      indice[produto] = { leads: tarefas.length };
      tarefas.push(lerAba(cfg.leads));

      indice[produto].etapa = tarefas.length;
      tarefas.push(lerAba(cfg.etapa));

      indice[produto].ganhos = tarefas.length;
      tarefas.push(lerAba(cfg.ganhos));

      indice[produto].investimento = [];
      for (const inv of cfg.investimento) {
        indice[produto].investimento.push({ ...inv, idx: tarefas.length });
        tarefas.push(lerAba(inv.aba));
      }
    }

    const idxBacklog = tarefas.length;
    tarefas.push(lerAba(ABA_BACKLOG));

    const idxReunioes = tarefas.length;
    tarefas.push(lerAba(ABA_REUNIOES));

    const idxPerdidos = tarefas.length;
    tarefas.push(lerAba(ABA_PERDIDOS));

    const idxMeta = tarefas.length;
    tarefas.push(lerAba(ABA_META));

    const resultados = await Promise.all(tarefas);

    // ── Monta cada produto ────────────────────────────────────────────────
    const produtos = {};

    for (const [nomeProduto, cfg] of Object.entries(PRODUTOS)) {
      const ref = indice[nomeProduto];

      // Leads por dia: Data | Leads | MQL
      const leadsPorDia = [];
      for (const linha of (resultados[ref.leads] || []).slice(1)) {
        const data = normalizarData(linha[0]);
        if (!data) continue;
        leadsPorDia.push({
          data,
          leads: parseNum(linha[1]),
          mqls:  parseNum(linha[2]),
        });
      }

      // Etapas do funil: Etapa | Qtd (a linha TOTAL fica de fora)
      const etapas = [];
      for (const linha of (resultados[ref.etapa] || []).slice(1)) {
        const nome = String(linha[0] || '').trim();
        if (!nome || nome.toUpperCase() === 'TOTAL') continue;
        etapas.push({ etapa: nome, qtd: parseNum(linha[1]) });
      }

      // Ganhos: uma linha por venda, com "Vale?" na ultima coluna
      const ganhosBrutos = [];
      for (const linha of (resultados[ref.ganhos] || []).slice(1)) {
        const data = normalizarData(linha[0]);
        if (!data) continue;
        ganhosBrutos.push({
          data,
          id:       linha[1] || '',
          nome:     linha[2] || '',
          email:    linha[3] || '',
          produto:  linha[4] || '',
          valor:    parseNum(linha[5]),
          campanha: linha[6] || '',
          source:   linha[7] || '',
          medium:   linha[8] || '',
          content:  linha[9] || '',
          term:     linha[10] || '',
          vale:     String(linha[11] || '').trim().toLowerCase(),
        });
      }

      // Mesmo comprador com varios negocios vira uma linha so
      const ganhos = consolidarPorEmail(ganhosBrutos);

      // ── Investimento ────────────────────────────────────────────────
      // Quatro saidas da mesma leitura:
      //   investPorRede / investPorDia / investDiaRede — totais que o
      //     dashboard ja usava
      //   investLinhas — uma linha por dia+campanha+conjunto+anuncio, que
      //     e' o que alimenta a aba Campanhas
      const investPorRede = {};
      const investPorDia  = {};
      const investDiaRede = {};
      const investLinhas  = [];

      for (const inv of ref.investimento) {
        const aba = resultados[inv.idx] || [];
        let totalRede = 0;
        investDiaRede[inv.rede] = {};

        // ── Duas leituras da MESMA aba, de proposito ──────────────────
        //
        // 1) TOTAIS (cards, CPL, CPMQL, ROAS): colunas fixas do config,
        //    exatamente como era antes. Sao os numeros que o time ja
        //    conhece e compara com a planilha na mao.
        //
        // 2) ABA CAMPANHAS: colunas achadas pelo cabecalho, com separacao
        //    por pais e exclusao das campanhas fora de aquisicao.
        //
        // Os dois nao batem, e isso e' esperado: o (2) tira workshop e
        // manda campanha de outro pais pro produto certo. A aba Campanhas
        // mostra essa diferenca na tela pra ninguem achar que e' erro.
        const cData  = inv.colData;
        const cValor = inv.colValor;

        for (const linha of aba.slice(1)) {
          const data = normalizarData(linha[cData]);
          const val  = parseNum(linha[cValor]);
          if (!data || !val) continue;

          totalRede += val;
          investPorDia[data] = (investPorDia[data] || 0) + val;
          investDiaRede[inv.rede][data] = (investDiaRede[inv.rede][data] || 0) + val;
        }
        investPorRede[inv.rede] = totalRede;

        // ── Leitura 2: detalhe por campanha ───────────────────────────
        const cols = acharColunas(aba[0] || []);
        const cDataDet  = cols.data  >= 0 ? cols.data  : inv.colData;
        const cValorDet = cols.valor >= 0 ? cols.valor : inv.colValor;

        const marca = MARCA_PAIS[nomeProduto];
        const filtraPais = !!(marca || nomeProduto === 'PFCC BRASIL');

        const candidatas = [];
        let barradasPorPais = 0;
        // Destas, quantas citavam algum pais — ver a rede de seguranca
        let barradasComPais = 0;

        for (const linha of aba.slice(1)) {
          const data = normalizarData(linha[cDataDet]);
          const val  = parseNum(linha[cValorDet]);
          if (!data || !val) continue;

          // O nome pode estar em Campaign Name ou no grupo, dependendo da
          // exportacao — olhamos os dois
          const nomeCamp = normNome([
            cols.campanha >= 0 ? linha[cols.campanha] : '',
            cols.grupo    >= 0 ? linha[cols.grupo]    : '',
          ].join(' '));

          // Fora de aquisicao: vale pra toda rede e todo produto
          if (CAMPANHAS_FORA.some(t => nomeCamp.includes(t))) continue;

          if (filtraPais) {
            const doPais = marca
              ? marca.test(nomeCamp)         // Mexico/Chile: precisa da marca
              : !MARCA_LATAM.test(nomeCamp); // Brasil: nao pode ter marca
            if (!doPais) {
              barradasPorPais++;
              if (MARCA_LATAM.test(nomeCamp)) barradasComPais++;
              continue;
            }
          }

          candidatas.push({ linha, data, val });
        }

        // Rede de seguranca, so pro caso de as campanhas nao citarem pais
        // nenhum no nome: ai nao da pra classificar e e' melhor listar
        // tudo do que deixar a aba Campanhas vazia sem explicacao.
        //
        // A condicao e' "nenhuma barrada tinha marca de pais". Se as
        // campanhas citam OUTRO pais — o caso da aba do Mexico que tinha
        // so campanha do Chile — a classificacao funcionou e o vazio e' a
        // resposta certa. Sem esse teste, a rede de seguranca devolvia
        // justamente o que o filtro tinha acabado de tirar.
        const usarTodas = filtraPais && marca
          && candidatas.length === 0
          && barradasPorPais > 0
          && !barradasComPais;
        if (usarTodas) {
          console.warn(`[${inv.aba}] nenhuma campanha cita o pais no nome; `
            + `listando a aba inteira em ${nomeProduto}`);
          for (const linha of aba.slice(1)) {
            const data = normalizarData(linha[cDataDet]);
            const val  = parseNum(linha[cValorDet]);
            if (!data || !val) continue;
            const nomeCamp = normNome([
              cols.campanha >= 0 ? linha[cols.campanha] : '',
              cols.grupo    >= 0 ? linha[cols.grupo]    : '',
            ].join(' '));
            if (CAMPANHAS_FORA.some(t => nomeCamp.includes(t))) continue;
            candidatas.push({ linha, data, val });
          }
        }

        for (const { linha, data, val } of candidatas) {
          const txt = i => i >= 0 ? String(linha[i] || '').trim() : '';

          // Hierarquia invertida no LinkedIn: la e' Campaign Group >
          // Campaign > Ad, o contrario do Meta. Quando a aba traz a coluna
          // de grupo, ela E' a campanha, e o "Campaign Name" desce pra
          // conjunto. Sem isso o cruzamento nao acha lead nenhum: a
          // utm_campaign do lead carrega o nome do GRUPO.
          const temGrupo = cols.grupo >= 0;

          investLinhas.push({
            data,
            rede:     inv.rede,
            campanha: temGrupo ? txt(cols.grupo)    : txt(cols.campanha),
            conjunto: temGrupo ? txt(cols.campanha) : txt(cols.conjunto),
            anuncio:  txt(cols.anuncio),
            // So numeros: e' assim que a utm do Google chega no Pipedrive
            idCampanha: cols.idCampanha >= 0
              ? txt(cols.idCampanha).replace(/\D/g, '') : '',
            valor:    val,
          });
        }
      }

      const totalInvestimento = Object.values(investPorRede).reduce((s, v) => s + v, 0);
      const totalLeads = leadsPorDia.reduce((s, d) => s + d.leads, 0);
      const totalMqls  = leadsPorDia.reduce((s, d) => s + d.mqls, 0);

      // So conta faturamento das vendas marcadas como "sim" na coluna Vale?
      const ganhosValidos  = ganhos.filter(g => g.vale === 'sim');
      const totalGanhos    = ganhosValidos.length;
      const faturamento    = ganhosValidos.reduce((s, g) => s + g.valor, 0);

      produtos[nomeProduto] = {
        leadsPorDia,
        etapas,
        ganhos,
        // Quantos NEGOCIOS existiam antes da consolidacao. A aba Ganhos
        // mostra os dois numeros, senao a contagem nao bate com a planilha
        // e parece erro. E' a contagem, nao o array — mandar o array
        // inteiro dobraria o tamanho da resposta a toa.
        qtdNegocios: ganhosBrutos.length,
        investPorRede,
        investPorDia,
        investDiaRede,
        investLinhas,
        kpis: {
          leads:        totalLeads,
          mqls:         totalMqls,
          investimento: totalInvestimento,
          ganhos:       totalGanhos,
          faturamento,
          roas: totalInvestimento ? faturamento / totalInvestimento : 0,
          // MQL e' subconjunto de leads: CPL divide so por leads
          cpl:   totalLeads ? totalInvestimento / totalLeads : 0,
          cpmql: totalMqls   ? totalInvestimento / totalMqls   : 0,
          cac:   totalGanhos ? totalInvestimento / totalGanhos : 0,
        },
      };
    }

    // ── Backlog: uma linha por lead, de todos os produtos ─────────────────
    const backlog = [];
    for (const linha of (resultados[idxBacklog] || []).slice(1)) {
      if (!linha[0]) continue;
      backlog.push({
        id:          linha[0],
        produto:     linha[1]  || '',
        nomeProduto: linha[2]  || '',
        nome:        linha[3]  || '',
        email:       linha[4]  || '',
        cargo:       linha[5]  || '',
        mql:         String(linha[6] || '').trim() !== '',
        funil:       linha[7]  || '',
        reaplicacao: String(linha[8] || '').trim() !== '',
        etapa:       linha[9]  || '',
        proprietario:linha[10] || '',
        status:      linha[11] || '',
        valor:       parseNum(linha[12]),
        aplicacao:   linha[13] || '',
        campanha:    linha[14] || '',
        source:      linha[15] || '',
        // medium e content sao conjunto e anuncio: a aba Campanhas cruza
        // os leads com o investimento por estes campos
        medium:      linha[16] || '',
        content:     linha[17] || '',
        term:        linha[18] || '',
        // So vem preenchido em lead perdido; vazio no resto
        motivoPerda: linha[19] || '',
        dataPerda:   linha[20] || '',
        // Score: null quando o campo esta vazio, pra separar "sem score"
        // de "score zero" — sao coisas diferentes na leitura
        score:       parseScore(linha[21]),
      });
    }

    // ── Reunioes: mesma estrutura do backlog ─────────────────────────────
    const reunioes = [];
    for (const linha of (resultados[idxReunioes] || []).slice(1)) {
      if (!linha[0]) continue;
      reunioes.push({
        id:           linha[0],
        produto:      linha[1]  || '',
        nome:         linha[3]  || '',
        cargo:        linha[5]  || '',
        mql:          String(linha[6] || '').trim() !== '',
        funil:        linha[7]  || '',
        etapa:        linha[8]  || '',
        proprietario: linha[9]  || '',
        status:       linha[10] || '',
        valor:        parseNum(linha[11]),
        dataReuniao:  linha[12] || '',
        tipo:         linha[13] || '',
        realizada:    String(linha[14] || '').trim() !== '',
        assunto:      linha[15] || '',
        campanha:     linha[17] || '',
        source:       linha[18] || '',
      });
    }

    // ── Perdidos: descartes do mes, independente de quando o lead entrou ──
    // Diferente do backlog, aqui a data que importa e' a da PERDA, nao a da
    // aplicacao: um lead de maio descartado agora conta no mes corrente.
    const perdidos = [];
    for (const linha of (resultados[idxPerdidos] || []).slice(1)) {
      if (!linha[0]) continue;
      perdidos.push({
        id:           linha[0],
        produto:      linha[1]  || '',
        nomeProduto:  linha[2]  || '',
        nome:         linha[3]  || '',
        email:        linha[4]  || '',
        cargo:        linha[5]  || '',
        mql:          String(linha[6] || '').trim() !== '',
        funil:        linha[7]  || '',
        etapa:        linha[8]  || '',
        proprietario: linha[9]  || '',
        valor:        parseNum(linha[10]),
        dataPerda:    linha[11] || '',
        motivo:       linha[12] || '',
        aplicacao:    linha[13] || '',
        campanha:     linha[14] || '',
        source:       linha[15] || '',
        medium:       linha[16] || '',
        content:      linha[17] || '',
        term:         linha[18] || '',
      });
    }

    // Quando o update_all.py rodou pela ultima vez. Diferente do
    // atualizadoEm, que e' so a hora desta resposta da API — o que importa
    // pro usuario e' a idade do DADO, nao a do request.
    const linhaMeta = (resultados[idxMeta] || [])[0] || [];
    const dadosDe = String(linhaMeta[1] || '').trim() || null;

    return res.status(200).json({
      atualizadoEm: new Date().toISOString(),
      dadosDe,
      produtos,
      backlog,
      reunioes,
      perdidos,
    });

  } catch (err) {
    console.error('dashboard error:', err.message);
    return res.status(500).json({ error: 'Falha ao ler a planilha.' });
  }
}
