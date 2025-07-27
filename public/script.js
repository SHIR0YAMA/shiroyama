// /public/script.js

// --- FUNÇÃO AUXILIAR ---
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// --- ESTADO GLOBAL DA APLICAÇÃO ---
const state = {
    token: localStorage.getItem('jwtToken'),
    username: localStorage.getItem('username'),
    role: localStorage.getItem('role'),
    fileTree: {},
    allFiles: []
};

// --- ELEMENTOS DO DOM ---
const mainContent = document.getElementById('main-content');
const mainNav = document.getElementById('main-nav');

// --- FUNÇÕES DE API ---
// Centraliza todas as chamadas de API, adicionando o token de autenticação quando necessário.
async function apiCall(endpoint, method = 'POST', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }
    try {
        const response = await fetch(`/api/${endpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : null
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || response.statusText);
        }
        return result;
    } catch (error) {
        console.error(`API Error on ${endpoint}:`, error);
        throw error;
    }
}

// --- FUNÇÕES DE AUTENTICAÇÃO ---
function login(token) {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        state.token = token;
        state.username = payload.username;
        state.role = payload.role;
        localStorage.setItem('jwtToken', token);
        localStorage.setItem('username', state.username);
        localStorage.setItem('role', state.role);
    } catch (e) {
        console.error("Erro ao decodificar o token:", e);
        logout();
    }
}

function logout() {
    state.token = null;
    state.username = null;
    state.role = null;
    localStorage.clear();
    router(); // Re-renderiza a página para o estado de "deslogado"
}

// --- FUNÇÕES DE LÓGICA DE ARQUIVOS ---
function buildFileTree(files) {
    const tree = {};
    files.forEach(file => {
        const parts = file.name.split('/').filter(p => p);
        let currentLevel = tree;
        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                currentLevel[part] = { ...file, _isFile: true };
            } else {
                if (!currentLevel[part]) { currentLevel[part] = {}; }
                currentLevel = currentLevel[part];
            }
        });
    });
    return tree;
}

function getContentForPath(path) {
    let currentLevel = state.fileTree;
    for (const folderName of path) {
        currentLevel = currentLevel[folderName];
        if (!currentLevel) return {};
    }
    return currentLevel;
}

// --- FUNÇÕES DE RENDERIZAÇÃO DE PÁGINAS ---
function renderNav() {
    if (state.token) {
        mainNav.innerHTML = `
            <span>Olá, <strong>${state.username}</strong> (${state.role})</span>
            ${state.role === 'owner' || state.role === 'admin' ? '<a href="/#/admin">Admin</a>' : ''}
            <a href="#" id="logout-btn">Sair</a>
        `;
        document.getElementById('logout-btn').onclick = (e) => { e.preventDefault(); logout(); };
    } else {
        mainNav.innerHTML = `
            <a href="/#/login">Login</a>
            <a href="/#/register">Registrar</a>
        `;
    }
}

function renderRegisterPage() {
    mainContent.innerHTML = `
        <form id="register-form" class="auth-form">
            <h2>Registrar Nova Conta</h2>
            <div class="form-group"><label for="username">Nome de Usuário</label><input type="text" id="username" name="username" required minlength="3"></div>
            <div class="form-group"><label for="password">Senha</label><input type="password" id="password" name="password" required minlength="6"></div>
            <button type="submit">Registrar</button>
        </form>
    `;
    document.getElementById('register-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
            const data = await apiCall('auth/register', 'POST', { username: e.target.username.value, password: e.target.password.value });
            alert(data.message);
            window.location.hash = '/login';
        } catch (error) {
            alert(`Erro no registro: ${error.message}`);
        }
    };
}

function renderLoginPage() {
    mainContent.innerHTML = `
        <form id="login-form" class="auth-form">
            <h2>Login</h2>
            <div class="form-group"><label for="username">Nome de Usuário</label><input type="text" id="username" name="username" required></div>
            <div class="form-group"><label for="password">Senha</label><input type="password" id="password" name="password" required></div>
            <button type="submit">Entrar</button>
        </form>
    `;
    document.getElementById('login-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
            const data = await apiCall('auth/login', 'POST', { username: e.target.username.value, password: e.target.password.value });
            login(data.token);
            window.location.hash = '/';
        } catch (error) {
            alert(`Erro no login: ${error.message}`);
        }
    };
}

function renderFilesPage(path) {
    mainContent.innerHTML = `
        <div class="navigation-controls">
            <button id="back-button" class="nav-button" title="Voltar">←</button>
            <button id="forward-button" class="nav-button" title="Avançar">→</button>
        </div>
        <div id="breadcrumb" style="margin-top: 15px;"></div>
        <table class="file-table">
            <thead><tr><th>Nome</th><th class="size-col">Tamanho</th><th class="download-col"></th></tr></thead>
            <tbody id="file-list-body"></tbody>
        </table>
    `;
    
    document.getElementById('back-button').onclick = () => window.history.back();
    document.getElementById('forward-button').onclick = () => window.history.forward();
    document.getElementById('back-button').disabled = path.length === 0;

    const breadcrumbElement = document.getElementById('breadcrumb');
    breadcrumbElement.innerHTML = '';
    ['Home', ...path].forEach((part, index, arr) => {
        const span = document.createElement('span');
        if (index < arr.length - 1) {
            const a = document.createElement('a');
            const targetPath = arr.slice(1, index + 1).map(encodeURIComponent).join('/');
            a.href = `#/${targetPath}`;
            a.textContent = part;
            span.appendChild(a);
            span.innerHTML += ' > ';
        } else {
            span.textContent = part;
        }
        breadcrumbElement.appendChild(span);
    });

    const fileListBodyElement = document.getElementById('file-list-body');
    const content = getContentForPath(path);
    fileListBodyElement.innerHTML = '';
    const items = Object.entries(content).sort(([nameA, itemA], [nameB, itemB]) => {
        const isFileA = itemA._isFile;
        const isFileB = itemB._isFile;
        if (isFileA && !isFileB) return 1;
        if (!isFileA && isFileB) return -1;
        return nameA.localeCompare(nameB, undefined, { numeric: true });
    });

    if (items.length === 0) {
        fileListBodyElement.innerHTML = '<tr><td colspan="3">Pasta vazia.</td></tr>';
        return;
    }

    items.forEach(([name, item]) => {
        const tr = document.createElement('tr');
        if (item._isFile) {
            tr.innerHTML = `
                <td class="file-item-name"><span>📄</span> <span>${name}</span></td>
                <td class="size-col">${formatFileSize(item.file_size)}</td>
                <td class="download-col"><a href="https://telegram-drive-eight.vercel.app/api/download?message_id=${item.message_id}&filename=${encodeURIComponent(name)}">Baixar</a></td>
            `;
        } else {
            tr.innerHTML = `
                <td colspan="3"><a href="#/${[...path, name].map(encodeURIComponent).join('/')}" class="file-item-name"><span>📁</span> <span>${name}</span></a></td>
            `;
        }
        fileListBodyElement.appendChild(tr);
    });
}

function renderAdminPage() {
    // A lógica do painel admin pode ser implementada aqui no futuro
    mainContent.innerHTML = `<h2>Painel de Administrador (Em construção)</h2>`;
}

// --- ROTEADOR PRINCIPAL ---
async function router() {
    renderNav();
    const pathString = window.location.hash.slice(1) || '/';
    const path = pathString.split('/').filter(p => p).map(decodeURIComponent);
    const route = path[0] || 'home';

    switch (route) {
        case 'login':
            renderLoginPage();
            break;
        case 'register':
            renderRegisterPage();
            break;
        case 'admin':
            if (state.role === 'owner' || state.role === 'admin') {
                renderAdminPage();
            } else {
                alert("Acesso negado.");
                window.location.hash = '/';
            }
            break;
        case 'home':
        default:
            renderFilesPage(path);
            break;
    }
}

// --- INICIALIZAÇÃO ---
async function main() {
    // Ouve por mudanças na URL
    window.addEventListener('hashchange', router);

    // Carrega a lista de arquivos (filtrada pela API se o usuário estiver logado)
    try {
        const data = await apiCall(`files?t=${new Date().getTime()}`, 'GET', null); // Cache-busting
        state.allFiles = data.files || [];
        state.fileTree = buildFileTree(state.allFiles);
    } catch (error) {
        console.error("Não foi possível carregar a lista de arquivos.", error);
    }
    
    // Inicia o roteador
    router();
}

main();