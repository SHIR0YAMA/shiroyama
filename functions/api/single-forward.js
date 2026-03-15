export async function onRequestPost() {
  return new Response(JSON.stringify({ message: 'Fluxo com bot do Telegram removido na versão local.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' }
  });
}
