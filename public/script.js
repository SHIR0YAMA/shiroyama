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
    allFiles: [],
    sort: {
        key: 'name',
        order: 'asc'
    }
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
const moveFileModal = document.getElementById('move-file-modal');
const createFolderModal = document.getElementById('create-folder-modal');
const renameModal = document.getElementById('rename-modal');

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
    
    // Primeiro, cria todas as estruturas de pasta a partir dos placeholders
    files.forEach(file => {
        if (file.name.endsWith('/.placeholder')) {
            const folderOnlyPath = file.name.substring(0, file.name.length - 13);
            const parts = folderOnlyPath.split('/').filter(p => p);
            let currentLevel = tree;
            parts.forEach(part => {
                if (!currentLevel[part]) {
                    currentLevel[part] = {};
                }
                currentLevel = currentLevel[part];
            });
        }
    });

    // Depois, insere os arquivos na árvore
    files.forEach(file => {
        if (file.name.endsWith('/.placeholder')) return; // Ignora os placeholders aqui
        
        const parts = file.name.split('/').filter(p => p);
        let currentLevel = tree;
        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                currentLevel[part] = { ...file, _isFile: true };
            } else {
                if (!currentLevel[part]) {
                    currentLevel[part] = {}; // Cria a pasta se não existir
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

// --- 7. OPERAÇÕES DE ARQUIVO (Modais) ---
let moveState = {
    oldKeys: [],
    destinationPath: null,
    currentPath: []
};
let renameState = {
    oldKey: null,
    newKey: null,
    isFolder: false
};

function openMoveModal(keysToMove) {
    moveState.oldKeys = Array.isArray(keysToMove) ? keysToMove : [keysToMove];
    const firstFileName = moveState.oldKeys[0].split('/').pop();
    const displayName = moveState.oldKeys.length > 1 ? `${moveState.oldKeys.length} itens` : firstFileName;
    document.getElementById('move-file-name').textContent = displayName;
    moveState.currentPath = [];
    renderFolderNavigator();
    moveFileModal.classList.add('show');
}

function closeMoveModal() {
    moveFileModal.classList.remove('show');
}

function renderFolderNavigator() {
    const navContainer = document.getElementById('folder-navigation');
    const pathDisplay = document.getElementById('move-file-path');
    const confirmBtn = document.getElementById('move-file-confirm-btn');
    const currentFolderContent = getContentForPath(moveState.currentPath);
    const subFolders = Object.entries(currentFolderContent)
        .filter(([_, item]) => !item._isFile)
        .map(([name, _]) => name);

    let html = '<ul>';
    if (moveState.currentPath.length > 0) {
        html += `<li data-action="up">⬅️ .. (Voltar)</li>`;
    }
    subFolders.forEach(folder => {
        html += `<li data-action="down" data-folder="${folder}">📁 ${folder}</li>`;
    });
    html += '</ul>';
    navContainer.innerHTML = html;

    const currentDisplayPath = `/${moveState.currentPath.join('/')}`;
    pathDisplay.textContent = currentDisplayPath;
    confirmBtn.disabled = false;
}

async function confirmMoveFile() {
    moveState.destinationPath = moveState.currentPath.join('/');
    try {
        await apiCall('admin/bulk-move', 'POST', {
            oldKeys: moveState.oldKeys,
            destinationPath: moveState.destinationPath
        });
        showNotification("Item(ns) movido(s) com sucesso!", "success");
        closeMoveModal();
        refreshFiles();
    } catch (error) {
        showNotification(`Erro ao mover: ${error.message}`, "error");
    }
}

function openCreateFolderModal() {
    document.getElementById('new-folder-name').value = '';
    createFolderModal.classList.add('show');
    document.getElementById('new-folder-name').focus();
}

function closeCreateFolderModal() {
    createFolderModal.classList.remove('show');
}

async function confirmCreateFolder() {
    const folderNameInput = document.getElementById('new-folder-name');
    const newFolderName = folderNameInput.value.trim();

    if (!newFolderName) {
        showNotification("O nome da pasta não pode estar vazio.", "error");
        return;
    }
    if (newFolderName.includes('/') || newFolderName === '.placeholder') {
        showNotification("Nome de pasta inválido.", "error");
        return;
    }

    const currentPath = (window.location.hash.slice(2) || '').split('/').filter(p => p);
    const fullPath = [...currentPath, newFolderName].join('/');

    try {
        await apiCall('admin/create-folder', 'POST', {
            folderPath: fullPath
        });
        showNotification(`Pasta "${newFolderName}" criada!`, "success");
        closeCreateFolderModal();
        refreshFiles();
    } catch (error) {
        showNotification(`Erro ao criar pasta: ${error.message}`, "error");
    }
}

function openRenameModal(key, isFolder) {
    renameState.oldKey = key;
    renameState.isFolder = isFolder;
    const currentName = key.split('/').pop();
    document.getElementById('rename-old-name').textContent = currentName;
    const renameInput = document.getElementById('rename-new-name');
    renameInput.value = currentName;
    renameModal.classList.add('show');
    renameInput.focus();
}

function closeRenameModal() {
    renameModal.classList.remove('show');
}

async function confirmRename() {
    const newName = document.getElementById('rename-new-name').value.trim();
    if (!newName || newName.includes('/')) {
        showNotification("Nome inválido.", "error");
        return;
    }
    const pathParts = renameState.oldKey.split('/');
    pathParts.pop();
    const newKey = [...pathParts, newName].join('/');
    if (renameState.oldKey === newKey) {
        closeRenameModal();
        return;
    }
    try {
        await apiCall('admin/rename', 'POST', {
            oldKey: renameState.oldKey,
            newKey,
            isFolder: renameState.isFolder
        });
        showNotification("Renomeado com sucesso!", "success");
        closeRenameModal();
        refreshFiles();
    } catch (error) {
        showNotification(`Erro ao renomear: ${error.message}`, "error");
    }
}

async function deleteItems(keys, isFolder = false, folderName = '') {
    const keyCount = keys.length;
    let message = isFolder ?
        `Tem certeza que deseja excluir a pasta "${folderName}" e todo o seu conteúdo? Esta ação é irreversível.` :
        `Tem certeza que deseja excluir ${keyCount} item(ns)? Esta ação é irreversível.`;
    if (!confirm(message)) return;
    try {
        const payload = isFolder ? {
            prefix: keys[0] + '/'
        } : {
            keys: keys
        };
        await apiCall('admin/bulk-delete', 'POST', payload);
        showNotification("Item(ns) excluído(s) com sucesso!", "success");
        refreshFiles();
    } catch (error) {
        showNotification(`Erro ao excluir: ${error.message}`, "error");
    }
}

// --- 8. FUNÇÕES DE RENDERIZAÇÃO DE PÁGINAS ("VIEWS") ---
function renderNav() {
    if (state.token) {
        mainNav.innerHTML = `<span>Olá, <a href="/#/profile"><strong>${state.username}</strong></a> (${state.role})</span> ${state.role === 'owner' || state.role === 'admin' ? '<a href="/#/admin">Admin</a>' : ''} <a href="#" id="logout-btn">Sair</a>`;
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
    mainContent.innerHTML = `<div class="controls"><div id="breadcrumb"></div><div class="controls-buttons"><button id="create-folder-btn" title="Criar Nova Pasta">📁+</button><button id="refresh-files-btn" class="btn-refresh" title="Atualizar Lista de Arquivos">🔄</button></div></div><div id="bulk-actions-container"></div><div class="file-list-header"><input type="checkbox" id="select-all-checkbox" class="file-checkbox"><span class="file-name sortable-header" data-sort="name">Nome<span class="sort-indicator"></span></span><span class="file-size sortable-header" data-sort="size">Tamanho<span class="sort-indicator"></span></span><span class="file-actions">Ações</span></div><div id="file-list-body" class="file-list"></div>`;
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
        const sortOrder = state.sort.order === 'asc' ? 1 : -1;
        if (state.sort.key === 'name') {
            return nameA.localeCompare(nameB, undefined, {
                numeric: true
            }) * sortOrder;
        }
        if (state.sort.key === 'size') {
            return (itemA.file_size - itemB.file_size) * sortOrder;
        }
        return 0;
    });
    if (items.length === 0) {
        fileListBodyElement.innerHTML = '<div class="file-item">Pasta vazia.</div>';
        document.getElementById('select-all-checkbox').disabled = true;
        return;
    }
    items.forEach(([name, item]) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        const itemPath = [...path, name].join('/');
        if (item._isFile) {
            div.innerHTML = `<input type="checkbox" class="file-checkbox" data-key="${item.name}" data-message-id="${item.message_id}"><span class="file-icon">📄</span><span class="file-name">${name}</span><span class="file-size">${formatFileSize(item.file_size)}</span><div class="file-actions"><button class="btn-icon btn-rename" data-key="${item.name}" data-isfolder="false" title="Renomear"><i class="fas fa-edit"></i></button><button class="btn-icon btn-move-file" data-key="${item.name}" title="Mover"><i class="fas fa-folder-open"></i></button><button class="btn-icon btn-single-forward" data-message-id="${item.message_id}" title="Receber"><i class="fas fa-paper-plane"></i></button><button class="btn-icon danger btn-delete" data-key="${item.name}" data-isfolder="false" title="Excluir"><i class="fas fa-trash"></i></button></div>`;
        } else {
            div.innerHTML = `<div class="file-checkbox" style="visibility: hidden;"></div><a href="#/${itemPath}" class="file-item-name" style="width: 100%; display: flex; align-items: center;"><span class="file-icon">📁</span><span>${name}</span></a><div class="file-actions"><button class="btn-icon btn-rename" data-key="${itemPath}" data-isfolder="true" title="Renomear"><i class="fas fa-edit"></i></button><button class="btn-icon danger btn-delete" data-key="${itemPath}" data-isfolder="true" title="Excluir"><i class="fas fa-trash"></i></button></div>`;
        }
        fileListBodyElement.appendChild(div);
    });
    document.querySelectorAll('.sortable-header').forEach(header => {
        if (header.dataset.sort === state.sort.key) {
            header.querySelector('.sort-indicator').classList.add(state.sort.order);
        }
    });
}

// --- 9. ROTEADOR PRINCIPAL ---
async function router() {
    renderNav();
    const pathString = window.location.hash.slice(1) || '/';
    const path = pathString.split('/').filter(p => p && p !== '#').map(decodeURIComponent);
    const route = path[0] || 'home';
    if (['admin', 'profile'].includes(route) && !state.token) {
        window.location.hash = '/login';
        return;
    }
    if (!state.allFiles.length && state.token) {
        try {
            const data = await apiCall(`files?t=${new Date().getTime()}`, 'GET');
            state.allFiles = data.files || [];
            state.fileTree = buildFileTree(state.allFiles);
        } catch (error) {
            console.error("Não foi possível carregar a lista de arquivos.", error);
            showNotification("Sessão expirada ou erro.", 'error');
            logout();
            return;
        }
    }
    switch (route) {
        case 'login':
            renderLoginPage();
            break;
        case 'register':
            renderRegisterPage();
            break;
        case 'admin':
            if (state.role === 'owner' || state.role === 'admin') renderAdminPage();
            else {
                showNotification("Acesso negado.", 'error');
                window.location.hash = '/';
            }
            break;
        case 'profile':
            renderProfilePage();
            break;
        default:
            if (state.token) renderFilesPage(path);
            else window.location.hash = '/login';
            break;
    }
}

// --- 10. INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('focus', stopFaviconBlink);
    document.getElementById('modal-close-btn').onclick = () => authModal.classList.remove('show');
    document.getElementById('modal-login-btn').onclick = () => window.location.hash = '/login';
    document.getElementById('modal-register-btn').onclick = () => window.location.hash = '/register';
    authModal.onclick = (e) => {
        if (e.target === authModal) authModal.classList.remove('show');
    };
    document.getElementById('why-modal-close-btn').onclick = () => whyLinkModal.classList.remove('show');
    whyLinkModal.onclick = (e) => {
        if (e.target === whyLinkModal) whyLinkModal.classList.remove('show');
    };
    document.getElementById('move-modal-close-btn').onclick = closeMoveModal;
    document.getElementById('move-file-cancel-btn').onclick = closeMoveModal;
    document.getElementById('move-file-confirm-btn').onclick = confirmMoveFile;
    moveFileModal.onclick = (e) => {
        if (e.target === moveFileModal) closeMoveModal();
    };
    document.getElementById('create-folder-close-btn').onclick = closeCreateFolderModal;
    document.getElementById('create-folder-cancel-btn').onclick = closeCreateFolderModal;
    document.getElementById('create-folder-confirm-btn').onclick = confirmCreateFolder;
    createFolderModal.onclick = (e) => {
        if (e.target === createFolderModal) closeCreateFolderModal();
    };
    document.getElementById('rename-close-btn').onclick = closeRenameModal;
    document.getElementById('rename-cancel-btn').onclick = closeRenameModal;
    document.getElementById('rename-confirm-btn').onclick = confirmRename;
    renameModal.onclick = (e) => {
        if (e.target === renameModal) closeRenameModal();
    };
    document.getElementById('new-folder-name').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') confirmCreateFolder();
    });
    document.getElementById('rename-new-name').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') confirmRename();
    });
    document.getElementById('folder-navigation').addEventListener('click', e => {
        const action = e.target.closest('li')?.dataset.action;
        if (!action) return;
        if (action === 'up') {
            moveState.currentPath.pop();
        } else if (action === 'down') {
            moveState.currentPath.push(e.target.closest('li').dataset.folder);
        }
        renderFolderNavigator();
    });

    mainContent.addEventListener('click', (e) => {
        const target = e.target.closest('button, .sortable-header');
        if (!target) return;
        if (target.classList.contains('btn-single-forward')) {
            handleSingleForward(target.dataset.messageId);
        }
        if (target.classList.contains('btn-move-file')) {
            openMoveModal(target.dataset.key);
        }
        if (target.classList.contains('btn-rename')) {
            openRenameModal(target.dataset.key, target.dataset.isfolder === 'true');
        }
        if (target.classList.contains('btn-delete')) {
            const isFolder = target.dataset.isfolder === 'true';
            const key = target.dataset.key;
            deleteItems([key], isFolder, isFolder ? key.split('/').pop() : '');
        }
        if (target.id === 'create-folder-btn') {
            openCreateFolderModal();
        }
        if (target.id === 'select-all-checkbox') {
            const isChecked = target.checked;
            document.querySelectorAll('#file-list-body .file-checkbox').forEach(cb => cb.checked = isChecked);
            const firstCheckbox = document.querySelector('#file-list-body .file-checkbox');
            if (firstCheckbox) {
                firstCheckbox.dispatchEvent(new Event('change', {
                    bubbles: true
                }));
            }
        }
        if (target.classList.contains('sortable-header')) {
            const sortKey = target.dataset.sort;
            if (state.sort.key === sortKey) {
                state.sort.order = state.sort.order === 'asc' ? 'desc' : 'asc';
            } else {
                state.sort.key = sortKey;
                state.sort.order = 'asc';
            }
            router();
        }
    });

    mainContent.addEventListener('change', (e) => {
        if (e.target.classList.contains('file-checkbox')) {
            const bulkActionsContainer = document.getElementById('bulk-actions-container');
            if (!bulkActionsContainer) return;
            const selected = Array.from(document.querySelectorAll('#file-list-body .file-checkbox:checked'));
            if (selected.length === 0) {
                bulkActionsContainer.style.display = 'none';
                document.getElementById('select-all-checkbox').checked = false;
                return;
            }
            bulkActionsContainer.style.display = 'flex';
            const keys = selected.map(cb => cb.dataset.key);
            const messageIds = selected.map(cb => cb.dataset.messageId);
            bulkActionsContainer.innerHTML = `
                <span>${selected.length} item(ns) selecionado(s)</span>
                <button id="bulk-receive-btn">Receber</button>
                <button id="bulk-move-btn">Mover</button>
                <button id="bulk-delete-btn" style="background-color: #ff5555;">Excluir</button>
            `;
            document.getElementById('bulk-move-btn').onclick = () => openMoveModal(keys);
            document.getElementById('bulk-delete-btn').onclick = () => deleteItems(keys);
            document.getElementById('bulk-receive-btn').onclick = async () => {
                if (!state.token) {
                    showNotification("Você precisa estar logado.", 'error');
                    return;
                }
                const btn = document.getElementById('bulk-receive-btn');
                try {
                    btn.textContent = 'Enviando...';
                    btn.disabled = true;
                    await apiCall('bulk-forward', 'POST', {
                        message_ids: messageIds.map(id => parseInt(id))
                    });
                    showNotification("O bot começou a enviar os arquivos! Verifique seu Telegram.", 'success');
                } catch (error) {
                    showNotification(`Ocorreu um erro: ${error.message}`, 'error');
                } finally {
                    btn.textContent = `Receber`;
                    btn.disabled = false;
                }
            };
        }
    });

    window.addEventListener('hashchange', router);
    router();
});