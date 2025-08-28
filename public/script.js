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

function showLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.add('show');
}

function hideLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('show');
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
    level: Infinity,
    permissions: [],
    fileTree: {},
    allFiles: [],
    sort: {
        key: 'name',
        order: 'asc'
    }
};

async function refreshFiles() {
    showLoading();
    showNotification('Atualizando lista de arquivos...', 'info');
    state.allFiles = [];
    state.fileTree = {};
    await router();
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
const passwordResetModal = document.getElementById('password-reset-modal');

// --- 4. FUNÇÃO CENTRAL DE API ---
async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }

    let finalEndpoint = endpoint;
    if (method === 'GET') {
        finalEndpoint += (endpoint.includes('?') ? '&' : '?') + `_=${new Date().getTime()}`;
    }

    try {
        const response = await fetch(`/api/${finalEndpoint}`, { method, headers, body: body ? JSON.stringify(body) : null });
        if (response.status === 204) return null;
        const result = await response.json();
        if (!response.ok) {
            if (response.status === 401 && endpoint !== 'auth/login') logout();
            throw new Error(result.message || response.statusText);
        }
        return result;
    } catch (error) {
        console.error(`API Error on ${endpoint}:`, error);
        if (error.message.includes('Acesso neg')) throw new Error("Acesso negado. Você não tem permissão para esta ação.");
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
        state.level = payload.level;
        state.permissions = payload.permissions || [];
        localStorage.setItem('jwtToken', token);
    } catch (e) {
        console.error("Erro ao decodificar o token:", e);
        logout();
    }
}

function logout() {
    showLoading();
    state.token = null;
    state.username = null;
    state.role = null;
    state.level = Infinity;
    state.permissions = [];
    localStorage.clear();
    window.location.hash = '/';
    window.location.reload();
}

function parseJwt() {
    const token = localStorage.getItem('jwtToken');
    state.token = token;
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            state.username = payload.username;
            state.role = payload.role;
            state.level = payload.level;
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
                currentLevel[part] = { ...file, _isFile: true };
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
        if (!currentLevel || !currentLevel[folderName]) return {};
        currentLevel = currentLevel[folderName];
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
        await apiCall('single-forward', 'POST', { message_id: parseInt(messageId) });
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
let moveState = { oldKeys: [], destinationPath: null, currentPath: [], isFolder: false };
let renameState = { oldKey: null, newKey: null, isFolder: false };
let roleState = { id: null, allPermissions: [] };

function openMoveModal(keysToMove, isFolder = false) {
    moveState.oldKeys = Array.isArray(keysToMove) ? keysToMove : [keysToMove];
    moveState.isFolder = isFolder;
    const firstFileName = moveState.oldKeys[0].split('/').pop();
    const displayName = moveState.oldKeys.length > 1 ? `${moveState.oldKeys.length} itens` : firstFileName;
    document.getElementById('move-file-name').textContent = displayName;
    
    const createFolderBtn = document.getElementById('create-folder-in-move-modal-btn');
    const canCreateFolders = hasPermission('can_create_folders');
    const canMoveAny = hasPermission('can_move_items') || hasPermission('can_move_folders');

    if (canCreateFolders && canMoveAny) {
        createFolderBtn.style.display = 'block';
    } else {
        createFolderBtn.style.display = 'none';
    }

    moveState.currentPath = [];
    renderFolderNavigator(isFolder ? firstFileName : null);
    moveFileModal.classList.add('show');
}

function closeMoveModal() { moveFileModal.classList.remove('show'); }

function renderFolderNavigator(folderToExclude = null) {
    const navContainer = document.getElementById('folder-navigation');
    const pathDisplay = document.getElementById('move-file-path');
    const confirmBtn = document.getElementById('move-file-confirm-btn');
    const currentFolderContent = getContentForPath(moveState.currentPath);
    
    const subFolders = Object.entries(currentFolderContent)
        .filter(([name, item]) => !item._isFile && name !== folderToExclude)
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
    showLoading();
    try {
        if (!moveState.isFolder) {
            await apiCall('admin/bulk-move', 'POST', { oldKeys: moveState.oldKeys, destinationPath: moveState.destinationPath });
        } else {
            await apiCall('admin/rename', 'POST', { oldKey: moveState.oldKeys[0], newKey: `${moveState.destinationPath}/${moveState.oldKeys[0].split('/').pop()}`, isFolder: true, action: 'move' });
        }
        showNotification("Item(ns) movido(s) com sucesso!", "success");
        closeMoveModal();
        await refreshFiles();
    } catch (error) {
        showNotification(`Erro ao mover: ${error.message}`, "error");
    } finally {
        hideLoading();
    }
}

function openCreateFolderModal(fromMoveModal = false) {
    document.getElementById('new-folder-name').value = '';
    createFolderModal.dataset.fromMoveModal = fromMoveModal;
    createFolderModal.classList.add('show');
    document.getElementById('new-folder-name').focus();
}

function closeCreateFolderModal() { createFolderModal.classList.remove('show'); }

async function confirmCreateFolder() {
    const folderNameInput = document.getElementById('new-folder-name');
    const newFolderName = folderNameInput.value.trim();
    if (!newFolderName || newFolderName.includes('/') || newFolderName === '.placeholder') {
        showNotification("Nome de pasta inválido.", "error"); return;
    }

    showLoading();
    const wasOpenedFromMoveModal = createFolderModal.dataset.fromMoveModal === 'true';
    const currentPathString = decodeURIComponent(window.location.hash.slice(2) || '');
    const basePath = wasOpenedFromMoveModal ? moveState.currentPath : currentPathString.split('/').filter(p => p);
    const fullPath = [...basePath, newFolderName].join('/');

    try {
        await apiCall('admin/create-folder', 'POST', { folderPath: fullPath });
        showNotification(`Pasta "${newFolderName}" criada!`, "success");
        closeCreateFolderModal();
        await refreshFiles();
        if (wasOpenedFromMoveModal) {
            moveState.currentPath = [...basePath, newFolderName];
            renderFolderNavigator();
            moveFileModal.classList.add('show');
        }
    } catch (error) {
        showNotification(`Erro ao criar pasta: ${error.message}`, "error");
    } finally {
        hideLoading();
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

function closeRenameModal() { renameModal.classList.remove('show'); }

async function confirmRename() {
    const newName = document.getElementById('rename-new-name').value.trim();
    if (!newName || newName.includes('/')) {
        showNotification("Nome inválido.", "error"); return;
    }
    const pathParts = renameState.oldKey.split('/');
    pathParts.pop();
    const newKey = [...pathParts, newName].join('/');
    if (renameState.oldKey === newKey) {
        closeRenameModal(); return;
    }
    showLoading();
    try {
        await apiCall('admin/rename', 'POST', { oldKey: renameState.oldKey, newKey, isFolder: renameState.isFolder });
        showNotification("Renomeado com sucesso!", "success");
        closeRenameModal();
        await refreshFiles();
    } catch (error) {
        showNotification(`Erro ao renomear: ${error.message}`, "error");
    } finally {
        hideLoading();
    }
}

async function deleteItems(keys, isFolder = false, folderName = '') {
    const itemsToDelete = Array.isArray(keys) ? keys : [keys];
    const keyCount = itemsToDelete.length;
    let message = isFolder ? `Tem certeza que deseja excluir a pasta "${folderName}" e todo o seu conteúdo? Esta ação é irreversível.` : `Tem certeza que deseja excluir ${keyCount} item(ns)? Esta ação é irreversível.`;
    if (!confirm(message)) return;

    showLoading();
    try {
        const payload = isFolder ? { prefix: itemsToDelete[0] + '/' } : { keys: itemsToDelete };
        await apiCall('admin/bulk-delete', 'POST', payload);
        showNotification("Item(ns) excluído(s) com sucesso!", "success");
        await refreshFiles();
    } catch (error) {
        showNotification(`Erro ao excluir: ${error.message}`, "error");
    } finally {
        hideLoading();
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
            showNotification("Erro ao carregar permissões.", "error"); return;
        }
    }

    const groupedPermissions = roleState.allPermissions.reduce((acc, perm) => {
        const group = perm.name.split(':')[0].split('_')[0];
        const categoryMap = { 'users': 'users', 'roles': 'roles', 'items': 'arquivos', 'can': 'arquivos' };
        const category = categoryMap[group] || 'outros';
        if (!acc[category]) acc[category] = [];
        acc[category].push(perm);
        return acc;
    }, {});

    let permsHTML = '';
    const categoryNames = { users: "Gerenciar Usuários", roles: "Gerenciar Cargos", arquivos: "Arquivos e Pastas" };
    const orderedCategories = ['users', 'roles', 'arquivos'];

    orderedCategories.forEach(category => {
        if (groupedPermissions[category]) {
            let categoryPermissions = groupedPermissions[category];
            if (category === 'arquivos' && groupedPermissions['items']) {
                categoryPermissions = [...categoryPermissions, ...groupedPermissions['items']];
            }
            permsHTML += `<details class="permission-group" open><summary><input type="checkbox" class="group-checkbox" data-group="${category}"><strong>${categoryNames[category]}</strong></summary><div class="permission-list">`;
            categoryPermissions.forEach(perm => {
                const isChecked = role ? role.permissions.includes(perm.name) : false;
                const label = perm.description || perm.name;
                permsHTML += `<div class="permission-item"><input type="checkbox" id="perm-${perm.id}" class="perm-checkbox" data-group="${category}" value="${perm.id}" data-name="${perm.name}" ${isChecked ? 'checked' : ''}><label for="perm-${perm.id}">${label}</label></div>`;
            });
            permsHTML += `</div></details>`;
        }
    });
    
    permsContainer.innerHTML = permsHTML;
    
    const permissionDependencies = {
        'users:view_chat_id': 'users:view_list',
        'users:delete': 'users:view_list',
        'users:reset_password': 'users:view_list',
        'users:unlink_telegram': ['users:view_list', 'users:view_chat_id'],
        'roles:create': 'roles:view_list',
        'roles:edit': 'roles:view_list',
        'roles:delete': 'roles:view_list',
        'roles:assign': 'users:view_list',
    };

    permsContainer.addEventListener('change', e => {
        const checkbox = e.target;
        if (!checkbox.classList.contains('perm-checkbox')) return;
        const changedPermName = checkbox.dataset.name;
        const isChecked = checkbox.checked;

        if (isChecked && permissionDependencies[changedPermName]) {
            const masters = [].concat(permissionDependencies[changedPermName]);
            masters.forEach(masterPermName => {
                const masterCheckbox = permsContainer.querySelector(`input[data-name="${masterPermName}"]`);
                if (masterCheckbox) masterCheckbox.checked = true;
            });
        }
        
        if (!isChecked) {
            for (const [dependent, masters] of Object.entries(permissionDependencies)) {
                if ([].concat(masters).includes(changedPermName)) {
                    const dependentCheckbox = permsContainer.querySelector(`input[data-name="${dependent}"]`);
                    if (dependentCheckbox) dependentCheckbox.checked = false;
                }
            }
        }
    });

    permsContainer.querySelectorAll('.group-checkbox').forEach(groupCheckbox => {
        groupCheckbox.onclick = (e) => {
            const group = e.target.dataset.group;
            const isChecked = e.target.checked;
            const event = new Event('change', { bubbles: true });
            permsContainer.querySelectorAll(`.perm-checkbox[data-group="${group}"]`).forEach(cb => {
                if (cb.checked !== isChecked) {
                    cb.checked = isChecked;
                    cb.dispatchEvent(event);
                }
            });
        };
    });

    roleModal.classList.add('show');
}

function closeRoleModal() { roleModal.classList.remove('show'); }

async function confirmSaveRole() {
    const name = document.getElementById('role-name').value;
    const level = parseInt(document.getElementById('role-level').value);
    const selectedPerms = Array.from(document.querySelectorAll('#permissions-container .perm-checkbox:checked')).map(el => parseInt(el.value));
    const endpoint = roleState.id ? `admin/roles/${roleState.id}` : `admin/roles`;
    const method = roleState.id ? 'PUT' : 'POST';
    showLoading();
    try {
        await apiCall(endpoint, method, { name, level, permissions: selectedPerms });
        showNotification("Cargo salvo com sucesso!", "success");
        closeRoleModal();
        await router('admin/roles');
    } catch (error) {
        showNotification(`Erro ao salvar cargo: ${error.message}`, "error");
    } finally {
        hideLoading();
    }
}

// --- 8. FUNÇÕES DE RENDERIZAÇÃO DE PÁGINAS ("VIEWS") ---
function renderNav() {
    parseJwt();
    let greetingHTML = `<span>Olá, <a href="/#/profile"><strong>${state.username || 'Visitante'}</strong></a>`;
    if (state.role) {
        greetingHTML += `<span class="role-tag">${state.role}</span>`;
    }
    greetingHTML += `</span>`;
    let navLinksHTML = '';
    const canAccessAdmin = state.permissions.some(p => p.startsWith('users:') || p.startsWith('roles:'));
    if (state.token) {
        if (canAccessAdmin) {
            navLinksHTML += `<button id="admin-btn" class="nav-button">Admin</button>`;
        }
        navLinksHTML += `<button id="logout-btn" class="nav-button">Sair</button>`;
    } else {
        navLinksHTML += `<button id="login-btn" class="nav-button">Login</button>`;
        navLinksHTML += `<button id="register-btn" class="nav-button">Registrar</button>`;
    }
    mainNav.innerHTML = `${greetingHTML}<span class="nav-links">${navLinksHTML}</span>`;
    if (state.token) {
        const adminBtn = document.getElementById('admin-btn');
        if (adminBtn) adminBtn.onclick = () => window.location.hash = '/admin';
        document.getElementById('logout-btn').onclick = (e) => { e.preventDefault(); logout(); };
    } else {
        document.getElementById('login-btn').onclick = () => window.location.hash = '/login';
        document.getElementById('register-btn').onclick = () => window.location.hash = '/register';
    }
}

function renderLoginPage() {
    mainContent.innerHTML = `<form id="login-form" class="auth-form"><h2>Login</h2><div class="form-group"><label for="username">Nome de Usuário</label><input type="text" id="username" name="username" required></div><div class="form-group"><label for="password">Senha</label><input type="password" id="password" name="password" required></div><button type="submit">Entrar</button></form>`;
    document.getElementById('login-form').onsubmit = async (e) => {
        e.preventDefault();
        showLoading();
        try {
            const data = await apiCall('auth/login', 'POST', { username: e.target.username.value, password: e.target.password.value });
            login(data.token);
            window.location.hash = '/';
            await router(); 
        } catch (error) {
            hideLoading();
            showNotification(`Erro no login: ${error.message}`, 'error');
        }
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
        } catch (error) {
            showNotification(`Erro no registro: ${error.message}`, 'error');
        }
    };
}

async function renderProfilePage() {
    mainContent.innerHTML = '';
    showLoading();
    try {
        const userData = await apiCall('user/status', 'GET');
        let telegramSectionHTML = '<h3>Vincular Conta do Telegram</h3>';
        if (hasPermission('can_receive_files')) {
            if (userData.telegram_chat_id) {
                telegramSectionHTML += `<p>Usuário: <strong>@${userData.telegram_username || 'N/A'}</strong></p> <p>Chat ID: <strong>${userData.telegram_chat_id}</strong></p> <button id="unlink-btn">Desvincular Conta</button>`;
            } else {
                telegramSectionHTML += `<p>Clique no botão abaixo para autorizar o bot no Telegram.</p> <button id="link-telegram-btn">Vincular com o Telegram</button> <a href="#" id="why-link-q" style="display: block; margin-top: 15px; font-size: 14px;">Por que preciso fazer isso?</a>`;
            }
        } else {
            telegramSectionHTML += '<p>Você não tem permissão para vincular ou receber arquivos via Telegram.</p>';
        }

        mainContent.innerHTML = `<div class="auth-form"><h2>Meu Perfil</h2><p>Usuário do Site: <strong>${userData.username}</strong> | Cargo: <strong>${state.role || 'N/A'}</strong></p><hr style="border-color: #6272a4; margin: 20px 0;">${telegramSectionHTML}<hr style="border-color: #6272a4; margin: 20px 0;"><h3>Alterar Senha</h3><form id="password-form"><div class="form-group"><label for="current-password">Senha Atual</label><input type="password" id="current-password" required></div><div class="form-group"><label for="new-password">Nova Senha</label><input type="password" id="new-password" required minlength="6"></div><div class="form-group"><label for="confirm-password">Confirmar Nova Senha</label><input type="password" id="confirm-password" required minlength="6"></div><button type="submit">Salvar Nova Senha</button></form></div>`;
        
        if (hasPermission('can_receive_files')) {
            if (userData.telegram_chat_id) {
                document.getElementById('unlink-btn').onclick = async () => { if (confirm('Tem certeza?')) { await apiCall('user/unlink-telegram', 'POST'); showNotification('Conta desvinculada com sucesso.', 'success'); await router(); } };
            } else {
                document.getElementById('link-telegram-btn').onclick = (e) => {
                    const linkButton = e.target;
                    linkButton.disabled = true; linkButton.textContent = 'Gerando...';
                    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                    const linkCodeWithPrefix = `link_${randomCode}`;
                    apiCall('user/prepare-link-code', 'POST', { linkCode: linkCodeWithPrefix })
                        .then(async () => {
                            window.open(`https://t.me/ShiroyamaBot?start=${linkCodeWithPrefix}`, '_blank');
                            linkButton.textContent = 'Verifique o Telegram!';
                            showNotification('Conclua o vínculo no Telegram.', 'info');
                            startFaviconBlink();
                            setTimeout(async () => await router(), 15000);
                        }).catch(err => { showNotification(`Erro: ${err.message}`, 'error'); linkButton.disabled = false; linkButton.textContent = 'Vincular com o Telegram'; });
                };
                document.getElementById('why-link-q').onclick = (e) => { e.preventDefault(); whyLinkModal.classList.add('show'); };
            }
        }
        document.getElementById('password-form').onsubmit = async (e) => {
            e.preventDefault();
            const currentPassword = e.target['current-password'].value;
            const newPassword = e.target['new-password'].value;
            if (newPassword !== e.target['confirm-password'].value) { showNotification("As senhas não coincidem.", 'error'); return; }
            try {
                const data = await apiCall('auth/change-password', 'POST', { currentPassword, newPassword });
                showNotification(data.message, 'success');
                logout();
            } catch (error) { showNotification(`Erro: ${error.message}`, 'error'); }
        };
    } catch (error) {
        mainContent.innerHTML = `<div class="auth-form"><h2>Erro ao carregar perfil</h2><p style="color: #ff5555;">${error.message}</p></div>`;
    } finally {
        hideLoading();
    }
}

async function renderAdminPage(subpage) {
    const canViewUsers = hasPermission('users:view_list');
    const canViewRoles = hasPermission('roles:view_list');

    if (!subpage) {
        if (canViewUsers) subpage = 'users';
        else if (canViewRoles) subpage = 'roles';
    }
    
    if (!canViewUsers && !canViewRoles) {
        mainContent.innerHTML = "<p>Você não tem permissões suficientes para visualizar o painel de administração.</p>";
        hideLoading();
        return;
    }

    mainContent.innerHTML = `<h2>Painel de Administrador</h2><div class="admin-tabs">${canViewUsers ? `<button id="admin-tab-users" class="${subpage === 'users' ? 'active' : ''}">Gerenciar Usuários</button>` : ''}${canViewRoles ? `<button id="admin-tab-roles" class="${subpage === 'roles' ? 'active' : ''}">Gerenciar Cargos</button>` : ''}</div><div id="admin-content"></div>`;
    const adminContent = document.getElementById('admin-content');
    adminContent.innerHTML = '';
    showLoading();

    const usersTab = document.getElementById('admin-tab-users');
    const rolesTab = document.getElementById('admin-tab-roles');
    if (usersTab) usersTab.onclick = () => router('admin/users');
    if (rolesTab) rolesTab.onclick = () => router('admin/roles');

    try {
        if (subpage === 'users' && canViewUsers) {
            const usersData = await apiCall('admin/users');
            let rolesData = [];
            if (hasPermission('roles:assign')) {
                rolesData = await apiCall('admin/roles');
            }
            
            const rolesOptions = rolesData.map(r => `<option value="${r.id}">${r.name} (Nível ${r.level})</option>`).join('');
            
            // CORREÇÃO: Verifica se o usuário tem QUALQUER permissão de ação
            const hasUserActions = hasPermission('roles:assign') || hasPermission('users:reset_password') || hasPermission('users:delete');

            let tableHTML = `
                <div class="table-container">
                    <table class="admin-table">
                        <thead><tr>
                            <th>Usuário</th>
                            <th>Cargo</th>
                            <th>ID do Chat</th>
                            <th>Criado em</th>
                            ${hasUserActions ? '<th>Ações</th>' : ''}
                        </tr></thead>
                        <tbody>`;

            for (const user of usersData.users) {
                const isSelf = state.username === user.username;
                const isSuperiorOrEqual = state.level >= user.role_level;
                const canActOnUser = !isSelf && !isSuperiorOrEqual;
                const disabledAttribute = !canActOnUser ? 'disabled' : '';

                tableHTML += `
                    <tr>
                        <td>${user.username}</td>
                        <td>
                            ${hasPermission('roles:assign') ? `
                            <select class="role-select" data-id="${user.id}" ${disabledAttribute}>
                                ${rolesData.length > 0 ? rolesOptions.replace(`value="${user.role_id}"`, `value="${user.role_id}" selected`) : `<option>${user.role_name || 'N/A'}</option>`}
                            </select>` : 
                            `<span>${user.role_name || 'N/A'}</span>`}
                        </td>
                        <td class="chat-id-cell">
                            <div class="chat-id-cell-content">
                            ${hasPermission('users:view_chat_id') ? `
                                <span>${user.telegram_chat_id || 'N/A'}</span>
                                ${user.telegram_chat_id && hasPermission('users:unlink_telegram') ? `<button class="unlink-telegram-btn btn-icon" data-user-id="${user.id}" data-username="${user.username}" title="Desvincular Telegram" ${disabledAttribute}><i class="fas fa-unlink"></i></button>` : ''}
                            ` : '<span>-</span>'}
                            </div>
                        </td>
                        <td>${new Date(user.created_at).toLocaleDateString()}</td>
                        ${hasUserActions ? `
                        <td class="actions-cell">
                            ${hasPermission('roles:assign') ? `<button class="save-user-role-btn" data-id="${user.id}" ${disabledAttribute}>Salvar</button>` : ''}
                            ${hasPermission('users:reset_password') ? `<button class="reset-password-btn btn-icon" data-user-id="${user.id}" data-username="${user.username}" title="Resetar Senha" ${disabledAttribute}><i class="fas fa-key"></i></button>` : ''}
                            ${hasPermission('users:delete') ? `<button class="delete-user-btn btn-danger" data-id="${user.id}" data-username="${user.username}" ${disabledAttribute}>Excluir</button>` : ''}
                        </td>` : ''}
                    </tr>`;
            }

            tableHTML += `</tbody></table></div>`;
            adminContent.innerHTML = tableHTML;

        } else if (subpage === 'roles' && canViewRoles) {
            const [rolesData, permissionsData] = await Promise.all([apiCall('admin/roles'), apiCall('admin/permissions')]);
            const permMap = Object.fromEntries(permissionsData.map(p => [p.name, p.description]));
            
            adminContent.innerHTML = `
                <div style="text-align: right; margin-bottom: 10px;">
                    ${hasPermission('roles:create') ? '<button id="create-new-role-btn">Criar Novo Cargo</button>' : ''}
                </div>
                <div class="table-container">
                    <table class="admin-table">
                        <thead><tr><th>Cargo</th><th>Nível</th><th>Permissões</th><th>Ações</th></tr></thead>
                        <tbody>
                            ${rolesData.map(role => {
                                const canActOnRole = state.level < role.level && (role.level !== 1000 || state.level === 0);
                                const disabledAttribute = !canActOnRole ? 'disabled' : '';

                                return `
                                <tr>
                                    <td>${role.name}</td>
                                    <td>${role.level}</td>
                                    <td class="permissions-cell">${role.permissions.map(pName => (permMap[pName] || pName)).join(',<br>')}</td>
                                    <td class="actions-cell">
                                        ${hasPermission('roles:edit') ? `<button class="edit-role-btn" data-role='${JSON.stringify(role)}' ${disabledAttribute}>Editar</button>` : ''}
                                        ${hasPermission('roles:delete') ? `<button class="delete-role-btn btn-danger" data-id="${role.id}" ${disabledAttribute}>Excluir</button>` : ''}
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else {
            adminContent.innerHTML = `<p>Você não tem permissão para ver esta seção.</p>`;
        }
    } catch (error) {
        adminContent.innerHTML = `<p style="color: #ff5555;">Erro ao carregar dados: ${error.message}</p>`;
    } finally {
        hideLoading();
    }
}

function renderFilesPage(path) {
    let controlsHTML = `<div class="controls-buttons">`;
    if (hasPermission('can_create_folders')) controlsHTML += `<button id="create-folder-btn" title="Criar Nova Pasta">📁+</button>`;
    controlsHTML += `<button id="refresh-files-btn" class="btn-refresh" title="Atualizar Lista de Arquivos">🔄</button></div>`;
    mainContent.innerHTML = `<div class="controls"><div id="breadcrumb"></div>${controlsHTML}</div><div id="bulk-actions-container"></div><div class="file-list-header"><input type="checkbox" id="select-all-checkbox" class="file-checkbox"><span class="file-name sortable-header" data-sort="name">Nome<span class="sort-indicator"></span></span><span class="file-size sortable-header" data-sort="size">Tamanho<span class="sort-indicator"></span></span><span class="file-actions">Ações</span></div><div id="file-list-body" class="file-list"></div>`;
    
    document.getElementById('refresh-files-btn').onclick = refreshFiles;
    if (hasPermission('can_create_folders')) document.getElementById('create-folder-btn').onclick = () => openCreateFolderModal(false);
    
    const breadcrumbElement = document.getElementById('breadcrumb');
    breadcrumbElement.innerHTML = '';
    const homeLink = document.createElement('a');
    homeLink.href = '#/';
    homeLink.textContent = 'Home';
    breadcrumbElement.appendChild(homeLink);

    let cumulativePath = '';
    path.forEach((part, index) => {
        breadcrumbElement.innerHTML += ' &gt; ';
        cumulativePath += `/${encodeURIComponent(part)}`;
        if (index < path.length - 1) {
            const a = document.createElement('a');
            a.href = `#${cumulativePath}`;
            a.textContent = part;
            breadcrumbElement.appendChild(a);
        } else {
            const span = document.createElement('span');
            span.textContent = part;
            breadcrumbElement.appendChild(span);
        }
    });

    const fileListBodyElement = document.getElementById('file-list-body');
    const content = getContentForPath(path);
    const items = Object.entries(content).sort(([nameA, itemA], [nameB, itemB]) => {
        const isFileA = itemA._isFile;
        const isFileB = itemB._isFile;
        if (isFileA && !isFileB) return 1;
        if (!isFileA && isFileB) return -1;
        const sortOrder = state.sort.order === 'asc' ? 1 : -1;
        if (state.sort.key === 'name') return nameA.localeCompare(nameB, undefined, { numeric: true }) * sortOrder;
        if (state.sort.key === 'size') return (itemA.file_size || 0) - (itemB.file_size || 0) * sortOrder;
        return 0;
    });

    if (items.length === 0) {
        fileListBodyElement.innerHTML = '<div class="file-item empty-folder">Pasta vazia.</div>';
        document.getElementById('select-all-checkbox').style.visibility = 'hidden';
        return;
    }
    
    document.getElementById('select-all-checkbox').style.visibility = 'visible';

    items.forEach(([name, item]) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        const itemPath = [...path, name].join('/');
        let actionsHTML = '<div class="file-actions">';
        if (item._isFile) {
            if (hasPermission('can_rename_items')) actionsHTML += `<button class="btn-icon btn-rename" data-key="${item.name}" data-isfolder="false" title="Renomear Arquivo"><i class="fas fa-edit"></i></button>`;
            if (hasPermission('can_move_items')) actionsHTML += `<button class="btn-icon btn-move-file" data-key="${item.name}" title="Mover Arquivo"><i class="fas fa-folder-open"></i></button>`;
            if (hasPermission('can_receive_files')) actionsHTML += `<button class="btn-icon btn-single-forward" data-message-id="${item.message_id}" title="Receber"><i class="fas fa-paper-plane"></i></button>`;
            if (hasPermission('can_delete_items')) actionsHTML += `<button class="btn-icon danger btn-delete" data-key="${item.name}" data-isfolder="false" title="Excluir"><i class="fas fa-trash"></i></button>`;
        } else {
            if (hasPermission('can_rename_folders')) actionsHTML += `<button class="btn-icon btn-rename" data-key="${itemPath}" data-isfolder="true" title="Renomear Pasta"><i class="fas fa-edit"></i></button>`;
            if (hasPermission('can_move_folders')) actionsHTML += `<button class="btn-icon btn-move-folder" data-key="${itemPath}" data-isfolder="true" title="Mover Pasta"><i class="fas fa-folder-open"></i></button>`;
            if (hasPermission('can_delete_items')) actionsHTML += `<button class="btn-icon danger btn-delete" data-key="${itemPath}" data-isfolder="true" title="Excluir Pasta"><i class="fas fa-trash"></i></button>`;
        }
        actionsHTML += '</div>';
        if (item._isFile) {
            div.innerHTML = `<input type="checkbox" class="file-checkbox" data-key="${item.name}" data-message-id="${item.message_id}"><span class="file-icon">${getIconForFile(name)}</span><span class="file-name">${name}</span><span class="file-size">${formatFileSize(item.file_size)}</span>${actionsHTML}`;
        } else {
            div.innerHTML = `<input type="checkbox" class="file-checkbox" style="visibility: hidden;"><span class="file-icon"><i class="fas fa-folder"></i></span><a href="#/${encodeURI(itemPath)}" class="file-name">${name}</a><span class="file-size"></span>${actionsHTML}`;
        }
        fileListBodyElement.appendChild(div);
    });

    document.querySelectorAll('.sortable-header').forEach(header => {
        const indicator = header.querySelector('.sort-indicator');
        indicator.className = 'sort-indicator';
        if (header.dataset.sort === state.sort.key) indicator.classList.add(state.sort.order);
    });
}

// --- 9. ROTEADOR PRINCIPAL ---
async function router(routeOverride) {
    showLoading();
    await parseJwt();
    
    const pathString = (typeof routeOverride === 'string') ? routeOverride : (window.location.hash.slice(1) || '/');
    const path = pathString.split('/').filter(p => p && p !== '#').map(decodeURIComponent);
    const primaryRoute = path[0] || 'home';
    
    await renderNav();

    try {
        switch (primaryRoute) {
            case 'login': renderLoginPage(); break;
            case 'register': renderRegisterPage(); break;
            case 'profile':
                if (!state.token) window.location.hash = '/login'; else await renderProfilePage();
                break;
            case 'admin':
                const canAccessAdmin = state.permissions.some(p => p.startsWith('users:') || p.startsWith('roles:'));
                if (!canAccessAdmin) {
                    showNotification("Acesso negado.", "error"); window.location.hash = '/';
                } else await renderAdminPage(path[1]);
                break;
            default:
                if (!state.token) { renderLoginPage(); break; }
                if (!hasPermission('can_view_files')) { mainContent.innerHTML = "<h2>Acesso Negado</h2><p>Você não tem permissão para visualizar arquivos.</p>"; break; }
                if (state.allFiles.length === 0) {
                    const data = await apiCall(`files?t=${new Date().getTime()}`);
                    state.allFiles = data.files || [];
                    state.fileTree = buildFileTree(state.allFiles);
                }
                const currentPath = primaryRoute === 'home' ? [] : path;
                renderFilesPage(currentPath);
                break;
        }
    } catch (error) {
        if (error.message.includes('Token')) logout();
        else mainContent.innerHTML = `<h2>Erro</h2><p style="color: #ff5555;">${error.message}</p>`;
    } finally {
        setTimeout(hideLoading, 200);
    }
}

// --- 10. INICIALIZAÇÃO E LISTENERS DE EVENTOS ---
document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('focus', stopFaviconBlink);
    
    document.getElementById('modal-close-btn').onclick = () => authModal.classList.remove('show');
    document.getElementById('why-modal-close-btn').onclick = () => whyLinkModal.classList.remove('show');
    document.getElementById('move-modal-close-btn').onclick = closeMoveModal;
    document.getElementById('create-folder-close-btn').onclick = closeCreateFolderModal;
    document.getElementById('rename-close-btn').onclick = closeRenameModal;
    document.getElementById('role-modal-close-btn').onclick = closeRoleModal;
    document.getElementById('password-reset-close-btn').onclick = () => passwordResetModal.classList.remove('show');
    document.getElementById('modal-login-btn').onclick = () => window.location.hash = '/login';
    document.getElementById('modal-register-btn').onclick = () => window.location.hash = '/register';
    document.getElementById('move-file-cancel-btn').onclick = closeMoveModal;
    document.getElementById('move-file-confirm-btn').onclick = confirmMoveFile;
    document.getElementById('create-folder-cancel-btn').onclick = closeCreateFolderModal;
    document.getElementById('create-folder-confirm-btn').onclick = confirmCreateFolder;
    document.getElementById('rename-cancel-btn').onclick = closeRenameModal;
    document.getElementById('rename-confirm-btn').onclick = confirmRename;
    document.getElementById('role-modal-cancel-btn').onclick = closeRoleModal;
    document.getElementById('role-modal-save-btn').onclick = confirmSaveRole;

    [authModal, whyLinkModal, moveFileModal, createFolderModal, renameModal, roleModal, passwordResetModal].forEach(modal => {
        if (modal) modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };
    });

    document.getElementById('new-folder-name').addEventListener('keyup', (e) => { if (e.key === 'Enter') confirmCreateFolder(); });
    document.getElementById('rename-new-name').addEventListener('keyup', (e) => { if (e.key === 'Enter') confirmRename(); });
    
    document.getElementById('folder-navigation').addEventListener('click', e => {
        const li = e.target.closest('li');
        if (!li) return;
        const action = li.dataset.action;
        if (action === 'up') moveState.currentPath.pop();
        else if (action === 'down') moveState.currentPath.push(li.dataset.folder);
        const folderNameToExclude = moveState.isFolder ? moveState.oldKeys[0].split('/').pop() : null;
        renderFolderNavigator(folderNameToExclude);
    });
    document.getElementById('create-folder-in-move-modal-btn').onclick = () => { closeMoveModal(); openCreateFolderModal(true); };

    mainContent.addEventListener('click', async (e) => {
        const target = e.target.closest('button, .sortable-header');
        if (!target) return;

        if (target.classList.contains('btn-single-forward')) await handleSingleForward(target.dataset.messageId);
        if (target.classList.contains('btn-move-file')) openMoveModal(target.dataset.key, false);
        if (target.classList.contains('btn-move-folder')) openMoveModal(target.dataset.key, true);
        if (target.classList.contains('btn-rename')) openRenameModal(target.dataset.key, target.dataset.isfolder === 'true');
        if (target.classList.contains('btn-delete')) {
            const isFolder = target.dataset.isfolder === 'true';
            const key = target.dataset.key;
            await deleteItems(key, isFolder, isFolder ? key.split('/').pop() : '');
        }

        if (target.classList.contains('sortable-header')) {
            const sortKey = target.dataset.sort;
            if (state.sort.key === sortKey) state.sort.order = state.sort.order === 'asc' ? 'desc' : 'asc';
            else { state.sort.key = sortKey; state.sort.order = 'asc'; }
            await router();
        }

        if (target.classList.contains('save-user-role-btn')) {
            const userId = target.dataset.id;
            const newRoleId = document.querySelector(`.role-select[data-id="${userId}"]`).value;
            apiCall('admin/users/update-role', 'POST', { userId: parseInt(userId), newRoleId: parseInt(newRoleId) })
                .then(() => showNotification("Cargo do usuário atualizado.", "success"))
                .catch(err => showNotification(`Erro: ${err.message}`, "error"));
        }
        if (target.classList.contains('delete-user-btn')) {
            const userId = target.dataset.id;
            const username = target.dataset.username;
            if (confirm(`Tem certeza que deseja excluir o usuário "${username}"?`)) {
                showLoading();
                try {
                    await apiCall('admin/delete-user', 'POST', { userId: parseInt(userId) });
                    showNotification("Usuário excluído.", "success");
                    await router('admin/users');
                } catch (err) { showNotification(`Erro: ${err.message}`, "error"); } 
                finally { hideLoading(); }
            }
        }
        if (target.classList.contains('reset-password-btn')) {
            const userId = target.dataset.userId;
            const username = target.dataset.username;
            if (confirm(`Tem certeza que deseja resetar a senha do usuário "${username}"? Uma nova senha aleatória será gerada.`)) {
                showLoading();
                try {
                    const result = await apiCall('admin/reset-password', 'POST', { userId: parseInt(userId) });
                    document.getElementById('password-reset-username').textContent = username;
                    document.getElementById('new-password-display').textContent = result.newPassword;
                    passwordResetModal.classList.add('show');
                } catch (err) { showNotification(`Erro ao resetar senha: ${err.message}`, "error"); } 
                finally { hideLoading(); }
            }
        }
        if (target.classList.contains('unlink-telegram-btn')) {
            const userId = target.dataset.userId;
            const username = target.dataset.username;
            if (confirm(`Tem certeza que deseja desvincular a conta do Telegram do usuário "${username}"?`)) {
                showLoading();
                try {
                    await apiCall('admin/unlink-user-telegram', 'POST', { userId: parseInt(userId) });
                    showNotification("Conta do Telegram desvinculada.", "success");
                    await router('admin/users');
                } catch(err) { showNotification(`Erro: ${err.message}`, "error"); } 
                finally { hideLoading(); }
            }
        }
        if (target.id === 'create-new-role-btn') openRoleModal();
        if (target.classList.contains('edit-role-btn')) {
            const roleData = JSON.parse(target.dataset.role);
            openRoleModal(roleData);
        }
        if (target.classList.contains('delete-role-btn')) {
            const roleId = target.dataset.id;
            if (confirm('Tem certeza que deseja excluir este cargo?')) {
                apiCall(`admin/roles/${roleId}`, 'DELETE')
                    .then(async () => { showNotification("Cargo excluído.", "success"); await router('admin/roles'); })
                    .catch(err => showNotification(`Erro: ${err.message}`, "error"));
            }
        }
    });

    mainContent.addEventListener('change', (e) => {
        if (!e.target.classList.contains('file-checkbox')) return;
        if (e.target.id === 'select-all-checkbox') {
            document.querySelectorAll('#file-list-body .file-checkbox:not([style*="visibility: hidden"])').forEach(cb => cb.checked = e.target.checked);
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
        if (hasPermission('can_receive_files')) buttonsHTML += `<button id="bulk-receive-btn" title="Receber"><i class="fas fa-paper-plane"></i></button>`;
        if (hasPermission('can_move_items')) buttonsHTML += `<button id="bulk-move-btn" title="Mover"><i class="fas fa-folder-open"></i></button>`;
        if (hasPermission('can_delete_items')) buttonsHTML += `<button id="bulk-delete-btn" class="btn-danger" title="Excluir"><i class="fas fa-trash"></i></button>`;
        bulkActionsContainer.innerHTML = buttonsHTML;
        if (document.getElementById('bulk-move-btn')) document.getElementById('bulk-move-btn').onclick = () => openMoveModal(keys, false);
        if (document.getElementById('bulk-delete-btn')) document.getElementById('bulk-delete-btn').onclick = () => deleteItems(keys, false);
        if (document.getElementById('bulk-receive-btn')) {
            document.getElementById('bulk-receive-btn').onclick = async () => {
                if (!state.token) { showNotification("Você precisa estar logado.", 'error'); return; }
                const btn = document.getElementById('bulk-receive-btn');
                try {
                    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
                    btn.disabled = true;
                    await apiCall('bulk-forward', 'POST', { message_ids: messageIds.map(id => parseInt(id)) });
                    showNotification("O bot começou a enviar os arquivos! Verifique seu Telegram.", 'success');
                } catch (error) {
                    showNotification(`Ocorreu um erro: ${error.message}`, 'error');
                } finally {
                    btn.innerHTML = `<i class="fas fa-paper-plane"></i>`;
                    btn.disabled = false;
                }
            };
        }
    });

    window.addEventListener('hashchange', router);
    router();
});