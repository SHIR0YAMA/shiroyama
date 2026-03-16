// /functions/api/admin/bulk-move.js

function splitFilePath(fullPath) {
    const normalized = String(fullPath || '').replace(/^\/+|\/+$/g, '');
    const parts = normalized.split('/').filter(Boolean);
    const fileName = parts.pop() || '';
    return { folderPath: parts.join('/'), fileName };
}

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const { oldKeys, destinationPath } = await request.json();

        if (!Array.isArray(oldKeys) || oldKeys.length === 0 || typeof destinationPath !== 'string') {
            return new Response(JSON.stringify({ message: 'Payload inválido. É necessário "oldKeys" (array) e "destinationPath" (string).' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const destination = String(destinationPath).replace(/^\/+|\/+$/g, '');
        const ops = [];
        let movedCount = 0;

        for (const oldKey of oldKeys) {
            const parsed = splitFilePath(oldKey);
            if (!parsed.fileName) continue;

            const row = await env.DB.prepare('SELECT id FROM files WHERE folder_path = ? AND file_name = ? LIMIT 1')
                .bind(parsed.folderPath, parsed.fileName)
                .first();
            if (!row) continue;

            ops.push(env.DB.prepare('UPDATE files SET folder_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(destination, row.id));
            movedCount += 1;
        }

        if (ops.length === 0) {
            return new Response(JSON.stringify({ message: 'Nenhum arquivo encontrado para mover.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        await env.DB.batch(ops);

        return new Response(JSON.stringify({ success: true, message: `${movedCount} arquivo(s) movido(s) com sucesso.` }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error('Erro ao mover arquivos em massa:', error);
        return new Response(JSON.stringify({ message: `Erro interno ao mover arquivos: ${error.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
