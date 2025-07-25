// Função auxiliar para formatar o tamanho dos arquivos
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

document.addEventListener('DOMContentLoaded', () => {
    // Referências para os elementos do DOM
    const fileListBodyElement = document.getElementById('file-list-body');
    const breadcrumbElement = document.getElementById('breadcrumb');
    const backButton = document.getElementById('back-button');
    const forwardButton = document.getElementById('forward-button');
    
    let fileTree = {}; // A árvore completa de arquivos e pastas

    // Lógica dos botões de navegação
    backButton.onclick = () => window.history.back();
    forwardButton.onclick = () => window.history.forward();
    
    // --- FUNÇÕES DE LÓGICA ---
    function buildFileTree(files) {
        const tree = {};
        files.forEach(file => {
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
        let currentLevel = fileTree;
        for (const folderName of path) {
            currentLevel = currentLevel[folderName];
            if (!currentLevel) return {};
        }
        return currentLevel;
    }

    // --- FUNÇÕES DE RENDERIZAÇÃO E ROTEAMENTO ---
    function renderView(path) {
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
                const nameTd = document.createElement('td');
                nameTd.className = 'file-item-name';
                nameTd.innerHTML = `<span>📄</span> <span>${name}</span>`;

                // --- CÉLULA DE TAMANHO CORRIGIDA E MAIS ROBUSTA ---
                const sizeTd = document.createElement('td');
                sizeTd.className = 'size-col';
                // Verificamos explicitamente se item.file_size é um número.
                if (typeof item.file_size === 'number') {
                    sizeTd.textContent = formatFileSize(item.file_size);
                } else {
                    sizeTd.textContent = 'N/A'; // Fallback para caso o dado não venha
                }
                // --- FIM DA CORREÇÃO ---

                const downloadTd = document.createElement('td');
                downloadTd.className = 'download-col';
                const downloadLink = document.createElement('a');
                const vercelApiUrl = "https://telegram-drive-eight.vercel.app/api/download";
                downloadLink.href = `${vercelApiUrl}?message_id=${item.message_id}&filename=${encodeURIComponent(name)}`;
                downloadLink.textContent = 'Baixar';
                downloadTd.appendChild(downloadLink);

                tr.appendChild(nameTd);
                tr.appendChild(sizeTd); // Adiciona a célula de tamanho
                tr.appendChild(downloadTd);
            } else {
                const nameTd = document.createElement('td');
                // Para pastas, a célula de nome ocupa 3 colunas
                nameTd.setAttribute('colspan', '3');
                const folderLink = document.createElement('a');
                const targetPath = [...path, name].map(encodeURIComponent).join('/');
                folderLink.href = `#/${targetPath}`;
                folderLink.className = 'file-item-name';
                folderLink.innerHTML = `<span>📁</span> <span>${name}</span>`;
                nameTd.appendChild(folderLink);
                tr.appendChild(nameTd);
            }
            fileListBodyElement.appendChild(tr);
        });
    }

    function router() {
        const pathString = window.location.hash.slice(1) || '/';
        const path = pathString.split('/').filter(p => p).map(decodeURIComponent);
        renderView(path);
    }

    // --- INICIALIZAÇÃO ---
    // Ouve por mudanças no hash (cliques nos links, botões do navegador)
    window.addEventListener('hashchange', router);

    // Carrega os dados e inicia o roteador
    fetch('/api/files')
        .then(response => {
            if (!response.ok) throw new Error(`Erro de rede: ${response.statusText}`);
            return response.json();
        })
        .then(data => {
            fileTree = buildFileTree(data.files || []);
            router(); // Renderiza a visão inicial baseada na URL
        })
        .catch(error => {
            console.error('Erro ao buscar a lista de arquivos:', error);
            fileListBodyElement.innerHTML = `<tr><td colspan="3">Erro ao carregar os arquivos. Verifique o console (F12).</td></tr>`;
        });
});