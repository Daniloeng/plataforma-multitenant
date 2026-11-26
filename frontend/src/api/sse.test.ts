import { SseParser, lerSse, type MensagemSse } from './sse';

function parser() {
  const mensagens: MensagemSse[] = [];
  const comentarios: string[] = [];
  const p = new SseParser({
    onMessage: (m) => mensagens.push(m),
    onComment: (c) => comentarios.push(c),
  });
  return { p, mensagens, comentarios };
}

/** Corpo de fluxo com os pedaços dados (texto ou bytes), na ordem. */
function corpo(pedacos: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const p of pedacos) controller.enqueue(typeof p === 'string' ? encoder.encode(p) : p);
      controller.close();
    },
  });
}

describe('SseParser', () => {
  it('lê event, id e data; a linha em branco separa as mensagens', () => {
    const { p, mensagens } = parser();
    p.push('event: pedido\nid: 1\ndata: {"a":1}\n\nevent: pedido\nid: 2\ndata: {"a":2}\n\n');
    expect(mensagens).toEqual([
      { event: 'pedido', id: '1', data: '{"a":1}' },
      { event: 'pedido', id: '2', data: '{"a":2}' },
    ]);
  });

  it('mensagem partida entre pedaços (até no meio do campo) só sai quando completa', () => {
    const { p, mensagens } = parser();
    const texto = 'event: pedido\nid: 7\ndata: {"status":"PENDENTE"}\n\n';
    for (const char of texto) p.push(char);
    expect(mensagens).toEqual([{ event: 'pedido', id: '7', data: '{"status":"PENDENTE"}' }]);

    p.push('event: ped');
    p.push('ido\ndata: x');
    expect(mensagens).toHaveLength(1);
    p.push('y\n');
    expect(mensagens).toHaveLength(1);
    p.push('\n');
    expect(mensagens[1]).toEqual({ event: 'pedido', id: '7', data: 'xy' });
  });

  it('comentários (": ping") não viram mensagem', () => {
    const { p, mensagens, comentarios } = parser();
    p.push(': ping\n\n:sem-espaco\n\n');
    expect(mensagens).toEqual([]);
    expect(comentarios).toEqual(['ping', 'sem-espaco']);
    // Sem onComment, o comentário é só ignorado.
    const sem = new SseParser({ onMessage: () => undefined });
    expect(() => sem.push(': ping\n\n')).not.toThrow();
  });

  it('várias linhas data viram uma só, com "\\n"; sem event, o tipo é "message"', () => {
    const { p, mensagens } = parser();
    p.push('data: linha 1\ndata: linha 2\ndata\n\n');
    expect(mensagens).toEqual([{ event: 'message', id: null, data: 'linha 1\nlinha 2\n' }]);
  });

  it('tira só um espaço depois do ":"; campo sem ":" tem valor vazio', () => {
    const { p, mensagens } = parser();
    p.push('data:  dois espaços\ndata:sem\n\n');
    expect(mensagens[0]!.data).toBe(' dois espaços\nsem');
  });

  it('o id vale para as mensagens seguintes; id com NUL é ignorado; mensagem sem data só atualiza o id', () => {
    const { p, mensagens } = parser();
    p.push('id: 3\n\ndata: a\n\nid: 4\u0000\ndata: b\n\nevent: x\n\n');
    expect(mensagens).toEqual([
      { event: 'message', id: '3', data: 'a' },
      { event: 'message', id: '3', data: 'b' },
    ]);
    // O event da mensagem sem data não vaza para a próxima.
    p.push('data: c\n\n');
    expect(mensagens[2]).toEqual({ event: 'message', id: '3', data: 'c' });
  });

  it('ignora retry e campos desconhecidos', () => {
    const { p, mensagens } = parser();
    p.push('retry: 1000\nfoo: bar\ndata: ok\n\n');
    expect(mensagens).toEqual([{ event: 'message', id: null, data: 'ok' }]);
  });

  it('aceita CRLF e CR, inclusive com o "\\r\\n" partido entre pedaços', () => {
    const { p, mensagens } = parser();
    p.push('data: a\r\n\r\ndata: b\r\rdata: c\r');
    expect(mensagens.map((m) => m.data)).toEqual(['a', 'b']);
    p.push('\n\r\n');
    expect(mensagens.map((m) => m.data)).toEqual(['a', 'b', 'c']);
  });

  it('end: uma linha terminada em "\\r" é processada; mensagem sem a linha em branco é descartada', () => {
    const { p, mensagens } = parser();
    p.push('data: completa\n\r');
    p.end();
    expect(mensagens.map((m) => m.data)).toEqual(['completa']);
    p.push('data: incompleta\n');
    p.end();
    p.push('\n');
    expect(mensagens).toHaveLength(1);
  });
});

describe('lerSse', () => {
  it('lê o corpo inteiro, com UTF-8 partido entre pedaços', async () => {
    const bytes = new TextEncoder().encode('data: ação\n\n');
    const meio = bytes.indexOf(0xc3) + 1; // no meio do "ç"
    const mensagens: MensagemSse[] = [];
    await lerSse(corpo([bytes.slice(0, meio), bytes.slice(meio), ': ping\n\n']), {
      onMessage: (m) => mensagens.push(m),
    });
    expect(mensagens).toEqual([{ event: 'message', id: null, data: 'ação' }]);
  });

  it('erro lançado por onMessage cancela o fluxo e rejeita', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: x\n\n'));
      },
      cancel,
    });
    await expect(
      lerSse(body, {
        onMessage: () => {
          throw new Error('fora do contrato');
        },
      }),
    ).rejects.toThrow('fora do contrato');
    expect(cancel).toHaveBeenCalled();
  });

  it('abortar o signal cancela a leitura e termina sem erro', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    const leitura = lerSse(body, { onMessage: () => undefined }, controller.signal);
    controller.abort();
    await expect(leitura).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalled();
  });

  it('signal já abortado não lê nada', async () => {
    const controller = new AbortController();
    controller.abort();
    const onMessage = vi.fn();
    await lerSse(corpo(['data: x\n\n']), { onMessage }, controller.signal);
    expect(onMessage).not.toHaveBeenCalled();
  });
});
