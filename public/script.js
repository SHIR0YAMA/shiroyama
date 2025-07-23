// public/script.js

document.addEventListener('DOMContentLoaded', () => {
    const fileList = document.getElementById('file-list');

    fetch('/api/files')
        .then(response => response.json())
        .then(data => {
            fileList.innerHTML = '';
            if (data.files && data.files.length > 0) {
                data.files.forEach(file => {
                    const li = document.createElement('li');
                    
                    const fileNameSpan = document.createElement('span');
                    fileNameSpan.textContent = file.name;
                    
                    const downloadLink = document.createElement('a');
                    // MUDANÇA AQUI: Adicionamos &filename=... na URL
                    downloadLink.href = `/api/download?file_id=${file.id}&filename=${encodeURIComponent(file.name)}`;
                    downloadLink.textContent = 'Baixar';
                    // Não precisamos mais do target="_blank"
                    // downloadLink.target = '_blank';

                    li.appendChild(fileNameSpan);
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