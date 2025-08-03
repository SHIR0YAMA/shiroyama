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

function getIconForFile(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];

    if (videoExts.includes(extension)) return '<i class="fas fa-file-video"></i>';
    if (imageExts.includes(extension)) return '<i class="fas fa-file-image"></i>';
    if (audioExts.includes(extension)) return '<i class="fas fa-file-audio"></i>';
    return '<i class="fas fa-file-alt"></i>';
}

// --- 2. ESTADO GLOBAL E FUNÇÕES RELACIONADAS ---
const state = {
    token: localStorage.getItem('jwtToken'),
    username: null,
    role: null,
    permissions: [],
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

function hasPermission(perm) {
    return state.permissions.includes(perm);
}

// --- 3. ELEMENTOS DO DOM ---
const mainContent = document.getElementById('main-content');
const mainNav = document.getElementById('main-nav');
const authModal = document.getElementById('authModal');
const whyLinkModal = document.getElementById('whyLinkModal');
const moveFileModal = document.getElementById('move-file-modal');
const createFolderModal = document.getElementById('create-folder-modal');
const renameModal = document.getElementById('rename-modal');
const roleModal = document.getElementById('role-modal');

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
        state.permissions = payload.permissions || [];
        localStorage.setItem('jwtToken', token);
    } catch (e) {
        console.error("Erro ao decodificar o token:", e);
        logout();
    }
}

function logout() {
    state.token = null;
    state.username = null;
    state.role = null;
    state.permissions = [];
    localStorage.clear();
    window.location.hash = '/';
    window.location.reload();
}

function parseJwt() {
    if (state.token) {
        try {
            const payload = JSON.parse(atob(state.token.split('.')[1]));
            state.username = payload.username;
            state.role = payload.role;
            state.permissions = payload.permissions || [];
        } catch (e) {
            console.error("Token inválido no localStorage, limpando sessão.");
            logout();
        }
    }
}

// --- 6. FUNÇÕES DE LÓGICA DE ARQUIVOS ---
function buildFileTree(files) {
    const tree = {};
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
            return;
        }
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
    if (!hasPermission('can_receive_files')) {
        showNotification("Você não tem permissão para esta ação.", "error");
        return;
    }
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
    currentPath: [],
    isFolder: false
};
let renameState = {
    oldKey: null,
    newKey: null,
    isFolder: false
};
let roleState = {
    id: null,
    allPermissions: []
};

function openMoveModal(keysToMove, isFolder = false) {
    moveState.oldKeys = Array.isArray(keysToMove) ? keysToMove : [keysToMove];
    moveState.isFolder = isFolder;
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
        const apiToCall = moveState.isFolder ? 'admin/rename' : 'admin/bulk-move';
        const payload = moveState.isFolder ? {
            oldKey: moveState.oldKeys[0],
            newKey: `${moveState.destinationPath}/${moveState.oldKeys[0].split('/').pop()}`,
            isFolder: true
        } : {
            oldKeys: moveState.oldKeys,
            destinationPath: moveState.destinationPath
        };
        await apiCall(apiToCall, 'POST', payload);
        showNotification("Item(ns) movido(s) com sucesso!", "success");
        closeMoveModal();
        refreshFiles();
    } catch (error) {
        showNotification(`Erro ao mover: ${error.message}`, "error");
    }
}

function openCreateFolderModal(fromMoveModal = false) {
    document.getElementById('new-folder-name').value = '';
    createFolderModal.dataset.fromMoveModal = fromMoveModal;
    createFolderModal.classList.add('show');
    document.getElementById('new-folder-name').focus();
}

function closeCreateFolderModal() {
    createFolderModal.classList.remove('show');
}

async function confirmCreateFolder() {
    const folderNameInput = document.getElementById('new-folder-name');
    const newFolderName = folderNameInput.value.trim();

    if (!newFolderName || newFolderName.includes('/') || newFolderName === '.placeholder') {
        showNotification("Nome de pasta inválido.", "error");
        return;
    }

    const wasOpenedFromMoveModal = createFolderModal.dataset.fromMoveModal === 'true';
    const basePath = wasOpenedFromMoveModal ? moveState.currentPath : (window.location.hash.slice(2) || '').split('/').filter(p => p);
    const fullPath = [...basePath, newFolderName].join('/');

    try {
        await apiCall('admin/create-folder', 'POST', {
            folderPath: fullPath
        });
        showNotification(`Pasta "${newFolderName}" criada!`, "success");
        closeCreateFolderModal();
        await refreshFiles();

        if (wasOpenedFromMoveModal) {
            openMoveModal(moveState.oldKeys, moveState.isFolder);
        }
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

async function openRoleModal(role = null) {
    const title = document.getElementById('role-modal-title');
    const nameInput = document.getElementById('role-name');
    const levelInput = document.getElementById('role-level');
    const permsContainer = document.getElementById('permissions-container');
    title.textContent = role ? `Editar Cargo: ${role.name}` : 'Criar Novo Cargo';
    nameInput.value = role ? role.name : '';
    levelInput.value = role ? role.level : '';
    roleState.id = role ? role.id : null;

    if (roleState.allPermissions.length === 0) {
        try {
            roleState.allPermissions = await apiCall('admin/permissions');
        } catch (e) {
            showNotification("Erro ao carregar permissões.", "error");
            return;
        }
    }
    let permsHTML = '';
    roleState.allPermissions.forEach(perm => {
        const isChecked = role ? role.permissions.includes(perm.name) : false;
        permsHTML += `<div><input type="checkbox" id="perm-${perm.id}" value="${perm.id}" ${isChecked ? 'checked' : ''}><label for="perm-${perm.id}"> ${perm.name}</label></div>`;
    });
    permsContainer.innerHTML = permsHTML;
    roleModal.classList.add('show');
}

function closeRoleModal() {
    roleModal.classList.remove('show');
}

async function confirmSaveRole() {
    const name = document.getElementById('role-name').value;
    const level = parseInt(document.getElementById('role-level').value);
    const selectedPerms = Array.from(document.querySelectorAll('#permissions-container input:checked')).map(el => parseInt(el.value));
    const endpoint = roleState.id ? `admin/roles/${roleState.id}` : 'admin/roles';
    const method = roleState.id ? 'PUT' : 'POST';
    try {
        await apiCall(endpoint, method, {
            name,
            level,
            permissions: selectedPerms
        });
        showNotification("Cargo salvo com sucesso!", "success");
        closeRoleModal();
        router('admin/roles');
    } catch (error) {
        showNotification(`Erro ao salvar cargo: ${error.message}`, "error");
    }
}

// --- 8. FUNÇÕES DE RENDERIZAÇÃO ---
function renderNav() {
    parseJwt();
    mainNav.innerHTML = `<span>Olá, <a href="/#/profile"><strong>${state.username || 'Visitante'}</strong></a>${state.role ? ` (${state.role})` : ''}</span>`;
    if (state.token) {
        if (hasPermission('can_manage_users') || hasPermission('can_manage_roles')) {
            mainNav.innerHTML += `<a href="/#/admin">Admin</a>`;
        }
        mainNav.innerHTML += `<a href="#" id="logout-btn">Sair</a>`;
        document.getElementById('logout-btn').onclick = (e) => {
            e.preventDefault();
            logout();
        };
    } else {
        mainNav.innerHTML += `<a href="/#/login">Login</a> <a href="/#/register">Registrar</a>`;
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
        mainContent.innerHTML = `<div class="auth-form"><h2>Meu Perfil</h2><p>Usuário do Site: <strong>${userData.username}</strong> | Cargo: <strong>${userData.role_name}</strong></p><hr style="border-color: #6272a4; margin: 20px 0;">${telegramSectionHTML}<hr style="border-color: #6272a4; margin: 20px 0;"><h3>Alterar Senha</h3><form id="password-form"><div class="form-group"><label for="current-password">Senha Atual</label><input type="password" id="current-password" required></div><div class="form-group"><label for="new-password">Nova Senha</label><input type="password" id="new-password" required minlength="6"></div><div class="form-group"><label for="confirm-password">Confirmar Nova Senha</label><input type="password" id="confirm-password" required minlength="6"></div><button type="submit">Salvar Nova Senha</button></form></div>`;
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

async function renderAdminPage(subpage = 'users') {
    mainContent.innerHTML = `<h2>Painel de Administrador</h2><div class="admin-tabs">${hasPermission('can_manage_users') ? `<button id="admin-tab-users" class="${subpage === 'users' ? 'active' : ''}">Gerenciar Usuários</button>` : ''}${hasPermission('can_manage_roles') ? `<button id="admin-tab-roles" class="${subpage === 'roles' ? 'active' : ''}">Gerenciar Cargos</button>` : ''}</div><div id="admin-content">Carregando...</div>`;
    if (hasPermission('can_manage_users')) {
        document.getElementById('admin-tab-users').onclick = () => router('admin/users');
    }
    if (hasPermission('can_manage_roles')) {
        document.getElementById('admin-tab-roles').onclick = () => router('admin/roles');
    }
    const adminContent = document.getElementById('admin-content');
    try {
        if (subpage === 'users' && hasPermission('can_manage_users')) {
            const [usersData, rolesData] = await Promise.all([apiCall('admin/users'), apiCall('admin/roles')]);
            const rolesOptions = rolesData.map(r => `<option value="${r.id}">${r.name} (Nível ${r.level})</option>`).join('');
            adminContent.innerHTML = `<div class="table-container"><table class="file-table"><thead><tr><th>Usuário</th><th>Cargo</th><th>ID do Chat</th><th>Criado em</th><th>Ações</th></tr></thead><tbody>${usersData.users.map(user => `<tr><td>${user.username}</td><td><select class="role-select" data-id="${user.id}">${rolesOptions.replace(`value="${user.role_id}"`, `value="${user.role_id}" selected`)}</select></td><td>${user.telegram_chat_id || 'N/A'}</td><td>${new Date(user.created_at).toLocaleDateString()}</td><td><button class="save-role-btn" data-id="${user.id}">Salvar</button><button class="delete-user-btn btn-danger" data-id="${user.id}">Excluir</button></td></tr>`).join('')}</tbody></table></div>`;
        } else if (subpage === 'roles' && hasPermission('can_manage_roles')) {
            const rolesData = await apiCall('admin/roles');
            adminContent.innerHTML = `<div style="text-align: right; margin-bottom: 10px;"><button id="create-new-role-btn">Criar Novo Cargo</button></div><div class="table-container"><table class="file-table"><thead><tr><th>Cargo</th><th>Nível</th><th>Permissões</th><th>Ações</th></tr></thead><tbody>${rolesData.map(role => `<tr><td>${role.name}</td><td>${role.level}</td><td>${role.permissions.join(', ') || 'Nenhuma'}</td><td><button class="edit-role-btn" data-role='${JSON.stringify(role)}'>Editar</button><button class="delete-role-btn btn-danger" data-id="${role.id}">Excluir</button></td></tr>`).join('')}</tbody></table></div>`;
        } else {
            // Se o usuário não tem permissão para a subpágina padrão, mas tem para outra.
            if(hasPermission('can_manage_users')) router('admin/users');
            else if(hasPermission('can_manage_roles')) router('admin/roles');
            else adminContent.innerHTML = `<p>Você não tem permissão para ver esta seção.</p>`;
        }
    } catch (error) {
        adminContent.innerHTML = `<p style="color: #ff5555;">Erro ao carregar dados: ${error.message}</p>`;
    }
}

function renderFilesPage(path) {
    let controlsHTML = `<div class="controls-buttons">`;
    if (hasPermission('can_create_folders')) {
        controlsHTML += `<button id="create-folder-btn" title="Criar Nova Pasta">📁+</button>`;
    }
    controlsHTML += `<button id="refresh-files-btn" class="btn-refresh" title="Atualizar Lista de Arquivos">🔄</button></div>`;
    mainContent.innerHTML = `<div class="controls"><div id="breadcrumb"></div>${controlsHTML}</div><div id="bulk-actions-container"></div><div class="file-list-header"><input type="checkbox" id="select-all-checkbox" class="file-checkbox"><span class="file-name sortable-header" data-sort="name">Nome<span class="sort-indicator"></span></span><span class="file-size sortable-header" data-sort="size">Tamanho<span class="sort-indicator"></span></span><span class="file-actions">Ações</span></div><div id="file-list-body" class="file-list"></div>`;
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
            return (itemA.file_size || 0) - (itemB.file_size || 0) * sortOrder;
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
        let actionsHTML = '<div class="file-actions">';
        if (item._isFile) {
            if (hasPermission('can_rename_items')) { actionsHTML += `<button class="btn-icon btn-rename" data-key="${item.name}" data-isfolder="false" title="Renomear"><i class="fas fa-edit"></i></button>`; }
            if (hasPermission('can_move_items')) { actionsHTML += `<button class="btn-icon btn-move-file" data-key="${item.name}" title="Mover"><i class="fas fa-folder-open"></i></button>`; }
            if (hasPermission('can_receive_files')) { actionsHTML += `<button class="btn-icon btn-single-forward" data-message-id="${item.message_id}" title="Receber"><i class="fas fa-paper-plane"></i></button>`; }
            if (hasPermission('can_delete_items')) { actionsHTML += `<button class="btn-icon danger btn-delete" data-key="${item.name}" data-isfolder="false" title="Excluir"><i class="fas fa-trash"></i></button>`; }
        } else {
            if (hasPermission('can_rename_items')) { actionsHTML += `<button class="btn-icon btn-rename" data-key="${itemPath}" data-isfolder="true" title="Renomear"><i class="fas fa-edit"></i></button>`; }
            if (hasPermission('can_move_items')) { actionsHTML += `<button class="btn-icon btn-move-folder" data-key="${itemPath}" data-isfolder="true" title="Mover Pasta"><i class="fas fa-folder-open"></i></button>`; }
            if (hasPermission('can_delete_items')) { actionsHTML += `<button class="btn-icon danger btn-delete" data-key="${itemPath}" data-isfolder="true" title="Excluir"><i class="fas fa-trash"></i></button>`; }
        }
        actionsHTML += '</div>';
        if (item._isFile) {
            div.innerHTML = `<input type="checkbox" class="file-checkbox" data-key="${item.name}" data-message-id="${item.message_id}"><span class="file-icon">${getIconForFile(name)}</span><span class="file-name">${name}</span><span class="file-size">${formatFileSize(item.file_size)}</span>${actionsHTML}`;
        } else {
            div.innerHTML = `<div class="file-checkbox" style="visibility: hidden;"></div><a href="#/${itemPath}" class="file-item-name" style="width: 100%; display: flex; align-items: center;"><span class="file-icon"><i class="fas fa-folder"></i></span><span>${name}</span></a>${actionsHTML}`;
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
async function router(forceRoute) {
    parseJwt();
    renderNav();
    const pathString = forceRoute || window.location.hash.slice(1) || '/';
    const path = pathString.split('/').filter(p => p && p !== '#').map(decodeURIComponent);
    const route = path[0] || 'home';
    if (route === 'admin' && !hasPermission('can_manage_users') && !hasPermission('can_manage_roles')) {
        showNotification("Acesso negado.", "error");
        window.location.hash = '/';
        return;
    }
    if (route === 'profile' && !state.token) {
        window.location.hash = '/login';
        return;
    }
    if (!state.allFiles.length && state.token && hasPermission('can_view_files')) {
        try {
            const data = await apiCall(`files?t=${new Date().getTime()}`);
            state.allFiles = data.files || [];
            state.fileTree = buildFileTree(state.allFiles);
        } catch (error) {
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
            renderAdminPage(path[1]);
            break;
        case 'profile':
            renderProfilePage();
            break;
        default:
            if (state.token) {
                if (hasPermission('can_view_files')) {
                    renderFilesPage(path);
                } else {
                    mainContent.innerHTML = "<h2>Acesso Negado</h2><p>Você não tem permissão para visualizar arquivos.</p>";
                }
            } else {
                renderLoginPage();
            }
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
    document.getElementById('role-modal-close-btn').onclick = closeRoleModal;
    document.getElementById('role-modal-cancel-btn').onclick = closeRoleModal;
    document.getElementById('role-modal-save-btn').onclick = confirmSaveRole;
    roleModal.onclick = (e) => {
        if (e.target === roleModal) closeRoleModal();
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
    document.getElementById('create-folder-in-move-modal-btn').onclick = () => {
        closeMoveModal();
        openCreateFolderModal(true);
    };

    mainContent.addEventListener('click', (e) => {
        const target = e.target.closest('button, .sortable-header');
        if (!target) return;

        if (target.classList.contains('btn-single-forward')) {
            handleSingleForward(target.dataset.messageId);
        }
        if (target.classList.contains('btn-move-file')) {
            openMoveModal(target.dataset.key, false);
        }
        if (target.classList.contains('btn-move-folder')) {
            openMoveModal(target.dataset.key, true);
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
            openCreateFolderModal(false);
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
        // --- Eventos da página de admin ---
        if (target.classList.contains('save-role-btn')) {
            const userId = target.dataset.id;
            const newRoleId = document.querySelector(`.role-select[data-id="${userId}"]`).value;
            apiCall('admin/update-role', 'POST', { userId: parseInt(userId), newRoleId: parseInt(newRoleId) })
                .then(() => showNotification("Cargo do usuário atualizado.", "success"))
                .catch(err => showNotification(`Erro: ${err.message}`, "error"));
        }
        if (target.classList.contains('delete-user-btn')) {
            const userId = target.dataset.id;
            if (confirm('Tem certeza que deseja excluir este usuário?')) {
                apiCall('admin/delete-user', 'POST', { userId: parseInt(userId) })
                    .then(() => { showNotification("Usuário excluído.", "success"); router('admin/users'); })
                    .catch(err => showNotification(`Erro: ${err.message}`, "error"));
            }
        }
        if (target.id === 'create-new-role-btn') {
            openRoleModal();
        }
        if (target.classList.contains('edit-role-btn')) {
            const roleData = JSON.parse(target.dataset.role);
            openRoleModal(roleData);
        }
        if (target.classList.contains('delete-role-btn')) {
            const roleId = target.dataset.id;
            if (confirm('Tem certeza que deseja excluir este cargo?')) {
                apiCall(`admin/roles/${roleId}`, 'DELETE')
                    .then(() => { showNotification("Cargo excluído.", "success"); router('admin/roles'); })
                    .catch(err => showNotification(`Erro: ${err.message}`, "error"));
            }
        }
    });

    mainContent.addEventListener('change', (e) => {
        if (e.target.id === 'select-all-checkbox' || e.target.classList.contains('file-checkbox')) {
            if (e.target.id === 'select-all-checkbox') {
                const isChecked = e.target.checked;
                document.querySelectorAll('#file-list-body .file-checkbox').forEach(cb => cb.checked = isChecked);
            }
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
            let buttonsHTML = `<span>${selected.length} item(ns) selecionado(s)</span>`;
            if (hasPermission('can_receive_files')) {
                buttonsHTML += `<button id="bulk-receive-btn" title="Receber"><i class="fas fa-paper-plane"></i></button>`;
            }
            if (hasPermission('can_move_items')) {
                buttonsHTML += `<button id="bulk-move-btn" title="Mover"><i class="fas fa-folder-open"></i></button>`;
            }
            if (hasPermission('can_delete_items')) {
                buttonsHTML += `<button id="bulk-delete-btn" class="btn-danger" title="Excluir"><i class="fas fa-trash"></i></button>`;
            }
            bulkActionsContainer.innerHTML = buttonsHTML;
            if (document.getElementById('bulk-move-btn')) document.getElementById('bulk-move-btn').onclick = () => openMoveModal(keys, false);
            if (document.getElementById('bulk-delete-btn')) document.getElementById('bulk-delete-btn').onclick = () => deleteItems(keys);
            if (document.getElementById('bulk-receive-btn')) {
                document.getElementById('bulk-receive-btn').onclick = async () => {
                    if (!state.token) {
                        showNotification("Você precisa estar logado.", 'error');
                        return;
                    }
                    const btn = document.getElementById('bulk-receive-btn');
                    try {
                        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
                        btn.disabled = true;
                        await apiCall('bulk-forward', 'POST', {
                            message_ids: messageIds.map(id => parseInt(id))
                        });
                        showNotification("O bot começou a enviar os arquivos! Verifique seu Telegram.", 'success');
                    } catch (error) {
                        showNotification(`Ocorreu um erro: ${error.message}`, 'error');
                    } finally {
                        btn.innerHTML = `<i class="fas fa-paper-plane"></i>`;
                        btn.disabled = false;
                    }
                };
            }
        }
    });

    window.addEventListener('hashchange', router);
    router();
});