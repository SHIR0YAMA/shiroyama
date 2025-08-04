// /functions/api/admin/delete-user.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        // O _middleware.js já verificou a permissão 'can_manage_users'
        // Os dados do usuário logado estão em `data.user`
        const loggedInUser = data.user;
        const { userId } = await request.json();

        if (typeof userId !== 'number') {
            return new Response(JSON.stringify({ message: 'ID de usuário inválido.' }), { status: 400 });
        }

        if (loggedInUser.userId === userId) {
            return new Response(JSON.stringify({ message: 'Você não pode deletar sua própria conta.' }), { status: 400 });
        }

        const stmt = env.DB.prepare('DELETE FROM users WHERE id = ?');
        const info = await stmt.bind(userId).run();

        if (info.changes === 0) {
            return new Response(JSON.stringify({ message: 'Usuário não encontrado.' }), { status: 404 });
        }

        return new Response(JSON.stringify({ success: true, message: 'Usuário deletado com sucesso!' }));

    } catch (error) {
        console.error("Erro ao deletar usuário:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao deletar usuário." }), { status: 500 });
    }
}