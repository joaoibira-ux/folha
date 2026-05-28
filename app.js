const firebaseConfig = {
  apiKey: "AIzaSyBaqROPsywPgtKjQU7cs1ke1WaqDFhWwn0",
  authDomain: "sistema-gw-36566.firebaseapp.com",
  projectId: "sistema-gw-36566",
  storageBucket: "sistema-gw-36566.firebasestorage.app",
  messagingSenderId: "472820177992",
  appId: "1:472820177992:web:2e1b98c9f6ac3a823d0c7d"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const VERSAO = "3.4";
document.querySelector("header span").textContent = `Folha de Pagamento da Produção v${VERSAO}`;

// ── Estado ─────────────────────────────────────────────────
let entradas             = [];
let funcionarioAtual     = null;
let servicosSelecionados = new Map();
let locaisCache          = {};
let servicosCache        = [];
let folhaAbertaId        = null;
let encarregadoCache     = null;

// ── Navegação ──────────────────────────────────────────────
function mostrarView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('ativa'));
  document.getElementById(id).classList.add('ativa');
}

// ── Utilitários ────────────────────────────────────────────
function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function ordemServico(nome) {
  const n = (nome || "").toLowerCase();
  if (n.includes("tratamento"))                          return 0;
  if (n.includes("pasta"))                               return 1;
  if (n.includes("emassamento") || n.includes("massa"))  return 2;
  if (n.includes("textura"))                             return 3;
  return 99;
}

function nomeAbrev(nome) {
  const n = (nome || "").toLowerCase();
  if (n.includes("tratamento")) return "Tratamento";
  if (n.includes("pasta"))      return "Gesso";
  if (n.includes("emassamento") || n.includes("massa")) return "Massa";
  if (n.includes("textura"))    return "Textura";
  return (nome || "").substring(0, 10);
}

function parseId(id) {
  const m = id.match(/^([A-Z]+)(\d+)$/);
  return m ? { block: m[1], num: parseInt(m[2]) } : null;
}

function getMdo(nomeServico) {
  const ordem = ordemServico(nomeServico);
  const match = servicosCache.find(s => ordemServico(s.nome) === ordem);
  return match ? (match.mdo || 0) : 0;
}

// ── Coleção servicos ───────────────────────────────────────
db.collection('servicos').onSnapshot(snap => {
  servicosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
});

// ── Encarregado ────────────────────────────────────────────
db.collection('funcionarios').onSnapshot(snap => {
  encarregadoCache = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(f => f.ativo !== false && (f.cargo || '').toLowerCase().includes('encarregado')) || null;
});

// ── Verifica folha em andamento na abertura ────────────────
// Fonte de verdade = locais (mapa). Folha doc = fallback para funcionário/valor.
function verificarFolhaExistente() {
  db.collection('locais').get().then(snap => {
    // Lê todos os serviços amarelos do mapa
    const amarelos = [];
    snap.docs.forEach(doc => {
      const local = doc.data();
      (local.servicos || []).forEach(s => {
        if (s.status === 'em_pagamento') {
          amarelos.push({
            firestoreLocalId: doc.id,
            localId:          local.identificacao,
            servico:          s.nome,
            funcionario:      s.funcionario || null
          });
        }
      });
    });
    if (!amarelos.length) return;

    // Carrega folha salva para recuperar funcionário e valor de itens antigos
    db.collection('folhas').orderBy('criadoEm', 'desc').limit(1).get().then(fSnap => {
      folhaAbertaId = fSnap.empty ? null : fSnap.docs[0].id;

      // Lookup do documento salvo: "firestoreId:nome" e "firestoreId:nomeAbrev" → {fn, valor}
      const lookup = new Map();
      if (!fSnap.empty) {
        (fSnap.docs[0].data().grupos || []).forEach(g => {
          if (g.isEncarregado) return;
          (g.itens || []).forEach(item => {
            const entry = { fn: g.funcionario, valor: Number(item.valor) };
            lookup.set(`${item.firestoreLocalId}:${item.servico}`,            entry);
            lookup.set(`${item.firestoreLocalId}:${nomeAbrev(item.servico)}`, entry);
          });
        });
      }

      entradas = amarelos.map(s => {
        const found = lookup.get(`${s.firestoreLocalId}:${s.servico}`)
                   || lookup.get(`${s.firestoreLocalId}:${nomeAbrev(s.servico)}`);
        return {
          funcionario:      s.funcionario || (found && found.fn) || { nome: '(desconhecido)', cargo: '' },
          firestoreLocalId: s.firestoreLocalId,
          localId:          s.localId,
          servico:          s.servico,
          valor:            found ? found.valor : getMdo(s.servico)
        };
      });

      renderizarFolha();
      atualizarHeader();
      mostrarView('view-folha');
    });
  });
}

verificarFolhaExistente();

// ── View Funcionários ──────────────────────────────────────
db.collection('funcionarios').orderBy('nome').onSnapshot(snap => {
  const lista = document.getElementById('lista-funcionarios');
  lista.innerHTML = '';

  const cargosValidos = ['pintor', 'raspador'];
  const docs = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(f => f.ativo !== false)
    .filter(f => cargosValidos.some(c => (f.cargo || '').toLowerCase().includes(c)));

  if (!docs.length) {
    lista.innerHTML = '<p class="vazio">Nenhum pintor ou raspador cadastrado.</p>';
    return;
  }

  docs.forEach(func => {
    const btn = document.createElement('button');
    btn.className = 'btn-funcionario';
    btn.innerHTML = `
      <span class="func-nome">${escHtml(func.nome)}</span>
      <span class="func-cargo ${(func.cargo||'').toLowerCase()}">${escHtml(func.cargo || '')}</span>
    `;
    btn.onclick = () => selecionarFuncionario(func);
    lista.appendChild(btn);
  });
});

function selecionarFuncionario(func) {
  funcionarioAtual = func;
  servicosSelecionados.clear();
  document.getElementById('func-atual').textContent = func.nome;
  atualizarBtnOk();
  mostrarView('view-mapa');
}

// ── View Mapa ──────────────────────────────────────────────
function groupByBloco(data) {
  const blocos = {};
  data.forEach(local => {
    const parsed = parseId(local.identificacao);
    if (!parsed) return;
    const { block, num } = parsed;
    if (!blocos[block]) blocos[block] = { ground: {}, upper: {} };
    if (num >= 100) blocos[block].upper[num - 100] = local;
    else            blocos[block].ground[num]       = local;
  });
  return blocos;
}

function buildCols(wing) {
  const nums = Object.keys(wing).map(Number);
  if (!nums.length) return [];
  const maxNum  = Math.max(...nums);
  const highOdd = maxNum % 2 === 0 ? maxNum - 1 : maxNum;
  const cols = [];
  for (let odd = highOdd; odd >= 1; odd -= 2) {
    cols.push({ odd, even: odd + 1, oddLocal: wing[odd], evenLocal: wing[odd + 1] });
  }
  return cols;
}

function renderAptCell(local) {
  if (!local) return `<div class="apt-vazio"></div>`;
  locaisCache[local.id] = local;
  const numPart = local.identificacao.replace(/^[A-Z]+/, "");
  const servs   = [...(local.servicos || [])].sort((a, b) => ordemServico(a.nome) - ordemServico(b.nome));
  return `
    <div class="apt-cell">
      <div class="apt-header">Apt: ${escHtml(numPart)}</div>
      ${servs.map((s, i) => {
        const key = `${local.id}::${i}`;
        const sel = servicosSelecionados.has(key) ? ' selecionado' : '';
        const cursor = (s.status === 'concluido' || s.status === 'em_pagamento') ? ' nao-clicavel' : '';
        return `<div class="apt-serv ${s.status}${sel}${cursor}"
                     data-localid="${escHtml(local.id)}"
                     data-svidx="${i}"
                     onclick="onServicoClick(this)">${nomeAbrev(s.nome)}</div>`;
      }).join("")}
    </div>`;
}

function renderWing(cols) {
  const n = cols.length;
  return `
    <div class="wing" style="grid-template-columns:repeat(${n},30px)">
      ${cols.map(c => renderAptCell(c.oddLocal)).join("")}
      ${cols.map(c => renderAptCell(c.evenLocal)).join("")}
    </div>`;
}

function render(data) {
  const blocos = groupByBloco(data);
  const letras = Object.keys(blocos).sort();
  if (!letras.length) {
    document.getElementById("mapa").innerHTML = '<p class="empty">Nenhum local cadastrado.</p>';
    return;
  }
  document.getElementById("mapa").innerHTML = letras.map(letra => {
    const { ground, upper } = blocos[letra];
    const gCols = buildCols(ground);
    const uCols = buildCols(upper);
    return `
      <div class="bloco">
        <div class="bloco-label">BLOCO ${letra}</div>
        <div class="bloco-body">
          ${gCols.length ? renderWing(gCols) : ""}
          ${uCols.length ? `<div class="corredor"></div>${renderWing(uCols)}` : ""}
        </div>
      </div>`;
  }).join("");
}

db.collection("locais").orderBy("identificacao", "asc").onSnapshot(snap => {
  render(snap.docs.map(d => ({ id: d.id, ...d.data() })));

  // Atualiza folha em tempo real se estiver visível
  if (entradas.length && document.getElementById('view-folha').classList.contains('ativa')) {
    const emPagamentoSet = new Set();
    snap.docs.forEach(doc => {
      (doc.data().servicos || []).forEach(s => {
        if (s.status === 'em_pagamento') {
          emPagamentoSet.add(`${doc.id}:${s.nome}`);
          emPagamentoSet.add(`${doc.id}:${nomeAbrev(s.nome)}`);
        }
      });
    });
    const antes = entradas.length;
    entradas = entradas.filter(e => emPagamentoSet.has(`${e.firestoreLocalId}:${e.servico}`));
    if (entradas.length !== antes) {
      renderizarFolha();
      atualizarHeader();
    }
  }
}, () => {
  document.getElementById("mapa").innerHTML = '<p class="empty">Erro ao conectar.</p>';
});

function onServicoClick(el) {
  const local    = locaisCache[el.dataset.localid];
  const servicos = [...(local.servicos || [])].sort((a, b) => ordemServico(a.nome) - ordemServico(b.nome));
  const servico  = servicos[parseInt(el.dataset.svidx)];
  if (servico.status === 'concluido' || servico.status === 'em_pagamento') return;

  const key = `${el.dataset.localid}::${el.dataset.svidx}`;
  if (servicosSelecionados.has(key)) {
    servicosSelecionados.delete(key);
  } else {
    servicosSelecionados.set(key, { local, servico });
  }

  // atualiza visual sem re-renderizar tudo
  el.classList.toggle('selecionado', servicosSelecionados.has(key));
  atualizarBtnOk();
}

function atualizarBtnOk() {
  const btn = document.getElementById('btn-ok');
  const n = servicosSelecionados.size;
  btn.textContent = n > 0 ? `OK (${n})` : 'OK';
  btn.disabled = n === 0;
}

// ── Confirmar seleção → adiciona na folha ──────────────────
function confirmarSelecao() {
  if (!servicosSelecionados.size) return;

  servicosSelecionados.forEach(({ local, servico }) => {
    entradas.push({
      funcionario:      funcionarioAtual,
      firestoreLocalId: local.id,
      localId:          local.identificacao,
      servico:          servico.nome,
      valor:            getMdo(servico.nome)
    });
  });

  renderizarFolha();
  atualizarHeader();
  mostrarView('view-folha');
}

function fmtMoeda(v) {
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
}

// ── View Folha ─────────────────────────────────────────────
function renderizarFolha() {
  const hoje  = new Date().toLocaleDateString('pt-BR');
  const nServ = entradas.length;

  // ── Bloco do encarregado (topo) ──
  let encarregadoHtml  = '';
  let valorEncarregado = 0;
  if (encarregadoCache) {
    const quinzena = (encarregadoCache.salario || 0) / 2;
    const bonus    = 5 * nServ;
    valorEncarregado = quinzena + bonus;
    encarregadoHtml = `
      <div class="grupo-func grupo-encarregado">
        <div class="grupo-header">
          <span class="grupo-nome">${escHtml(encarregadoCache.nome)}</span>
          <span class="grupo-cargo encarregado">${escHtml(encarregadoCache.cargo)}</span>
        </div>
        <table class="folha-tabela">
          <thead><tr><th colspan="2">Descrição</th><th>Valor</th></tr></thead>
          <tbody>
            <tr><td colspan="2">Quinzena (50% do salário)</td><td class="td-valor">${fmtMoeda(quinzena)}</td></tr>
            <tr><td colspan="2">${nServ} serviço${nServ !== 1 ? 's' : ''} × R$ 5,00</td><td class="td-valor">${fmtMoeda(bonus)}</td></tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" class="td-sub-label">Subtotal</td>
              <td class="td-sub-valor">${fmtMoeda(valorEncarregado)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  // ── Grupos de produção ──
  const grupos = new Map();
  entradas.forEach(e => {
    const key = e.funcionario.id || e.funcionario.nome;
    if (!grupos.has(key)) grupos.set(key, { funcionario: e.funcionario, itens: [] });
    grupos.get(key).itens.push(e);
  });

  const totalProducao = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  const totalGeral    = totalProducao + valorEncarregado;

  const gruposHtml = [...grupos.values()].map(g => {
    const subtotal = g.itens.reduce((acc, e) => acc + Number(e.valor), 0);
    const linhas = g.itens.map(e => `
      <tr>
        <td>${escHtml(e.localId)}</td>
        <td>${escHtml(nomeAbrev(e.servico))}</td>
        <td class="td-valor">${fmtMoeda(e.valor)}</td>
      </tr>`).join('');

    return `
      <div class="grupo-func">
        <div class="grupo-header">
          <span class="grupo-nome">${escHtml(g.funcionario.nome)}</span>
          <span class="grupo-cargo ${(g.funcionario.cargo||'').toLowerCase()}">${escHtml(g.funcionario.cargo||'')}</span>
        </div>
        <table class="folha-tabela">
          <thead><tr><th>Local</th><th>Serviço</th><th>Valor</th></tr></thead>
          <tbody>${linhas}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" class="td-sub-label">Subtotal</td>
              <td class="td-sub-valor">${fmtMoeda(subtotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }).join('');

  document.getElementById('folha-documento').innerHTML = `
    <div class="folha-paper">
      <div class="folha-titulo">FOLHA DE PAGAMENTO DA PRODUÇÃO</div>
      <div class="folha-data">Emitida em ${hoje}</div>
      ${encarregadoHtml}
      ${gruposHtml}
      <div class="total-geral">
        <span>TOTAL GERAL</span>
        <span>${fmtMoeda(totalGeral)}</span>
      </div>
    </div>
  `;
}

function atualizarHeader() {
  const el = document.getElementById('total-header');
  if (!entradas.length) { el.textContent = ''; return; }
  const totalProd = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  const totalEnc  = encarregadoCache
    ? ((encarregadoCache.salario || 0) / 2) + (5 * entradas.length)
    : 0;
  const total = totalProd + totalEnc;
  el.textContent = `${entradas.length} item${entradas.length > 1 ? 's' : ''} · R$ ${total.toFixed(2)}`;
}

function imprimirFolha() {
  if (!entradas.length) { alert('Adicione pelo menos um item antes de imprimir.'); return; }
  renderizarFolha();
  mostrarView('view-folha');
  setTimeout(() => window.print(), 200);
}

// ── Fechar Folha → salva no Firestore + marca serviços ────
function fecharFolha() {
  if (!entradas.length) return;

  const btnFechar = document.querySelector('.btn-fechar-folha');
  btnFechar.disabled = true;
  btnFechar.textContent = 'Salvando...';

  // Agrupa por funcionário para o documento da folha
  const grupos = new Map();
  entradas.forEach(e => {
    const key = e.funcionario.id || e.funcionario.nome;
    if (!grupos.has(key)) grupos.set(key, { funcionario: e.funcionario, itens: [] });
    grupos.get(key).itens.push(e);
  });

  const totalProducao    = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  const valorEncarregado = encarregadoCache
    ? ((encarregadoCache.salario || 0) / 2) + (5 * entradas.length)
    : 0;
  const totalGeral = totalProducao + valorEncarregado;

  const gruposProducao = [...grupos.values()].map(g => ({
    funcionario: { id: g.funcionario.id || '', nome: g.funcionario.nome, cargo: g.funcionario.cargo || '' },
    subtotal:    g.itens.reduce((acc, e) => acc + Number(e.valor), 0),
    itens:       g.itens.map(e => ({
      firestoreLocalId: e.firestoreLocalId || '',
      localId:          e.localId,
      servico:          e.servico,
      valor:            Number(e.valor)
    }))
  }));

  const grupoEncarregado = encarregadoCache ? [{
    isEncarregado: true,
    funcionario: { id: encarregadoCache.id, nome: encarregadoCache.nome, cargo: encarregadoCache.cargo || '' },
    subtotal: valorEncarregado,
    itens: [
      { firestoreLocalId: '', localId: '—', servico: 'Quinzena 50%',           valor: (encarregadoCache.salario || 0) / 2 },
      { firestoreLocalId: '', localId: '—', servico: `${entradas.length} serv × R$5`, valor: 5 * entradas.length }
    ]
  }] : [];

  const folhaDoc = {
    data:       new Date().toLocaleDateString('pt-BR'),
    criadoEm:  firebase.firestore.FieldValue.serverTimestamp(),
    status:    'fechada',
    totalGeral,
    grupos: [...grupoEncarregado, ...gruposProducao]
  };

  // Agrupa serviços a marcar por localId do Firestore: servicoNome → funcionario
  const locaisParaAtualizar = new Map();
  entradas.forEach(e => {
    if (!locaisParaAtualizar.has(e.firestoreLocalId)) {
      locaisParaAtualizar.set(e.firestoreLocalId, new Map());
    }
    locaisParaAtualizar.get(e.firestoreLocalId).set(e.servico, e.funcionario);
  });

  // Monta o batch: salva/atualiza folha + atualiza status dos serviços
  const batch = db.batch();

  const folhaRef = folhaAbertaId
    ? db.collection('folhas').doc(folhaAbertaId)
    : db.collection('folhas').doc();
  batch.set(folhaRef, folhaDoc);

  locaisParaAtualizar.forEach((servicoFuncMap, firestoreId) => {
    const local = locaisCache[firestoreId];
    if (!local) return;
    const novosServicos = (local.servicos || []).map(s => {
      if (!servicoFuncMap.has(s.nome)) return s;
      const func = servicoFuncMap.get(s.nome);
      return { ...s, status: 'em_pagamento', funcionario: { id: func.id || '', nome: func.nome } };
    });
    batch.update(db.collection('locais').doc(firestoreId), { servicos: novosServicos });
  });

  batch.commit()
    .then(() => {
      folhaAbertaId = null;
      entradas = [];
      atualizarHeader();
      btnFechar.disabled = false;
      btnFechar.textContent = 'Fechar Folha';
      mostrarSucesso();
    })
    .catch(() => {
      btnFechar.disabled = false;
      btnFechar.textContent = 'Fechar Folha';
      alert('Erro ao salvar. Tente novamente.');
    });
}

function mostrarSucesso() {
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                height:100dvh;background:#1a3322;color:#fff;gap:16px;">
      <div style="font-size:3rem;">✓</div>
      <div style="font-size:1.2rem;font-weight:700;">Folha fechada!</div>
    </div>`;
  setTimeout(() => window.close(), 1500);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
