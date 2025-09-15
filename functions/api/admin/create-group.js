// /functions/api/admin/create-group.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;

        // 1. Verificação de Permissão
        if (!loggedInUser.permissions.includes('can_group_items')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para agrupar arquivos.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        const { groupName, folderPath, fileKeys } = await request.json();

        if (!groupName || !folderPath || !Array.isArray(fileKeys) || fileKeys.length === 0) {
            return new Response(JSON.stringify({ message: 'Dados inválidos. É necessário nome do grupo, caminho da pasta e uma lista de arquivos.' }), { status: 400, headers: { 'Content-Type': 'application/json' }});
        }
        
        const db = env.DB;
        
        // 2. Cria o grupo na tabela 'file_groups'
        const groupInsertStmt = db.prepare('INSERT INTO file_groups (name, folder_path) VALUES (?, ?)')
            .bind(groupName, folderPath);
        const { meta } = await groupInsertStmt.run();
        const newGroupId = meta.last_row_id;

        if (!newGroupId) {
            throw new Error("Não foi possível criar o grupo e obter seu ID.");
        }

        // 3. Prepara as inserções para cada arquivo na tabela 'group_items'
        const insertStmts = fileKeys.map((key, index) => {
            return db.prepare('INSERT INTO group_items (group_id, file_key, part_number) VALUES (?, ?, ?)')
                .bind(newGroupId, key, index + 1); // part_number é baseado na ordem do array
        });

        // 4. Executa todas as inserções dos itens em um único batch (transação)
        await db.batch(insertStmts);
        
        // Log da ação
        await db.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'create_file_group', `Grupo: ${groupName} (${fileKeys.length} partes)`)
            .run();

        return new Response(JSON.stringify({ success: true, message: `Grupo "${groupName}" criado com sucesso.` }), { status: 201, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
             return new Response(JSON.stringify({ message: 'Um arquivo neste grupo já pertence a outro grupo.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        console.error("Erro ao criar grupo de arquivos:", error);
        return new Response(JSON.stringify({ message: `Erro no servidor: ${error.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}