// /functions/api/admin/ungroup.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;

        // 1. Verificação de Permissão
        if (!loggedInUser.permissions.includes('can_group_items')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para desagrupar arquivos.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        const { groupId } = await request.json();

        if (!groupId || typeof groupId !== 'number') {
            return new Response(JSON.stringify({ message: 'ID do grupo inválido ou não fornecido.' }), { status: 400, headers: { 'Content-Type': 'application/json' }});
        }
        
        const db = env.DB;
        
        // 2. Busca o nome do grupo para o log antes de deletar
        const groupName = await db.prepare("SELECT name FROM file_groups WHERE id = ?").bind(groupId).first("name");
        
        // 3. Deleta o grupo da tabela 'file_groups'.
        // Graças ao 'ON DELETE CASCADE' na tabela 'group_items', todos os itens associados serão deletados automaticamente.
        const { success } = await db.prepare('DELETE FROM file_groups WHERE id = ?').bind(groupId).run();

        if (!success) {
            throw new Error("Falha ao deletar o grupo do banco de dados.");
        }
        
        // 4. Log da ação
        await db.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'delete_file_group', `Grupo: ${groupName || 'ID:'} ${groupId}`)
            .run();

        return new Response(JSON.stringify({ success: true, message: `Grupo desagrupado com sucesso.` }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error("Erro ao desagrupar arquivos:", error);
        return new Response(JSON.stringify({ message: `Erro no servidor: ${error.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}