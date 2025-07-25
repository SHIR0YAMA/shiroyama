document.addEventListener('DOMContentLoaded', () => {
    // Agora pegamos o corpo da tabela, não a lista ul
    const fileListBodyElement = document.getElementById('file-list-body');
    const breadcrumbElement = document.getElementById('breadcrumb');
    let allFilesData = {}; // Usamos objeto para a árvore

    // As funções parsePath e buildFileTree continuam as mesmas
    function parsePath(path) {
        const parts = path.split('/').filter(p => p);
        const filename = parts.pop() || '';
        const folderPath = parts;
        return { filename, folderPath };
    }

    function buildFileTree(files) {
        const tree = {};
        files.forEach(file => {
            const { filename, folderPath } = parsePath(file.name);
            let currentLevel = tree;
            folderPath.forEach(folderName => {
                if (!currentLevel[folderName]) {
                    currentLevel[folderName] = {};
                }
                currentLevel = currentLevel[folderName];
            });
            if (filename) {
                currentLevel[filename] = { ...file, _isFile: true };
            }
        });
        return tree;
    }

    function renderView(path) {
    // --- LÓGICA DO BREADCRUMB CORRIGIDA ---
    breadcrumbElement.innerHTML = '';
    const pathParts = ['Home', ...path];

    pathParts.forEach((part, index) => {
        const span = document.createElement('span');
        
        // Todos os itens, exceto o último, são links clicáveis
        if (index < pathParts.length - 1) {
            const a = document.createElement('a');
            a.href = '#';
            a.textContent = part;
            
            // Aqui está a correção: calculamos o "caminho de destino" para cada link
            const targetPath = pathParts.slice(1, index + 1);
            
            a.onclick = (e) => {
                e.preventDefault();
                renderView(targetPath); // Navega para o caminho de destino calculado
            };
            span.appendChild(a);
            span.innerHTML += ' > '; // Adiciona o separador
        } else {
            // O último item é apenas texto
            span.textContent = part;
        }
        breadcrumbElement.appendChild(span);
    });

    // O resto da lógica para encontrar e renderizar os itens continua igual
    let currentLevel = allFilesData;
    path.forEach(folderName => {
        currentLevel = currentLevel[folderName] || {};
    });

    fileListBodyElement.innerHTML = '';
    const items = Object.entries(currentLevel);
    
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
            const nameTd = document.createElement('td');
            nameTd.setAttribute('colspan', '2');
            const folderLink = document.createElement('a');
            folderLink.href = '#';
            folderLink.className = 'file-item-name';
            folderLink.innerHTML = `<span>📁</span> <span>${name}</span>`;
            folderLink.onclick = (e) => {
                e.preventDefault();
                renderView([...path, name]);
            };
            nameTd.appendChild(folderLink);
            tr.appendChild(nameTd);
        }
        fileListBodyElement.appendChild(tr);
    });
}

    // O fetch inicial continua igual
    fetch('/api/files')
        .then(response => {
            if (!response.ok) throw new Error(`Erro de rede: ${response.statusText}`);
            return response.json();
        })
        .then(data => {
            allFilesData = buildFileTree(data.files || []);
            renderView([]);
        })
        .catch(error => {
            console.error('Erro ao buscar a lista de arquivos:', error);
            fileListBodyElement.innerHTML = `<tr><td colspan="2">Erro ao carregar os arquivos. Verifique o console (F12).</td></tr>`;
        });
});