// /public/script.js

// --- 1. FUNÇÕES AUXILIARES ---
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatModifiedDate(item) {
    const rawDate = item.updated_at || item.modified_at || item.created_at || item.last_modified || item.date;
    if (!rawDate) return '—';
    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
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

function getIconForFile(fileName, isGroup = false) {
    if (isGroup) return '<i class="fas fa-file-archive filetype-icon archive"></i>';
    const extension = fileName.split('.').pop().toLowerCase();
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];

    if (videoExts.includes(extension)) return '<i class="fas fa-film filetype-icon video"></i>';
    if (imageExts.includes(extension)) return '<i class="fas fa-image filetype-icon image"></i>';
    if (audioExts.includes(extension)) return '<i class="fas fa-wave-square filetype-icon audio"></i>';
    return '<i class="fas fa-file-alt filetype-icon document"></i>';
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
    allFolders: [],
    sort: { key: 'name', order: 'asc' },
    pendingHighlightKey: null,
    highlightTimeout: null,
    viewMode: 'list'
};

async function refreshFiles() {
    showLoading();
    showNotification('Atualizando lista de arquivos...', 'info');
    state.allFiles = [];
    state.allFolders = [];
    state.fileTree = {};
    await router();
}

function hasPermission(perm) {
    return state.permissions.includes(perm);
}

function isOwnerUser() {
    const roleName = (state.role || '').toLowerCase();
    return roleName === 'dono' || state.level === 1;
}

function navigateToSearchResult(item) {
    const targetPath = item._isFolder ? item.name : item.name.split('/').slice(0, -1).join('/');
    state.pendingHighlightKey = item._isFolder ? null : item.name;
    window.location.hash = targetPath ? `#/${encodeURI(targetPath)}` : '#/';
}

function focusPendingFileHighlight() {
    if (!state.pendingHighlightKey) return;

    const targetCheckbox = Array.from(document.querySelectorAll('#file-list-body .file-checkbox[data-key]'))
        .find(cb => cb.dataset.key === state.pendingHighlightKey);

    if (!targetCheckbox) return;

    const row = targetCheckbox.closest('.file-item');
    if (!row) return;

    row.classList.add('pulse-highlight');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const clearHighlight = () => {
        row.classList.remove('pulse-highlight');
        state.pendingHighlightKey = null;
        if (state.highlightTimeout) {
            clearTimeout(state.highlightTimeout);
            state.highlightTimeout = null;
        }
    };

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            const visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.6);
            if (visible) {
                clearHighlight();
                observer.disconnect();
            }
        }, { threshold: [0.6] });
        observer.observe(row);
    }

    state.highlightTimeout = setTimeout(clearHighlight, 15000);
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
const folderPermsModal = document.getElementById('folder-perms-modal');
const userRolesModal = document.getElementById('user-roles-modal');
const groupFilesModal = document.getElementById('group-files-modal');

// --- 4. FUNÇÃO CENTRAL DE API ---
async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
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
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            state.token = token;
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
function buildFileTree(files, folders) {
    const tree = {};
    folders.forEach(folderPath => {
        const parts = folderPath.split('/').filter(p => p);
        let currentLevel = tree;
        parts.forEach(part => {
            if (!currentLevel[part]) currentLevel[part] = {};
            currentLevel = currentLevel[part];
        });
    });
    files.forEach(file => {
        if (file.isPlaceholder) return;
        const parts = file.name.split('/').filter(p => p);
        let currentLevel = tree;
        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                currentLevel[part] = { ...file, _isFile: true };
            } else {
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

// --- 7. OPERAÇÕES DE ARQUIVO E CARGOS (Modais) ---
let moveState = { oldKeys: [], destinationPath: null, currentPath: [], isFolder: false };
let renameState = { oldKey: null, newKey: null, isFolder: false };
let roleState = { id: null, allPermissions: [] };
let folderPermsState = { folderPath: null };
let userRolesState = { userId: null };

function openMoveModal(keysToMove, isFolder = false) {
    moveState.oldKeys = Array.isArray(keysToMove) ? keysToMove : [keysToMove];
    moveState.isFolder = isFolder;
    const firstFileName = moveState.oldKeys[0].split('/').pop();
    const displayName = moveState.oldKeys.length > 1 ? `${moveState.oldKeys.length} itens` : firstFileName;
    document.getElementById('move-file-name').textContent = displayName;
    
    const createFolderBtn = document.getElementById('create-folder-in-move-modal-btn');
    if (hasPermission('can_create_folders') && (hasPermission('can_move_items') || hasPermission('can_move_folders'))) {
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
        .filter(([_, item]) => !item._isFile && item.name !== folderToExclude)
        .map(([name]) => name);

    let html = '<ul>';
    if (moveState.currentPath.length > 0) html += `<li data-action="up">⬅️ .. (Voltar)</li>`;
    subFolders.forEach(folder => { html += `<li data-action="down" data-folder="${folder}">📁 ${folder}</li>`; });
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
        const apiToCall = moveState.isFolder ? 'admin/rename' : 'admin/bulk-move';
        const payload = moveState.isFolder ? 
            { oldKey: moveState.oldKeys[0], newKey: `${moveState.destinationPath}/${moveState.oldKeys[0].split('/').pop()}`, isFolder: true, action: 'move' } :
            { oldKeys: moveState.oldKeys, destinationPath: moveState.destinationPath };
        await apiCall(apiToCall, 'POST', payload);
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
    let message = isFolder ? `Tem certeza que deseja excluir a pasta "${folderName}" e todo o seu conteúdo?` : `Tem certeza que deseja excluir ${itemsToDelete.length} item(ns)?`;
    if (!confirm(message + " Esta ação é irreversível.")) return;

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
    const permsContainer = document.getElementById('permissions-container');
    title.textContent = role ? `Editar Cargo: ${role.name}` : 'Criar Novo Cargo';
    document.getElementById('role-name').value = role ? role.name : '';
    document.getElementById('role-level').value = role ? role.level : '';
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

function closeFolderPermsModal() { folderPermsModal.classList.remove('show'); }
async function openFolderPermsModal(folderPath) {
    folderPermsState.folderPath = folderPath;
    document.getElementById('folder-perms-title').innerHTML = `Permissões para: <strong>${folderPath}</strong>`;
    const rolesContainer = document.getElementById('folder-perms-roles-container');
    rolesContainer.innerHTML = 'Carregando cargos...';
    folderPermsModal.classList.add('show');

    try {
        const [allRoles, folderPerms] = await Promise.all([
            apiCall('admin/roles'),
            apiCall(`admin/folder-permissions?path=${encodeURIComponent(folderPath)}`)
        ]);
        
        let rolesHTML = '';
        allRoles.forEach(role => {
            const isChecked = folderPerms.allowedRoleIds.includes(role.id);
            const isSuperiorOrEqual = state.level >= role.level;
            const isDisabled = isSuperiorOrEqual && isChecked && state.level !== 0;

            let title = '';
            if (isDisabled) {
                title = "Você não pode remover a permissão de um cargo superior ou igual ao seu.";
            }
            
            rolesHTML += `<div title="${title}"><input type="checkbox" id="role-perm-${role.id}" value="${role.id}" ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}><label for="role-perm-${role.id}"> ${role.name} (Nível ${role.level})</label></div>`;
        });
        rolesContainer.innerHTML = rolesHTML || 'Nenhum cargo encontrado.';
    } catch (error) {
        showNotification(`Erro ao carregar permissões: ${error.message}`, 'error');
        rolesContainer.innerHTML = 'Erro ao carregar cargos.';
    }
}
async function confirmSaveFolderPerms() {
    const selectedRoleIds = Array.from(document.querySelectorAll('#folder-perms-roles-container input:checked')).map(el => parseInt(el.value));
    showLoading();
    try {
        await apiCall('admin/folder-permissions', 'POST', {
            folderPath: folderPermsState.folderPath,
            roleIds: selectedRoleIds
        });
        showNotification('Permissões da pasta salvas com sucesso!', 'success');
        closeFolderPermsModal();
    } catch (error) {
        showNotification(`Erro ao salvar: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

function closeUserRolesModal() { userRolesModal.classList.remove('show'); }
async function openUserRolesModal(userId, username, userRoles) {
    userRolesState.userId = userId;
    document.getElementById('user-roles-username').textContent = username;
    const rolesContainer = document.getElementById('user-roles-container');
    rolesContainer.innerHTML = 'Carregando...';
    userRolesModal.classList.add('show');

    try {
        const allRoles = await apiCall('admin/roles');
        const userRoleIds = userRoles.map(r => r.role_id);

        let rolesHTML = '';
        allRoles.forEach(role => {
            const isChecked = userRoleIds.includes(role.id);
            const canAssignRole = state.level < role.level;
            const isDisabled = !canAssignRole;
            
            rolesHTML += `<div><input type="checkbox" id="user-role-${role.id}" value="${role.id}" ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}><label for="user-role-${role.id}"> ${role.name} (Nível ${role.level})</label></div>`;
        });
        rolesContainer.innerHTML = rolesHTML;
    } catch (e) {
        rolesContainer.innerHTML = 'Erro ao carregar cargos.';
        showNotification(e.message, 'error');
    }
}
async function confirmSaveUserRoles() {
    const selectedRoleIds = Array.from(document.querySelectorAll('#user-roles-container input:checked')).map(el => parseInt(el.value));
    if (selectedRoleIds.length === 0) {
        showNotification("Um usuário deve ter pelo menos um cargo.", "error");
        return;
    }
    showLoading();
    try {
        await apiCall('admin/users/update-roles', 'POST', {
            userId: userRolesState.userId,
            newRoleIds: selectedRoleIds
        });
        showNotification('Cargos do usuário atualizados!', 'success');
        closeUserRolesModal();
        await router('admin/users');
    } catch (e) {
        showNotification(e.message, 'error');
    } finally {
        hideLoading();
    }
}

function openGroupFilesModal() {
    document.getElementById('group-name').value = '';
    groupFilesModal.classList.add('show');
    document.getElementById('group-name').focus();
}

function closeGroupFilesModal() {
    groupFilesModal.classList.remove('show');
}

async function confirmGroupFiles() {
    const groupName = document.getElementById('group-name').value.trim();
    if (!groupName) {
        showNotification("O nome do agrupamento é obrigatório.", "error");
        return;
    }

    const selected = Array.from(document.querySelectorAll('#file-list-body .file-checkbox:checked'));
    const fileKeys = selected.map(cb => cb.dataset.key);
    const path = (window.location.hash.slice(2) || '').split('/').filter(p => p);
    const folderPath = path.join('/');

    showLoading();
    try {
        await apiCall('admin/create-group', 'POST', { groupName, folderPath, fileKeys });
        showNotification(`Arquivos agrupados como "${groupName}" com sucesso!`, 'success');
        closeGroupFilesModal();
        await refreshFiles();
    } catch (error) {
        showNotification(`Erro ao agrupar: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// --- 8. FUNÇÕES DE RENDERIZAÇÃO DE PÁGINAS ("VIEWS") ---
function renderNav() {
    parseJwt();
    let greetingHTML = `<span><i class="fas fa-user-circle"></i> Olá, <a href="/#/profile"><strong>${state.username || 'Visitante'}</strong></a>`;
    if (state.role) {
        greetingHTML += `<span class="role-tag">${state.role}</span>`;
    }
    greetingHTML += `</span>`;
    let navLinksHTML = '';
    const canAccessAdmin = state.permissions.some(p => p.startsWith('users:') || p.startsWith('roles:'));
    if (state.token) {
        if (canAccessAdmin) {
            navLinksHTML += `<button id="admin-btn" class="nav-button"><i class="fas fa-cogs"></i>Admin</button>`;
        }
        navLinksHTML += `<button id="logout-btn" class="nav-button"><i class="fas fa-sign-out-alt"></i>Sair</button>`;
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
    document.body.classList.add('login-active');
    mainContent.innerHTML = `<div class="login-screen"><form id="login-form" class="auth-form login-card"><div class="brand"><span class="brand-icon"><i class="fas fa-cloud"></i></span><h2>Shiroyama Archive</h2><p>Seu armazenamento em nuvem seguro e organizado.</p></div><div class="form-group"><label for="username">Email ou Nome de Usuário</label><input type="text" id="username" name="username" required autocomplete="username"></div><div class="form-group"><label for="password">Senha</label><input type="password" id="password" name="password" required autocomplete="current-password"></div><button type="submit" class="primary-btn">Entrar</button><a href="#" class="forgot-link">Esqueci minha senha</a></form></div>`;

    document.querySelector('.forgot-link').onclick = (e) => {
        e.preventDefault();
        showNotification('Recuperação de senha em breve. Fale com o administrador por enquanto.', 'info');
    };

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
    document.body.classList.remove('login-active');
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
    document.body.classList.remove('login-active');
    mainContent.innerHTML = '';
    showLoading();
    try {
        const userData = await apiCall('user/status', 'GET');
        let telegramSectionHTML = '<h3><i class="fas fa-paper-plane"></i> Vincular Conta do Telegram</h3>';
        if (hasPermission('can_receive_files')) {
            if (userData.telegram_chat_id) {
                telegramSectionHTML += `<p>Usuário: <strong>@${userData.telegram_username || 'N/A'}</strong></p> <p>Chat ID: <strong>${userData.telegram_chat_id}</strong></p> <button id="unlink-btn"><i class="fas fa-unlink"></i> Desvincular Conta</button>`;
            } else {
                telegramSectionHTML += `<p>Clique no botão abaixo para autorizar o bot no Telegram.</p> <button id="link-telegram-btn"><i class="fas fa-link"></i> Vincular com o Telegram</button> <a href="#" id="why-link-q" style="display: block; margin-top: 15px; font-size: 14px;">Por que preciso fazer isso?</a>`;
            }
        } else {
            telegramSectionHTML = '';
        }

        mainContent.innerHTML = `<div class="auth-form profile-card"><h2><i class="fas fa-user-circle"></i> Meu Perfil</h2><p>Usuário do Site: <strong>${userData.username}</strong> | Cargo: <strong>${state.role || 'N/A'}</strong></p>
            ${telegramSectionHTML ? `<hr style="border-color: #6272a4; margin: 20px 0;">${telegramSectionHTML}` : ''}
            <hr style="border-color: #3d3368; margin: 20px 0;"><h3><i class="fas fa-lock"></i> Alterar Senha</h3><form id="password-form"><div class="form-group"><label for="current-password">Senha Atual</label><input type="password" id="current-password" required></div><div class="form-group"><label for="new-password">Nova Senha</label><input type="password" id="new-password" required minlength="6"></div><div class="form-group"><label for="confirm-password">Confirmar Nova Senha</label><input type="password" id="confirm-password" required minlength="6"></div><button type="submit"><i class="fas fa-save"></i> Salvar Nova Senha</button></form></div>`;
        
        if (hasPermission('can_receive_files')) {
            if (userData.telegram_chat_id) {
                document.getElementById('unlink-btn').onclick = async () => { if (confirm('Tem certeza?')) { await apiCall('user/unlink-telegram', 'POST'); showNotification('Conta desvinculada com sucesso.', 'success'); await router(); } };
            } else {
                document.getElementById('link-telegram-btn').onclick = (e) => {
                    const linkButton = e.target;
                    linkButton.disabled = true; linkButton.innerHTML = '<i class=\"fas fa-spinner fa-spin\"></i> Gerando...';
                    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                    const linkCodeWithPrefix = `link_${randomCode}`;
                    apiCall('user/prepare-link-code', 'POST', { linkCode: linkCodeWithPrefix })
                        .then(async () => {
                            window.open(`https://t.me/ShiroyamaBot?start=${linkCodeWithPrefix}`, '_blank');
                            linkButton.innerHTML = '<i class=\"fas fa-paper-plane\"></i> Verifique o Telegram!';
                            showNotification('Conclua o vínculo no Telegram.', 'info');
                            startFaviconBlink();
                            setTimeout(async () => await router(), 15000);
                        }).catch(err => { showNotification(`Erro: ${err.message}`, 'error'); linkButton.disabled = false; linkButton.innerHTML = '<i class=\"fas fa-link\"></i> Vincular com o Telegram'; });
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
    document.body.classList.remove('login-active');
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

    mainContent.innerHTML = `<h2><i class="fas fa-sliders"></i> Painel de Administrador</h2><div class="admin-tabs">${canViewUsers ? `<button id="admin-tab-users" class="${subpage === 'users' ? 'active' : ''}"><i class="fas fa-users"></i> Gerenciar Usuários</button>` : ''}${canViewRoles ? `<button id="admin-tab-roles" class="${subpage === 'roles' ? 'active' : ''}"><i class="fas fa-user-shield"></i> Gerenciar Cargos</button>` : ''}</div><div id="admin-content"></div>`;
    const adminContent = document.getElementById('admin-content');
    adminContent.innerHTML = '';
    showLoading();

    const usersTab = document.getElementById('admin-tab-users');
    const rolesTab = document.getElementById('admin-tab-roles');
    if (usersTab) usersTab.onclick = () => router('admin/users');
    if (rolesTab) rolesTab.onclick = () => router('admin/roles');

    try {
        if (subpage === 'users' && canViewUsers) {
            const data = await apiCall('admin/users');
            const usersList = data.users;
            
            let tableHTML = `
                <div class="table-container">
                    <table class="admin-table">
                        <thead><tr>
                            <th class="col-user">Usuário</th>
                            <th class="col-role">Cargos</th>
                            <th class="col-chat-id">ID do Chat</th>
                            <th class="col-created">Criado em</th>
                            <th class="col-actions">Ações</th>
                        </tr></thead>
                        <tbody>`;

            for (const user of usersList) {
                const isSelf = state.username === user.username;
                const isSuperiorOrEqual = state.level >= user.role_level;
                const canActOnUser = !isSelf && !isSuperiorOrEqual;
                const disabledAttribute = !canActOnUser ? 'disabled' : '';
                const rolesAsTags = user.roles.map(r => `<span class="role-tag">${r.role_name}</span>`).join(' ');

                tableHTML += `
                    <tr data-user-id="${user.id}">
                        <td data-label="Usuário">${user.username}</td>
                        <td data-label="Cargos" class="roles-cell">
                            <div class="roles-wrap"><div>${rolesAsTags || 'Nenhum'}</div><button class="edit-user-roles-btn btn-icon" data-user-id="${user.id}" data-username="${user.username}" data-user-roles='${JSON.stringify(user.roles)}' ${disabledAttribute}><i class="fas fa-user-edit"></i></button></div>
                        </td>
                        <td data-label="ID do Chat" class="chat-id-cell">
                            <div class="chat-id-cell-content">
                                <span>${user.telegram_chat_id || 'N/A'}</span>
                                <button class="unlink-telegram-btn btn-icon" data-user-id="${user.id}" data-username="${user.username}" title="Desvincular Telegram" ${disabledAttribute}><i class="fas fa-unlink"></i></button>
                            </div>
                        </td>
                        <td data-label="Criado em">${new Date(user.created_at).toLocaleDateString()}</td>
                        <td data-label="Ações" class="actions-cell">
                            <div class="actions-wrap"><button class="reset-password-btn btn-icon" data-user-id="${user.id}" data-username="${user.username}" title="Resetar Senha" ${disabledAttribute}><i class="fas fa-key"></i></button><button class="delete-user-btn btn-danger" data-id="${user.id}" data-username="${user.username}" ${disabledAttribute}><i class="fas fa-trash-can"></i> Excluir</button></div>
                        </td>
                    </tr>`;
            }

            tableHTML += `</tbody></table></div>`;
            adminContent.innerHTML = tableHTML;
            
            adminContent.querySelectorAll('tr[data-user-id]').forEach((row, index) => {
                const user = usersList[index];
                if (!hasPermission('roles:assign')) {
                    const editBtn = row.querySelector('.edit-user-roles-btn');
                    if (editBtn) editBtn.style.display = 'none';
                }
                if (!hasPermission('users:view_chat_id')) {
                    row.querySelector('.col-chat-id').innerHTML = '<span>-</span>';
                } else {
                    const unlinkBtn = row.querySelector('.unlink-telegram-btn');
                    if (unlinkBtn && (!user.telegram_chat_id || !hasPermission('users:unlink_telegram'))) {
                        unlinkBtn.style.display = 'none';
                    }
                }
                if (!hasPermission('users:reset_password')) {
                    const resetBtn = row.querySelector('.reset-password-btn');
                    if (resetBtn) resetBtn.style.display = 'none';
                }
                if (!hasPermission('users:delete')) {
                    const deleteBtn = row.querySelector('.delete-user-btn');
                    if (deleteBtn) deleteBtn.style.display = 'none';
                }
            });

        } else if (subpage === 'roles' && canViewRoles) {
            const [rolesData, permissionsData] = await Promise.all([apiCall('admin/roles'), apiCall('admin/permissions')]);
            const permMap = Object.fromEntries(permissionsData.map(p => [p.name, p.description]));
            const hasRoleActions = hasPermission('roles:edit') || hasPermission('roles:delete');

            adminContent.innerHTML = `
                <div style="text-align: right; margin-bottom: 10px;">
                    ${hasPermission('roles:create') ? '<button id="create-new-role-btn"><i class="fas fa-plus"></i> Criar Novo Cargo</button>' : ''}
                </div>
                <div class="table-container">
                    <table class="admin-table">
                        <thead><tr>
                            <th>Cargo</th>
                            <th>Nível</th>
                            <th>Permissões</th>
                            ${hasRoleActions ? '<th>Ações</th>' : ''}
                        </tr></thead>
                        <tbody>
                            ${rolesData.map(role => {
                                const canActOnRole = state.level < role.level && (role.level !== 1000 || state.level === 0);
                                const disabledAttribute = !canActOnRole ? 'disabled' : '';
                                return `
                                <tr>
                                    <td data-label="Cargo">${role.name}</td>
                                    <td data-label="Nível">${role.level}</td>
                                    <td data-label="Permissões" class="permissions-cell">${role.permissions.map(pName => (permMap[pName] || pName)).join(',<br>')}</td>
                                    ${hasRoleActions ? `
                                    <td data-label="Ações" class="actions-cell">
                                        <div class="actions-wrap">${hasPermission('roles:edit') ? `<button class="edit-role-btn" data-role='${JSON.stringify(role)}' ${disabledAttribute}><i class="fas fa-pen"></i> Editar</button>` : ''}${hasPermission('roles:delete') ? `<button class="delete-role-btn btn-danger" data-id="${role.id}" ${disabledAttribute}><i class="fas fa-trash-can"></i> Excluir</button>` : ''}</div>
                                    </td>` : ''}
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

function renderSearchResults(searchTerm) {
    const fileListBodyElement = document.getElementById('file-list-body');
    const lowerCaseSearchTerm = searchTerm.toLowerCase();

    const allItems = [
        ...state.allFolders.map(p => ({ name: p, _isFolder: true })),
        ...state.allFiles.filter(f => !f.isPlaceholder)
    ];

    const uniqueNames = new Set();
    const filteredItems = allItems.filter(item => {
        const itemName = item.name.toLowerCase();
        if (itemName.includes(lowerCaseSearchTerm) && !uniqueNames.has(item.name)) {
            uniqueNames.add(item.name);
            return true;
        }
        return false;
    });

    document.querySelector('.file-list-header').style.display = state.viewMode === 'grid' ? 'none' : 'flex';
    document.getElementById('breadcrumb').innerHTML = `<strong>Resultados da busca por "${searchTerm}"</strong>`;

    if (filteredItems.length === 0) {
        fileListBodyElement.className = 'file-list list-mode';
        fileListBodyElement.innerHTML = '<div class="file-item empty-folder">Nenhum resultado encontrado.</div>';
        return;
    }

    fileListBodyElement.className = `file-list ${state.viewMode === 'grid' ? 'grid-mode' : 'list-mode'}`;
    fileListBodyElement.innerHTML = '';

    filteredItems.forEach(item => {
        const targetPath = item._isFolder ? item.name : item.name.split('/').slice(0, -1).join('/');
        const href = targetPath ? `#/${encodeURI(targetPath)}` : '#/';

        if (state.viewMode === 'grid') {
            const card = document.createElement('div');
            card.className = 'file-card clickable-card';
            card.dataset.href = href;
            card.dataset.targetName = item.name;
            card.dataset.isFolder = item._isFolder ? 'true' : 'false';

            const iconHtml = item._isFolder ? '<i class="fas fa-folder"></i>' : getIconForFile(item.name);
            const meta = item._isFolder ? `Pasta • —` : `${formatFileSize(item.file_size)} • ${formatModifiedDate(item)}`;
            card.innerHTML = `<div class="file-card-icon ${item._isFolder ? 'folder-icon' : ''}">${iconHtml}</div><div class="file-card-content"><div class="file-name"><span class="file-name-text">${item.name}</span><span class="file-name-tooltip">${item.name}</span></div><div class="file-card-meta">${meta}</div></div>`;
            fileListBodyElement.appendChild(card);
        } else {
            const div = document.createElement('div');
            div.className = 'file-item';
            if (item._isFolder) {
                div.innerHTML = `<div style="flex-basis: 18px;"></div><span class="file-icon folder-icon"><i class="fas fa-folder"></i></span><a href="${href}" class="file-name search-result-file-link" data-target-name="${item.name}" data-is-folder="true">${item.name}</a><span class="file-size">—</span><span class="file-date">—</span><div class="file-actions"></div>`;
            } else {
                div.innerHTML = `<div style="flex-basis: 18px;"></div><span class="file-icon">${getIconForFile(item.name)}</span><a href="${href}" class="file-name search-result-file-link" data-target-name="${item.name}" data-is-folder="false">${item.name}</a><span class="file-size">${formatFileSize(item.file_size)}</span><span class="file-date">${formatModifiedDate(item)}</span><div class="file-actions"></div>`;
            }
            fileListBodyElement.appendChild(div);
        }
    });

    document.querySelectorAll('.search-result-file-link').forEach(link => {
        link.onclick = (event) => {
            event.preventDefault();
            const targetName = link.dataset.targetName;
            const isFolder = link.dataset.isFolder === 'true';
            navigateToSearchResult({ name: targetName, _isFolder: isFolder });
        };
    });
}



function renderFilesPage(path) {
    document.body.classList.remove('login-active');
    const currentPathStr = path.join('/');
    const content = getContentForPath(path);
    const folderExistsSystemWide = state.allFolders.includes(currentPathStr);
    const userCanSeeFolderContent = Object.keys(content).length > 0;

    if (path.length > 0 && !folderExistsSystemWide) {
        mainContent.innerHTML = `<div class="auth-form"><h2>Pasta Inexistente</h2><p>A pasta "${currentPathStr}" não foi encontrada no sistema.</p></div>`;
        hideLoading();
        return;
    }
    
    if (path.length > 0 && folderExistsSystemWide && !userCanSeeFolderContent && !isOwnerUser()) {
        mainContent.innerHTML = `<div class="auth-form"><h2>Acesso Negado</h2><p>Você não tem permissão para visualizar o conteúdo da pasta "${currentPathStr}".</p></div>`;
        hideLoading();
        return;
    }
    
    const contentEntries = Object.entries(content);
    const folderCount = contentEntries.filter(([_, item]) => !item._isFile).length;
    const fileCount = contentEntries.filter(([_, item]) => item._isFile).length;

    let controlsHTML = `<div class="storage-panel"><div class="storage-topline section-card"><div></div><div class="storage-stat-group"><span class="storage-stat"><i class="far fa-folder"></i> ${folderCount} pastas</span><span class="storage-stat"><i class="far fa-file"></i> ${fileCount} arquivos</span></div></div><div id="breadcrumb" class="directory-bar section-card"></div><div class="storage-search-row section-card"><div class="search-container">`;
    controlsHTML += `<input type="text" id="search-input" placeholder="Buscar pastas...">
                        <div class="search-buttons">
                            <button id="search-btn" title="Buscar"><i class="fas fa-search"></i></button>
                            <button id="search-clear-btn" title="Limpar" style="display:none;">×</button>
                        </div>
                     </div><div class="view-toggle" aria-label="Modo de visualização"><button class="view-toggle-btn ${state.viewMode === 'grid' ? 'active' : ''}" data-view="grid" title="Grade"><i class="fas fa-grip"></i></button><button class="view-toggle-btn ${state.viewMode === 'list' ? 'active' : ''}" data-view="list" title="Lista"><i class="fas fa-list"></i></button></div><div class="controls-buttons">`;
    if (hasPermission('can_create_folders')) controlsHTML += `<button id="create-folder-btn" title="Criar Nova Pasta"><i class="fas fa-folder-plus"></i></button>`;
    controlsHTML += `<button id="refresh-files-btn" class="btn-refresh" title="Atualizar Lista de Arquivos"><i class="fas fa-sync-alt"></i></button></div></div></div>`;
    mainContent.innerHTML = `${controlsHTML}<div id="bulk-actions-container"></div><div class="files-section section-card"><div class="file-list-header"><input type="checkbox" id="select-all-checkbox" class="file-checkbox"><span class="file-name sortable-header" data-sort="name">Nome<span class="sort-indicator"></span></span><span class="file-size sortable-header" data-sort="size">Tamanho<span class="sort-indicator"></span></span><span class="file-date">Modificado</span><span class="file-actions">Ações</span></div><div id="file-list-body" class="file-list"></div></div>`;
    
    document.getElementById('refresh-files-btn').onclick = refreshFiles;
    if (hasPermission('can_create_folders')) document.getElementById('create-folder-btn').onclick = () => openCreateFolderModal(false);
    
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const searchClearBtn = document.getElementById('search-clear-btn');

    const performSearch = () => {
        const searchTerm = searchInput.value.trim();
        searchClearBtn.style.display = searchTerm ? 'block' : 'none';
        if (searchTerm.length > 1) {
            renderSearchResults(searchTerm);
        } else if (searchTerm.length === 0) {
            document.getElementById('breadcrumb').style.display = 'block';
            document.querySelector('.file-list-header').style.display = 'flex';
            router();
        }
    };

    searchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
        searchClearBtn.style.display = searchInput.value ? 'block' : 'none';
    });
    searchBtn.addEventListener('click', performSearch);
    searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        performSearch();
    });

    document.querySelectorAll('.view-toggle-btn').forEach((btn) => {
        btn.onclick = () => {
            const mode = btn.dataset.view;
            if (mode && mode !== state.viewMode) {
                state.viewMode = mode;
                renderFilesPage(path);
            }
        };
    });

    const breadcrumbElement = document.getElementById('breadcrumb');
    breadcrumbElement.innerHTML = '';

    const homeLink = document.createElement('a');
    homeLink.href = '#/';
    homeLink.className = 'directory-link';
    homeLink.innerHTML = '<i class="fas fa-house"></i><span>Home</span>';
    breadcrumbElement.appendChild(homeLink);

    let cumulativePath = '';
    path.forEach((part, index) => {
        const separator = document.createElement('span');
        separator.className = 'directory-sep';
        separator.innerHTML = '<i class="fas fa-chevron-right"></i>';
        breadcrumbElement.appendChild(separator);

        cumulativePath += `/${encodeURIComponent(part)}`;
        if (index < path.length - 1) {
            const a = document.createElement('a');
            a.href = `#${cumulativePath}`;
            a.className = 'directory-link';
            a.textContent = part;
            breadcrumbElement.appendChild(a);
        } else {
            const span = document.createElement('span');
            span.className = 'directory-current';
            span.textContent = part;
            breadcrumbElement.appendChild(span);
        }
    });

    const fileListBodyElement = document.getElementById('file-list-body');
    const items = Object.entries(content).sort(([nameA, itemA], [nameB, itemB]) => {
        const isFileA = itemA._isFile;
        const isFileB = itemB._isFile;
        if (isFileA && !isFileB) return 1;
        if (!isFileA && isFileB) return -1;
        const sortOrder = state.sort.order === 'asc' ? 1 : -1;
        if (state.sort.key === 'name') return nameA.localeCompare(nameB, undefined, { numeric: true }) * sortOrder;
        if (state.sort.key === 'size') {
            const sizeA = itemA.file_size || 0;
            const sizeB = itemB.file_size || 0;
            return (sizeA - sizeB) * sortOrder;
        }
        return 0;
    });

    if (items.length === 0) {
        fileListBodyElement.innerHTML = '<div class="file-item empty-folder">Pasta vazia.</div>';
        document.getElementById('select-all-checkbox').style.visibility = 'hidden';
    } else {
        document.getElementById('select-all-checkbox').style.visibility = 'visible';
    }
    
    fileListBodyElement.className = `file-list ${state.viewMode === 'grid' ? 'grid-mode' : 'list-mode'}`;
    fileListBodyElement.innerHTML = '';
    if (items.length === 0) fileListBodyElement.innerHTML = '<div class="file-item empty-folder">Pasta vazia.</div>';
    
    items.forEach(([name, item]) => {
        const div = document.createElement('div');
        div.className = state.viewMode === 'grid' ? 'file-card' : 'file-item';
        const itemPath = [...path, name].join('/');

        let actionButtons = '';
        if (item._isFile && !item.isGroup) {
            if (hasPermission('can_rename_items')) actionButtons += `<button class="btn-icon btn-rename" data-key="${item.name}" data-isfolder="false" title="Renomear Arquivo"><i class="fas fa-pen"></i></button>`;
            if (hasPermission('can_move_items')) actionButtons += `<button class="btn-icon btn-move-file" data-key="${item.name}" title="Mover Arquivo"><i class="fas fa-up-down-left-right"></i></button>`;
            if (hasPermission('can_receive_files')) actionButtons += `<button class="btn-icon btn-single-forward" data-message-id="${item.message_id}" title="Receber"><i class="fas fa-paper-plane"></i></button>`;
            if (hasPermission('can_delete_items')) actionButtons += `<button class="btn-icon danger btn-delete" data-key="${item.name}" data-isfolder="false" title="Excluir"><i class="fas fa-trash-can"></i></button>`;
        } else if (item.isGroup) {
            if (hasPermission('can_group_items')) actionButtons += `<button class="btn-icon btn-ungroup" data-group-id="${item.groupId}" title="Desagrupar"><i class="fas fa-unlink"></i></button>`;
            if (hasPermission('can_receive_files')) actionButtons += `<button class="btn-icon btn-bulk-forward" data-message-ids="${item.message_ids.join(',')}" title="Receber Todas as Partes"><i class="fas fa-paper-plane"></i></button>`;
            if (hasPermission('can_delete_items')) actionButtons += `<button class="btn-icon danger btn-delete-group" data-group-id="${item.groupId}" data-group-items='${JSON.stringify(item.groupItems)}' title="Excluir Grupo"><i class="fas fa-trash-can"></i></button>`;
        } else {
            if (hasPermission('can_manage_folder_permissions')) actionButtons += `<button class="btn-icon btn-folder-perms" data-path="${itemPath}" title="Permissões da Pasta"><i class="fas fa-user-shield"></i></button>`;
            if (hasPermission('can_rename_folders')) actionButtons += `<button class="btn-icon btn-rename" data-key="${itemPath}" data-isfolder="true" title="Renomear Pasta"><i class="fas fa-pen"></i></button>`;
            if (hasPermission('can_move_folders')) actionButtons += `<button class="btn-icon btn-move-folder" data-key="${itemPath}" data-isfolder="true" title="Mover Pasta"><i class="fas fa-up-down-left-right"></i></button>`;
            if (hasPermission('can_delete_items')) actionButtons += `<button class="btn-icon danger btn-delete" data-key="${itemPath}" data-isfolder="true" title="Excluir Pasta"><i class="fas fa-trash-can"></i></button>`;
        }

        const actionsHTML = `<div class="file-actions">${actionButtons}</div>`;
        const cardActionsHTML = `<div class="file-card-actions"><button class="btn-icon btn-card-actions" title="Ações"><i class="fas fa-ellipsis"></i></button><div class="file-card-menu">${actionButtons}</div></div>`;

        const isGroup = !!item.isGroup;
        const displayName = isGroup ? item.name.split('/').pop() : name;

        if (state.viewMode === 'grid') {
            if (item._isFile) {
                div.dataset.href = `#/${encodeURI(path.join('/'))}`;
                div.dataset.targetName = item.name;
                div.dataset.isFolder = 'false';
                div.classList.add('clickable-card');
                div.innerHTML = `<input type="checkbox" class="file-checkbox card-checkbox" data-key="${item.name}" data-message-id="${item.message_id}" data-is-group="${isGroup}" data-group-id="${item.groupId || ''}"><div class="file-card-icon">${getIconForFile(name, isGroup)}</div><div class="file-card-content"><div class="file-name"><span class="file-name-text">${displayName}</span><span class="file-name-tooltip">${displayName}</span></div><div class="file-card-meta">${formatFileSize(item.file_size)} • ${formatModifiedDate(item)}</div></div>${cardActionsHTML}`;
            } else {
                div.dataset.href = `#/${encodeURI(itemPath)}`;
                div.dataset.targetName = itemPath;
                div.dataset.isFolder = 'true';
                div.classList.add('clickable-card');
                div.innerHTML = `<input type="checkbox" class="file-checkbox card-checkbox" style="visibility: hidden;"><div class="file-card-icon folder-icon"><i class="fas fa-folder"></i></div><div class="file-card-content"><div class="file-name"><span class="file-name-text">${name}</span><span class="file-name-tooltip">${name}</span></div><div class="file-card-meta">Pasta • ${formatModifiedDate(item)}</div></div>${cardActionsHTML}`;
            }
        } else {
            if (item._isFile) {
                div.innerHTML = `<input type="checkbox" class="file-checkbox" data-key="${item.name}" data-message-id="${item.message_id}" data-is-group="${isGroup}" data-group-id="${item.groupId || ''}"><span class="file-icon">${getIconForFile(name, isGroup)}</span><span class="file-name">${displayName}</span><span class="file-size">${formatFileSize(item.file_size)}</span><span class="file-date">${formatModifiedDate(item)}</span>${actionsHTML}`;
            } else {
                div.innerHTML = `<input type="checkbox" class="file-checkbox" style="visibility: hidden;"><span class="file-icon folder-icon"><i class="fas fa-folder"></i></span><a href="#/${encodeURI(itemPath)}" class="file-name">${name}</a><span class="file-size">—</span><span class="file-date">${formatModifiedDate(item)}</span>${actionsHTML}`;
            }
        }

        fileListBodyElement.appendChild(div);
    });

    document.querySelector('.file-list-header').style.display = state.viewMode === 'grid' ? 'none' : 'flex';

    document.querySelectorAll('.sortable-header').forEach(header => {
        const indicator = header.querySelector('.sort-indicator');
        indicator.className = 'sort-indicator';
        if (header.dataset.sort === state.sort.key) indicator.classList.add(state.sort.order);
    });

    focusPendingFileHighlight();
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
                if (!hasPermission('can_view_files')) { mainContent.innerHTML = "<h2>Acesso Negado</h2>"; break; }
                if (state.allFiles.length === 0) {
                    const data = await apiCall('files');
                    state.allFiles = data.files || [];
                    state.allFolders = data.allFolders || [];
                    state.fileTree = buildFileTree(state.allFiles, state.allFolders);
                }
                const currentPath = primaryRoute === 'home' ? [] : path;
                renderFilesPage(currentPath);
                break;
        }
    } catch (error) {
        if (error.message.includes('Token')) logout();
        else mainContent.innerHTML = `<h2>Erro</h2><p>${error.message}</p>`;
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
    document.getElementById('folder-perms-close-btn').onclick = closeFolderPermsModal;
    document.getElementById('user-roles-close-btn').onclick = closeUserRolesModal;
    document.getElementById('group-files-close-btn').onclick = closeGroupFilesModal;
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
    document.getElementById('folder-perms-cancel-btn').onclick = closeFolderPermsModal;
    document.getElementById('folder-perms-save-btn').onclick = confirmSaveFolderPerms;
    document.getElementById('user-roles-cancel-btn').onclick = closeUserRolesModal;
    document.getElementById('user-roles-save-btn').onclick = confirmSaveUserRoles;
    document.getElementById('group-files-cancel-btn').onclick = closeGroupFilesModal;
    document.getElementById('group-files-confirm-btn').onclick = confirmGroupFiles;

    [authModal, whyLinkModal, moveFileModal, createFolderModal, renameModal, roleModal, passwordResetModal, folderPermsModal, userRolesModal, groupFilesModal].forEach(modal => {
        if (modal) modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };
    });

    document.getElementById('new-folder-name').addEventListener('keyup', (e) => { if (e.key === 'Enter') confirmCreateFolder(); });
    document.getElementById('rename-new-name').addEventListener('keyup', (e) => { if (e.key === 'Enter') confirmRename(); });
    document.getElementById('group-name').addEventListener('keyup', (e) => { if (e.key === 'Enter') confirmGroupFiles(); });
    
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
        const clickableCard = e.target.closest('.clickable-card[data-href]');
        if (clickableCard && !e.target.closest('button, input, a, .file-card-menu, .file-checkbox')) {
            if (clickableCard.dataset.targetName) {
                navigateToSearchResult({ name: clickableCard.dataset.targetName, _isFolder: clickableCard.dataset.isFolder === 'true' });
            } else {
                window.location.hash = clickableCard.dataset.href;
            }
            return;
        }

        const target = e.target.closest('button, .sortable-header');
        if (!target) {
            document.querySelectorAll('.file-card-actions.show').forEach(el => el.classList.remove('show'));
            return;
        }

        if (target.classList.contains('btn-card-actions')) {
            const card = target.closest('.file-card-actions');
            if (!card) return;
            document.querySelectorAll('.file-card-actions.show').forEach(el => { if (el !== card) el.classList.remove('show'); });
            card.classList.toggle('show');
            return;
        }
        if (target.classList.contains('btn-single-forward')) await handleSingleForward(target.dataset.messageId);
        if (target.classList.contains('btn-bulk-forward')) {
            const messageIds = target.dataset.messageIds.split(',').map(id => parseInt(id));
            await apiCall('bulk-forward', 'POST', { message_ids: messageIds });
            showNotification('O bot começou a enviar os arquivos! Verifique seu Telegram.', 'success');
        }
        if (target.classList.contains('btn-ungroup')) {
            if (confirm("Tem certeza que deseja desagrupar estes arquivos? Eles voltarão a ser exibidos individualmente.")) {
                await apiCall('admin/ungroup', 'POST', { groupId: parseInt(target.dataset.groupId) });
                await refreshFiles();
            }
        }
        if (target.classList.contains('btn-delete-group')) {
             if (confirm("Tem certeza que deseja excluir este grupo e todos os seus arquivos?")) {
                const groupItems = JSON.parse(target.dataset.groupItems);
                await deleteItems(groupItems);
             }
        }

        if (target.classList.contains('btn-move-file')) openMoveModal(target.dataset.key, false);
        if (target.classList.contains('btn-move-folder')) openMoveModal(target.dataset.key, true);
        if (target.classList.contains('btn-rename')) openRenameModal(target.dataset.key, target.dataset.isfolder === 'true');
        if (target.classList.contains('btn-delete')) {
            const isFolder = target.dataset.isfolder === 'true';
            const key = target.dataset.key;
            await deleteItems(key, isFolder, isFolder ? key.split('/').pop() : '');
        }
        if (target.classList.contains('btn-folder-perms')) {
            openFolderPermsModal(target.dataset.path);
        }
        if (target.classList.contains('edit-user-roles-btn')) {
            const userId = parseInt(target.dataset.userId);
            const username = target.dataset.username;
            const userRoles = JSON.parse(target.dataset.userRoles);
            openUserRolesModal(userId, username, userRoles);
        }

        if (target.classList.contains('sortable-header')) {
            const sortKey = target.dataset.sort;
            if (state.sort.key === sortKey) state.sort.order = state.sort.order === 'asc' ? 'desc' : 'asc';
            else { state.sort.key = sortKey; state.sort.order = 'asc'; }
            router();
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
        
        let buttonsHTML = `<span class="bulk-count"><i class="fas fa-check-double"></i> ${selected.length} item(ns) selecionado(s)</span><div class="bulk-actions-group">`;
        if (hasPermission('can_receive_files')) buttonsHTML += `<button id="bulk-receive-btn" class="bulk-btn" title="Receber"><i class="fas fa-paper-plane"></i><span>Receber</span></button>`;
        if (hasPermission('can_move_items')) buttonsHTML += `<button id="bulk-move-btn" class="bulk-btn" title="Mover"><i class="fas fa-up-down-left-right"></i><span>Mover</span></button>`;
        if (hasPermission('can_group_items')) buttonsHTML += `<button id="bulk-group-btn" class="bulk-btn" title="Agrupar"><i class="fas fa-cubes"></i><span>Agrupar</span></button>`;
        if (hasPermission('can_delete_items')) buttonsHTML += `<button id="bulk-delete-btn" class="btn-danger bulk-btn" title="Excluir"><i class="fas fa-trash-can"></i><span>Excluir</span></button>`;
        buttonsHTML += '</div>'; 
        bulkActionsContainer.innerHTML = buttonsHTML;

        if (document.getElementById('bulk-move-btn')) document.getElementById('bulk-move-btn').onclick = () => openMoveModal(keys, false);
        if (document.getElementById('bulk-delete-btn')) document.getElementById('bulk-delete-btn').onclick = () => deleteItems(keys);
        if (document.getElementById('bulk-group-btn')) document.getElementById('bulk-group-btn').onclick = openGroupFilesModal;
        if (document.getElementById('bulk-receive-btn')) {
            document.getElementById('bulk-receive-btn').onclick = async () => {
                if (!state.token) { showNotification("Você precisa estar logado.", 'error'); return; }
                const btn = document.getElementById('bulk-receive-btn');
                try {
                    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>Enviando</span>`;
                    btn.disabled = true;
                    await apiCall('bulk-forward', 'POST', { message_ids: messageIds.filter(Boolean).map(id => parseInt(id)) });
                    showNotification("O bot começou a enviar os arquivos! Verifique seu Telegram.", 'success');
                } catch (error) {
                    showNotification(`Ocorreu um erro: ${error.message}`, 'error');
                } finally {
                    btn.innerHTML = `<i class="fas fa-paper-plane"></i><span>Receber</span>`;
                    btn.disabled = false;
                }
            };
        }
    });

    window.addEventListener('hashchange', router);
    router();
});