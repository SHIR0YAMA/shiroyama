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
        const [permsResult, kvListResult] = await Promise.all([
            env.DB.prepare("SELECT role_id, folder_path FROM folder_permissions").all(),
            env.ARQUIVOS_TELEGRAM.list({ limit: 1000 }) // Para simplicidade, assumimos menos de 1000 chaves
        ]);

        const folderPerms = permsResult.results;
        const allKeys = kvListResult.keys;

        const restrictedFolders = {};
        folderPerms.forEach(p => {
            if (!restrictedFolders[p.folder_path]) {
                restrictedFolders[p.folder_path] = [];
            }
            restrictedFolders[p.folder_path].push(p.role_id);
        });

        const isOwner = loggedInUser.level === 0;
        
        // A lista de todas as pastas que realmente existem, antes do filtro de permissão
        const allExistingFolders = [...new Set(allKeys.map(k => k.name.substring(0, k.name.lastIndexOf('/'))).filter(Boolean))];

        // Filtra as chaves com base nas permissões do usuário
        const accessibleKeys = allKeys.filter(key => {
            if (isOwner) return true; // Dono vê tudo

            const folderPath = key.name.substring(0, key.name.lastIndexOf('/'));
            if (!folderPath) return true; // Arquivo na raiz é sempre visível

            // Verifica se a pasta tem alguma restrição
            if (restrictedFolders[folderPath]) {
                // Se for restrita, o usuário precisa ter um dos cargos permitidos
                return restrictedFolders[folderPath].includes(loggedInUser.roleId);
            }
            
            // Se a pasta não está na lista de restritas, é pública
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
        
        const headers = new Headers({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        return new Response(JSON.stringify({ 
            files: accessibleFilesWithMetadata,
            allFolders: allExistingFolders // Envia TODAS as pastas para o frontend poder checar se uma pasta existe
        }), { headers: headers });

    } catch (error) {
        console.error("Erro ao listar arquivos:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao buscar a lista de arquivos." }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}