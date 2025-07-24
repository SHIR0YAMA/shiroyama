document.addEventListener('DOMContentLoaded', () => {
    const fileList = document.getElementById('file-list');

    // Pede a lista de arquivos para nossa API na Cloudflare
    fetch('/api/files')
        .then(response => {
            if (!response.ok) {
                // Se a resposta não for 'ok', lança um erro para ser pego pelo .catch()
                throw new Error(`Erro de rede: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            fileList.innerHTML = ''; // Limpa a mensagem "Carregando..."
            if (data.files && data.files.length > 0) {
                data.files.forEach(file => {
                    const li = document.createElement('li');
                    
                    const fileNameSpan = document.createElement('span');
                    fileNameSpan.textContent = file.name;
                    
                    const downloadLink = document.createElement('a');
                    
                    // --- ESTA É A MUDANÇA PRINCIPAL ---
                    // Monta a URL para a nova API de download na Vercel
                    const vercelApiUrl = "https://telegram-drive-eight.vercel.app/api/download";
                    downloadLink.href = `${vercelApiUrl}?message_id=${file.message_id}&filename=${encodeURIComponent(file.name)}`;
                    downloadLink.textContent = 'Baixar';
                    
                    li.appendChild(fileNameSpan);
                    li.appendChild(downloadLink);
                    fileList.appendChild(li);
                });
            } else {
                fileList.innerHTML = '<li>Nenhum arquivo encontrado no banco de dados. Adicione arquivos no canal e atualize o banco de dados.</li>';
            }
        })
        .catch(error => {
            console.error('Erro ao buscar a lista de arquivos:', error);
            fileList.innerHTML = `<li>Erro ao carregar os arquivos. Verifique o console (F12) para mais detalhes.</li>`;
        });
});