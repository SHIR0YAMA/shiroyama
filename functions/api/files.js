// /functions/api/files.js

export async function onRequestGet(context) {
    const { env, data } = context;
    const loggedInUser = data.user;

    if (!loggedInUser || !loggedInUser.permissions.includes('can_view_files')) {
        return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        const [permsResult, kvListResult] = await Promise.all([
            env.DB.prepare("SELECT role_id, folder_path FROM folder_permissions").all(),
            env.ARQUIVOS_TELEGRAM.list({ limit: 1000 }) // Adicionar paginação aqui se tiver mais de 1000 chaves
        ]);

        const folderPerms = permsResult.results;
        const allKeys = kvListResult.keys;

        const permissionMap = new Map();
        folderPerms.forEach(p => {
            if (!permissionMap.has(p.folder_path)) {
                permissionMap.set(p.folder_path, new Set());
            }
            permissionMap.get(p.folder_path).add(p.role_id);
        });

        const isOwner = loggedInUser.level === 0;

        const accessibleKeys = allKeys.filter(key => {
            if (isOwner) return true;

            const pathParts = key.name.split('/');
            pathParts.pop(); // Remove o nome do arquivo

            // Itera do caminho mais específico para o mais geral
            for (let i = pathParts.length; i > 0; i--) {
                const currentPath = pathParts.slice(0, i).join('/');
                if (permissionMap.has(currentPath)) {
                    // Encontrou a regra mais próxima. Se o usuário tiver permissão, ele pode ver.
                    return permissionMap.get(currentPath).has(loggedInUser.roleId);
                }
            }
            
            // Se nenhum pai na hierarquia tem restrição, é público
            return true;
        });

        // Obtém os metadados apenas para as chaves acessíveis
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
        
        const allExistingFolders = [...new Set(allKeys.map(k => k.name.substring(0, k.name.lastIndexOf('/'))).filter(Boolean))];

        const headers = new Headers({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });

        return new Response(JSON.stringify({ 
            files: accessibleFilesWithMetadata,
            allFolders: allExistingFolders 
        }), { headers });

    } catch (error) {
        console.error("Erro ao listar arquivos:", error);
        return new Response(JSON.stringify({ message: "Erro interno." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}