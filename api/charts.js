// api/charts.js
import { verifyToken } from '../lib/auth.js';
import { getValues } from '../lib/sheets.js';

const SPREADSHEET_ID      = '1sFLWhfBAeGmDnJ22TadZ0ZMC5AOZXBODXBrwKClENJk';
const SPREADSHEET_ID_PIPE = '1Evtto8jEIQ6_239Ad-4jP_pYa1twc8iY4XWfIjgEARo';
const ABA                 = '[PERPÉTUO] Julho PFCC';
const ABA_LEADS_DIA       = 'LEADS-DIA';

const META_MQLS_MES = 1900;
const META_ROAS     = 3;
const META_VENDAS   = 1444000;
const DIAS_NO_MES   = 31;

function checkAuth(req) {
  const secret = process.env.SESSION_SECRET;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return secret ? verifyToken(token, secret) : null;
}

function parseNum(v) {
  if (!v && v !== 0) return null;
  const s = String(v).replace(/[R$\s%]/g,'').replace(/\./g,'').replace(',','.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Converte serial do Excel pra "dd/mm" pra bater com os labels do gráfico
function serialParaDDMM(serial) {
  if (!serial) return null;
  const n = parseNum(serial);
  if (!n) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo nao permitido.' });
  if (!checkAuth(req)) return res.status(401).json({ error: 'Sessao invalida.' });

  try {
    // Busca os dois ranges em paralelo
    const [rowsPerp, rowsLeads] = await Promise.all([
      getValues({ spreadsheetId: SPREADSHEET_ID,      range: `'${ABA}'!N4:AM80` }),
      getValues({ spreadsheetId: SPREADSHEET_ID_PIPE, range: `${ABA_LEADS_DIA}!A:L`  }),
    ]);

    const row = (linhaReal) => rowsPerp[linhaReal - 4] || [];

    const datas  = row(4);
    const mqls   = row(36);
    const roas1  = row(79);
    const roas2  = row(80);
    const vend1  = row(73);
    const vend2  = row(74);

    // Monta mapa de dd/mm → mqls_v2 da aba LEADS-DIA (col A=serial, col L=mqls_v2)
    const mqlsV2PorDia = {};
    for (const row of rowsLeads) {
      const serial  = row[0];
      const mqlsV2  = parseNum(row[11]); // coluna L = índice 11
      const ddmm    = serialParaDDMM(serial);
      if (ddmm && mqlsV2 !== null) mqlsV2PorDia[ddmm] = mqlsV2;
    }

    // Descobre até qual coluna tem dado
    let ultimoDia = 0;
    for (let i = 0; i < datas.length; i++) {
      if (datas[i] && parseNum(mqls[i]) !== null) ultimoDia = i + 1;
    }

    const labels = [], mqlsDia = [], metaMqls = [], mqlsV2Dia = [];
    const raosDia = [], metaRoas = [];
    const vendasMtd = [], metaVendasMtd = [];
    const metaMqlDia  = Math.round(META_MQLS_MES / DIAS_NO_MES);
    const metaVendDia = META_VENDAS / DIAS_NO_MES;

    let vendasAcum = 0, metaVendAcum = 0;

    for (let i = 0; i < ultimoDia; i++) {
      const raw = String(datas[i] || '');
      const label = raw.includes('/') ? raw.split('/').slice(0,2).join('/') : raw;
      labels.push(label);

      mqlsDia.push(parseNum(mqls[i]) ?? 0);
      metaMqls.push(metaMqlDia);
      mqlsV2Dia.push(mqlsV2PorDia[label] ?? null);

      const r = (parseNum(roas1[i]) ?? 0) + (parseNum(roas2[i]) ?? 0);
      raosDia.push(parseFloat(r.toFixed(2)));
      metaRoas.push(META_ROAS);

      vendasAcum += (parseNum(vend1[i]) ?? 0) + (parseNum(vend2[i]) ?? 0);
      vendasMtd.push(Math.round(vendasAcum));
      metaVendAcum += metaVendDia;
      metaVendasMtd.push(Math.round(metaVendAcum));
    }

    const totalV2 = mqlsV2Dia.reduce((s, v) => s + (v ?? 0), 0);

    return res.status(200).json({
      labels,
      mqls:    { dados: mqlsDia,   meta: metaMqls,      totalMes: META_MQLS_MES },
      mqlsV2:  { dados: mqlsV2Dia, totalMes: totalV2 },
      roas:    { dados: raosDia,   meta: metaRoas },
      vendas:  { dados: vendasMtd, meta: metaVendasMtd, totalMes: META_VENDAS },
    });

  } catch (err) {
    console.error('charts error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
