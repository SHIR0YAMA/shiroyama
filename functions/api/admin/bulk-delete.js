// /functions/api/admin/bulk-delete.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { keys, prefix } = await request.json();

        if ((!keys || keys.length === 0) && !prefix) {
            return new Response(JSON.stringify({ message: 'É necessário fornecer "keys" ou "prefix".' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // --- LÓGICA DE EXCLUSÃO DE ARQUIVOS (SIMPLES) ---
        if (keys && Array.isArray(keys)) {
            if (!loggedInUser.permissions.includes('can_delete_items')) {
                return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para excluir itens.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
            await Promise.all(keys.map(key => env.ARQUIVOS_TELEGRAM.delete(key)));
            
            // Log e resposta de sucesso
            const logTarget = `Chaves: ${keys.slice(0,3).join(', ')}... (${keys.length} total)`;
            await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
                .bind(loggedInUser.userId, loggedInUser.username, 'delete_files', logTarget).run();
            return new Response(JSON.stringify({ success: true, message: `${keys.length} arquivo(s) excluído(s).` }));
        }

        // --- LÓGICA DE EXCLUSÃO DE PASTAS (ROBUSTA) ---
        if (prefix && typeof prefix === 'string') {
            if (!loggedInUser.permissions.includes('can_delete_items')) {
                return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para excluir itens.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            // Lista TODOS os objetos que começam com o prefixo da pasta.
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix: prefix });
            const keysToDelete = list.keys.map(k => k.name);
            
            // Garante que o placeholder da pasta em si também seja incluído na lista para exclusão.
            const placeholderKey = `${prefix.replace(/\/$/, '')}/.placeholder`;
            if (!keysToDelete.includes(placeholderKey)) {
                keysToDelete.push(placeholderKey);
            }

            if (keysToDelete.length > 0) {
                // O método delete do R2 aceita um array de até 1000 chaves. Isso é mais eficiente.
                // O KV Store exige um loop, mas o R2 (que você deve estar usando) é mais otimizado.
                await env.ARQUIVOS_TELEGRAM.delete(keysToDelete);
            }

            // Log e resposta de sucesso
            await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
                .bind(loggedInUser.userId, loggedInUser.username, 'delete_folder', `Prefixo: ${prefix}`).run();
            return new Response(JSON.stringify({ success: true, message: 'Pasta e seu conteúdo foram excluídos.' }));
        }

        return new Response(JSON.stringify({ message: 'Payload inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error("Erro ao excluir itens:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao excluir itens." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}