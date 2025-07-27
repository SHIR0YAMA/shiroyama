function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

document.addEventListener('DOMContentLoaded', () => {
    const fileListBodyElement = document.getElementById('file-list-body');
    const tableHeaderElement = document.querySelector('.file-table thead tr');
    const breadcrumbElement = document.getElementById('breadcrumb');
    const backButton = document.getElementById('back-button');
    const forwardButton = document.getElementById('forward-button');
    
    let fileTree = {};
    let adminSecret = sessionStorage.getItem('adminSecret'); // Guarda a senha na sessão

    // --- FUNÇÕES DA API DO ADMIN ---
    async function apiAdminAction(endpoint, body) {
        if (!adminSecret) {
            alert('Senha de administrador não definida ou expirou.');
            return;
        }
        try {
            const response = await fetch(`/api/admin/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...body, secret: adminSecret })
            });
            const result = await response.json();
            alert(result.message);
            if (response.ok) {
                window.location.reload(); // Recarrega para ver a mudança
            }
        } catch (error) {
            alert(`Erro na comunicação com a API: ${error.message}`);
        }
    }

    function deleteFile(key) {
        if (confirm(`Tem certeza que deseja deletar o arquivo:\n${key}`)) {
            apiAdminAction('delete', { key });
        }
    }

    function renameFile(oldKey) {
        const newKey = prompt("Digite o novo caminho completo (ex: Animes/Nome/Ep01.mkv):", oldKey);
        if (newKey && newKey !== oldKey) {
            apiAdminAction('rename', { oldKey, newKey });
        }
    }

    // --- FUNÇÕES DE LÓGICA ---
    function buildFileTree(files) { /* ... (código igual ao anterior) ... */ }
    function getContentForPath(path) { /* ... (código igual ao anterior) ... */ }

    // --- FUNÇÕES DE RENDERIZAÇÃO ---
    function renderAdminView(allFiles) {
        document.querySelector('.navigation-controls').style.display = 'none';
        breadcrumbElement.innerHTML = `<span>Painel de Administrador (<a href="/#/" id="admin-logout">Sair</a>)</span>`;
        document.getElementById('admin-logout').onclick = (e) => {
            e.preventDefault();
            sessionStorage.removeItem('adminSecret');
            window.location.hash = '/';
        };

        tableHeaderElement.innerHTML = `
            <th>Caminho Completo</th>
            <th class="size-col">Tamanho</th>
            <th class="actions-col">Ações</th>
        `;
        fileListBodyElement.innerHTML = '';
        
        allFiles.sort((a, b) => a.name.localeCompare(b.name)).forEach(file => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${file.name}</td>
                <td class="size-col">${formatFileSize(file.file_size)}</td>
                <td class="actions-col admin-actions">
                    <button class="rename-btn" data-key="${file.name}">Mover/Renomear</button>
                    <button class="delete-btn" data-key="${file.name}">Excluir</button>
                </td>
            `;
            fileListBodyElement.appendChild(tr);
        });

        document.querySelectorAll('.rename-btn').forEach(btn => btn.onclick = () => renameFile(btn.dataset.key));
        document.querySelectorAll('.delete-btn').forEach(btn => btn.onclick = () => deleteFile(btn.dataset.key));
    }

    function renderPublicView(path) { /* ... (código igual ao anterior, mas com o nome renderPublicView) ... */ }

    // --- ROTEADOR PRINCIPAL ---
    function router(allFiles) {
        const pathString = window.location.hash.slice(1) || '/';
        const path = pathString.split('/').filter(p => p).map(decodeURIComponent);

        if (path[0] === 'admin') {
            if (!adminSecret) {
                adminSecret = prompt('Por favor, digite a senha de administrador:');
                if (adminSecret) {
                    sessionStorage.setItem('adminSecret', adminSecret);
                }
            }
            if (adminSecret) {
                renderAdminView(allFiles);
            } else {
                window.location.hash = '/';
            }
        } else {
            document.querySelector('.navigation-controls').style.display = 'flex';
            tableHeaderElement.innerHTML = `
                <th>Nome</th>
                <th class="size-col">Tamanho</th>
                <th class="download-col"></th>
            `;
            fileTree = buildFileTree(allFiles);
            renderPublicView(path);
        }
    }

    // --- INICIALIZAÇÃO ---
    fetch('/api/files')
        .then(response => response.json())
        .then(data => {
            const allFiles = data.files || [];
            const initialRouterCall = () => router(allFiles);
            window.addEventListener('hashchange', initialRouterCall);
            initialRouterCall();
        })
        .catch(error => console.error('Erro ao carregar arquivos:', error));
    
    // As funções buildFileTree e getContentForPath são as mesmas da versão anterior
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
        let currentLevel = fileTree;
        for (const folderName of path) {
            currentLevel = currentLevel[folderName];
            if (!currentLevel) return {};
        }
        return currentLevel;
    };
    renderPublicView = function(path) {
        backButton.disabled = path.length === 0;
        breadcrumbElement.innerHTML = '';
        const pathParts = ['Home', ...path];
        pathParts.forEach((part, index) => {
            const span = document.createElement('span');
            if (index < pathParts.length - 1) {
                const a = document.createElement('a');
                const targetPath = pathParts.slice(1, index + 1).map(encodeURIComponent).join('/');
                a.href = `#/${targetPath}`;
                a.textContent = part;
                span.appendChild(a);
                span.innerHTML += ' > ';
            } else {
                span.textContent = part;
            }
            breadcrumbElement.appendChild(span);
        });
        const content = getContentForPath(path);
        fileListBodyElement.innerHTML = '';
        const items = Object.entries(content);
        items.sort(([nameA, itemA], [nameB, itemB]) => {
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
                    <td colspan="3">
                        <a href="#/${[...path, name].map(encodeURIComponent).join('/')}" class="file-item-name">
                            <span>📁</span> <span>${name}</span>
                        </a>
                    </td>
                `;
            }
            fileListBodyElement.appendChild(tr);
        });
    };
});