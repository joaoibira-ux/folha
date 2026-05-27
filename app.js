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

let entradas = [];
let servicoAtual = null;

// ── NAVEGAÇÃO ──────────────────────────────────────────────
function mostrarView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('ativa'));
  document.getElementById(id).classList.add('ativa');
}

// ── VIEW MAPA ──────────────────────────────────────────────
db.collection('locais').orderBy('identificacao', 'asc').onSnapshot(snap => {
  const mapa = document.getElementById('mapa');
  mapa.innerHTML = '';

  snap.forEach(doc => {
    const local = { id: doc.id, ...doc.data() };
    if (!local.servicos || local.servicos.length === 0) return;

    const card = document.createElement('div');
    card.className = 'card-local';

    const cabecalho = document.createElement('div');
    cabecalho.className = 'card-local-header';
    cabecalho.textContent = local.identificacao;
    card.appendChild(cabecalho);

    local.servicos.forEach(servico => {
      const btn = document.createElement('button');
      btn.className = `btn-servico ${servico.status || ''}`;

      const valorTexto = servico.valorPago != null
        ? ` · R$${Number(servico.valorPago).toFixed(2)}`
        : '';

      btn.textContent = servico.nome + valorTexto;
      btn.onclick = () => abrirFuncionarios(local, servico);
      card.appendChild(btn);
    });

    mapa.appendChild(card);
  });
});

// ── VIEW FUNCIONÁRIOS ──────────────────────────────────────
function abrirFuncionarios(local, servico) {
  servicoAtual = { local, servico };

  const valorTexto = servico.valorPago != null
    ? `<span class="valor-servico">R$ ${Number(servico.valorPago).toFixed(2)}</span>`
    : '';

  document.getElementById('servico-selecionado').innerHTML =
    `<strong>${local.identificacao}</strong> — ${servico.nome} ${valorTexto}`;

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
      const btn = document.createElement('button');
      btn.className = 'btn-funcionario';
      btn.innerHTML = `
        <span class="func-nome">${func.nome}</span>
        <span class="func-cargo">${func.cargo || ''}</span>
      `;
      btn.onclick = () => adicionarEntrada(func);
      lista.appendChild(btn);
    });
  });
}

// ── VIEW FOLHA ─────────────────────────────────────────────
function adicionarEntrada(funcionario) {
  entradas.push({
    funcionario,
    localId: servicoAtual.local.identificacao,
    servico: servicoAtual.servico.nome,
    valor: servicoAtual.servico.valorPago || 0
  });

  renderizarFolha();
  atualizarHeader();
  mostrarView('view-folha');
}

function renderizarFolha() {
  const total = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  const hoje = new Date().toLocaleDateString('pt-BR');

  const linhas = entradas.map((e, i) => `
    <tr>
      <td class="td-num">${i + 1}</td>
      <td>${e.funcionario.nome}</td>
      <td>${e.funcionario.cargo || '—'}</td>
      <td>${e.localId}</td>
      <td>${e.servico}</td>
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
            <th>#</th>
            <th>Funcionário</th>
            <th>Cargo</th>
            <th>Local</th>
            <th>Serviço</th>
            <th>Valor</th>
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
  if (entradas.length === 0) {
    el.textContent = '';
    return;
  }
  const total = entradas.reduce((acc, e) => acc + Number(e.valor), 0);
  el.textContent = `${entradas.length} item${entradas.length > 1 ? 's' : ''} · R$ ${total.toFixed(2)}`;
}

function imprimirFolha() {
  if (entradas.length === 0) {
    alert('Adicione pelo menos um item à folha antes de imprimir.');
    return;
  }
  renderizarFolha();
  mostrarView('view-folha');
  setTimeout(() => window.print(), 200);
}
