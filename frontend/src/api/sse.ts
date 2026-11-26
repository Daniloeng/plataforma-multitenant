// Leitor de Server-Sent Events (text/event-stream) sobre fetch + ReadableStream.
//
// O EventSource do navegador não envia o cabeçalho Authorization, e toda API passa pelo gateway
// com o token; por isso a linha do tempo do pedido é lida com fetch (apiFetch) e este parser.
// Segue o formato da especificação do HTML (seção "Server-sent events"): linhas `campo: valor`,
// comentários começando com `:`, linha em branco encerrando a mensagem, CRLF, LF ou CR como fim de
// linha e mensagens partidas em pedaços quaisquer (até no meio de um caractere UTF-8).

/** Uma mensagem SSE completa. */
export interface MensagemSse {
  /** Campo `event`; sem ele, "message". */
  event: string;
  /** Linhas `data` juntadas com "\n". */
  data: string;
  /** Último `id` recebido (vale para as mensagens seguintes também), ou null. */
  id: string | null;
}

export interface SseHandlers {
  onMessage: (mensagem: MensagemSse) => void;
  /** Comentário (linha que começa com ":"), sem o ":" e o espaço seguinte. Ex.: "ping". */
  onComment?: (texto: string) => void;
}

/** Valor da linha: tira um único espaço depois do ":", como manda a especificação. */
function valorDe(texto: string): string {
  return texto.startsWith(' ') ? texto.slice(1) : texto;
}

/**
 * Parser incremental: `push` recebe texto em pedaços (como chegam da rede) e chama `onMessage` a
 * cada mensagem completa; `end` encerra (uma mensagem sem a linha em branco final é descartada).
 */
export class SseParser {
  private buffer = '';
  private dados: string[] = [];
  private evento = '';
  private ultimoId: string | null = null;

  constructor(private readonly handlers: SseHandlers) {}

  push(pedaco: string): void {
    this.buffer += pedaco;
    for (;;) {
      const fim = this.buffer.search(/[\r\n]/);
      if (fim < 0) return;
      const char = this.buffer[fim];
      // Um "\r" no fim do pedaço pode ser a metade de um "\r\n": espera o próximo pedaço.
      if (char === '\r' && fim === this.buffer.length - 1) return;
      const tamanho = char === '\r' && this.buffer[fim + 1] === '\n' ? 2 : 1;
      const linha = this.buffer.slice(0, fim);
      this.buffer = this.buffer.slice(fim + tamanho);
      this.linha(linha);
    }
  }

  /** Fim do fluxo: processa uma linha pendente terminada em "\r"; o resto incompleto é descartado. */
  end(): void {
    if (this.buffer.endsWith('\r')) this.linha(this.buffer.slice(0, -1));
    this.buffer = '';
    this.dados = [];
    this.evento = '';
  }

  private linha(linha: string): void {
    if (linha === '') {
      this.despachar();
      return;
    }
    if (linha.startsWith(':')) {
      this.handlers.onComment?.(valorDe(linha.slice(1)));
      return;
    }
    const doisPontos = linha.indexOf(':');
    const campo = doisPontos < 0 ? linha : linha.slice(0, doisPontos);
    const valor = doisPontos < 0 ? '' : valorDe(linha.slice(doisPontos + 1));
    if (campo === 'event') this.evento = valor;
    else if (campo === 'data') this.dados.push(valor);
    else if (campo === 'id' && !valor.includes('\0')) this.ultimoId = valor;
    // `retry` e campos desconhecidos são ignorados: a reconexão é do hook, com backoff próprio.
  }

  private despachar(): void {
    const dados = this.dados;
    const evento = this.evento;
    this.dados = [];
    this.evento = '';
    // Mensagem sem `data` não é entregue (só atualiza o id), como no EventSource.
    if (dados.length === 0) return;
    this.handlers.onMessage({
      event: evento || 'message',
      data: dados.join('\n'),
      id: this.ultimoId,
    });
  }
}

/**
 * Lê um corpo text/event-stream até o fim, entregando cada mensagem. Abortar `signal` cancela a
 * leitura (e a promessa termina sem erro). Um erro lançado por `onMessage` cancela o fluxo e
 * rejeita a promessa.
 */
export async function lerSse(
  body: ReadableStream<Uint8Array>,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser(handlers);
  const cancelar = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', cancelar);
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) {
        parser.push(decoder.decode());
        parser.end();
        return;
      }
      parser.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    signal?.removeEventListener('abort', cancelar);
    cancelar();
  }
}
