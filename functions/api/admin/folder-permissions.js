// /functions/api/admin/folder-permissions.js

// Lida com a busca das permissões atuais de uma pasta específica
async function handleGet(context) {
    const { request, env, data } = context;
    const loggedInUser = data.user;
    const url = new URL(request.url);
    const folderPath = url.searchParams.get('path');

    if (!loggedInUser.permissions.includes('can_manage_folder_permissions')) {
        return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    if (!folderPath) {
        return new Response(JSON.stringify({ message: 'O caminho da pasta é obrigatório.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        const stmt = env.DB.prepare("SELECT role_id FROM folder_permissions WHERE folder_path = ?").bind(folderPath);
        const { results } = await stmt.all();
        const allowedRoleIds = results.map(r => r.role_id);
        return new Response(JSON.stringify({ allowedRoleIds }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error("Erro ao buscar permissões de pasta:", error);
        return new Response(JSON.stringify({ message: 'Erro interno no servidor.' }), { status: 500 });
    }
}

// Lida com a atualização das permissões de uma pasta
async function handlePost(context) {
    const { request, env, data } = context;
    const loggedInUser = data.user;
    
    if (!loggedInUser.permissions.includes('can_manage_folder_permissions')) {
        return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    
    try {
        const { folderPath, roleIds } = await request.json();
        const db = env.DB;

        if (!folderPath || !Array.isArray(roleIds)) {
            return new Response(JSON.stringify({ message: 'Payload inválido.' }), { status: 400 });
        }

        // Inicia uma transação para garantir a atomicidade da operação
        const batch = [
            // 1. Deleta todas as permissões antigas para esta pasta
            db.prepare("DELETE FROM folder_permissions WHERE folder_path = ?").bind(folderPath)
        ];

        // 2. Insere as novas permissões
        roleIds.forEach(roleId => {
            batch.push(db.prepare("INSERT INTO folder_permissions (folder_path, role_id) VALUES (?, ?)").bind(folderPath, roleId));
        });

        await db.batch(batch);

        // Log da ação
        await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'update_folder_perms', `Pasta: ${folderPath}`)
            .run();
            
        return new Response(JSON.stringify({ success: true, message: 'Permissões da pasta atualizadas.' }), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error("Erro ao salvar permissões de pasta:", error);
        return new Response(JSON.stringify({ message: 'Erro interno no servidor.' }), { status: 500 });
    }
}


export function onRequest(context) {
    switch (context.request.method) {
        case 'GET':
            return handleGet(context);
        case 'POST':
            return handlePost(context);
        default:
            return new Response('Método não permitido.', { status: 405 });
    }
}