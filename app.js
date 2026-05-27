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

const VERSAO = "1.1";
document.querySelector("header span").textContent = `Folha de Pagamento v${VERSAO}`;

// ── Estado ─────────────────────────────────────────────────
let entradas    = [];
let servicoAtual = null;
let locaisCache = {};

// ── Navegação ──────────────────────────────────────────────
function mostrarView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('ativa'));
  document.getElementById(id).classList.add('ativa');
}

// ── Utilitários (idênticos ao mapa) ───────────────────────
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

// ── Agrupamento (idêntico ao mapa) ─────────────────────────
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

// ── Renderização de célula (onclick adaptado para folha) ───
function renderAptCell(local) {
  if (!local) return `<div class="apt-vazio"></div>`;
  locaisCache[local.id] = local;
  const numPart = local.identificacao.replace(/^[A-Z]+/, "");
  const servs   = [...(local.servicos || [])].sort((a, b) => ordemServico(a.nome) - ordemServico(b.nome));
  return `
    <div class="apt-cell">
      <div class="apt-header">Apt: ${escHtml(numPart)}</div>
      ${servs.map((s, i) =>
        `<div class="apt-serv ${s.status}"
              data-localid="${escHtml(local.id)}"
              data-svidx="${i}"
              onclick="onServicoClick(this)">${nomeAbrev(s.nome)}</div>`
      ).join("")}
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

// ── Listener Firestore (idêntico ao mapa) ─────────────────
db.collection("locais").orderBy("identificacao", "asc").onSnapshot(snap => {
  render(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}, err => {
  document.getElementById("mapa").innerHTML = '<p class="empty">Erro ao conectar.</p>';
});

// ── Click no serviço → abre funcionários ──────────────────
function onServicoClick(el) {
  const local   = locaisCache[el.dataset.localid];
  const servicos = [...(local.servicos || [])].sort((a, b) => ordemServico(a.nome) - ordemServico(b.nome));
  const servico  = servicos[parseInt(el.dataset.svidx)];
  abrirFuncionarios(local, servico);
}

// ── View Funcionários ──────────────────────────────────────
function abrirFuncionarios(local, servico) {
  servicoAtual = { local, servico };

  const valorTexto = servico.valorPago != null
    ? `<span class="valor-servico">R$ ${Number(servico.valorPago).toFixed(2)}</span>`
    : '';

  document.getElementById('servico-selecionado').innerHTML =
    `<strong>${escHtml(local.identificacao)}</strong> — ${escHtml(servico.nome)} ${valorTexto}`;

  const lista = document.getElementById('lista-funcionarios');
  lista.innerHTML = '<p class="carregando">Carregando funcionários...</p>';

  mostrarView('view-funcionarios');

  db.collection('funcionarios').orderBy('nome').get().then(snap => {
    lista.innerHTML = '';
    if (snap.empty) {
      lista.innerHTML = '<p class="vazio">Nenhum funcionário cadastrado.</p>';
      return;
    }
    snap.forEach(doc => {
      const func = { id: doc.id, ...doc.data() };
      const btn  = document.createElement('button');
      btn.className = 'btn-funcionario';
      btn.innerHTML = `
        <span class="func-nome">${escHtml(func.nome)}</span>
        <span class="func-cargo">${escHtml(func.cargo || '')}</span>
      `;
      btn.onclick = () => adicionarEntrada(func);
      lista.appendChild(btn);
    });
  });
}

// ── View Folha ─────────────────────────────────────────────
function adicionarEntrada(funcionario) {
  entradas.push({
    funcionario,
    localId: servicoAtual.local.identificacao,
    servico: servicoAtual.servico.nome,
    valor:   servicoAtual.servico.valorPago || 0
  });
  renderizarFolha();
  atualizarHeader();
  mostrarView('view-folha');
}

function renderizarFolha() {
  const total = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  const hoje  = new Date().toLocaleDateString('pt-BR');

  const linhas = entradas.map((e, i) => `
    <tr>
      <td class="td-num">${i + 1}</td>
      <td>${escHtml(e.funcionario.nome)}</td>
      <td>${escHtml(e.funcionario.cargo || '—')}</td>
      <td>${escHtml(e.localId)}</td>
      <td>${escHtml(e.servico)}</td>
      <td class="td-valor">R$ ${Number(e.valor).toFixed(2)}</td>
    </tr>
  `).join('');

  document.getElementById('folha-documento').innerHTML = `
    <div class="folha-paper">
      <div class="folha-titulo">FOLHA DE PAGAMENTO</div>
      <div class="folha-data">Emitida em ${hoje}</div>
      <table class="folha-tabela">
        <thead>
          <tr>
            <th>#</th><th>Funcionário</th><th>Cargo</th>
            <th>Local</th><th>Serviço</th><th>Valor</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
        <tfoot>
          <tr>
            <td colspan="5" class="td-total-label">TOTAL</td>
            <td class="td-total-valor">R$ ${total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
      <div class="folha-rodape">Toque para continuar adicionando ↩</div>
    </div>
  `;
}

function atualizarHeader() {
  const el = document.getElementById('total-header');
  if (!entradas.length) { el.textContent = ''; return; }
  const total = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  el.textContent = `${entradas.length} item${entradas.length > 1 ? 's' : ''} · R$ ${total.toFixed(2)}`;
}

function imprimirFolha() {
  if (!entradas.length) { alert('Adicione pelo menos um item antes de imprimir.'); return; }
  renderizarFolha();
  mostrarView('view-folha');
  setTimeout(() => window.print(), 200);
}
