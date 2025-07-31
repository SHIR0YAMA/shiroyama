// /functions/api/webhook.js

// --- FUNÇÃO DE DEPURAÇÃO ---
// Esta função apenas ajuda a formatar os logs.
function log(message) {
    console.log(`[Webhook Log] ${new Date().toISOString()}: ${message}`);
}

// --- FUNÇÃO PRINCIPAL DA API (WEBHOOK) - MODO DE DEPURAÇÃO ---

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const data = await request.json();

        // --- MUDANÇA CRÍTICA: LOGAMOS O CORPO INTEIRO DA REQUISIÇÃO ---
        // Este é o passo mais importante. Ele vai nos mostrar a estrutura exata dos dados.
        log("Recebido um novo evento do Telegram. Conteúdo completo abaixo:");
        console.log(JSON.stringify(data, null, 2)); // O '2' formata o JSON para ficar legível

        // Por enquanto, vamos manter a lógica antiga, mas agora sabemos que ela provavelmente não será acionada.
        // O log acima é o nosso foco.
        if (data.message && data.message.text) {
            log("Evento identificado como uma mensagem de texto padrão.");
            // A lógica antiga permanece aqui...
            const message = data.message;
            const from = message.from;
            const chat_id = from.id;

            if (message.text.startsWith('/start')) {
                const payload = message.text.split(' ')[1];
                // ... (o restante da lógica /start que já tínhamos) ...
                // Não precisa colar de novo, o importante é a estrutura.
            }

        } else {
            // Se o evento não for uma mensagem de texto, vamos registrar isso.
            log("AVISO: O evento recebido não é do tipo 'message.text'. Nenhuma ação foi tomada.");
        }
        
        // Sempre respondemos OK para o Telegram.
        return new Response('OK', { status: 200 });

    } catch (error) {
        log(`ERRO CRÍTICO no webhook: ${error.stack}`);
        return new Response('Erro interno do servidor.', { status: 500 });
    }
}