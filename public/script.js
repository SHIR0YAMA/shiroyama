document.addEventListener('DOMContentLoaded', () => {
    const fileList = document.getElementById('file-list');

    // Pede a lista de arquivos para nossa API
    fetch('/api/files')
        .then(response => response.json())
        .then(data => {
            fileList.innerHTML = ''; // Limpa a mensagem "Carregando..."
            if (data.files && data.files.length > 0) {
                data.files.forEach(file => {
                    const li = document.createElement('li');
                    
                    // O nome do arquivo
                    const fileName = document.createElement('span');
                    fileName.textContent = file.name;
                    
                    // O link de download
                    const downloadLink = document.createElement('a');
                    // Este link aponta para nossa outra função de API
                    downloadLink.href = `/api/download?file_id=${file.id}`;
                    downloadLink.textContent = 'Baixar';
                    downloadLink.target = '_blank'; // Abre em nova aba

                    li.appendChild(fileName);
                    li.appendChild(downloadLink);
                    fileList.appendChild(li);
                });
            } else {
                fileList.innerHTML = '<li>Nenhum arquivo encontrado.</li>';
            }
        })
        .catch(error => {
            console.error('Erro ao buscar arquivos:', error);
            fileList.innerHTML = '<li>Erro ao carregar os arquivos.</li>';
        });
});