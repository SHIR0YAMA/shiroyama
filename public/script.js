// /public/script.js

// --- FUNÇÕES AUXILIARES ---
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
async function apiCall(endpoint, method = 'GET', body = null) {
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
    state.token = null; state.username = null; state.role = null;
    localStorage.clear();
    window.location.hash = '/';
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
        mainNav.innerHTML = `<span>Olá, <a href="/#/profile"><strong>${state.username}</strong></a> (${state.role})</span>
            ${state.role === 'owner' || state.role === 'admin' ? '<a href="/#/admin">Admin</a>' : ''}
            <a href="#" id="logout-btn">Sair</a>`;
        document.getElementById('logout-btn').onclick = (e) => { e.preventDefault(); logout(); };
    } else {
        mainNav.innerHTML = `<a href="/#/login">Login</a> <a href="/#/register">Registrar</a>`;
    }
}

function renderRegisterPage() {
    mainContent.innerHTML = `<form id="register-form" class="auth-form"><h2>Registrar Nova Conta</h2><div class="form-group"><label for="username">Nome de Usuário</label><input type="text" id="username" name="username" required minlength="3"></div><div class="form-group"><label for="password">Senha</label><input type="password" id="password" name="password" required minlength="6"></div><button type="submit">Registrar</button></form>`;
    document.getElementById('register-form').onsubmit = async (e) => {
        e.preventDefault();
        try { const data = await apiCall('auth/register', 'POST', { username: e.target.username.value, password: e.target.password.value }); alert(data.message); window.location.hash = '/login'; } 
        catch (error) { alert(`Erro no registro: ${error.message}`); }
    };
}

function renderLoginPage() {
    mainContent.innerHTML = `<form id="login-form" class="auth-form"><h2>Login</h2><div class="form-group"><label for="username">Nome de Usuário</label><input type="text" id="username" name="username" required></div><div class="form-group"><label for="password">Senha</label><input type="password" id="password" name="password" required></div><button type="submit">Entrar</button></form>`;
    document.getElementById('login-form').onsubmit = async (e) => {
        e.preventDefault();
        try { const data = await apiCall('auth/login', 'POST', { username: e.target.username.value, password: e.target.password.value }); login(data.token); window.location.hash = '/'; } 
        catch (error) { alert(`Erro no login: ${error.message}`); }
    };
}

function renderProfilePage() {
    mainContent.innerHTML = `<form id="profile-form" class="auth-form"><h2>Meu Perfil</h2><p>Usuário: <strong>${state.username}</strong> | Cargo: <strong>${state.role}</strong></p><hr style="border-color: #6272a4; margin: 20px 0;"><h3>Alterar Senha</h3><div class="form-group"><label for="current-password">Senha Atual</label><input type="password" id="current-password" required></div><div class="form-group"><label for="new-password">Nova Senha</label><input type="password" id="new-password" required minlength="6"></div><div class="form-group"><label for="confirm-password">Confirmar Nova Senha</label><input type="password" id="confirm-password" required minlength="6"></div><button type="submit">Salvar Alterações</button></form>`;
    document.getElementById('profile-form').onsubmit = async (e) => {
        e.preventDefault();
        const currentPassword = e.target['current-password'].value;
        const newPassword = e.target['new-password'].value;
        const confirmPassword = e.target['confirm-password'].value;
        if (newPassword !== confirmPassword) { alert("A nova senha e a confirmação não coincidem."); return; }
        try { const data = await apiCall('auth/change-password', 'POST', { currentPassword, newPassword }); alert(data.message); logout(); } 
        catch (error) { alert(`Erro ao alterar a senha: ${error.message}`); }
    };
}

async function renderAdminPage() {
    mainContent.innerHTML = `<div id="breadcrumb">Painel de Administrador - Gestão de Usuários</div><table class="file-table"><thead><tr><th>Usuário</th><th>Cargo</th><th>Criado em</th><th class="actions-col">Ações</th></tr></thead><tbody id="user-list-body"><tr><td colspan="4">Carregando usuários...</td></tr></tbody></table>`;
    try {
        const data = await apiCall('admin/users', 'GET');
        const userListBody = document.getElementById('user-list-body');
        userListBody.innerHTML = '';
        data.users.forEach(user => {
            const tr = document.createElement('tr');
            const roles = ['owner', 'admin', 'editor', 'viewer'];
            const roleOptions = roles.map(r => `<option value="${r}" ${user.role === r ? 'selected' : ''}>${r}</option>`).join('');
            tr.innerHTML = `<td>${user.username}</td><td><select class="role-select" data-id="${user.id}" ${state.username === user.username ? 'disabled' : ''}>${roleOptions}</select></td><td>${new Date(user.created_at).toLocaleDateString()}</td><td class="actions-col admin-actions"><button class="save-role-btn" data-id="${user.id}">Salvar</button><button class="delete-user-btn" data-id="${user.id}" ${state.username === user.username ? 'disabled' : ''}>Deletar</button></td>`;
            userListBody.appendChild(tr);
        });
        document.querySelectorAll('.save-role-btn').forEach(btn => {
            btn.onclick = async () => {
                const userId = btn.dataset.id;
                const newRole = document.querySelector(`.role-select[data-id="${userId}"]`).value;
                try { const result = await apiCall('admin/update-role', 'POST', { userId: parseInt(userId), newRole }); alert(result.message); } 
                catch (error) { alert(`Erro: ${error.message}`); }
            };
        });
        document.querySelectorAll('.delete-user-btn').forEach(btn => {
            btn.onclick = async () => {
                if (confirm('Tem certeza que deseja deletar este usuário?')) {
                    const userId = btn.dataset.id;
                    try { const result = await apiCall('admin/delete-user', 'POST', { userId: parseInt(userId) }); alert(result.message); router(); } 
                    catch (error) { alert(`Erro: ${error.message}`); }
                }
            };
        });
    } catch (error) { mainContent.innerHTML += `<p style="color: #ff5555;">Erro ao carregar usuários: ${error.message}</p>`; }
}

function renderFilesPage(path) {
    mainContent.innerHTML = `
        <div class="navigation-controls">
            <button id="back-button" class="nav-button" title="Voltar">←</button>
            <button id="forward-button" class="nav-button" title="Avançar">→</button>
        </div>
        <div id="breadcrumb" style="margin-top: 15px;"></div>
        <div id="bulk-actions-container" style="display: none; margin-bottom: 15px; padding: 10px; background-color: #3b3e50; border-radius: 5px; border: 1px solid #6272a4;"></div>
        <table class="file-table">
            <thead><tr><th style="width: 1%;"><input type="checkbox" id="select-all-checkbox"></th><th>Nome</th><th class="size-col">Tamanho</th><th class="download-col"></th></tr></thead>
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
    const items = Object.entries(content).sort(([nameA, itemA], [nameB, itemB]) => {
        const isFileA = itemA._isFile;
        const isFileB = itemB._isFile;
        if (isFileA && !isFileB) return 1;
        if (!isFileA && isFileB) return -1;
        return nameA.localeCompare(nameB, undefined, { numeric: true });
    });

    if (items.length === 0) {
        fileListBodyElement.innerHTML = '<tr><td colspan="4">Pasta vazia.</td></tr>';
        document.getElementById('select-all-checkbox').disabled = true;
        return;
    }

    items.forEach(([name, item]) => {
        const tr = document.createElement('tr');
        if (item._isFile) {
            tr.innerHTML = `
                <td><input type="checkbox" class="file-checkbox" data-message-id="${item.message_id}" data-key="${item.name}"></td>
                <td class="file-item-name"><span>📄</span> <span>${name}</span></td>
                <td class="size-col">${formatFileSize(item.file_size)}</td>
                <td class="download-col"><a href="https://t.me/ShiroyamaBot?start=${item.message_id}" target="_blank" rel="noopener noreferrer">Receber no Telegram</a></td>
            `;
        } else {
            tr.innerHTML = `<td colspan="4"><a href="#/${[...path, name].map(encodeURIComponent).join('/')}" class="file-item-name"><span>📁</span> <span>${name}</span></a></td>`;
        }
        fileListBodyElement.appendChild(tr);
    });

    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const fileCheckboxes = document.querySelectorAll('.file-checkbox');
    const bulkActionsContainer = document.getElementById('bulk-actions-container');

    function updateBulkActions() {
        const selected = Array.from(document.querySelectorAll('.file-checkbox:checked'));
        if (selected.length === 0) {
            bulkActionsContainer.style.display = 'none';
            return;
        }
        bulkActionsContainer.style.display = 'flex';
        bulkActionsContainer.style.gap = '10px';
        bulkActionsContainer.innerHTML = '';

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = `Receber ${selected.length} Arquivo(s)`;
        downloadBtn.onclick = async () => {
            if (!state.token) {
                alert("Você precisa estar logado para usar esta função.");
                window.location.hash = '/login';
                return;
            }
            let userChatId = sessionStorage.getItem('userChatId');
            if (!userChatId) {
                userChatId = prompt("Pela primeira vez, precisamos do seu ID de Chat do Telegram.\n\n1. Inicie uma conversa com o bot @userinfobot e envie /start\n2. Copie o número em 'Id:'\n3. Cole aqui:", "");
                if (userChatId && !isNaN(userChatId)) {
                    sessionStorage.setItem('userChatId', userChatId);
                } else {
                    alert("ID inválido. A operação foi cancelada.");
                    return;
                }
            }
            const message_ids = selected.map(cb => parseInt(cb.dataset.messageId));
            try {
                downloadBtn.textContent = 'Enviando...';
                downloadBtn.disabled = true;
                await apiCall('bulk-forward', 'POST', { message_ids, user_chat_id: parseInt(userChatId) });
                alert("O bot começou a enviar os arquivos para você no Telegram!");
            } catch (error) {
                alert(`Ocorreu um erro: ${error.message}`);
            } finally {
                downloadBtn.textContent = `Receber ${selected.length} Arquivo(s)`;
                downloadBtn.disabled = false;
            }
        };
        bulkActionsContainer.appendChild(downloadBtn);

        if (state.role === 'admin' || state.role === 'owner') {
            const moveBtn = document.createElement('button');
            moveBtn.textContent = 'Mover Selecionados';
            moveBtn.onclick = () => { alert('Funcionalidade de Mover em Massa (em construção)'); };
            bulkActionsContainer.appendChild(moveBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Excluir Selecionados';
            deleteBtn.onclick = () => { alert('Funcionalidade de Excluir em Massa (em construção)'); };
            bulkActionsContainer.appendChild(deleteBtn);
        }
    }
    selectAllCheckbox.onchange = (e) => {
        fileCheckboxes.forEach(cb => cb.checked = e.target.checked);
        updateBulkActions();
    };
    fileCheckboxes.forEach(cb => cb.onchange = updateBulkActions);
}

async function router() {
    renderNav();
    const pathString = window.location.hash.slice(1) || '/';
    const path = pathString.split('/').filter(p => p).map(decodeURIComponent);
    const route = path[0] || 'home';

    if (['admin', 'profile'].includes(route) && !state.token) {
        window.location.hash = '/login';
        return;
    }
    
    if (route === 'home' || route === '' || route === 'admin') {
        if (!state.allFiles.length) {
             try {
                const data = await apiCall(`files?t=${new Date().getTime()}`, 'GET');
                state.allFiles = data.files || [];
                state.fileTree = buildFileTree(state.allFiles);
            } catch (error) { console.error("Não foi possível carregar a lista de arquivos.", error); }
        }
    }
    switch (route) {
        case 'login': renderLoginPage(); break;
        case 'register': renderRegisterPage(); break;
        case 'admin':
            if (state.role === 'owner' || state.role === 'admin') { renderAdminPage(); } 
            else { alert("Acesso negado."); window.location.hash = '/'; }
            break;
        case 'profile': renderProfilePage(); break;
        default: renderFilesPage(path); break;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('hashchange', router);
    router();
});