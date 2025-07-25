document.addEventListener('DOMContentLoaded', () => {
    const fileListElement = document.getElementById('file-list');
    const breadcrumbElement = document.getElementById('breadcrumb');
    let allFilesData = []; // Para armazenar todos os arquivos uma vez

    function parsePath(path) {
        const parts = path.split('/').filter(p => p);
        const filename = parts.pop();
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
                    currentLevel[folderName] = {}; // É uma pasta
                }
                currentLevel = currentLevel[folderName];
            });
            // Adiciona o arquivo no nível final
            currentLevel[filename] = { ...file, _isFile: true };
        });
        return tree;
    }

    function renderView(path) {
        // Atualiza o "breadcrumb" (o caminho: Home > Animes > ...)
        breadcrumbElement.innerHTML = '';
        const pathParts = ['Home', ...path];
        pathParts.forEach((part, index) => {
            const span = document.createElement('span');
            if (index < pathParts.length - 1) {
                const a = document.createElement('a');
                a.href = '#';
                a.textContent = part;
                a.onclick = (e) => {
                    e.preventDefault();
                    renderView(pathParts.slice(1, index + 1));
                };
                span.appendChild(a);
                span.innerHTML += ' > ';
            } else {
                span.textContent = part;
            }
            breadcrumbElement.appendChild(span);
        });

        // Navega na árvore de arquivos para obter o conteúdo da pasta atual
        let currentLevel = allFilesData;
        path.forEach(folderName => {
            currentLevel = currentLevel[folderName] || {};
        });

        fileListElement.innerHTML = ''; // Limpa a lista
        const items = Object.entries(currentLevel);

        // Ordena para que as pastas venham primeiro
        items.sort(([nameA, itemA], [nameB, itemB]) => {
            const isFileA = itemA._isFile;
            const isFileB = itemB._isFile;
            if (isFileA && !isFileB) return 1;
            if (!isFileA && isFileB) return -1;
            return nameA.localeCompare(nameB);
        });

        if (items.length === 0) {
            fileListElement.innerHTML = '<li>Pasta vazia.</li>';
            return;
        }

        items.forEach(([name, item]) => {
            const li = document.createElement('li');
            
            if (item._isFile) { // É um arquivo
                const fileNameSpan = document.createElement('span');
                fileNameSpan.textContent = `📄 ${name}`;
                
                const downloadLink = document.createElement('a');
                const vercelApiUrl = "https://telegram-drive-eight.vercel.app/api/download";
                downloadLink.href = `${vercelApiUrl}?message_id=${item.message_id}&filename=${encodeURIComponent(name)}`;
                downloadLink.textContent = 'Baixar';
                
                li.appendChild(fileNameSpan);
                li.appendChild(downloadLink);
            } else { // É uma pasta
                const folderLink = document.createElement('a');
                folderLink.href = '#';
                folderLink.textContent = `📁 ${name}`;
                folderLink.onclick = (e) => {
                    e.preventDefault();
                    renderView([...path, name]);
                };
                li.appendChild(folderLink);
            }
            fileListElement.appendChild(li);
        });
    }

    // Pede a lista de TODOS os arquivos para a API, UMA ÚNICA VEZ
    fetch('/api/files')
        .then(response => {
            if (!response.ok) throw new Error(`Erro de rede: ${response.statusText}`);
            return response.json();
        })
        .then(data => {
            // Constrói a árvore de arquivos e pastas
            allFilesData = buildFileTree(data.files);
            // Renderiza a visão inicial (a raiz do projeto)
            renderView([]);
        })
        .catch(error => {
            console.error('Erro ao buscar a lista de arquivos:', error);
            fileListElement.innerHTML = `<li>Erro ao carregar os arquivos. Verifique o console (F12) para mais detalhes.</li>`;
        });
});