// api/charts.js
import { verifyToken } from '../lib/auth.js';
import { getValues } from '../lib/sheets.js';

const SPREADSHEET_ID = '1sFLWhfBAeGmDnJ22TadZ0ZMC5AOZXBODXBrwKClENJk';
const ABA = '[PERPÉTUO] Julho PFCC';
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo nao permitido.' });
  if (!checkAuth(req)) return res.status(401).json({ error: 'Sessao invalida.' });

  try {
    const range = `'${ABA}'!N4:AM80`;
    const rows = await getValues({ spreadsheetId: SPREADSHEET_ID, range });

    const row = (linhaReal) => rows[linhaReal - 4] || [];

    const datas   = row(4);
    const mqls    = row(36);
    const roas1   = row(79);
    const roas2   = row(80);
    const vend1   = row(73);
    const vend2   = row(74);

    // Descobre até qual coluna tem dado
    let ultimoDia = 0;
    for (let i = 0; i < datas.length; i++) {
      if (datas[i] && parseNum(mqls[i]) !== null) ultimoDia = i + 1;
    }

    const labels = [], mqlsDia = [], metaMqls = [];
    const raosDia = [], metaRoas = [];
    const vendasMtd = [], metaVendasMtd = [];
    const metaMqlDia = Math.round(META_MQLS_MES / DIAS_NO_MES);
    const metaVendDia = META_VENDAS / DIAS_NO_MES;

    let vendasAcum = 0, metaVendAcum = 0;

    for (let i = 0; i < ultimoDia; i++) {
      const raw = String(datas[i] || '');
      labels.push(raw.includes('/') ? raw.split('/').slice(0,2).join('/') : raw);

      mqlsDia.push(parseNum(mqls[i]) ?? 0);
      metaMqls.push(metaMqlDia);

      const r = (parseNum(roas1[i]) ?? 0) + (parseNum(roas2[i]) ?? 0);
      raosDia.push(parseFloat(r.toFixed(2)));
      metaRoas.push(META_ROAS);

      vendasAcum += (parseNum(vend1[i]) ?? 0) + (parseNum(vend2[i]) ?? 0);
      vendasMtd.push(Math.round(vendasAcum));
      metaVendAcum += metaVendDia;
      metaVendasMtd.push(Math.round(metaVendAcum));
    }

    return res.status(200).json({
      labels,
      mqls:   { dados: mqlsDia,  meta: metaMqls,      totalMes: META_MQLS_MES },
      roas:   { dados: raosDia,  meta: metaRoas },
      vendas: { dados: vendasMtd, meta: metaVendasMtd, totalMes: META_VENDAS },
    });

  } catch (err) {
    console.error('charts error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
