export async function onRequestPost() {
  return new Response(JSON.stringify({ message: 'Vínculo via bot removido na versão local.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' }
  });
}
