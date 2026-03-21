// /functions/api/admin/bulk-delete.js

function splitFilePath(fullPath) {
    const normalized = String(fullPath || '').replace(/^\/+|\/+$/g, '');
    const parts = normalized.split('/').filter(Boolean);
    const fileName = parts.pop() || '';
    return { folderPath: parts.join('/'), fileName };
}

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { keys, prefix } = await request.json();

        if (!loggedInUser.permissions.includes('can_delete_items')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para excluir itens.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        if (prefix) {
            const folderPrefix = String(prefix).replace(/^\/+|\/+$/g, '');
            if (!folderPrefix) return new Response(JSON.stringify({ message: 'Prefixo inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

            const deleteResult = await env.DB.batch([
                env.DB.prepare('DELETE FROM files WHERE folder_path = ? OR folder_path LIKE ?').bind(folderPrefix, `${folderPrefix}/%`),
                env.DB.prepare('DELETE FROM folder_permissions WHERE folder_path = ? OR folder_path LIKE ?').bind(folderPrefix, `${folderPrefix}/%`),
                env.DB.prepare('DELETE FROM folders WHERE folder_path = ? OR folder_path LIKE ?').bind(folderPrefix, `${folderPrefix}/%`)
            ]);

            const affected = (deleteResult || []).reduce((sum, r) => sum + (r.meta?.changes || 0), 0);
            if (affected === 0) {
                return new Response(JSON.stringify({ message: 'Pasta não encontrada para exclusão.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
            }

            return new Response(JSON.stringify({ success: true, message: 'Pasta e conteúdo excluídos.' }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (keys && keys.length > 0) {
            let deleted = 0;
            for (const key of keys) {
                const parsed = splitFilePath(key);
                if (!parsed.fileName) continue;
                const res = await env.DB.prepare('DELETE FROM files WHERE folder_path = ? AND file_name = ?').bind(parsed.folderPath, parsed.fileName).run();
                deleted += res.meta?.changes || 0;
            }

            if (deleted === 0) {
                return new Response(JSON.stringify({ message: 'Nenhum arquivo encontrado para exclusão.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
            }

            return new Response(JSON.stringify({ success: true, message: `${deleted} arquivo(s) excluído(s).` }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ message: 'Nenhuma chave ou prefixo fornecido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error('Erro em bulk-delete:', error);
        return new Response(JSON.stringify({ message: `Erro interno no servidor: ${error.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
