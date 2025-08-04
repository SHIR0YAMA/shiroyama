// /functions/api/admin/permissions.js

export async function onRequestGet(context) {
    try {
        // O _middleware.js já verificou a permissão 'can_manage_roles'
        const stmt = context.env.DB.prepare('SELECT id, name, description FROM permissions ORDER BY id');
        const { results } = await stmt.all();

        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error("Erro ao buscar permissões:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao buscar permissões." }), { status: 500 });
    }
}