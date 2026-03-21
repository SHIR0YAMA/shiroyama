export async function onRequest() {
  return new Response(JSON.stringify({ message: 'Use /api/files/:id/download para baixar arquivos.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' }
  });
}
