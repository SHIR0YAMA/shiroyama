document.addEventListener('DOMContentLoaded', () => {
    const fileListBodyElement = document.getElementById('file-list-body');
    const breadcrumbElement = document.getElementById('breadcrumb');
    
    let fileTree = {}; // A árvore de arquivos completa

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
        // 1. Renderiza o breadcrumb
        breadcrumbElement.innerHTML = '';
        const pathParts = ['Home', ...path];
        pathParts.forEach((part, index) => {
            const span = document.createElement('span');
            if (index < pathParts.length - 1) {
                const a = document.createElement('a');
                // O link agora aponta para uma URL com hash
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

        // 2. Renderiza a lista de arquivos
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
            fileListBodyElement.innerHTML = '<tr><td colspan="2">Pasta vazia.</td></tr>';
            return;
        }

        items.forEach(([name, item]) => {
            const tr = document.createElement('tr');
            if (item._isFile) {
                // ... (código para renderizar arquivos continua o mesmo)
                const nameTd = document.createElement('td');
                nameTd.className = 'file-item-name';
                nameTd.innerHTML = `<span>📄</span> <span>${name}</span>`;
                const downloadTd = document.createElement('td');
                downloadTd.className = 'download-col';
                const downloadLink = document.createElement('a');
                const vercelApiUrl = "https://telegram-drive-eight.vercel.app/api/download";
                downloadLink.href = `${vercelApiUrl}?message_id=${item.message_id}&filename=${encodeURIComponent(name)}`;
                downloadLink.textContent = 'Baixar';
                downloadTd.appendChild(downloadLink);
                tr.appendChild(nameTd);
                tr.appendChild(downloadTd);
            } else {
                // O link da pasta agora também aponta para uma URL com hash
                const nameTd = document.createElement('td');
                nameTd.setAttribute('colspan', '2');
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

    // --- O ROTEADOR PRINCIPAL ---
    function router() {
        // Pega o caminho do hash da URL (ex: #/Animes/Ação -> /Animes/Ação)
        const pathString = window.location.hash.slice(1) || '/';
        // Limpa barras extras e divide em partes, decodificando cada parte
        const path = pathString.split('/').filter(p => p).map(decodeURIComponent);
        // Renderiza a visão para o caminho atual da URL
        renderView(path);
    }

    // --- INICIALIZAÇÃO ---

    // Ouve por mudanças no hash da URL (quando o usuário clica nos links ou usa os botões do navegador)
    window.addEventListener('hashchange', router);

    // Carrega os dados dos arquivos e inicia o roteador pela primeira vez
    fetch('/api/files')
        .then(response => {
            if (!response.ok) throw new Error(`Erro de rede: ${response.statusText}`);
            return response.json();
        })
        .then(data => {
            fileTree = buildFileTree(data.files || []);
            // Chama o roteador para renderizar a página inicial baseada na URL atual
            router(); 
        })
        .catch(error => {
            console.error('Erro ao buscar a lista de arquivos:', error);
            fileListBodyElement.innerHTML = `<tr><td colspan="2">Erro ao carregar os arquivos. Verifique o console (F12).</td></tr>`;
        });
});