// /functions/api/admin/permissions.js

export async function onRequestGet(context) {
    try {
        // A verificação de permissão 'roles:view_list' é feita pelo _middleware.js
        const stmt = context.env.DB.prepare('SELECT id, name, description FROM permissions ORDER BY id');
        const { results } = await stmt.all();

        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ message: "Erro interno ao buscar permissões." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}