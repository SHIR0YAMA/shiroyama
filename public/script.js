// /public/script.js

// --- 1. FUNÇÕES AUXILIARES ---
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 4000);
}

let faviconInterval = null;
const originalTitle = document.title;
const faviconNormal = document.getElementById('favicon-normal');
const faviconNotif = document.getElementById('favicon-notif');

function startFaviconBlink() {
    if (faviconInterval || !faviconNormal || !faviconNotif) return;
    let isNotif = true;
    faviconInterval = setInterval(() => {
        faviconNormal.setAttribute('href', isNotif ? faviconNotif.href : faviconNormal.href);
        document.title = isNotif ? "(!) " + originalTitle : originalTitle;
        isNotif = !isNotif;
    }, 800);
}

function stopFaviconBlink() {
    if (!faviconInterval) return;
    clearInterval(faviconInterval);
    faviconInterval = null;
    faviconNormal.setAttribute('href', faviconNormal.href);
    document.title = originalTitle;
}

// --- 2. ESTADO GLOBAL E FUNÇÃO DE RECARGA ---
const state = {
    token: localStorage.getItem('jwtToken'),
    username: localStorage.getItem('username'),
    role: localStorage.getItem('role'),
    fileTree: {},
    allFiles: []
};

function refreshFiles() {
    showNotification('Atualizando lista de arquivos...', 'info');
    state.allFiles = [];
    state.fileTree = {};
    router();
}

// --- 3. ELEMENTOS DO DOM ---
const mainContent = document.getElementById('main-content');
const mainNav = document.getElementById('main-nav');
const authModal = document.getElementById('authModal');
const whyLinkModal = document.getElementById('whyLinkModal');

// --- 4. FUNÇÃO CENTRAL DE API ---
async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = {
        'Content-Type': 'application/json'
    };
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }
    try {
        const response = await fetch(`/api/${endpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : null
        });
        if (response.status === 204) {
            return null;
        }
        const result = await response.json();
        if (!response.ok) {
            if (response.status === 401 && endpoint !== 'auth/login') {
                logout();
            }
            throw new Error(result.message || response.statusText);
        }
        return result;
    } catch (error) {
        console.error(`API Error on ${endpoint}:`, error);
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
    state.token = null;
    state.username = null;
    state.role = null;
    localStorage.clear();
    window.location.hash = '/';
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
                currentLevel[part] = { ...file,
                    _isFile: true
                };
            } else {
                if (!currentLevel[part]) {
                    currentLevel[part] = {};
                }
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

async function handleSingleForward(messageId) {
    if (!state.token) {
        authModal.classList.add('show');
        return;
    }
    showNotification('Enviando para o seu Telegram...', 'info');
    try {
        await apiCall('single-forward', 'POST', {
            message_id: parseInt(messageId)
        });
        showNotification('✅ Arquivo enviado com sucesso!', 'success');
    } catch (error) {
        if (error.message.includes('vinculada')) {
            showNotification('❌ Primeiro, vincule sua conta do Telegram no Perfil.', 'error');
            setTimeout(() => window.location.hash = '/profile', 2000);
        } else {
            showNotification(`❌ Erro: ${error.message}`, 'error');
        }
    }
}

// --- 7. FUNÇÕES DE RENDERIZAÇÃO DE PÁGINAS ("VIEWS") ---
function renderNav() {
    if (state.token) {
        mainNav.innerHTML = `<span>Olá, <a href="/#/profile"><strong>${state.username}</strong></a> (${state.role})</span>
            ${state.role === 'owner' || state.role === 'admin' ? '<a href="/#/admin">Admin</a>' : ''}
            <a href="#" id="logout-btn">Sair</a>`;
        document.getElementById('logout-btn').onclick = (e) => {
            e.preventDefault();
            logout();
        };
    } else {
        mainNav.innerHTML = `<a href="/#/login">Login</a> <a href="/#/register">Registrar</a>`;
    }
}

function renderLoginPage() {
    mainContent.innerHTML = `<form id="login-form" class="auth-form"><h2>Login</h2><div class="form-group"><label for="username">Nome de Usuário</label><input type="text" id="username" name="username" required></div><div class="form-group"><label for="password">Senha</label><input type="password" id="password" name="password" required></div><button type="submit">Entrar</button></form>`;
    document.getElementById('login-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
            const data = await apiCall('auth/login', 'POST', {
                username: e.target.username.value,
                password: e.target.password.value
            });
            login(data.token);
            window.location.hash = '/';
        } catch (error) {
            showNotification(`Erro no login: ${error.message}`, 'error');
        }
    };
}

function renderRegisterPage() {
    mainContent.innerHTML = `<form id="register-form" class="auth-form"><h2>Registrar Nova Conta</h2><div class="form-group"><label for="username">Nome de Usuário</label><input type="text" id="username" name="username" required minlength="3"></div><div class="form-group"><label for="password">Senha</label><input type="password" id="password" name="password" required minlength="6"></div><button type="submit">Registrar</button></form>`;
    document.getElementById('register-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
            const data = await apiCall('auth/register', 'POST', {
                username: e.target.username.value,
                password: e.target.password.value
            });
            showNotification(data.message, 'success');
            window.location.hash = '/login';
        } catch (error) {
            showNotification(`Erro no registro: ${error.message}`, 'error');
        }
    };
}

async function renderProfilePage() {
    mainContent.innerHTML = `<div class="auth-form"><h2>Carregando perfil...</h2></div>`;
    try {
        const userData = await apiCall('user/status', 'GET');
        let telegramSectionHTML = '';
        if (userData.telegram_chat_id) {
            telegramSectionHTML = `<h3>Conta do Telegram Vinculada</h3> <p>Usuário: <strong>@${userData.telegram_username || 'N/A'}</strong></p> <p>Chat ID: <strong>${userData.telegram_chat_id}</strong></p> <button id="unlink-btn">Desvincular Conta</button>`;
        } else {
            telegramSectionHTML = `<h3>Vincular Conta do Telegram</h3> <p>Clique no botão abaixo para autorizar o bot no Telegram.</p> <button id="link-telegram-btn">Vincular com o Telegram</button> <a href="#" id="why-link-q" style="display: block; margin-top: 15px; font-size: 14px;">Por que preciso fazer isso?</a>`;
        }
        mainContent.innerHTML = `<div class="auth-form"><h2>Meu Perfil</h2><p>Usuário do Site: <strong>${userData.username}</strong> | Cargo: <strong>${userData.role}</strong></p><hr style="border-color: #6272a4; margin: 20px 0;">${telegramSectionHTML}<hr style="border-color: #6272a4; margin: 20px 0;"><h3>Alterar Senha</h3><form id="password-form"><div class="form-group"><label for="current-password">Senha Atual</label><input type="password" id="current-password" required></div><div class="form-group"><label for="new-password">Nova Senha</label><input type="password" id="new-password" required minlength="6"></div><div class="form-group"><label for="confirm-password">Confirmar Nova Senha</label><input type="password" id="confirm-password" required minlength="6"></div><button type="submit">Salvar Nova Senha</button></form></div>`;
        if (userData.telegram_chat_id) {
            document.getElementById('unlink-btn').onclick = async () => {
                if (confirm('Tem certeza?')) {
                    try {
                        await apiCall('user/unlink-telegram', 'POST');
                        showNotification('Conta desvinculada com sucesso.', 'success');
                        router();
                    } catch (error) {
                        showNotification(`Erro: ${error.message}`, 'error');
                    }
                }
            };
        } else {
            document.getElementById('link-telegram-btn').onclick = (e) => {
                const linkButton = e.target;
                linkButton.disabled = true;
                linkButton.textContent = 'Gerando...';
                const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                const linkCodeWithPrefix = `link_${randomCode}`;
                apiCall('user/prepare-link-code', 'POST', {
                    linkCode: linkCodeWithPrefix
                }).then(() => {
                    window.open(`https://t.me/ShiroyamaBot?start=${linkCodeWithPrefix}`, '_blank');
                    linkButton.textContent = 'Verifique o Telegram!';
                    showNotification('Conclua o vínculo no Telegram.', 'info');
                    startFaviconBlink();
                    setTimeout(() => router(), 15000);
                }).catch(err => {
                    showNotification(`Erro: ${err.message}`, 'error');
                    linkButton.disabled = false;
                    linkButton.textContent = 'Vincular com o Telegram';
                });
            };
            document.getElementById('why-link-q').onclick = (e) => {
                e.preventDefault();
                whyLinkModal.classList.add('show');
            };
        }
        document.getElementById('password-form').onsubmit = async (e) => {
            e.preventDefault();
            const currentPassword = e.target['current-password'].value;
            const newPassword = e.target['new-password'].value;
            if (newPassword !== e.target['confirm-password'].value) {
                showNotification("As senhas não coincidem.", 'error');
                return;
            }
            try {
                const data = await apiCall('auth/change-password', 'POST', {
                    currentPassword,
                    newPassword
                });
                showNotification(data.message, 'success');
                logout();
            } catch (error) {
                showNotification(`Erro: ${error.message}`, 'error');
            }
        };
    } catch (error) {
        mainContent.innerHTML = `<div class="auth-form"><h2>Erro ao carregar perfil</h2><p style="color: #ff5555;">${error.message}</p></div>`;
    }
}

async function renderAdminPage() {
    mainContent.innerHTML = `<div id="breadcrumb">Painel de Administrador - Gestão de Usuários</div><table class="file-table"><thead><tr><th>Usuário</th><th>Cargo</th><th>ID do Chat</th><th>Criado em</th><th class="actions-col">Ações</th></tr></thead><tbody id="user-list-body"><tr><td colspan="5">Carregando...</td></tr></tbody></table>`;
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
                    const result = await apiCall('admin/update-role', 'POST', {
                        userId: parseInt(userId),
                        newRole
                    });
                    showNotification(result.message, 'success');
                } catch (error) {
                    showNotification(`Erro: ${error.message}`, 'error');
                }
            };
        });
        document.querySelectorAll('.delete-user-btn').forEach(btn => {
            btn.onclick = async () => {
                if (confirm('Tem certeza?')) {
                    const userId = btn.dataset.id;
                    try {
                        const result = await apiCall('admin/delete-user', 'POST', {
                            userId: parseInt(userId)
                        });
                        showNotification(result.message, 'success');
                        router();
                    } catch (error) {
                        showNotification(`Erro: ${error.message}`, 'error');
                    }
                }
            };
        });
    } catch (error) {
        mainContent.innerHTML += `<p style="color: #ff5555;">Erro: ${error.message}</p>`;
    }
}

function renderFilesPage(path) {
    mainContent.innerHTML = `
        <div class="controls">
            <div id="breadcrumb"></div>
            <button id="refresh-files-btn" class="btn-refresh" title="Atualizar Lista de Arquivos">🔄</button>
        </div>
        <div id="bulk-actions-container"></div>
        <div class="file-list-header">
            <input type="checkbox" id="select-all-checkbox" class="file-checkbox">
            <span class="file-name">Nome</span>
            <span class="file-size">Tamanho</span>
            <span class="file-actions">Ações</span>
        </div>
        <div id="file-list-body" class="file-list"></div>
    `;

    document.getElementById('refresh-files-btn').onclick = refreshFiles;

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
        return nameA.localeCompare(nameB, undefined, {
            numeric: true
        });
    });

    if (items.length === 0) {
        fileListBodyElement.innerHTML = '<div class="file-item">Pasta vazia.</div>';
        document.getElementById('select-all-checkbox').disabled = true;
        return;
    }

    items.forEach(([name, item]) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        if (item._isFile) {
            div.innerHTML = `
                <input type="checkbox" class="file-checkbox" data-message-id="${item.message_id}">
                <span class="file-icon">📄</span>
                <span class="file-name">${name}</span>
                <span class="file-size">${formatFileSize(item.file_size)}</span>
                <div class="file-actions">
                    <button class="btn-icon btn-single-forward" data-message-id="${item.message_id}" title="Receber no Telegram">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            `;
        } else {
            // Garante que o checkbox de pastas não apareça e o link ocupe o espaço
            div.innerHTML = `
                <div class="file-checkbox"></div> 
                <a href="#/${[...path, name].map(encodeURIComponent).join('/')}" class="file-item-name" style="width: 100%; display: flex; align-items: center;">
                    <span class="file-icon">📁</span>
                    <span>${name}</span>
                </a>
            `;
        }
        fileListBodyElement.appendChild(div);
    });
    
    // O event listener para 'Select All' foi movido para a inicialização para evitar que seja perdido.
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

    // --- CORREÇÃO DO BUG DE ATUALIZAÇÃO ---
    // Adiciona um timestamp para evitar o cache do navegador ao buscar arquivos.
    if (!state.allFiles.length && state.token) {
        try {
            const data = await apiCall(`files?t=${new Date().getTime()}`, 'GET');
            state.allFiles = data.files || [];
            state.fileTree = buildFileTree(state.allFiles);
        } catch (error) {
            console.error("Não foi possível carregar a lista de arquivos.", error);
            showNotification("Sessão expirada ou erro ao carregar arquivos.", 'error');
            logout();
            return;
        }
    }

    switch (route) {
        case 'login': renderLoginPage(); break;
        case 'register': renderRegisterPage(); break;
        case 'admin':
            if (state.role === 'owner' || state.role === 'admin') renderAdminPage();
            else { showNotification("Acesso negado.", 'error'); window.location.hash = '/'; }
            break;
        case 'profile': renderProfilePage(); break;
        default:
            if (state.token) renderFilesPage(path);
            else window.location.hash = '/login';
            break;
    }
}

// --- 9. INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('focus', stopFaviconBlink);
    
    document.getElementById('modal-close-btn').onclick = () => authModal.classList.remove('show');
    document.getElementById('modal-login-btn').onclick = () => window.location.hash = '/login';
    document.getElementById('modal-register-btn').onclick = () => window.location.hash = '/register';
    authModal.onclick = (e) => { if (e.target === authModal) authModal.classList.remove('show'); };
    
    document.getElementById('why-modal-close-btn').onclick = () => whyLinkModal.classList.remove('show');
    whyLinkModal.onclick = (e) => { if (e.target === whyLinkModal) whyLinkModal.classList.remove('show'); };

    // --- CORREÇÃO DO BUG "SELECIONAR TODOS" ---
    // Usamos delegação de evento no container principal para garantir que os listeners sempre funcionem.
    mainContent.addEventListener('click', (e) => {
        // Ação para o botão de envio único
        const singleForwardButton = e.target.closest('.btn-single-forward');
        if (singleForwardButton) {
            handleSingleForward(singleForwardButton.dataset.messageId);
        }
        
        // Ação para o checkbox "Selecionar Todos"
        if (e.target.id === 'select-all-checkbox') {
            const isChecked = e.target.checked;
            document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = isChecked);
            
            // Força a atualização da barra de ações em massa
            const firstCheckbox = document.querySelector('.file-checkbox');
            if(firstCheckbox) firstCheckbox.dispatchEvent(new Event('change'));
        }
    });

    // Listener para as checkboxes individuais para atualizar a barra de ações
    mainContent.addEventListener('change', (e) => {
        if (e.target.classList.contains('file-checkbox')) {
            const bulkActionsContainer = document.getElementById('bulk-actions-container');
            if (!bulkActionsContainer) return;

            const selected = Array.from(document.querySelectorAll('.file-checkbox:checked'));
            if (selected.length === 0) {
                bulkActionsContainer.style.display = 'none';
                return;
            }
            
            bulkActionsContainer.style.display = 'flex';
            bulkActionsContainer.style.gap = '10px';
            bulkActionsContainer.innerHTML = '';
            
            const forwardBtn = document.createElement('button');
            forwardBtn.textContent = `Receber ${selected.length} Arquivo(s)`;
            forwardBtn.onclick = async () => {
                if (!state.token) { showNotification("Você precisa estar logado.", 'error'); return; }
                const message_ids = selected.map(cb => parseInt(cb.dataset.messageId));
                try {
                    forwardBtn.textContent = 'Enviando...';
                    forwardBtn.disabled = true;
                    await apiCall('bulk-forward', 'POST', { message_ids });
                    showNotification("O bot começou a enviar os arquivos! Verifique seu Telegram.", 'success');
                } catch (error) {
                    showNotification(`Ocorreu um erro: ${error.message}`, 'error');
                } finally {
                    forwardBtn.textContent = `Receber ${selected.length} Arquivo(s)`;
                    forwardBtn.disabled = false;
                }
            };
            bulkActionsContainer.appendChild(forwardBtn);
        }
    });

    window.addEventListener('hashchange', router);
    router();
});