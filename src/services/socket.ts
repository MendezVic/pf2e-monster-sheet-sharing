import { SOCKET_NAME } from '@/constants';

type SocketKind = 'request' | 'result' | 'error';
type RequestHandler<TData, TResult> = (data: TData, senderId: string) => Promise<TResult> | TResult;

interface BaseMessage {
  kind: SocketKind;
  requestId: string;
}

interface RequestMessage<TData = unknown> extends BaseMessage {
  kind: 'request';
  action: string;
  senderId: string;
  data: TData;
}

interface ResultMessage<TResult = unknown> extends BaseMessage {
  kind: 'result';
  targetId: string;
  data: TResult;
}

interface ErrorMessage extends BaseMessage {
  kind: 'error';
  targetId: string;
  error: string;
}

type SocketMessage = RequestMessage | ResultMessage | ErrorMessage;

const REQUEST_TIMEOUT_MS = 10_000;
const pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
const requestHandlers = new Map<string, RequestHandler<unknown, unknown>>();

export function registerSocket(): void {
  game.socket.on(SOCKET_NAME, (message: SocketMessage) => void handleSocketMessage(message));
}

export function registerRequestHandler<TData, TResult>(action: string, handler: RequestHandler<TData, TResult>): void {
  requestHandlers.set(action, handler as RequestHandler<unknown, unknown>);
}

export async function dispatchRequest<TData, TResult>(action: string, data: TData): Promise<TResult> {
  if (game.user.isGM) return handleRequest({ action, data, senderId: game.user.id }) as Promise<TResult>;

  const requestId = foundry.utils.randomID();
  const promise = new Promise<TResult>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(game.i18n.localize('pf2e-monster-sheet-sharing.errors.requestTimedOut')));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(requestId, {
      resolve: (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value as TResult);
      },
      reject: (reason) => {
        globalThis.clearTimeout(timeout);
        reject(reason);
      },
    });
  });

  game.socket.emit(SOCKET_NAME, {
    kind: 'request',
    action,
    requestId,
    senderId: game.user.id,
    data,
  } satisfies RequestMessage<TData>);

  return promise;
}

async function handleSocketMessage(message: SocketMessage): Promise<void> {
  if (message.kind === 'request') {
    if (!game.user.isGM) return;
    await answerRequest(message);
    return;
  }

  if (message.targetId !== game.user.id) return;

  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
  pendingRequests.delete(message.requestId);

  if (message.kind === 'result') {
    pending.resolve(message.data);
  } else {
    pending.reject(new Error(message.error));
  }
}

async function answerRequest(message: RequestMessage): Promise<void> {
  try {
    const data = await handleRequest(message);
    game.socket.emit(SOCKET_NAME, {
      kind: 'result',
      requestId: message.requestId,
      targetId: message.senderId,
      data,
    } satisfies ResultMessage);
  } catch (error) {
    game.socket.emit(SOCKET_NAME, {
      kind: 'error',
      requestId: message.requestId,
      targetId: message.senderId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ErrorMessage);
  }
}

async function handleRequest<TData = unknown, TResult = unknown>(message: {
  action: string;
  data: TData;
  senderId: string;
}): Promise<TResult> {
  const handler = requestHandlers.get(message.action);
  if (!handler) throw new Error(`No handler registered for ${message.action}`);
  return handler(message.data, message.senderId) as Promise<TResult>;
}
