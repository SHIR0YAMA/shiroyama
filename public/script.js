// /public/script.js

// --- 1. FUNÇÕES AUXILIARES ---
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// --- INÍCIO: FUNÇÃO ADICIONADA NA FASE 2 ---
/**
 * Exibe uma notificação flutuante (toast).
 * @param {string} message - A mensagem para exibir.
 * @param {'success'|'error'|'info'} type - O tipo de notificação.
 */
function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 4000);
}
// --- FIM: FUNÇÃO ADICIONADA NA FASE 2 ---


// --- 2. ESTADO GLOBAL DA APLICAÇÃO ---
const state = {
    token: localStorage.getItem('jwtToken'),
    username: localStorage.getItem('username'),
    role: localStorage.getItem('role'),
    fileTree: {},
    allFiles: []
};

// --- 3. ELEMENTOS DO DOM ---
const mainContent = document.getElementById('main-content');
const mainNav = document.getElementById('main-nav');
// --- INÍCIO: ELEMENTOS ADICIONADOS NA FASE 2 ---
const authModal = document.getElementById('authModal');
// --- FIM: ELEMENTOS ADICIONADOS NA FASE 2 ---

// --- 4. FUNÇÃO CENTRAL DE API ---
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
        
        // --- ALTERAÇÃO AQUI: Trata respostas que podem não ter corpo JSON (como 204 No Content) ---
        if (response.status === 204) return null; 
        
        const result = await response.json();
        if (!response.ok) {
            // Se o token for inválido, desloga o usuário
            if (response.status === 401 && endpoint !== 'auth/login') {
                logout();
            }
            throw new Error(result.message || response.statusText);
        }
        return result;
    } catch (error) {
        console.error(`API Error on ${endpoint}:`, error);
        // Não mostra o alerta aqui para dar controle a quem chama a função
        throw error;
    }
}

// --- 5. FUNÇÕES DE AUTENTICAÇÃO ---
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
    // Força a atualização da página para a home, limpando o estado
    window.location.hash = '/';
    // Recarrega a página para garantir que tudo seja reinicializado
    window.location.reload(); 
}

// --- 6. FUNÇÕES DE LÓGICA DE ARQUIVOS ---
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

// --- INÍCIO: LÓGICA DE AÇÕES DE ARQUIVO ADICIONADA NA FASE 2 ---
async function handleSingleForward(messageId) {
    if (!state.token) {
        authModal.classList.add('show');
        return;
    }
    
    showNotification('Enviando para o seu Telegram...', 'info');
    try {
        await apiCall('single-forward', 'POST', { message_id: parseInt(messageId) });
        showNotification('✅ Arquivo enviado com sucesso!', 'success');
    } catch (error) {
        if (error.message.includes('não está vinculada')) {
            showNotification('❌ Primeiro, vincule sua conta do Telegram no Perfil.', 'error');
            // Atraso para dar tempo de ler a notificação
            setTimeout(() => window.location.hash = '/profile', 2000);
        } else {
            showNotification(`❌ Erro: ${error.message}`, 'error');
        }
    }
}
// --- FIM: LÓGICA DE AÇÕES DE ARQUIVO ADICIONADA NA FASE 2 ---


// --- 7. FUNÇÕES DE RENDERIZAÇÃO DE PÁGINAS ("VIEWS") ---
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

function renderLoginPage() {
    mainContent.innerHTML = `<form id="login-form" class="auth-form"><h2>Login</h2><div class="form-group"><label for="username">Nome de Usuário</label><input type="text" id="username" name="username" required></div><div class="form-group"><label for="password">Senha</label><input type="password" id="password" name="password" required></div><button type="submit">Entrar</button></form>`;
    document.getElementById('login-form').onsubmit = async (e) => {
        e.preventDefault();
        try { 
            const data = await apiCall('auth/login', 'POST', { username: e.target.username.value, password: e.target.password.value }); 
            login(data.token); 
            window.location.hash = '/'; 
        } 
        catch (error) { showNotification(`Erro no login: ${error.message}`, 'error'); }
    };
}

function renderRegisterPage() {
    mainContent.innerHTML = `<form id="register-form" class="auth-form"><h2>Registrar Nova Conta</h2><div class="form-group"><label for="username">Nome de Usuário</label><input type="text" id="username" name="username" required minlength="3"></div><div class="form-group"><label for="password">Senha</label><input type="password" id="password" name="password" required minlength="6"></div><button type="submit">Registrar</button></form>`;
    document.getElementById('register-form').onsubmit = async (e) => {
        e.preventDefault();
        try { 
            const data = await apiCall('auth/register', 'POST', { username: e.target.username.value, password: e.target.password.value }); 
            showNotification(data.message, 'success'); 
            window.location.hash = '/login'; 
        } 
        catch (error) { showNotification(`Erro no registro: ${error.message}`, 'error'); }
    };
}

function renderProfilePage() {
    mainContent.innerHTML = `
        <div class="auth-form">
            <h2>Meu Perfil</h2>
            <p>Usuário: <strong>${state.username}</strong> | Cargo: <strong>${state.role}</strong></p>
            <hr style="border-color: #6272a4; margin: 20px 0;">
            <h3>Vincular Conta do Telegram</h3>
            <div id="link-telegram-section">
                <p>Vincule sua conta para receber múltiplos arquivos de uma vez.</p>
                <button id="generate-link-code-btn">Gerar Código de Vinculação</button>
                <div id="link-code-display" style="display:none; margin-top: 10px;">
                    <p>Copie e envie o seguinte comando para o bot @ShiroyamaBot:</p>
                    <code style="background: #282a36; padding: 5px 10px; border-radius: 3px; font-weight: bold; user-select: all;"></code>
                </div>
            </div>
            <hr style="border-color: #6272a4; margin: 20px 0;">
            <h3>Alterar Senha</h3>
            <form id="password-form">
                <div class="form-group"><label for="current-password">Senha Atual</label><input type="password" id="current-password" required></div>
                <div class="form-group"><label for="new-password">Nova Senha</label><input type="password" id="new-password" required minlength="6"></div>
                <div class="form-group"><label for="confirm-password">Confirmar Nova Senha</label><input type="password" id="confirm-password" required minlength="6"></div>
                <button type="submit">Salvar Nova Senha</button>
            </form>
        </div>
    `;
    document.getElementById('generate-link-code-btn').onclick = async () => {
        try {
            const data = await apiCall('user/generate-link-code', 'POST');
            const display = document.getElementById('link-code-display');
            display.querySelector('code').textContent = `/start ${data.code}`; // --- ALTERAÇÃO AQUI: Mudado para /start ---
            display.style.display = 'block';
        } catch (error) { showNotification(`Erro ao gerar código: ${error.message}`, 'error'); }
    };
    document.getElementById('password-form').onsubmit = async (e) => {
        e.preventDefault();
        const currentPassword = e.target['current-password'].value;
        const newPassword = e.target['new-password'].value;
        const confirmPassword = e.target['confirm-password'].value;
        if (newPassword !== confirmPassword) { showNotification("A nova senha e a confirmação não coincidem.", 'error'); return; }
        try { 
            const data = await apiCall('auth/change-password', 'POST', { currentPassword, newPassword }); 
            showNotification(data.message, 'success'); 
            logout(); 
        } 
        catch (error) { showNotification(`Erro ao alterar a senha: ${error.message}`, 'error'); }
    };
}

async function renderAdminPage() {
    mainContent.innerHTML = `<div id="breadcrumb">Painel de Administrador - Gestão de Usuários</div><table class="file-table"><thead><tr><th>Usuário</th><th>Cargo</th><th>ID do Chat</th><th>Criado em</th><th class="actions-col">Ações</th></tr></thead><tbody id="user-list-body"><tr><td colspan="5">Carregando usuários...</td></tr></tbody></table>`;
    try {
        const data = await apiCall('admin/users', 'GET');
        const userListBody = document.getElementById('user-list-body');
        userListBody.innerHTML = '';
        data.users.forEach(user => {
            const tr = document.createElement('tr');
            const roles = ['owner', 'admin', 'editor', 'viewer'];
            const roleOptions = roles.map(r => `<option value="${r}" ${user.role === r ? 'selected' : ''}>${r}</option>`).join('');
            tr.innerHTML = `<td>${user.username}</td><td><select class="role-select" data-id="${user.id}" ${state.username === user.username ? 'disabled' : ''}>${roleOptions}</select></td><td>${user.telegram_chat_id || 'Não vinculado'}</td><td>${new Date(user.created_at).toLocaleDateString()}</td><td class="actions-col admin-actions"><button class="save-role-btn" data-id="${user.id}">Salvar</button><button class="delete-user-btn" data-id="${user.id}" ${state.username === user.username ? 'disabled' : ''}>Deletar</button></td>`;
            userListBody.appendChild(tr);
        });
        document.querySelectorAll('.save-role-btn').forEach(btn => {
            btn.onclick = async () => {
                const userId = btn.dataset.id;
                const newRole = document.querySelector(`.role-select[data-id="${userId}"]`).value;
                try { 
                    const result = await apiCall('admin/update-role', 'POST', { userId: parseInt(userId), newRole }); 
                    showNotification(result.message, 'success'); 
                } 
                catch (error) { showNotification(`Erro: ${error.message}`, 'error'); }
            };
        });
        document.querySelectorAll('.delete-user-btn').forEach(btn => {
            btn.onclick = async () => {
                if (confirm('Tem certeza?')) {
                    const userId = btn.dataset.id;
                    try { 
                        const result = await apiCall('admin/delete-user', 'POST', { userId: parseInt(userId) }); 
                        showNotification(result.message, 'success'); 
                        router(); 
                    } 
                    catch (error) { showNotification(`Erro: ${error.message}`, 'error'); }
                }
            };
        });
    } catch (error) {
        mainContent.innerHTML += `<p style="color: #ff5555;">Erro ao carregar usuários: ${error.message}</p>`;
    }
}

function renderFilesPage(path) {
    mainContent.innerHTML = `
        <div class="navigation-controls"> <button id="back-button" class="nav-button" title="Voltar">←</button> <button id="forward-button" class="nav-button" title="Avançar">→</button> </div>
        <div id="breadcrumb" style="margin-top: 15px;"></div>
        <div id="bulk-actions-container"></div>
        <table class="file-table"> <thead><tr><th style="width: 1%;"><input type="checkbox" id="select-all-checkbox"></th><th>Nome</th><th class="size-col">Tamanho</th><th class="download-col">Ações</th></tr></thead> <tbody id="file-list-body"></tbody> </table>
    `;
    
    document.getElementById('back-button').onclick = () => window.history.back();
    document.getElementById('forward-button').onclick = () => window.history.forward();
    document.getElementById('back-button').disabled = path.length === 0;
    
    const breadcrumbElement = document.getElementById('breadcrumb');
    breadcrumbElement.innerHTML = '';
    ['Home', ...path].forEach((part, index, arr) => {
        const span = document.createElement('span');
        if (index < arr.length - 1) { const a = document.createElement('a'); const targetPath = arr.slice(1, index + 1).map(encodeURIComponent).join('/'); a.href = `#/${targetPath}`; a.textContent = part; span.appendChild(a); span.innerHTML += ' > '; } 
        else { span.textContent = part; }
        breadcrumbElement.appendChild(span);
    });

    const fileListBodyElement = document.getElementById('file-list-body');
    const content = getContentForPath(path);
    const items = Object.entries(content).sort(([nameA, itemA], [nameB, itemB]) => { const isFileA = itemA._isFile; const isFileB = itemB._isFile; if (isFileA && !isFileB) return 1; if (!isFileA && isFileB) return -1; return nameA.localeCompare(nameB, undefined, { numeric: true }); });

    if (items.length === 0) {
        fileListBodyElement.innerHTML = '<tr><td colspan="4">Pasta vazia.</td></tr>';
        document.getElementById('select-all-checkbox').disabled = true;
        return;
    }

    items.forEach(([name, item]) => {
        const tr = document.createElement('tr');
        if (item._isFile) {
            // --- INÍCIO: ALTERAÇÃO CRÍTICA NA FASE 2 ---
            // Substituímos o link direto por um botão que chama nossa função JS
            tr.innerHTML = `
                <td><input type="checkbox" class="file-checkbox" data-message-id="${item.message_id}" data-key="${item.name}"></td>
                <td class="file-item-name"><span>📄</span> <span>${name}</span></td>
                <td class="size-col">${formatFileSize(item.file_size)}</td>
                <td class="download-col">
                    <button class="btn-single-forward" data-message-id="${item.message_id}" title="Receber no Telegram">Receber</button>
                </td>
            `;
            // --- FIM: ALTERAÇÃO CRÍTICA NA FASE 2 ---
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
        if (selected.length === 0) { bulkActionsContainer.style.display = 'none'; return; }
        bulkActionsContainer.style.display = 'flex'; bulkActionsContainer.style.gap = '10px';
        bulkActionsContainer.innerHTML = '';
        
        const forwardBtn = document.createElement('button');
        forwardBtn.textContent = `Receber ${selected.length} Arquivo(s)`;
        forwardBtn.onclick = async () => {
            if (!state.token) { showNotification("Você precisa estar logado.", 'error'); return; }
            const message_ids = selected.map(cb => parseInt(cb.dataset.messageId));
            try {
                forwardBtn.textContent = 'Enviando...'; forwardBtn.disabled = true;
                await apiCall('bulk-forward', 'POST', { message_ids });
                showNotification("O bot começou a enviar os arquivos! Verifique seu Telegram.", 'success');
            } catch (error) {
                showNotification(`Ocorreu um erro: ${error.message}`, 'error');
            } finally {
                forwardBtn.textContent = `Receber ${selected.length} Arquivo(s)`; forwardBtn.disabled = false;
            }
        };
        bulkActionsContainer.appendChild(forwardBtn);
    }
    selectAllCheckbox.onchange = (e) => { fileCheckboxes.forEach(cb => cb.checked = e.target.checked); updateBulkActions(); };
    fileCheckboxes.forEach(cb => cb.onchange = updateBulkActions);
}

// --- 8. ROTEADOR PRINCIPAL ---
async function router() {
    renderNav();
    const pathString = window.location.hash.slice(1) || '/';
    const path = pathString.split('/').filter(p => p).map(decodeURIComponent);
    const route = path[0] || 'home';

    if (['admin', 'profile'].includes(route) && !state.token) {
        window.location.hash = '/login';
        return;
    }

    // --- ALTERAÇÃO AQUI: Garante que os arquivos sejam carregados apenas uma vez ou se o usuário fizer login ---
    if (!state.fileTree.length && state.token) {
        try {
            const data = await apiCall(`files?t=${new Date().getTime()}`, 'GET');
            state.allFiles = data.files || [];
            state.fileTree = buildFileTree(state.allFiles);
        } catch (error) {
            console.error("Não foi possível carregar a lista de arquivos.", error);
            showNotification("Sessão expirada ou erro ao carregar arquivos. Faça login novamente.", 'error');
            logout();
            return; // Interrompe o roteamento se os arquivos não puderem ser carregados
        }
    }

    switch (route) {
        case 'login': renderLoginPage(); break;
        case 'register': renderRegisterPage(); break;
        case 'admin':
            if (state.role === 'owner' || state.role === 'admin') { renderAdminPage(); } 
            else { showNotification("Acesso negado.", 'error'); window.location.hash = '/'; }
            break;
        case 'profile': renderProfilePage(); break;
        default: 
            if (state.token) {
                renderFilesPage(path);
            } else {
                // Se não há token, vai para a página de login
                window.location.hash = '/login';
            }
            break;
    }
}

// --- 9. INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    // --- INÍCIO: EVENT LISTENERS ADICIONADOS NA FASE 2 ---
    // Listeners para o Modal
    document.getElementById('modal-close-btn').onclick = () => authModal.classList.remove('show');
    document.getElementById('modal-login-btn').onclick = () => window.location.hash = '/login';
    document.getElementById('modal-register-btn').onclick = () => window.location.hash = '/register';
    authModal.onclick = (e) => { if (e.target === authModal) authModal.classList.remove('show'); };
    
    // Delegação de evento para cliques nos botões de arquivo
    mainContent.addEventListener('click', (e) => {
        const singleForwardButton = e.target.closest('.btn-single-forward');
        if (singleForwardButton) {
            handleSingleForward(singleForwardButton.dataset.messageId);
        }
    });
    // --- FIM: EVENT LISTENERS ADICIONADOS NA FASE 2 ---

    window.addEventListener('hashchange', router);
    router(); // Chama o roteador pela primeira vez para carregar a página correta
});