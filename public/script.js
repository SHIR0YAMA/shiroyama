document.addEventListener('DOMContentLoaded', () => {
    const fileListBodyElement = document.getElementById('file-list-body');
    const breadcrumbElement = document.getElementById('breadcrumb');
    
    let fileTree = {}; // A árvore de arquivos completa
    let currentPath = []; // O estado atual da nossa navegação

    // --- FUNÇÕES DE LÓGICA (separadas e claras) ---

    // 1. Constrói a estrutura de árvore a partir da lista de arquivos
    function buildFileTree(files) {
        const tree = {};
        files.forEach(file => {
            const parts = file.name.split('/').filter(p => p);
            let currentLevel = tree;
            parts.forEach((part, index) => {
                if (index === parts.length - 1) { // É o nome do arquivo
                    currentLevel[part] = { ...file, _isFile: true };
                } else { // É uma pasta
                    if (!currentLevel[part]) {
                        currentLevel[part] = {};
                    }
                    currentLevel = currentLevel[part];
                }
            });
        });
        return tree;
    }

    // 2. Navega na árvore e retorna o conteúdo da pasta atual
    function getContentForPath(path) {
        let currentLevel = fileTree;
        for (const folderName of path) {
            currentLevel = currentLevel[folderName];
            if (!currentLevel) return {}; // Caminho inválido
        }
        return currentLevel;
    }

	function renderBreadcrumb() {
		breadcrumbElement.innerHTML = '';
		const pathParts = ['Home', ...currentPath];

		pathParts.forEach((part, index) => {
			const span = document.createElement('span');
			
			// Se não for o último item, é um link clicável
			if (index < pathParts.length - 1) {
				const a = document.createElement('a');
				a.href = '#';
				a.textContent = part;
				
				// --- ESTA É A CORREÇÃO CRÍTICA ---
				a.onclick = (e) => {
					e.preventDefault();
					// O novo caminho é uma fatia do caminho ATUAL, com o comprimento do índice do item clicado.
					// Se o índice for 0 (Home), o slice(0, 0) retorna um array vazio [].
					// Se o índice for 1 (Meus Testes), o slice(0, 1) retorna ['Meus Testes'].
					// Se o índice for 2 (Teste 1), o slice(0, 2) retorna ['Meus Testes', 'Teste 1'].
					// E assim por diante. É a lógica correta.
					currentPath = currentPath.slice(0, index);
					renderCurrentView();
				};
				span.appendChild(a);
				span.innerHTML += ' > ';
			} else {
				// O último item (a pasta atual) é apenas texto
				span.textContent = part;
			}
			breadcrumbElement.appendChild(span);
		});
	}

    // 4. Renderiza a lista de arquivos e pastas para o caminho atual
    function renderFileList() {
        const content = getContentForPath(currentPath);
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
                // Ao clicar, adiciona a pasta ao caminho atual e renderiza
                folderLink.onclick = (e) => {
                    e.preventDefault();
                    currentPath.push(name);
                    renderCurrentView();
                };
                nameTd.appendChild(folderLink);
                tr.appendChild(nameTd);
            }
            fileListBodyElement.appendChild(tr);
        });
    }

    // 5. Função principal que atualiza a tela inteira
    function renderCurrentView() {
        renderBreadcrumb();
        renderFileList();
    }


    // --- INICIALIZAÇÃO ---
    // Pega todos os arquivos da API e inicia a aplicação
    fetch('/api/files')
        .then(response => {
            if (!response.ok) throw new Error(`Erro de rede: ${response.statusText}`);
            return response.json();
        })
        .then(data => {
            fileTree = buildFileTree(data.files || []);
            // Inicia na raiz (caminho vazio)
            renderCurrentView();
        })
        .catch(error => {
            console.error('Erro ao buscar a lista de arquivos:', error);
            fileListBodyElement.innerHTML = `<tr><td colspan="2">Erro ao carregar os arquivos. Verifique o console (F12).</td></tr>`;
        });
});