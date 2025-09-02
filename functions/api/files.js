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
        // 1. Busca todas as regras de permissão de pastas e todas as chaves do KV em paralelo
        const [permsResult, kvListResult] = await Promise.all([
            env.DB.prepare("SELECT role_id, folder_path FROM folder_permissions").all(),
            env.ARQUIVOS_TELEGRAM.list({ limit: 1000 }) // Para simplicidade, assumimos menos de 1000 chaves. Adicionar paginação se necessário.
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

        const isOwner = loggedInUser.level === 0;

        // 2. Filtra a lista de chaves com base nas permissões do usuário
        const accessibleKeys = allKeys.filter(key => {
            if (isOwner) return true; // Dono vê tudo

            const pathParts = key.name.split('/');
            pathParts.pop();
            const folderPath = pathParts.join('/');
            if (!folderPath) return true; // Arquivo na raiz é sempre visível

            if (restrictedFolders[folderPath]) {
                return restrictedFolders[folderPath].includes(loggedInUser.roleId);
            }
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

        const accessibleFilesWithMetadata = (await Promise.all(filePromises)).filter(Boolean);

        // 4. Obtém a lista de todas as pastas que realmente existem para a UI
        const allExistingFolders = [...new Set(allKeys.map(k => k.name.substring(0, k.name.lastIndexOf('/'))).filter(Boolean))];

        const headers = new Headers({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        return new Response(JSON.stringify({ 
            files: accessibleFilesWithMetadata,
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