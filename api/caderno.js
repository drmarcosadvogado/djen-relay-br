// api/caderno.js
// Baixa o "caderno" diario compactado do DJEN para um tribunal, descompacta,
// e retorna uma linha por par (comunicacao x OAB-alvo encontrada), pronta
// para gravacao direta numa planilha (sem exigir iterator aninhado no Make).
// Roda no runtime Node (nao Edge) e na regiao gru1, definida em vercel.json,
// para poder alcancar comunicaapi.pje.jus.br sem geo-bloqueio.
//
// Query params:
//   tribunal (obrigatorio) - sigla do tribunal, ex.: TJRJ, TRF2, TJMA, STJ
//   data (obrigatorio)     - yyyy-mm-dd
//   meio (opcional)        - "D" (Diario Eletronico, default) ou "E" (Edital)
//   oabs (opcional)        - lista separada por virgula de "numero-uf", ex.:
//                            "182051-RJ,59214-RJ". Se omitido, nao filtra e
//                            retorna as comunicacoes originais (sem achatar).

const AdmZip = require('adm-zip');

function normOab(numero, uf) {
      return String(numero || '').replace(/\D/g, '') + '-' + String(uf || '').toUpperCase();
}

function extractComunicacoes(parsed) {
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
      if (parsed && Array.isArray(parsed.comunicacoes)) return parsed.comunicacoes;
      if (parsed && Array.isArray(parsed.data)) return parsed.data;
      return [];
}

function achatarLinha(c, adv, tribunalParam) {
      return {
              id: c.id,
              data_disponibilizacao: c.data_disponibilizacao || c.datadisponibilizacao,
              tribunal: c.siglaTribunal || tribunalParam,
              tipo_comunicacao: c.tipoComunicacao,
              nome_orgao: c.nomeOrgao,
              numero_processo: c.numeroprocessocommascara || c.numero_processo,
              meio: c.meio,
              texto: c.texto,
              oab: adv.numero_oab,
              uf_oab: adv.uf_oab,
              advogado: adv.nome,
              hash: c.hash,
              link: c.link,
      };
}

module.exports = async (req, res) => {
      const tribunal = req.query.tribunal;
      const data = req.query.data;
      const meio = req.query.meio || 'D';
      const oabsParam = req.query.oabs;

      if (!tribunal || !data) {
              res.status(400).json({ error: 'missing_params', message: 'tribunal e data sao obrigatorios' });
              return;
      }

      const oabList = oabsParam
        ? String(oabsParam).split(',').map(function (s) { return s.trim(); }).filter(Boolean)
              : null;

      try {
              const metaUrl = 'https://comunicaapi.pje.jus.br/api/v1/caderno/' +
                        encodeURIComponent(tribunal) + '/' + encodeURIComponent(data) + '/' + encodeURIComponent(meio);
              const metaResp = await fetch(metaUrl);

        if (!metaResp.ok) {
                  const bodyText = await metaResp.text();
                  res.status(metaResp.status).json({
                              status: 'error',
                              stage: 'metadata',
                              upstream_status: metaResp.status,
                              upstream_body: bodyText.slice(0, 1000),
                  });
                  return;
        }

        const meta = await metaResp.json();

        const zipResp = await fetch(meta.url);
              if (!zipResp.ok) {
                        res.status(502).json({ status: 'error', stage: 'zip_download', upstream_status: zipResp.status });
                        return;
              }
              const zipBuffer = Buffer.from(await zipResp.arrayBuffer());

        const zip = new AdmZip(zipBuffer);
              const entries = zip.getEntries().filter(function (e) { return !e.isDirectory; });

        let allComunicacoes = [];
              const parseErrors = [];
              for (let i = 0; i < entries.length; i++) {
                        const entry = entries[i];
                        const text = entry.getData().toString('utf8');
                        try {
                                    const parsed = JSON.parse(text);
                                    allComunicacoes = allComunicacoes.concat(extractComunicacoes(parsed));
                        } catch (e) {
                                    parseErrors.push({ file: entry.entryName, error: String(e).slice(0, 200) });
                        }
              }

        let linhas;
              if (oabList) {
                        linhas = [];
                        for (let i = 0; i < allComunicacoes.length; i++) {
                                    const c = allComunicacoes[i];
                                    const advs = c.destinatarioadvogados || [];
                                    for (let j = 0; j < advs.length; j++) {
                                                  const adv = (advs[j] && advs[j].advogado) || {};
                                                  if (oabList.indexOf(normOab(adv.numero_oab, adv.uf_oab)) !== -1) {
                                                                  linhas.push(achatarLinha(c, adv, tribunal));
                                                  }
                                    }
                        }
              } else {
                        linhas = allComunicacoes;
              }

        res.status(200).json({
                  status: 'success',
                  tribunal: tribunal,
                  data: data,
                  meio: meio,
                  total_no_caderno: allComunicacoes.length,
                  total_filtrado: linhas.length,
                  arquivos_no_zip: entries.length,
                  parse_errors: parseErrors.length ? parseErrors : undefined,
                  comunicacoes: linhas,
        });
      } catch (err) {
              res.status(500).json({ status: 'error', stage: 'exception', message: String((err && err.message) || err) });
      }
};
