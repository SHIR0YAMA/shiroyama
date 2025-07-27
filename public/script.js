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
    router();
}

// --- FUNÇÕES DE LÓGICA DE ARQUIVOS ---
function buildFileTree(files) { /* (Código igual ao anterior) */ }
function getContentForPath(path) { /* (Código igual ao anterior) */ }

// --- FUNÇÕES DE RENDERIZAÇÃO DE PÁGINAS ---
function renderNav() {
    if (state.token) {
        mainNav.innerHTML = `
            <span>Olá, <a href="/#/profile"><strong>${state.username}</strong></a> (${state.role})</span>
            ${state.role === 'owner' || state.role === 'admin' ? '<a href="/#/admin">Admin</a>' : ''}
            <a href="#" id="logout-btn">Sair</a>
        `;
        document.getElementById('logout-btn').onclick = (e) => { e.preventDefault(); logout(); };
    } else {
        mainNav.innerHTML = `<a href="/#/login">Login</a> <a href="/#/register">Registrar</a>`;
    }
}

function renderRegisterPage() { /* (Código igual ao anterior) */ }
function renderLoginPage() { /* (Código igual ao anterior) */ }
function renderFilesPage(path) { /* (Código igual ao anterior) */ }
function renderAdminPage() { /* (Código igual ao anterior) */ }

// --- NOVA PÁGINA DE PERFIL ---
function renderProfilePage() {
    mainContent.innerHTML = `
        <form id="profile-form" class="auth-form">
            <h2>Meu Perfil</h2>
            <p>Usuário: <strong>${state.username}</strong> | Cargo: <strong>${state.role}</strong></p>
            <hr style="border-color: #6272a4; margin: 20px 0;">
            <h3>Alterar Senha</h3>
            <div class="form-group">
                <label for="current-password">Senha Atual</label>
                <input type="password" id="current-password" required>
            </div>
            <div class="form-group">
                <label for="new-password">Nova Senha</label>
                <input type="password" id="new-password" required minlength="6">
            </div>
            <div class="form-group">
                <label for="confirm-password">Confirmar Nova Senha</label>
                <input type="password" id="confirm-password" required minlength="6">
            </div>
            <button type="submit">Salvar Alterações</button>
        </form>
    `;

    document.getElementById('profile-form').onsubmit = async (e) => {
        e.preventDefault();
        const currentPassword = e.target['current-password'].value;
        const newPassword = e.target['new-password'].value;
        const confirmPassword = e.target['confirm-password'].value;

        if (newPassword !== confirmPassword) {
            alert("A nova senha e a confirmação não coincidem.");
            return;
        }

        try {
            const data = await apiCall('auth/change-password', 'POST', { currentPassword, newPassword });
            alert(data.message);
            logout(); // Força o logout por segurança após mudar a senha
        } catch (error) {
            alert(`Erro ao alterar a senha: ${error.message}`);
        }
    };
}

// --- ROTEADOR PRINCIPAL ---
async function router() {
    renderNav();
    const pathString = window.location.hash.slice(1) || '/';
    const path = pathString.split('/').filter(p => p).map(decodeURIComponent);
    const route = path[0] || 'home';

    if (['admin', 'profile'].includes(route) && !state.token) {
        window.location.hash = '/login';
        return;
    }
    
    // Carrega os arquivos apenas se for necessário
    if (!state.allFiles.length && ['home', 'admin'].includes(route)) {
        try {
            const data = await apiCall(`files?t=${new Date().getTime()}`, 'GET', null);
            state.allFiles = data.files || [];
            state.fileTree = buildFileTree(state.allFiles);
        } catch (error) {
            console.error("Não foi possível carregar a lista de arquivos.", error);
        }
    }

    switch (route) {
        case 'login': renderLoginPage(); break;
        case 'register': renderRegisterPage(); break;
        case 'admin':
            if (state.role === 'owner' || state.role === 'admin') {
                renderAdminPage();
            } else {
                alert("Acesso negado.");
                window.location.hash = '/';
            }
            break;
        case 'profile':
            renderProfilePage();
            break;
        default:
            renderFilesPage(path);
            break;
    }
}

// --- INICIALIZAÇÃO ---
window.addEventListener('hashchange', router);
router();

// --- COLE AS FUNÇÕES COMPLETAS QUE FORAM RESUMIDAS ACIMA ---
buildFileTree = function(files) {
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
};
getContentForPath = function(path) {
    let currentLevel = state.fileTree;
    for (const folderName of path) {
        currentLevel = currentLevel[folderName];
        if (!currentLevel) return {};
    }
    return currentLevel;
};
renderRegisterPage = function() {
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
};
renderLoginPage = function() {
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
};
renderFilesPage = function(path) {
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
            tr.innerHTML = `<td class="file-item-name"><span>📄</span> <span>${name}</span></td><td class="size-col">${formatFileSize(item.file_size)}</td><td class="download-col"><a href="https://telegram-drive-eight.vercel.app/api/download?message_id=${item.message_id}&filename=${encodeURIComponent(name)}">Baixar</a></td>`;
        } else {
            tr.innerHTML = `<td colspan="3"><a href="#/${[...path, name].map(encodeURIComponent).join('/')}" class="file-item-name"><span>📁</span> <span>${name}</span></a></td>`;
        }
        fileListBodyElement.appendChild(tr);
    });
};
renderAdminPage = function() {
    // A lógica do painel de administrador foi movida para a Fase 4.
    // Primeiro, vamos implementar a gestão de usuários.
    mainContent.innerHTML = `<h2>Painel de Administrador - Gestão de Usuários</h2>`;
};