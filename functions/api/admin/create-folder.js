// /functions/api/admin/create-folder.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        
        if (!loggedInUser.permissions.includes('can_create_folders')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para criar pastas.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        const { folderPath } = await request.json();

        if (!folderPath || folderPath.includes('//') || folderPath.endsWith('/')) {
            return new Response(JSON.stringify({ message: 'Nome de pasta inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        // Remove qualquer barra inicial do caminho para evitar chaves inválidas.
        const normalizedPath = folderPath.startsWith('/') ? folderPath.substring(1) : folderPath;
        const key = `${normalizedPath}/.placeholder`;

        const existing = await env.ARQUIVOS_TELEGRAM.get(key);
        if (existing !== null) {
            return new Response(JSON.stringify({ message: 'Uma pasta ou arquivo com este nome já existe.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }

        const value = JSON.stringify({ created_at: new Date().toISOString() });
        await env.ARQUIVOS_TELEGRAM.put(key, value);
        
        // Log da ação
        await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'create_folder', `Caminho: ${normalizedPath}`)
            .run();

        return new Response(JSON.stringify({ success: true, message: 'Pasta criada com sucesso.' }), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error("Erro ao criar pasta:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao criar pasta." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}