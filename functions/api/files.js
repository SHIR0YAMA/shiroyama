// /functions/api/files.js

export async function onRequestGet(context) {
    const { env, data } = context;
    const loggedInUser = data.user;

    if (!loggedInUser || !loggedInUser.permissions.includes('can_view_files')) {
        return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para visualizar arquivos.' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // --- NOVA LÓGICA DE PERMISSÕES DE PASTAS ---

        // 1. Busca todas as regras de permissão de pastas e todas as chaves do KV em paralelo
        const [permsResult, kvListResult] = await Promise.all([
            env.DB.prepare("SELECT role_id, folder_path FROM folder_permissions").all(),
            env.ARQUIVOS_TELEGRAM.list({ limit: 1000 }) // Para simplicidade, limitamos a 1000. Adicionar paginação se necessário.
        ]);

        const folderPerms = permsResult.results;
        const allKeys = kvListResult.keys;

        // Cria um mapa de pastas restritas para consulta rápida
        const restrictedFolders = {};
        folderPerms.forEach(p => {
            if (!restrictedFolders[p.folder_path]) {
                restrictedFolders[p.folder_path] = [];
            }
            restrictedFolders[p.folder_path].push(p.role_id);
        });

        // 2. Filtra a lista de chaves com base nas permissões do usuário
        const accessibleKeys = allKeys.filter(key => {
            const pathParts = key.name.split('/');
            pathParts.pop(); // Remove o nome do arquivo, sobrando o caminho
            const folderPath = pathParts.join('/');

            // Se a pasta está na lista de restritas
            if (restrictedFolders[folderPath]) {
                // O usuário só pode ver se o ID do seu cargo estiver na lista de permissões da pasta
                return restrictedFolders[folderPath].includes(loggedInUser.roleId);
            }
            
            // Se a pasta não é restrita, é pública para quem tem 'can_view_files'
            return true;
        });

        // 3. Obtém os metadados apenas para as chaves acessíveis
        const filePromises = accessibleKeys.map(async (key) => {
            if (key.name.endsWith('/.placeholder')) {
                return { name: key.name, isPlaceholder: true };
            }
            try {
                const value = await env.ARQUIVOS_TELEGRAM.get(key.name);
                if (value) {
                    const metadata = JSON.parse(value);
                    return {
                        name: key.name,
                        file_size: metadata.file_size || 0,
                        message_id: metadata.message_id || null
                    };
                }
            } catch (e) {
                console.error(`Chave '${key.name}' tem valor inválido:`, e);
                return { name: key.name, file_size: 0, message_id: null };
            }
            return null;
        });

        const accessibleFiles = (await Promise.all(filePromises)).filter(Boolean);

        // 4. Obtém a lista de todas as pastas únicas que realmente existem (para a UI)
        const allExistingFolders = [...new Set(allKeys.map(k => k.name.substring(0, k.name.lastIndexOf('/'))).filter(Boolean))];

        // --- FIM DA NOVA LÓGICA ---

        const headers = new Headers({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        return new Response(JSON.stringify({ 
            files: accessibleFiles,
            allFolders: allExistingFolders 
        }), { headers: headers });

    } catch (error) {
        console.error("Erro ao listar arquivos:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao buscar a lista de arquivos." }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}